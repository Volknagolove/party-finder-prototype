"""Local Party Finder API and static server. Run: python server.py"""

from __future__ import annotations

import hmac
import json
import os
import re
import sqlite3
import sys
import time
import uuid
from contextlib import closing
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / ".local-packages"))
DB_PATH = Path(os.environ.get("PARTY_FINDER_DB", ROOT / "data" / "party-finder.sqlite3"))
PORT = int(os.environ.get("PARTY_FINDER_PORT", "8003"))
LIFETIME_MS = 7 * 24 * 60 * 60 * 1000
CLASS_LIST = json.loads((ROOT / "class-codes.json").read_text(encoding="utf-8"))
CLASS_BY_CODE = {entry["code"]: entry["name"] for entry in CLASS_LIST}
VALID_CLASSES = {entry["name"] for entry in CLASS_LIST}
SERVERS = {"bartz", "teon", "erica"}
DEMO_CHARACTERS = {
    "char-101": ("bartz", "Kain", "Warcryer", 78),
    "char-102": ("bartz", "Mirael", "Paladin", 76),
    "char-103": ("bartz", "Elyria", "Bishop", 74),
    "char-104": ("bartz", "Ardent", "Gladiator", 79),
    "char-105": ("bartz", "Lunara", "Spellsinger", 77),
    "char-201": ("teon", "Rhett", "Dark Avenger", 72),
    "char-202": ("teon", "Serena", "Elven Elder", 73),
    "char-203": ("teon", "Torvik", "Destroyer", 75),
    "char-204": ("teon", "Shade", "Treasure Hunter", 74),
    "char-205": ("teon", "Aether", "Sorcerer", 76),
    "char-301": ("erica", "Selene", "Shillien Elder", 74),
    "char-302": ("erica", "Varyn", "Warlord", 77),
    "char-303": ("erica", "Neris", "Necromancer", 76),
    "char-304": ("erica", "Lyra", "Swordsinger", 75),
    "char-305": ("erica", "Morrin", "Phantom Summoner", 73),
}


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message


def now_ms() -> int:
    return int(time.time() * 1000)


def new_id(prefix: str) -> str:
    return f"{prefix}:{uuid.uuid4().hex}"


def db_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def text(value: object, maximum: int, *, required: bool = False) -> str:
    clean = str(value or "").strip()[:maximum]
    if required and not clean:
        raise ApiError(400, "Заполни обязательные поля.")
    return clean


def time_zone(value: object) -> str:
    zone = text(value, 64, required=True)
    try:
        ZoneInfo(zone)
    except ZoneInfoNotFoundError as exc:
        raise ApiError(400, "Неизвестный часовой пояс.") from exc
    return zone


def weekly(value: object, *, required: bool = True) -> list[list[int]]:
    if not isinstance(value, list) or len(value) != 7:
        raise ApiError(400, "Расписание должно содержать семь дней.")
    result = []
    for day in value:
        if not isinstance(day, list) or any(type(hour) is not int or hour < 0 or hour > 23 for hour in day):
            raise ApiError(400, "В расписании допустимы только часы от 0 до 23.")
        result.append(sorted(set(day)))
    if required and not any(result):
        raise ApiError(400, "Укажи часы игры.")
    return result


def weekly_slots(value: list[list[int]], zone_name: str) -> set[int]:
    zone = ZoneInfo(zone_name)
    monday = datetime.now(zone).date()
    monday -= timedelta(days=monday.weekday())
    slots = set()
    for day_index, hours in enumerate(value):
        for hour in hours:
            local = datetime(monday.year, monday.month, monday.day, hour, tzinfo=zone) + timedelta(days=day_index)
            utc = local.astimezone(timezone.utc)
            slots.add(utc.weekday() * 24 + utc.hour)
    return slots


def party_matches(connection: sqlite3.Connection, party: sqlite3.Row, class_name: str, level: int,
                  availability: list[list[int]], applicant_zone: str) -> bool:
    vacancies = connection.execute(
        "SELECT slot_number, class_name, min_level, max_level FROM vacancies WHERE party_id=? ORDER BY slot_number",
        (party["id"],),
    ).fetchall()
    occupied = {row[0] for row in connection.execute(
        "SELECT accepted_slot FROM applications WHERE party_id=? AND status='accepted'",
        (party["id"],),
    )}
    fits = any(index not in occupied and (not vacancy["class_name"] or vacancy["class_name"] == class_name)
               and vacancy["min_level"] <= level <= vacancy["max_level"]
               for index, vacancy in enumerate(vacancies))
    return fits and weekly_slots(json.loads(party["weekly_availability"]), party["time_zone"]).issubset(
        weekly_slots(availability, applicant_zone))


def party_data(connection: sqlite3.Connection, row: sqlite3.Row, include_contacts: bool = False) -> dict:
    members = connection.execute(
        "SELECT slot_number, name, class_name, level, character_id, is_leader FROM party_members WHERE party_id=? ORDER BY slot_number",
        (row["id"],),
    ).fetchall()
    vacancies = connection.execute(
        "SELECT slot_number, class_name, min_level, max_level FROM vacancies WHERE party_id=? ORDER BY slot_number",
        (row["id"],),
    ).fetchall()
    accepted = connection.execute(
        "SELECT accepted_slot, character_name, class_name, level FROM applications WHERE party_id=? AND status='accepted'",
        (row["id"],),
    ).fetchall()
    return {
        "id": row["id"], "name": row["name"], "serverId": row["server_id"],
        "leaderCharacterId": row["leader_character_id"], "leaderName": row["leader_name"],
        "leaderClass": row["leader_class"], "leaderLevel": row["leader_level"],
        "authStatus": row["auth_status"],
        **({"contacts": {"telegram": row["telegram"], "discord": row["discord"]}} if include_contacts else {}),
        "members": [{"slotNumber": item["slot_number"], "name": item["name"],
                     "className": item["class_name"], "level": item["level"],
                     "characterId": item["character_id"]} for item in members if not item["is_leader"]],
        "vacancies": [{"slotNumber": item["slot_number"], "className": item["class_name"] or "",
                       "minLevel": item["min_level"], "maxLevel": item["max_level"]} for item in vacancies],
        "acceptedMembers": [{"vacancyIndex": item["accepted_slot"], "name": item["character_name"],
                             "className": item["class_name"], "level": item["level"]} for item in accepted],
        "weeklyAvailability": json.loads(row["weekly_availability"]), "timeZone": row["time_zone"],
        "createdAt": row["created_at"], "expiresAt": row["expires_at"],
        "source": row["source"], "status": row["status"],
    }


def application_data(connection: sqlite3.Connection, row: sqlite3.Row, viewer_key: str) -> dict:
    party = connection.execute("SELECT * FROM parties WHERE id=?", (row["party_id"],)).fetchone()
    mine = row["owner_key"] == viewer_key
    return {
        "id": row["id"], "source": "self" if mine else "candidate",
        "partyId": row["party_id"], "partyName": party["name"], "serverId": party["server_id"],
        "characterId": row["character_id"], "characterName": row["character_name"],
        "className": row["class_name"], "level": row["level"], "authStatus": row["auth_status"],
        "contacts": {"telegram": row["telegram"], "discord": row["discord"]},
        "leaderContacts": {"telegram": party["telegram"], "discord": party["discord"]},
        "leaderName": party["leader_name"], "leaderAuthStatus": party["auth_status"],
        "availability": json.loads(row["weekly_availability"]), "timeZone": row["time_zone"],
        "status": row["status"], "acceptedSlot": row["accepted_slot"], "createdAt": row["created_at"],
        "demoCandidate": row["owner_key"].startswith("seed:"),
    }


def seed_fixture_parties(connection: sqlite3.Connection) -> None:
    fixtures = json.loads((ROOT / "demo-fixtures.json").read_text(encoding="utf-8"))
    for server_id in SERVERS:
        for index, fixture in enumerate(fixtures):
            party_id = f"fixture:{server_id}:{index}"
            if connection.execute("SELECT 1 FROM parties WHERE id=?", (party_id,)).fetchone():
                continue
            slug = re.sub(r"[^a-z0-9]+", "_", fixture["name"].lower()).strip("_")[:18]
            now = now_ms()
            connection.execute("""INSERT INTO parties
              (id, owner_key, server_id, name, leader_character_id, leader_name, leader_class,
               leader_level, auth_status, telegram, discord, time_zone, weekly_availability,
               source, status, created_at, expires_at)
              VALUES (?, NULL, ?, ?, NULL, ?, ?, 75, 'demo', ?, ?, 'Europe/Madrid', ?, 'fixture', 'active', ?, ?)""",
              (party_id, server_id, fixture["name"], fixture["leader"], "Warcryer",
               f"@demo_{slug}", f"demo.{slug}", json.dumps([fixture["hours"]] * 7), now, now + 10 * 365 * 86400000))
            connection.execute("INSERT INTO party_members VALUES (?, ?, 1, ?, 'Warcryer', 75, NULL, 1)",
                               (new_id("member"), party_id, fixture["leader"]))
            slot = 2
            for code, label in fixture["roles"]:
                if slot > 9:
                    break
                class_name = CLASS_BY_CODE.get(code)
                if not class_name:
                    continue
                is_open = code in fixture["open"]
                if is_open:
                    connection.execute(
                        "INSERT INTO vacancies (id, party_id, slot_number, class_name, min_level, max_level) VALUES (?, ?, ?, ?, 1, 80)",
                        (new_id("vacancy"), party_id, slot, class_name))
                else:
                    connection.execute("INSERT INTO party_members VALUES (?, ?, ?, ?, ?, NULL, NULL, 0)",
                                       (new_id("member"), party_id, slot, label, class_name))
                slot += 1
            for code in fixture["open"]:
                class_name = CLASS_BY_CODE.get(code)
                if slot > 9 or not class_name or any(
                    item["class_name"] == class_name for item in connection.execute(
                        "SELECT class_name FROM vacancies WHERE party_id=?", (party_id,))):
                    continue
                connection.execute(
                    "INSERT INTO vacancies (id, party_id, slot_number, class_name, min_level, max_level) VALUES (?, ?, ?, ?, 1, 80)",
                    (new_id("vacancy"), party_id, slot, class_name))
                slot += 1


def seed_demo_account(connection: sqlite3.Connection) -> None:
    existing = connection.execute("SELECT 1 FROM parties WHERE owner_key='demo-account' AND source='user'").fetchone()
    if existing:
        seed_demo_application(connection)
        return
    now = now_ms()
    party_id = new_id("party")
    schedule = json.dumps([[19, 20, 21] for _ in range(7)])
    connection.execute("""INSERT INTO parties
      (id, owner_key, server_id, name, leader_character_id, leader_name, leader_class, leader_level,
       auth_status, telegram, discord, time_zone, weekly_availability, source, status, created_at, expires_at)
      VALUES (?, 'demo-account', 'teon', 'Стражи Теона', 'char-201', 'Rhett', 'Dark Avenger', 72,
       'profile', '@demo_teon_leader', 'teon.leader.demo', 'Europe/Madrid', ?, 'user', 'active', ?, ?)""",
      (party_id, schedule, now, now + LIFETIME_MS))
    for slot, name, class_name, leader in [(1, "Rhett", "Dark Avenger", 1),
                                           (2, "Aria", "Bishop", 0), (3, "Voss", "Warcryer", 0)]:
        connection.execute("INSERT INTO party_members VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)",
                           (new_id("member"), party_id, slot, name, class_name, leader))
    for slot, class_name in [(4, "Treasure Hunter"), (5, "Elven Elder"), (6, "Gladiator")]:
        connection.execute(
            "INSERT INTO vacancies (id, party_id, slot_number, class_name, min_level, max_level) VALUES (?, ?, ?, ?, 70, 78)",
            (new_id("vacancy"), party_id, slot, class_name))
    for index, (name, class_name, level) in enumerate([
        ("Elion", "Treasure Hunter", 77), ("Mirael", "Elven Elder", 74),
        ("Ragnar", "Gladiator", 76), ("Neris", "Gladiator", 75),
    ]):
        owner_key = f"seed:{index}"
        connection.execute("INSERT OR IGNORE INTO sessions (id, mode, created_at, owner_key) VALUES (?, 'guest', ?, ?)", (owner_key, now, owner_key))
        connection.execute("""INSERT INTO applications
          (id, party_id, owner_key, character_id, character_name, class_name, level, auth_status,
           telegram, discord, time_zone, weekly_availability, created_at)
          VALUES (?, ?, ?, NULL, ?, ?, ?, 'guest', ?, ?, 'Europe/Madrid', ?, ?)""",
          (new_id("application"), party_id, owner_key, name, class_name, level,
           f"@demo_{name.lower()}", f"demo.{name.lower()}",
           json.dumps([[19, 20, 21] for _ in range(7)]), now - (index + 1) * 3600000))
    seed_demo_application(connection)


def seed_demo_application(connection: sqlite3.Connection) -> None:
    fixture_id = "fixture:bartz:4"
    if (connection.execute("SELECT 1 FROM parties WHERE id=?", (fixture_id,)).fetchone()
            and not connection.execute("SELECT 1 FROM applications WHERE owner_key='demo-account' AND party_id=?", (fixture_id,)).fetchone()):
        now = now_ms()
        connection.execute("""INSERT INTO applications
          (id, party_id, owner_key, character_id, character_name, class_name, level, auth_status,
           telegram, discord, time_zone, weekly_availability, created_at)
          VALUES (?, ?, 'demo-account', 'char-101', 'Kain', 'Warcryer', 78, 'profile',
           '@demo_party_player', 'demo.party.player', 'Europe/Madrid', ?, ?)""",
          (new_id("application"), fixture_id, json.dumps([[18, 19, 20, 21, 22] for _ in range(7)]), now))


def validate_party(payload: dict, mode: str) -> dict:
    server_id = text(payload.get("serverId"), 24, required=True)
    if server_id not in SERVERS:
        raise ApiError(400, "Выбери действующий сервер.")
    name = text(payload.get("name"), 36, required=True)
    contacts = payload.get("contacts") or {}
    telegram, discord = text(contacts.get("telegram"), 64), text(contacts.get("discord"), 64)
    if not (telegram or discord):
        raise ApiError(400, "Укажи хотя бы один контакт лидера.")
    schedule = weekly(payload.get("weeklyAvailability"))
    zone = time_zone(payload.get("timeZone"))
    if mode == "demo":
        character_id = text(payload.get("leaderCharacterId"), 64, required=True)
        character = DEMO_CHARACTERS.get(character_id)
        if not character or character[0] != server_id:
            raise ApiError(403, "Персонаж не принадлежит тестовому аккаунту на этом сервере.")
        _, leader_name, leader_class, leader_level = character
        auth_status = "profile"
    else:
        character_id = None
        leader_name = text(payload.get("leaderName"), 24, required=True)
        leader_class = text(payload.get("leaderClass"), 64, required=True)
        leader_level = payload.get("leaderLevel")
        if leader_class not in VALID_CLASSES or type(leader_level) is not int or not 1 <= leader_level <= 80:
            raise ApiError(400, "Укажи класс и уровень лидера.")
        auth_status = "guest"
    members = payload.get("members") or []
    vacancies = payload.get("vacancies") or []
    if not isinstance(members, list) or not isinstance(vacancies, list) or not vacancies or 1 + len(members) + len(vacancies) > 9:
        raise ApiError(400, "В пати должно быть не больше девяти мест и хотя бы одна вакансия.")
    parsed_members = []
    for member in members:
        class_name = text(member.get("className"), 64, required=True)
        if class_name not in VALID_CLASSES:
            raise ApiError(400, "Выбери класс участника пати.")
        parsed_members.append((text(member.get("name"), 24), class_name))
    parsed_vacancies = []
    for vacancy in vacancies:
        class_name = text(vacancy.get("className"), 64)
        minimum, maximum = vacancy.get("minLevel"), vacancy.get("maxLevel")
        if class_name and class_name not in VALID_CLASSES:
            raise ApiError(400, "Выбери класс вакансии.")
        if type(minimum) is not int or type(maximum) is not int or not 1 <= minimum <= maximum <= 80:
            raise ApiError(400, "Проверь диапазон уровня вакансии.")
        parsed_vacancies.append((class_name, minimum, maximum))
    return dict(server_id=server_id, name=name, character_id=character_id, leader_name=leader_name,
                leader_class=leader_class, leader_level=leader_level, auth_status=auth_status,
                telegram=telegram, discord=discord, schedule=schedule, zone=zone,
                members=parsed_members, vacancies=parsed_vacancies)


def save_party(connection: sqlite3.Connection, owner_key: str, mode: str, payload: dict, party_id: str | None) -> dict:
    data = validate_party(payload, mode)
    now = now_ms()
    if party_id:
        current = connection.execute("SELECT * FROM parties WHERE id=? AND owner_key=? AND source='user'",
                                     (party_id, owner_key)).fetchone()
        if not current:
            raise ApiError(404, "Объявление не найдено.")
        if current["server_id"] != data["server_id"] and connection.execute(
            "SELECT 1 FROM applications WHERE party_id=? LIMIT 1", (party_id,)
        ).fetchone():
            raise ApiError(409, "Сервер пати нельзя сменить после первого отклика.")
        accepted = connection.execute(
            "SELECT accepted_slot, class_name, level, weekly_availability, time_zone FROM applications WHERE party_id=? AND status='accepted'",
            (party_id,)).fetchall()
        for item in accepted:
            index = item["accepted_slot"]
            if index is None or index >= len(data["vacancies"]):
                raise ApiError(409, "Сначала исключи принятого игрока из удаляемой вакансии.")
            class_name, minimum, maximum = data["vacancies"][index]
            if (class_name and class_name != item["class_name"]) or not minimum <= item["level"] <= maximum:
                raise ApiError(409, "Новая вакансия не подходит уже принятому игроку.")
            if not weekly_slots(data["schedule"], data["zone"]).issubset(
                weekly_slots(json.loads(item["weekly_availability"]), item["time_zone"])
            ):
                raise ApiError(409, "Новое расписание не подходит уже принятому игроку.")
        expires_at = current["expires_at"] if current["expires_at"] > now else now + LIFETIME_MS
        connection.execute("""UPDATE parties SET server_id=?, name=?, leader_character_id=?, leader_name=?,
          leader_class=?, leader_level=?, auth_status=?, telegram=?, discord=?, time_zone=?,
          weekly_availability=?, status='active', expires_at=? WHERE id=?""",
          (data["server_id"], data["name"], data["character_id"], data["leader_name"],
           data["leader_class"], data["leader_level"], data["auth_status"], data["telegram"],
           data["discord"], data["zone"], json.dumps(data["schedule"]), expires_at, party_id))
        connection.execute("DELETE FROM party_members WHERE party_id=?", (party_id,))
        connection.execute("DELETE FROM vacancies WHERE party_id=?", (party_id,))
    else:
        if connection.execute("SELECT 1 FROM parties WHERE owner_key=? AND status='active' AND source='user'",
                              (owner_key,)).fetchone():
            raise ApiError(409, "У тебя уже есть активное объявление. Измени или закрой его.")
        party_id = new_id("party")
        expires_at = now + LIFETIME_MS
        connection.execute("""INSERT INTO parties
          (id, owner_key, server_id, name, leader_character_id, leader_name, leader_class, leader_level,
           auth_status, telegram, discord, time_zone, weekly_availability, source, status, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', 'active', ?, ?)""",
          (party_id, owner_key, data["server_id"], data["name"], data["character_id"], data["leader_name"],
           data["leader_class"], data["leader_level"], data["auth_status"], data["telegram"],
           data["discord"], data["zone"], json.dumps(data["schedule"]), now, expires_at))
    connection.execute("INSERT INTO party_members VALUES (?, ?, 1, ?, ?, ?, ?, 1)",
                       (new_id("member"), party_id, data["leader_name"], data["leader_class"],
                        data["leader_level"], data["character_id"]))
    slot = 2
    for member_name, class_name in data["members"]:
        connection.execute("INSERT INTO party_members VALUES (?, ?, ?, ?, ?, NULL, NULL, 0)",
                           (new_id("member"), party_id, slot, member_name, class_name))
        slot += 1
    for class_name, minimum, maximum in data["vacancies"]:
        connection.execute(
            "INSERT INTO vacancies (id, party_id, slot_number, class_name, min_level, max_level) VALUES (?, ?, ?, ?, ?, ?)",
            (new_id("vacancy"), party_id, slot, class_name or None, minimum, maximum))
        slot += 1
    return party_data(connection, connection.execute("SELECT * FROM parties WHERE id=?", (party_id,)).fetchone(), include_contacts=True)


def create_application(connection: sqlite3.Connection, owner_key: str, mode: str, party_id: str, payload: dict) -> dict:
    party = connection.execute("SELECT * FROM parties WHERE id=? AND status='active' AND expires_at>?",
                               (party_id, now_ms())).fetchone()
    if not party:
        raise ApiError(404, "Пати уже не ищет игроков.")
    if party["owner_key"] == owner_key:
        raise ApiError(409, "Нельзя подать заявку в свою пати.")
    contacts = payload.get("contacts") or {}
    telegram, discord = text(contacts.get("telegram"), 64), text(contacts.get("discord"), 64)
    if not (telegram or discord):
        raise ApiError(400, "Укажи Telegram или Discord.")
    schedule = weekly(payload.get("availability"))
    zone = time_zone(payload.get("timeZone"))
    if mode == "demo":
        character_id = text(payload.get("characterId"), 64, required=True)
        character = DEMO_CHARACTERS.get(character_id)
        if not character or character[0] != party["server_id"]:
            raise ApiError(403, "Персонаж не принадлежит тестовому аккаунту на этом сервере.")
        _, name, class_name, level = character
        auth_status = "profile"
    else:
        name = text(payload.get("characterName"), 24, required=True)
        class_name = text(payload.get("className"), 64, required=True)
        level = payload.get("level")
        if class_name not in VALID_CLASSES or type(level) is not int or not 1 <= level <= 80:
            raise ApiError(400, "Укажи класс и уровень персонажа.")
        character_id = f"guest:{party['server_id']}:{name.lower()}:{class_name}"
        auth_status = "guest"
    if not party_matches(connection, party, class_name, level, schedule, zone):
        raise ApiError(409, "Класс, уровень или время не подходят свободной вакансии.")
    if connection.execute("""SELECT 1 FROM applications WHERE owner_key=? AND party_id=? AND character_id=?
       AND status IN ('pending', 'accepted')""", (owner_key, party_id, character_id)).fetchone():
        raise ApiError(409, "Активная заявка этого персонажа уже есть.")
    app_id = new_id("application")
    connection.execute("""INSERT INTO applications
      (id, party_id, owner_key, character_id, character_name, class_name, level, auth_status,
       telegram, discord, time_zone, weekly_availability, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
      (app_id, party_id, owner_key, character_id, name, class_name, level, auth_status,
       telegram, discord, zone, json.dumps(schedule), now_ms()))
    if party["source"] == "user" and party["expires_at"] - now_ms() <= 86400000:
        connection.execute("UPDATE parties SET expires_at=expires_at+86400000 WHERE id=?", (party_id,))
    row = connection.execute("SELECT * FROM applications WHERE id=?", (app_id,)).fetchone()
    return application_data(connection, row, owner_key)


def change_application(connection: sqlite3.Connection, viewer_key: str, app_id: str, status: str) -> dict:
    row = connection.execute("SELECT * FROM applications WHERE id=?", (app_id,)).fetchone()
    if not row:
        raise ApiError(404, "Заявка не найдена.")
    party = connection.execute("SELECT * FROM parties WHERE id=?", (row["party_id"],)).fetchone()
    if status == "withdrawn":
        if row["owner_key"] != viewer_key or row["status"] not in ("pending", "accepted"):
            raise ApiError(403, "Эту заявку нельзя отозвать.")
        connection.execute("UPDATE applications SET status='withdrawn', accepted_slot=NULL WHERE id=?", (app_id,))
    elif status == "removed":
        if party["owner_key"] != viewer_key or row["status"] != "accepted":
            raise ApiError(403, "Игрока нельзя исключить из этой пати.")
        connection.execute("UPDATE applications SET status='removed', accepted_slot=NULL WHERE id=?", (app_id,))
    elif status in ("accepted", "declined"):
        if party["owner_key"] != viewer_key or row["status"] != "pending":
            raise ApiError(403, "Эту заявку нельзя обработать.")
        if status == "accepted":
            schedule = json.loads(row["weekly_availability"])
            if not party_matches(connection, party, row["class_name"], row["level"], schedule, row["time_zone"]):
                raise ApiError(409, "Для персонажа больше нет подходящей свободной вакансии.")
            vacancies = connection.execute("SELECT * FROM vacancies WHERE party_id=? ORDER BY slot_number",
                                           (party["id"],)).fetchall()
            occupied = {item[0] for item in connection.execute(
                "SELECT accepted_slot FROM applications WHERE party_id=? AND status='accepted'", (party["id"],))}
            slot = next(index for index, vacancy in enumerate(vacancies)
                        if index not in occupied and (not vacancy["class_name"] or vacancy["class_name"] == row["class_name"])
                        and vacancy["min_level"] <= row["level"] <= vacancy["max_level"])
            connection.execute("UPDATE applications SET status='accepted', accepted_slot=? WHERE id=?", (slot, app_id))
        else:
            connection.execute("UPDATE applications SET status='declined' WHERE id=?", (app_id,))
    else:
        raise ApiError(400, "Неизвестный статус заявки.")
    return application_data(connection, connection.execute("SELECT * FROM applications WHERE id=?", (app_id,)).fetchone(), viewer_key)


class Handler(SimpleHTTPRequestHandler):
    server_version = "PartyFinderLocal/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status: int, payload: object, cookie: str | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def json_body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 65536:
                raise ApiError(413, "Слишком большой или пустой запрос.")
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("object required")
            return data
        except (ValueError, json.JSONDecodeError) as exc:
            raise ApiError(400, "Некорректный JSON-запрос.") from exc

    def session(self, connection: sqlite3.Connection) -> tuple[str, str, str | None, bool]:
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get("Cookie", ""))
        except Exception:
            pass
        requested = "demo" if self.headers.get("X-Party-Access") == "demo" else "guest"
        cookie_name = f"pf_{requested}_session"
        for name in (cookie_name, "pf_session"):
            token = cookies.get(name)
            if not token or not re.fullmatch(r"session:[0-9a-f]{32}", token.value):
                continue
            row = connection.execute("SELECT id, mode, owner_key FROM sessions WHERE id=?", (token.value,)).fetchone()
            if row and row["mode"] == requested:
                new_cookie = None if name == cookie_name else (
                    f"{cookie_name}={token.value}; Path=/; HttpOnly; SameSite=Lax"
                    + ("; Max-Age=2592000" if requested == "guest" else "")
                )
                return row["owner_key"] or row["id"], row["mode"], new_cookie, True
        if requested == "demo":
            return "", "guest", None, False
        return "", "guest", None, False

    def api(self, method: str) -> None:
        path = unquote(urlsplit(self.path).path)
        try:
            if path == "/api/health" and method == "GET":
                self.send_json(200, {"ok": True, "database": "sqlite"})
                return
            with closing(db_connection()) as connection, connection:
                viewer_key, mode, fresh_cookie, known_session = self.session(connection)
                requested_access = self.headers.get("X-Party-Access", "guest")
                if requested_access == "demo" and mode != "demo" and path not in {
                    "/api/session/login", "/api/session", "/api/bootstrap"
                }:
                    raise ApiError(401, "Тестовая сессия истекла. Войди заново.")
                if not viewer_key and method in {"POST", "PUT", "PATCH", "DELETE"} and path not in {
                    "/api/session/login", "/api/session/guest", "/api/parties/search"
                }:
                    raise ApiError(401, "Выбери гостевой режим или войди в тестовый аккаунт.")
                if path == "/api/session/login" and method == "POST":
                    body = self.json_body()
                    if not (hmac.compare_digest(str(body.get("email", "")).lower(), "demo@party.local")
                            and hmac.compare_digest(str(body.get("password", "")), "Party2026!")):
                        raise ApiError(401, "Неверный тестовый логин или пароль.")
                    connection.execute("INSERT OR IGNORE INTO sessions (id, mode, created_at, owner_key) VALUES ('demo-account', 'demo', ?, 'demo-account')", (now_ms(),))
                    seed_demo_account(connection)
                    demo_token = new_id("session")
                    connection.execute("INSERT INTO sessions (id, mode, created_at, owner_key) VALUES (?, 'demo', ?, 'demo-account')", (demo_token, now_ms()))
                    self.send_json(200, {"mode": "demo"}, f"pf_demo_session={demo_token}; Path=/; HttpOnly; SameSite=Lax")
                    return
                if path == "/api/session/guest" and method == "POST":
                    if mode == "guest" and known_session:
                        self.send_json(200, {"mode": "guest"}, fresh_cookie)
                    else:
                        guest_id = new_id("session")
                        connection.execute("INSERT INTO sessions (id, mode, created_at, owner_key) VALUES (?, 'guest', ?, ?)", (guest_id, now_ms(), guest_id))
                        self.send_json(200, {"mode": "guest"}, f"pf_guest_session={guest_id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000")
                    return
                if path == "/api/session" and method == "DELETE":
                    cookie_name = "pf_demo_session" if requested_access == "demo" else "pf_guest_session"
                    self.send_json(200, {"mode": "guest"}, f"{cookie_name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
                    return
                if path == "/api/session" and method == "GET":
                    self.send_json(200, {"mode": mode, "returningGuest": mode == "guest" and known_session}, fresh_cookie)
                    return
                if path == "/api/bootstrap" and method == "GET":
                    owned = connection.execute("SELECT * FROM parties WHERE owner_key=? AND source='user' AND status='active' ORDER BY created_at DESC LIMIT 1", (viewer_key,)).fetchone()
                    closed = connection.execute("SELECT id FROM parties WHERE owner_key=? AND source='user' AND status='closed' ORDER BY created_at DESC LIMIT 1", (viewer_key,)).fetchone()
                    rows = connection.execute("""SELECT applications.* FROM applications
                      JOIN parties ON parties.id=applications.party_id
                      WHERE applications.owner_key=? OR parties.owner_key=? ORDER BY applications.created_at DESC""",
                      (viewer_key, viewer_key)).fetchall()
                    self.send_json(200, {"mode": mode, "listing": party_data(connection, owned, include_contacts=True) if owned else None,
                                         "deletedListingId": closed["id"] if closed else None,
                                         "applications": [application_data(connection, row, viewer_key) for row in rows]}, fresh_cookie)
                    return
                if path == "/api/parties" and method == "GET":
                    server = parse_qs(urlsplit(self.path).query).get("server", [""])[0]
                    if server and server not in SERVERS:
                        raise ApiError(400, "Неизвестный сервер.")
                    rows = connection.execute("SELECT * FROM parties WHERE status='active' AND expires_at>? AND (?='' OR server_id=?) ORDER BY source='user' DESC, created_at DESC", (now_ms(), server, server)).fetchall()
                    self.send_json(200, {"parties": [party_data(connection, row) for row in rows]}, fresh_cookie)
                    return
                if path == "/api/parties/search" and method == "POST":
                    body = self.json_body()
                    server = text(body.get("serverId"), 24, required=True)
                    class_name = text(body.get("className"), 64, required=True)
                    level = body.get("level")
                    if server not in SERVERS or class_name not in VALID_CLASSES or type(level) is not int or not 1 <= level <= 80:
                        raise ApiError(400, "Укажи сервер, класс и уровень.")
                    schedule = weekly(body.get("availability"))
                    zone = time_zone(body.get("timeZone"))
                    rows = connection.execute("SELECT * FROM parties WHERE server_id=? AND status='active' AND expires_at>? ORDER BY source='user' DESC, created_at DESC", (server, now_ms())).fetchall()
                    self.send_json(200, {"parties": [party_data(connection, row) for row in rows if party_matches(connection, row, class_name, level, schedule, zone)]}, fresh_cookie)
                    return
                if path == "/api/parties" and method == "POST":
                    result = save_party(connection, viewer_key, mode, self.json_body(), None)
                    self.send_json(201, result, fresh_cookie)
                    return
                match = re.fullmatch(r"/api/parties/([^/]+)", path)
                if match:
                    party_id = match.group(1)
                    if method == "PUT":
                        result = save_party(connection, viewer_key, mode, self.json_body(), party_id)
                        self.send_json(200, result, fresh_cookie)
                        return
                    if method == "DELETE":
                        row = connection.execute("SELECT owner_key FROM parties WHERE id=? AND source='user'", (party_id,)).fetchone()
                        if not row or row["owner_key"] != viewer_key:
                            raise ApiError(403, "Это не твоё объявление.")
                        connection.execute("UPDATE parties SET status='closed' WHERE id=?", (party_id,))
                        self.send_json(200, {"closed": True}, fresh_cookie)
                        return
                match = re.fullmatch(r"/api/parties/([^/]+)/restore", path)
                if match and method == "POST":
                    party_id = match.group(1)
                    row = connection.execute("SELECT * FROM parties WHERE id=? AND owner_key=? AND status='closed'", (party_id, viewer_key)).fetchone()
                    if not row:
                        raise ApiError(404, "Объявление для восстановления не найдено.")
                    connection.execute("UPDATE parties SET status='active', expires_at=? WHERE id=?", (now_ms() + LIFETIME_MS, party_id))
                    self.send_json(200, {"restored": True}, fresh_cookie)
                    return
                match = re.fullmatch(r"/api/parties/([^/]+)/applications", path)
                if match and method == "POST":
                    result = create_application(connection, viewer_key, mode, match.group(1), self.json_body())
                    self.send_json(201, result, fresh_cookie)
                    return
                match = re.fullmatch(r"/api/applications/([^/]+)", path)
                if match and method == "PATCH":
                    result = change_application(connection, viewer_key, match.group(1), text(self.json_body().get("status"), 16))
                    self.send_json(200, result, fresh_cookie)
                    return
                if path == "/api/demo/reset" and method == "POST":
                    if mode != "demo":
                        raise ApiError(403, "Сброс демо доступен только тестовому аккаунту.")
                    ids = [row[0] for row in connection.execute("SELECT id FROM parties WHERE owner_key='demo-account' AND source='user'")]
                    for party_id in ids:
                        connection.execute("DELETE FROM applications WHERE party_id=?", (party_id,))
                        connection.execute("DELETE FROM parties WHERE id=?", (party_id,))
                    seed_demo_account(connection)
                    self.send_json(200, {"reset": True}, fresh_cookie)
                    return
                raise ApiError(404, "API-маршрут не найден.")
        except ApiError as exc:
            self.send_json(exc.status, {"error": exc.message})
        except sqlite3.IntegrityError:
            self.send_json(409, {"error": "Данные изменились. Обнови страницу и повтори действие."})

    def do_GET(self) -> None:
        path = unquote(urlsplit(self.path).path)
        if path.startswith("/api/"):
            self.api("GET")
        elif any(part.startswith(".") or part in {"data", "__pycache__"} for part in Path(path).parts) or path in {
            "/server.py", "/schema.sql", "/class-codes.json", "/demo-fixtures.json", "/requirements.txt"
        }:
            self.send_error(HTTPStatus.NOT_FOUND)
        else:
            super().do_GET()

    def do_POST(self) -> None:
        self.api("POST")

    def do_PUT(self) -> None:
        self.api("PUT")

    def do_PATCH(self) -> None:
        self.api("PATCH")

    def do_DELETE(self) -> None:
        self.api("DELETE")


def main() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with closing(db_connection()) as connection, connection:
        connection.executescript((ROOT / "schema.sql").read_text(encoding="utf-8"))
        columns = {row[1] for row in connection.execute("PRAGMA table_info(sessions)")}
        if "owner_key" not in columns:
            connection.execute("ALTER TABLE sessions ADD COLUMN owner_key TEXT")
        connection.execute("UPDATE sessions SET owner_key=id WHERE owner_key IS NULL")
        seed_fixture_parties(connection)
        connection.execute("UPDATE vacancies SET max_level=80 WHERE party_id LIKE 'fixture:%' AND max_level=85")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Party Finder: http://127.0.0.1:{PORT}/party-finder/#ru", flush=True)
    print(f"SQLite: {DB_PATH}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()


if __name__ == "__main__":
    main()
