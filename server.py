"""Local Party Finder API and static server. Run: python server.py"""

from __future__ import annotations

import json
import ipaddress
from functools import lru_cache
import threading
from collections import deque
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
APPLICATION_COOLDOWN_MS = 60 * 1000
DEFAULT_TIME_ZONE = "Europe/Kyiv"
SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000
REQUEST_DEADLINE_SECONDS = 30
REQUEST_INACTIVITY_TIMEOUT_SECONDS = 10
PUBLIC_FILES = {"app.js", "applications.js", "cabinet.js", "party-api.js", "shell-loader.js",
                "styles.css", "overrides.css", "applications.css", "cabinet.css"}
RATE_LOCK = threading.Lock()
RATE_BUCKETS = {}
TRUSTED_PROXY_NETWORKS = tuple(ipaddress.ip_network(value.strip()) for value in
    os.environ.get("PARTY_FINDER_TRUSTED_PROXIES", "").split(",") if value.strip())


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message


def initialize_database(connection):
    connection.executescript((ROOT / "schema.sql").read_text(encoding="utf-8"))
    for table, additions in {
        "sessions": {"owner_key": "TEXT"},
        "parties": {"creator_ip": "TEXT NOT NULL DEFAULT ''"},
        "applications": {"creator_ip": "TEXT NOT NULL DEFAULT ''",
                         "character_key": "TEXT NOT NULL DEFAULT ''", "expires_at": "INTEGER"},
    }.items():
        columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
        for name, definition in additions.items():
            if name not in columns:
                connection.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
    connection.execute("UPDATE sessions SET owner_key=id WHERE owner_key IS NULL")
    connection.execute("UPDATE applications SET expires_at=created_at+? WHERE expires_at IS NULL", (LIFETIME_MS,))
    for row in connection.execute("""SELECT a.id, a.character_name, p.server_id FROM applications a
                                   JOIN parties p ON p.id=a.party_id WHERE a.character_key=''""").fetchall():
        connection.execute("UPDATE applications SET character_key=? WHERE id=?",
                           (character_key(row["server_id"], row["character_name"]), row["id"]))
    connection.execute("CREATE INDEX IF NOT EXISTS parties_ip_active ON parties(creator_ip,status,expires_at)")
    connection.execute("CREATE INDEX IF NOT EXISTS applications_ip_pending ON applications(creator_ip,status,expires_at)")
    connection.execute("CREATE INDEX IF NOT EXISTS applications_owner_pending ON applications(owner_key,status,expires_at)")


def prune_history(connection):
    cutoff = now_ms() - 90 * 86400000
    connection.execute("""DELETE FROM applications WHERE id IN (
        SELECT id FROM applications WHERE
        (status IN ('declined','withdrawn','removed') AND created_at<?)
        OR (status='pending' AND expires_at<?) LIMIT 1000)""", (cutoff, cutoff))


def history_maintenance(stop):
    while not stop.wait(3600):
        try:
            with closing(db_connection()) as connection, connection:
                prune_history(connection)
        except sqlite3.Error:
            pass  # Retry on the next scheduled pass.


def character_key(server_id, name):
    return server_id + ":" + name.strip().casefold()


class DeadlineReader:
    """Bound request-body and header reads by one absolute request deadline."""

    def __init__(self, stream, connection, deadline):
        self.stream = stream
        self.connection = connection
        self.deadline = deadline

    def _before_read(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("request deadline exceeded")
        self.connection.settimeout(min(REQUEST_INACTIVITY_TIMEOUT_SECONDS, remaining))

    def read(self, size=-1):
        if size is None or size < 0:
            chunks = []
            while True:
                chunk = self.read(8192)
                if not chunk:
                    return b"".join(chunks)
                chunks.append(chunk)
        chunks = []
        remaining = size
        while remaining:
            self._before_read()
            chunk = self.stream.read(min(8192, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def readline(self, size=-1):
        result = bytearray()
        while size < 0 or len(result) < size:
            self._before_read()
            chunk = self.stream.read(1)
            if not chunk:
                break
            result.extend(chunk)
            if chunk == b"\n":
                break
        return bytes(result)

    def readinto(self, buffer):
        data = self.read(len(buffer))
        buffer[:len(data)] = data
        return len(data)

    def readable(self):
        return True

    def fileno(self):
        return self.stream.fileno()

    def close(self):
        return self.stream.close()

    @property
    def closed(self):
        return self.stream.closed


def check_party_limit(connection, owner_key, client_ip, exclude_id=""):
    for field, value in (("owner_key", owner_key), ("creator_ip", client_ip)):
        count = connection.execute(f"""SELECT COUNT(*) FROM parties
            WHERE {field}=? AND status='active' AND expires_at>? AND id<>?""",
            (value, now_ms(), exclude_id)).fetchone()[0]
        if count >= 5:
            raise ApiError(409, "Лимит: не больше 5 активных пати на гостя и на IP.")


def check_character_limit(connection, owner_key, client_ip, key):
    for field, value in (("owner_key", owner_key), ("creator_ip", client_ip)):
        keys = {row[0] for row in connection.execute(f"""SELECT DISTINCT character_key FROM applications
            WHERE {field}=? AND status='pending' AND expires_at>?""", (value, now_ms()))}
        if key not in keys and len(keys) >= 5:
            raise ApiError(409, "Лимит: одновременно искать пати могут не больше 5 персонажей на гостя и на IP.")


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
    if value is not None and not isinstance(value, str):
        raise ApiError(400, "Текстовое поле должно быть строкой.")
    clean = (value or "").strip()
    try:
        clean.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise ApiError(400, "Поле содержит недопустимые символы Unicode.") from exc
    if "\x00" in clean:
        raise ApiError(400, "Поле содержит недопустимые символы.")
    if len(clean) > maximum:
        raise ApiError(400, "Превышена допустимая длина поля.")
    if required and not clean:
        raise ApiError(400, "Заполни обязательные поля.")
    return clean


def time_zone(value: object) -> str:
    zone = text(value, 64) or DEFAULT_TIME_ZONE
    try:
        ZoneInfo(zone)
    except (ZoneInfoNotFoundError, ValueError):
        return DEFAULT_TIME_ZONE
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
            start = local.astimezone(timezone.utc)
            end = (local + timedelta(hours=1)).astimezone(timezone.utc)
            for minute in range(max(0, int((end - start).total_seconds() // 60))):
                utc = start + timedelta(minutes=minute)
                slots.add(utc.weekday() * 1440 + utc.hour * 60 + utc.minute)
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


def search_parties(connection, server_id, class_name, level, availability, zone, limit, offset):
    applicant_slots = weekly_slots(availability, zone)

    @lru_cache(maxsize=128)
    def required_slots(schedule, party_zone):
        return weekly_slots(json.loads(schedule), party_zone)

    rows = connection.execute("""
        SELECT p.* FROM parties p
        WHERE p.server_id=? AND p.status='active' AND p.expires_at>?
        AND EXISTS (
            SELECT 1 FROM vacancies v WHERE v.party_id=p.id
            AND (v.class_name IS NULL OR v.class_name='' OR v.class_name=?)
            AND ? BETWEEN v.min_level AND v.max_level
            AND NOT EXISTS (
                SELECT 1 FROM applications a WHERE a.party_id=p.id AND a.status='accepted'
                AND a.accepted_slot=(SELECT COUNT(*) FROM vacancies previous
                    WHERE previous.party_id=v.party_id AND previous.slot_number<v.slot_number)
            )
        )
        ORDER BY p.created_at DESC, p.id DESC
    """, (server_id, now_ms(), class_name, level))
    matches = []
    skipped = 0
    for row in rows:
        if not required_slots(row["weekly_availability"], row["time_zone"]).issubset(applicant_slots):
            continue
        if skipped < offset:
            skipped += 1
            continue
        matches.append(party_data(connection, row))
        if len(matches) >= limit:
            break
    return matches


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
        "status": "expired" if row["status"] == "pending" and row["expires_at"] <= now_ms() else row["status"],
        "expiresAt": row["expires_at"], "acceptedSlot": row["accepted_slot"], "createdAt": row["created_at"],

    }


def validate_party(payload: dict, mode: str) -> dict:
    server_id = text(payload.get("serverId"), 24, required=True)
    if server_id not in SERVERS:
        raise ApiError(400, "Выбери действующий сервер.")
    name = text(payload.get("name"), 36, required=True)
    contacts = payload.get("contacts") or {}
    if not isinstance(contacts, dict):
        raise ApiError(400, "Контакты должны быть объектом.")
    telegram, discord = text(contacts.get("telegram"), 64), text(contacts.get("discord"), 64)
    if not (telegram or discord):
        raise ApiError(400, "Укажи хотя бы один контакт лидера.")
    schedule = weekly(payload.get("weeklyAvailability"))
    zone = time_zone(payload.get("timeZone"))
    if mode != "guest":
        raise ApiError(401, "Авторизация через профиль ещё не подключена.")
    if mode == "guest":
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
        if not isinstance(member, dict):
            raise ApiError(400, "Некорректный участник пати.")
        class_name = text(member.get("className"), 64, required=True)
        if class_name not in VALID_CLASSES:
            raise ApiError(400, "Выбери класс участника пати.")
        parsed_members.append((text(member.get("name"), 24), class_name))
    parsed_vacancies = []
    for vacancy in vacancies:
        if not isinstance(vacancy, dict):
            raise ApiError(400, "Некорректная вакансия.")
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


def save_party(connection: sqlite3.Connection, owner_key: str, mode: str, payload: dict, party_id: str | None, client_ip: str = "") -> dict:
    data = validate_party(payload, mode)
    now = now_ms()
    if party_id:
        current = connection.execute("SELECT * FROM parties WHERE id=? AND owner_key=? AND source='user'",
                                     (party_id, owner_key)).fetchone()
        if not current:
            raise ApiError(404, "Объявление не найдено.")
        if current["status"] != "active" or current["expires_at"] <= now:
            check_party_limit(connection, owner_key, client_ip, party_id)
            connection.execute("UPDATE parties SET creator_ip=? WHERE id=?", (client_ip, party_id))
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
        check_party_limit(connection, owner_key, client_ip)
        party_id = new_id("party")
        expires_at = now + LIFETIME_MS
        connection.execute("""INSERT INTO parties
          (id, owner_key, server_id, name, leader_character_id, leader_name, leader_class, leader_level,
           auth_status, telegram, discord, time_zone, weekly_availability, source, status, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', 'active', ?, ?)""",
          (party_id, owner_key, data["server_id"], data["name"], data["character_id"], data["leader_name"],
           data["leader_class"], data["leader_level"], data["auth_status"], data["telegram"],
           data["discord"], data["zone"], json.dumps(data["schedule"]), now, expires_at))
    if not party_id:
        raise ApiError(400, "Некорректное объявление.")
    if connection.execute("SELECT creator_ip FROM parties WHERE id=?", (party_id,)).fetchone()[0] == "":
        connection.execute("UPDATE parties SET creator_ip=? WHERE id=?", (client_ip, party_id))
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


def create_application(connection: sqlite3.Connection, owner_key: str, mode: str, party_id: str, payload: dict, client_ip: str = "") -> dict:
    party = connection.execute("SELECT * FROM parties WHERE id=? AND status='active' AND expires_at>?",
                               (party_id, now_ms())).fetchone()
    if not party:
        raise ApiError(404, "Пати уже не ищет игроков.")
    if party["owner_key"] == owner_key:
        raise ApiError(409, "Нельзя подать заявку в свою пати.")
    contacts = payload.get("contacts") or {}
    if not isinstance(contacts, dict):
        raise ApiError(400, "Контакты должны быть объектом.")
    telegram, discord = text(contacts.get("telegram"), 64), text(contacts.get("discord"), 64)
    if not (telegram or discord):
        raise ApiError(400, "Укажи Telegram или Discord.")
    schedule = weekly(payload.get("availability"))
    zone = time_zone(payload.get("timeZone"))
    if mode != "guest":
        raise ApiError(401, "Авторизация через профиль ещё не подключена.")
    if mode == "guest":
        name = text(payload.get("characterName"), 24, required=True)
        class_name = text(payload.get("className"), 64, required=True)
        level = payload.get("level")
        if class_name not in VALID_CLASSES or type(level) is not int or not 1 <= level <= 80:
            raise ApiError(400, "Укажи класс и уровень персонажа.")
        # Keep the persisted identity in sync with duplicate/cooldown checks.
        # casefold() handles Unicode names consistently across all guest flows.
        character_id = f"guest:{party['server_id']}:{name.casefold()}"
        auth_status = "guest"
    key = character_key(party["server_id"], name)
    previous = connection.execute("""SELECT created_at FROM applications WHERE party_id=? AND character_key=?
        AND (owner_key=? OR creator_ip=?) ORDER BY created_at DESC LIMIT 1""",
        (party_id, key, owner_key, client_ip)).fetchone()
    if previous and now_ms() - previous["created_at"] < APPLICATION_COOLDOWN_MS:
        raise ApiError(429, "Повторную заявку этого персонажа в эту пати можно отправить через 1 минуту после предыдущей.")
    check_character_limit(connection, owner_key, client_ip, key)
    if not party_matches(connection, party, class_name, level, schedule, zone):
        raise ApiError(409, "Класс, уровень или время не подходят свободной вакансии.")
    if connection.execute("""SELECT 1 FROM applications WHERE owner_key=? AND party_id=? AND character_id=?
       AND (status='accepted' OR (status='pending' AND expires_at>?))""", (owner_key, party_id, character_id, now_ms())).fetchone():
        raise ApiError(409, "Активная заявка этого персонажа уже есть.")
    app_id = new_id("application")
    connection.execute("""INSERT INTO applications
      (id, party_id, owner_key, character_id, character_name, class_name, level, auth_status,
       telegram, discord, time_zone, weekly_availability, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
      (app_id, party_id, owner_key, character_id, name, class_name, level, auth_status,
       telegram, discord, zone, json.dumps(schedule), now_ms()))
    connection.execute("UPDATE applications SET creator_ip=?, character_key=?, expires_at=? WHERE id=?",
                       (client_ip, key, now_ms() + LIFETIME_MS, app_id))
    if party["source"] == "user" and party["expires_at"] - now_ms() <= 86400000:
        connection.execute("UPDATE parties SET expires_at=expires_at+86400000 WHERE id=?", (party_id,))
    row = connection.execute("SELECT * FROM applications WHERE id=?", (app_id,)).fetchone()
    return application_data(connection, row, owner_key)


def change_application(connection: sqlite3.Connection, viewer_key: str, app_id: str, status: str) -> dict:
    row = connection.execute("SELECT * FROM applications WHERE id=?", (app_id,)).fetchone()
    if not row:
        raise ApiError(404, "Заявка не найдена.")
    party = connection.execute("SELECT * FROM parties WHERE id=?", (row["party_id"],)).fetchone()
    if row["status"] == "pending" and row["expires_at"] <= now_ms():
        raise ApiError(409, "Срок заявки истёк. Игрок может подать новую.")
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

    def trusted_peer(self):
        address = ipaddress.ip_address(self.client_address[0])
        return any(address in network for network in TRUSTED_PROXY_NETWORKS)

    def client_ip(self):
        if hasattr(self, "_client_ip"):
            return self._client_ip
        address = ipaddress.ip_address(self.client_address[0])
        if self.trusted_peer():
            forwarded = self.headers.get("X-Forwarded-For", "")
            parts = forwarded.split(",") if forwarded else []
            if len(parts) > 16:
                raise ApiError(400, "Слишком длинная цепочка прокси.")
            try:
                chain = [ipaddress.ip_address(part.strip()) for part in parts]
            except ValueError as exc:
                raise ApiError(400, "Некорректный IP в цепочке доверенного прокси.") from exc
            while chain and any(address in network for network in TRUSTED_PROXY_NETWORKS):
                address = chain.pop()
        self._client_ip = str(address.ipv4_mapped if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped else address)
        return self._client_ip

    def is_https(self):
        return self.trusted_peer() and self.headers.get("X-Forwarded-Proto", "").lower() == "https"

    def setup(self):
        super().setup()
        self._request_deadline = time.monotonic() + REQUEST_DEADLINE_SECONDS
        self.rfile = DeadlineReader(self.rfile, self.connection, self._request_deadline)
        self.connection.settimeout(REQUEST_INACTIVITY_TIMEOUT_SECONDS)

    def end_headers(self):
        if self.is_https():
            self.send_header("Strict-Transport-Security", "max-age=31536000")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'self'")
        super().end_headers()

    def limit(self, category, maximum, seconds):
        stamp = time.monotonic()
        key = (self.client_ip(), category)
        with RATE_LOCK:
            for old_key in list(RATE_BUCKETS):
                if not RATE_BUCKETS[old_key] or RATE_BUCKETS[old_key][-1] < stamp - 3600:
                    del RATE_BUCKETS[old_key]
            if key not in RATE_BUCKETS and len(RATE_BUCKETS) >= 10000:
                raise ApiError(429, "Слишком много запросов. Попробуй позже.")
            bucket = RATE_BUCKETS.setdefault(key, deque())
            while bucket and bucket[0] <= stamp - seconds:
                bucket.popleft()
            if len(bucket) >= maximum:
                raise ApiError(429, "Слишком много запросов. Попробуй позже.")
            bucket.append(stamp)

    def send_head(self):
        path = unquote(urlsplit(self.path).path)
        if chr(0) in path or chr(92) in path or any(part.startswith(".") for part in path.split("/") if part):
            self.send_error(404)
            return None
        if path == "/party-finder/":
            path += "index.html"
        root = ROOT.resolve()
        target = (root / path.lstrip("/")).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            self.send_error(404)
            return None
        relative = target.relative_to(root)
        allowed = (relative.as_posix() == "party-finder/index.html"
                   or relative.as_posix() in PUBLIC_FILES
                   or relative.parts[0] in {"assets", "i18n"})
        if not allowed:
            self.send_error(404)
            return None
        return super().send_head()

    def do_HEAD(self):
        if not self.redirect_page():
            super().do_HEAD()

    def redirect_page(self):
        parts = urlsplit(self.path)
        if parts.path not in {"/", "/party-finder", "/party-finder/index.html"}:
            return False
        location = "/party-finder/" + ("?" + parts.query if parts.query else "")
        self.send_response(308)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()
        return True

    def send_json(self, status: int, payload: object, cookie: str | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        # Complete the transaction before writing a potentially slow network response.
        connection = getattr(self, "_active_db", None)
        if connection is not None:
            try:
                if connection.in_transaction:
                    connection.commit()
            except sqlite3.ProgrammingError:
                pass
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def page_options(self):
        try:
            query = parse_qs(urlsplit(self.path).query, max_num_fields=20)
            values = []
            for name, default, maximum in (("limit", "50", 100), ("offset", "0", 10000)):
                supplied = query.get(name, [default])
                if len(supplied) != 1 or not re.fullmatch(r"[0-9]{1,5}", supplied[0]):
                    raise ValueError("Invalid page parameter")
                value = int(supplied[0])
                if value > maximum or (name == "limit" and value == 0):
                    raise ValueError("Page parameter outside range")
                values.append(value)
            return tuple(values)
        except ValueError as exc:
            raise ApiError(400, "Допустимы limit от 1 до 100 и offset от 0 до 10000.") from exc

    def json_body(self) -> dict:
        if hasattr(self, "_parsed_body"):
            return self._parsed_body
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 65536:
                raise ApiError(413, "Слишком большой или пустой запрос.")
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ApiError(400, "Запрос был передан не полностью.")
            if self.headers.get_content_type() != "application/json":
                raise ApiError(415, "Ожидается application/json.")
            def reject_constant(value):
                raise ValueError("Invalid JSON constant")
            data = json.loads(raw, parse_constant=reject_constant)
            if not isinstance(data, dict):
                raise ValueError("object required")
            stack = [(data, 0)]
            visited = 0
            while stack:
                item, depth = stack.pop()
                visited += 1
                if depth > 32 or visited > 4096:
                    raise ApiError(400, "Слишком сложная структура JSON.")
                if isinstance(item, str):
                    try:
                        item.encode("utf-8")
                    except UnicodeEncodeError as exc:
                        raise ApiError(400, "JSON содержит недопустимые символы Unicode.") from exc
                elif isinstance(item, dict):
                    stack.extend((key, depth + 1) for key in item)
                    stack.extend((value, depth + 1) for value in item.values())
                elif isinstance(item, list):
                    stack.extend((value, depth + 1) for value in item)
            self._parsed_body = data
            return data
        except (ValueError, json.JSONDecodeError, RecursionError) as exc:
            raise ApiError(400, "Некорректный JSON-запрос.") from exc

    def session(self, connection: sqlite3.Connection) -> tuple[str, str, str | None, bool]:
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get("Cookie", ""))
        except Exception:
            pass
        token = cookies.get("pf_guest_session")
        if token and re.fullmatch(r"session:[0-9a-f]{32}", token.value):
            row = connection.execute("SELECT * FROM sessions WHERE id=? AND mode='guest'", (token.value,)).fetchone()
            if row and 0 <= now_ms() - row["created_at"] < SESSION_LIFETIME_MS:
                return row["owner_key"] or row["id"], "guest", None, True
        return "", "guest", None, False

    def api(self, method: str) -> None:
        path = unquote(urlsplit(self.path).path)
        try:
            self.limit("api", 300, 60)
            host = self.headers.get("Host", "")
            allowed_hosts = set(os.environ.get("PARTY_FINDER_HOSTS", "127.0.0.1,localhost").split(","))
            if host.split(":")[0].lower() not in allowed_hosts:
                raise ApiError(403, "Недопустимый адрес сервера.")
            if method in {"POST", "PUT", "PATCH"}:
                self.json_body()
            if method != "GET":
                origin = self.headers.get("Origin")
                expected_origin = ("https://" if self.is_https() else "http://") + host
                if origin and origin != expected_origin:
                    raise ApiError(403, "Запрос с другого сайта запрещён.")
                self.limit("writes", 60, 60)
            if path in {"/api/session/login", "/api/demo/reset"}:
                raise ApiError(404, "API-маршрут не найден.")
            if self.headers.get("X-Party-Access") not in {None, "guest"}:
                raise ApiError(401, "Авторизация через профиль ещё не подключена.")
            if path == "/api/health" and method == "GET":
                self.send_json(200, {"ok": True, "database": "sqlite"})
                return
            with closing(db_connection()) as connection, connection:
                if method != "GET":
                    connection.execute("BEGIN IMMEDIATE")
                self._active_db = connection
                viewer_key, mode, fresh_cookie, known_session = self.session(connection)
                if not viewer_key and method in {"POST", "PUT", "PATCH", "DELETE"} and path not in {
                    "/api/session/guest", "/api/parties/search", "/api/session"
                }:
                    raise ApiError(401, "Продолжи в гостевом режиме.")
                if path == "/api/session/guest" and method == "POST":
                    self.json_body()
                    if mode == "guest" and known_session:
                        self.send_json(200, {"mode": "guest"}, fresh_cookie)
                    else:
                        self.limit("sessions", 20, 3600)
                        guest_id = new_id("session")
                        connection.execute("INSERT INTO sessions (id, mode, created_at, owner_key) VALUES (?, 'guest', ?, ?)", (guest_id, now_ms(), guest_id))
                        self.send_json(200, {"mode": "guest"}, f"pf_guest_session={guest_id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000" + ("; Secure" if self.is_https() or os.environ.get("PARTY_FINDER_SECURE_COOKIE") == "1" else ""))
                    return
                if path == "/api/session" and method == "DELETE":
                    self.send_json(200, {"mode": "guest", "retained": known_session})
                    return
                if path == "/api/session" and method == "GET":
                    self.send_json(200, {"mode": mode, "returningGuest": mode == "guest" and known_session}, fresh_cookie)
                    return
                if path == "/api/bootstrap" and method == "GET":
                    owned = connection.execute("SELECT * FROM parties WHERE owner_key=? AND source='user' AND status='active' ORDER BY created_at DESC LIMIT 1", (viewer_key,)).fetchone()
                    closed = connection.execute("SELECT id FROM parties WHERE owner_key=? AND source='user' AND status='closed' ORDER BY created_at DESC LIMIT 1", (viewer_key,)).fetchone()
                    limit, offset = self.page_options()
                    rows = connection.execute("""SELECT applications.* FROM applications
                      JOIN parties ON parties.id=applications.party_id
                      WHERE applications.owner_key=? OR parties.owner_key=? ORDER BY applications.created_at DESC, applications.id DESC LIMIT ? OFFSET ?""",
                      (viewer_key, viewer_key, limit + 1, offset)).fetchall()
                    has_more = len(rows) > limit
                    rows = rows[:limit]
                    required = connection.execute("""SELECT a.* FROM applications a JOIN parties p ON p.id=a.party_id
                        WHERE p.owner_key=? AND p.status=\'active\' AND p.expires_at>? AND a.status=\'accepted\'""",
                        (viewer_key, now_ms())).fetchall()
                    rows = list({row["id"]: row for row in rows + required}.values())
                    all_owned = connection.execute("""SELECT * FROM parties WHERE owner_key=? AND source='user'
                        ORDER BY (status='active' AND expires_at>?) DESC, created_at DESC LIMIT 100""", (viewer_key, now_ms())).fetchall()
                    self.send_json(200, {"mode": mode, "listings": [party_data(connection, item, include_contacts=True) for item in all_owned], "listing": party_data(connection, owned, include_contacts=True) if owned else None,
                                         "deletedListingId": closed["id"] if closed else None,
                                         "applicationsHasMore": has_more, "applicationsNextOffset": offset + limit,
                                         "applications": [application_data(connection, row, viewer_key) for row in rows]}, fresh_cookie)
                    return
                if path == "/api/parties" and method == "GET":
                    server = parse_qs(urlsplit(self.path).query).get("server", [""])[0]
                    if server and server not in SERVERS:
                        raise ApiError(400, "Неизвестный сервер.")
                    limit, offset = self.page_options()
                    rows = connection.execute("SELECT * FROM parties WHERE status='active' AND expires_at>? AND (?='' OR server_id=?) ORDER BY source='user' DESC, created_at DESC LIMIT ? OFFSET ?", (now_ms(), server, server, limit, offset)).fetchall()
                    self.send_json(200, {"parties": [party_data(connection, row) for row in rows]}, fresh_cookie)
                    return
                if path == "/api/parties/search" and method == "POST":
                    self.limit("search", 60, 60)
                    body = self.json_body()
                    server = text(body.get("serverId"), 24, required=True)
                    class_name = text(body.get("className"), 64, required=True)
                    level = body.get("level")
                    if server not in SERVERS or class_name not in VALID_CLASSES or type(level) is not int or not 1 <= level <= 80:
                        raise ApiError(400, "Укажи сервер, класс и уровень.")
                    schedule = weekly(body.get("availability"))
                    zone = time_zone(body.get("timeZone"))
                    limit, offset = self.page_options()
                    matches = search_parties(connection, server, class_name, level, schedule, zone, limit, offset)
                    self.send_json(200, {"parties": matches}, fresh_cookie)
                    return
                if path == "/api/parties" and method == "POST":
                    self.limit("parties", 10, 3600)
                    result = save_party(connection, viewer_key, mode, self.json_body(), None, self.client_ip())
                    self.send_json(201, result, fresh_cookie)
                    return
                match = re.fullmatch(r"/api/parties/([^/]+)", path)
                if match:
                    party_id = match.group(1)
                    if method == "PUT":
                        result = save_party(connection, viewer_key, mode, self.json_body(), party_id, self.client_ip())
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
                    check_party_limit(connection, viewer_key, self.client_ip(), party_id)
                    connection.execute("UPDATE parties SET status='active', expires_at=?, creator_ip=? WHERE id=?", (now_ms() + LIFETIME_MS, self.client_ip(), party_id))
                    self.send_json(200, {"restored": True}, fresh_cookie)
                    return
                match = re.fullmatch(r"/api/parties/([^/]+)/applications", path)
                if match and method == "POST":
                    result = create_application(connection, viewer_key, mode, match.group(1), self.json_body(), self.client_ip())
                    self.send_json(201, result, fresh_cookie)
                    return
                match = re.fullmatch(r"/api/applications/([^/]+)", path)
                if match and method == "PATCH":
                    result = change_application(connection, viewer_key, match.group(1), text(self.json_body().get("status"), 16))
                    self.send_json(200, result, fresh_cookie)
                    return
                raise ApiError(404, "API-маршрут не найден.")
        except ApiError as exc:
            self.send_json(exc.status, {"error": exc.message})
        except (AttributeError, TypeError, UnicodeDecodeError):
            self.send_json(400, {"error": "Некорректные поля запроса."})
        except sqlite3.OperationalError:
            self.send_json(503, {"error": "База временно занята. Повтори запрос позже."})
        except sqlite3.IntegrityError:
            self.send_json(409, {"error": "Данные изменились. Обнови страницу и повтори действие."})

    def do_GET(self) -> None:
        path = unquote(urlsplit(self.path).path)
        if path.startswith("/api/"):
            self.api("GET")
        elif not self.redirect_page():
            super().do_GET()

    def do_POST(self) -> None:
        self.api("POST")

    def do_PUT(self) -> None:
        self.api("PUT")

    def do_PATCH(self) -> None:
        self.api("PATCH")

    def do_DELETE(self) -> None:
        self.api("DELETE")


class PartyFinderServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 32

    def __init__(self, *args, **kwargs):
        self.workers = threading.BoundedSemaphore(32)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self.workers.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.workers.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.workers.release()


def main() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with closing(db_connection()) as connection, connection:
        initialize_database(connection)
        prune_history(connection)
    stop = threading.Event()
    threading.Thread(target=history_maintenance, args=(stop,), daemon=True).start()
    server = PartyFinderServer(("127.0.0.1", PORT), Handler)
    print(f"Party Finder: http://127.0.0.1:{PORT}/party-finder/#ru", flush=True)
    print(f"SQLite: {DB_PATH}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()


if __name__ == "__main__":
    main()
