"""Run with: python -m unittest discover -s tests -v"""

import http.cookiejar
import json
import sqlite3
import threading
import unittest
import urllib.error
import urllib.request
import uuid
from contextlib import closing
from pathlib import Path
from urllib.parse import quote

import server as party_server


class ApiFlowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.old_db = party_server.DB_PATH
        party_server.DB_PATH = party_server.ROOT / "data" / f"test-{uuid.uuid4().hex}.sqlite3"
        cls.test_db = party_server.DB_PATH
        with closing(party_server.db_connection()) as connection, connection:
            connection.executescript((party_server.ROOT / "schema.sql").read_text(encoding="utf-8"))
            party_server.seed_fixture_parties(connection)
        cls.http = party_server.ThreadingHTTPServer(("127.0.0.1", 0), party_server.Handler)
        cls.base = f"http://127.0.0.1:{cls.http.server_port}"
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join(timeout=2)
        party_server.DB_PATH = cls.old_db
        cls.test_db.unlink(missing_ok=True)

    def request(self, client, method, path, data=None, access="guest"):
        body = json.dumps(data).encode("utf-8") if data is not None else None
        request = urllib.request.Request(self.base + path, data=body, method=method,
                                         headers={"X-Party-Access": access,
                                                  **({"Content-Type": "application/json"} if body else {})})
        with client.open(request) as response:
            return json.load(response)

    def client(self):
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def test_guest_cross_client_flow(self):
        leader, applicant, outsider = self.client(), self.client(), self.client()
        for client in (leader, applicant, outsider):
            self.request(client, "POST", "/api/session/guest", {})
        hours = [[20, 21] for _ in range(7)]
        party = self.request(leader, "POST", "/api/parties", {
            "serverId": "erica", "name": "Integration Test", "leaderName": "Leader",
            "leaderClass": "Paladin", "leaderLevel": 75,
            "contacts": {"telegram": "@leader", "discord": ""}, "timeZone": "Europe/Madrid",
            "weeklyAvailability": hours, "members": [{"name": "Friend", "className": "Bishop"}],
            "vacancies": [{"className": "Warlord", "minLevel": 70, "maxLevel": 80}],
            "authStatus": "profile",
        })
        self.assertEqual(party["authStatus"], "guest")
        self.assertEqual(party["members"][0]["name"], "Friend")
        party_id = party["id"]
        search = {"serverId": "erica", "className": "Warlord", "level": 77,
                  "timeZone": "Europe/Madrid", "availability": [[19, 20, 21, 22] for _ in range(7)]}
        with self.assertRaises(urllib.error.HTTPError) as own_application:
            self.request(leader, "POST", f"/api/parties/{quote(party_id, safe='')}/applications", {
                "characterName": "Leader", "className": "Warlord", "level": 77,
                "availability": search["availability"], "timeZone": "Europe/Madrid",
                "contacts": {"telegram": "@leader"},
            })
        self.assertEqual(own_application.exception.code, 409)
        own_application.exception.close()
        matches = self.request(outsider, "POST", "/api/parties/search", search)["parties"]
        found = next(item for item in matches if item["id"] == party_id)
        self.assertNotIn("contacts", found)
        self.assertNotIn("contacts", next(item for item in self.request(
            outsider, "GET", "/api/parties?server=erica")["parties"] if item["id"] == party_id))
        self.assertEqual(self.request(leader, "GET", "/api/bootstrap")["listing"]["contacts"]["telegram"], "@leader")
        self.assertFalse(any(item["id"] == party_id for item in self.request(
            outsider, "POST", "/api/parties/search", {**search, "availability": [[19, 20] for _ in range(7)]})["parties"]))
        with closing(party_server.db_connection()) as connection, connection:
            connection.execute("UPDATE parties SET expires_at=? WHERE id=?", (party_server.now_ms() + 3600000, party_id))
        reply = self.request(applicant, "POST", f"/api/parties/{quote(party_id, safe='')}/applications", {
            "characterName": "Candidate", "className": "Warlord", "level": 77,
            "availability": search["availability"], "timeZone": "Europe/Madrid",
            "contacts": {"telegram": "@candidate", "discord": "candidate.test"},
            "authStatus": "profile",
        })
        self.assertEqual(reply["authStatus"], "guest")
        self.assertEqual(reply["leaderContacts"]["telegram"], "@leader")
        self.assertEqual(self.request(applicant, "GET", "/api/bootstrap")["applications"][0]["leaderContacts"]["telegram"], "@leader")
        self.assertEqual(self.request(outsider, "GET", "/api/bootstrap")["applications"], [])
        inbox = self.request(leader, "GET", "/api/bootstrap")["applications"]
        self.assertEqual(inbox[0]["contacts"]["telegram"], "@candidate")
        with self.assertRaises(urllib.error.HTTPError) as denied:
            self.request(outsider, "PATCH", f"/api/applications/{quote(reply['id'], safe='')}", {"status": "accepted"})
        self.assertEqual(denied.exception.code, 403)
        denied.exception.close()
        accepted = self.request(leader, "PATCH", f"/api/applications/{quote(reply['id'], safe='')}", {"status": "accepted"})
        self.assertEqual(accepted["status"], "accepted")
        updated = next(item for item in self.request(outsider, "GET", "/api/parties?server=erica")["parties"]
                       if item["id"] == party_id)
        self.assertEqual(updated["acceptedMembers"][0]["name"], "Candidate")
        self.assertGreater(updated["expiresAt"], party_server.now_ms() + 24 * 3600000)
        self.assertFalse(any(item["id"] == party_id for item in self.request(
            outsider, "POST", "/api/parties/search", search)["parties"]))
        with self.assertRaises(urllib.error.HTTPError) as denied_file:
            self.request(outsider, "GET", "/data/party-finder.sqlite3")
        self.assertEqual(denied_file.exception.code, 404)
        denied_file.exception.close()

    def test_guest_and_cabinet_cookies_do_not_replace_each_other(self):
        browser = self.client()
        self.assertFalse(self.request(browser, "GET", "/api/session")["returningGuest"])
        self.request(browser, "POST", "/api/session/login",
                     {"email": "demo@party.local", "password": "Party2026!"})
        cabinet = self.request(browser, "GET", "/api/bootstrap", access="demo")
        self.assertEqual(cabinet["mode"], "demo")
        demo_id = cabinet["listing"]["id"]
        guest = self.request(browser, "POST", "/api/session/guest", {})
        self.assertEqual(guest["mode"], "guest")
        self.assertTrue(self.request(browser, "GET", "/api/session")["returningGuest"])
        guest_party = self.request(browser, "POST", "/api/parties", {
            "serverId": "bartz", "name": "Guest Party", "leaderName": "Visitor",
            "leaderClass": "Paladin", "leaderLevel": 75,
            "contacts": {"telegram": "@visitor"}, "timeZone": "Europe/Madrid",
            "weeklyAvailability": [[20, 21] for _ in range(7)], "members": [],
            "vacancies": [{"className": "Bishop", "minLevel": 70, "maxLevel": 80}],
        })
        self.assertEqual(self.request(browser, "GET", "/api/bootstrap")["listing"]["id"], guest_party["id"])
        self.assertEqual(self.request(browser, "GET", "/api/bootstrap", access="demo")["listing"]["id"], demo_id)
        demo_payload = {
            "serverId": "teon", "name": "Updated Teon Party", "leaderCharacterId": "char-201",
            "contacts": {"discord": "teon.leader.demo"}, "timeZone": "Europe/Madrid",
            "weeklyAvailability": [[19, 20, 21] for _ in range(7)],
            "members": [{"name": "Aria", "className": "Bishop"}, {"name": "Voss", "className": "Warcryer"}],
            "vacancies": [{"className": "Treasure Hunter", "minLevel": 70, "maxLevel": 78},
                          {"className": "Elven Elder", "minLevel": 70, "maxLevel": 78},
                          {"className": "Gladiator", "minLevel": 70, "maxLevel": 78}],
        }
        updated = self.request(browser, "PUT", f"/api/parties/{quote(demo_id, safe='')}", demo_payload, access="demo")
        self.assertEqual(updated["name"], "Updated Teon Party")
        self.assertTrue(self.request(browser, "DELETE", f"/api/parties/{quote(guest_party['id'], safe='')}")["closed"])
        self.assertEqual(self.request(browser, "GET", "/api/bootstrap", access="demo")["listing"]["id"], demo_id)

    def test_guest_can_apply_to_vacancy_without_class_restriction(self):
        leader, applicant = self.client(), self.client()
        for client in (leader, applicant):
            self.request(client, "POST", "/api/session/guest", {})
        hours = [[19, 20, 21] for _ in range(7)]
        party = self.request(leader, "POST", "/api/parties", {
            "serverId": "erica", "name": "Open Class Test", "leaderName": "Leader",
            "leaderClass": "Bishop", "leaderLevel": 75,
            "contacts": {"telegram": "@leader"}, "timeZone": "Europe/Madrid",
            "weeklyAvailability": hours, "members": [],
            "vacancies": [{"className": "", "minLevel": 70, "maxLevel": 80}],
        })
        search = {"serverId": "erica", "className": "Paladin", "level": 75,
                  "timeZone": "Europe/Madrid", "availability": hours}
        matches = self.request(applicant, "POST", "/api/parties/search", search)["parties"]
        self.assertIn(party["id"], [item["id"] for item in matches])
        reply = self.request(applicant, "POST", f"/api/parties/{quote(party['id'], safe='')}/applications", {
            "characterName": "Applicant", "className": "Paladin", "level": 75,
            "timeZone": "Europe/Madrid", "availability": hours,
            "contacts": {"discord": "applicant.test"},
        })
        self.assertEqual(reply["status"], "pending")

    def test_acceptance_fills_matching_slot_and_reopens_on_removal(self):
        leader, applicant, observer = self.client(), self.client(), self.client()
        for client in (leader, applicant, observer):
            self.request(client, "POST", "/api/session/guest", {})
        hours = [[19, 20, 21] for _ in range(7)]
        party = self.request(leader, "POST", "/api/parties", {
            "serverId": "erica", "name": "Two Vacancies", "leaderName": "Leader",
            "leaderClass": "Warcryer", "leaderLevel": 75,
            "contacts": {"discord": "leader.test"}, "timeZone": "Europe/Madrid",
            "weeklyAvailability": hours, "members": [],
            "vacancies": [{"className": "Paladin", "minLevel": 70, "maxLevel": 80},
                          {"className": "Bishop", "minLevel": 70, "maxLevel": 80}],
        })
        search = {"serverId": "erica", "level": 75, "timeZone": "Europe/Madrid",
                  "availability": hours}
        reply = self.request(applicant, "POST", f"/api/parties/{quote(party['id'], safe='')}/applications", {
            "characterName": "NewTank", "className": "Paladin", "level": 75,
            "timeZone": "Europe/Madrid", "availability": hours,
            "contacts": {"telegram": "@newtank"},
        })
        accepted = self.request(leader, "PATCH", f"/api/applications/{quote(reply['id'], safe='')}",
                                {"status": "accepted"})
        self.assertEqual(accepted["acceptedSlot"], 0)
        leader_state = self.request(leader, "GET", "/api/bootstrap")
        listing = leader_state["listing"]
        self.assertEqual(listing["acceptedMembers"], [{"vacancyIndex": 0, "name": "NewTank",
                                                         "className": "Paladin", "level": 75}])
        self.assertTrue(any(item["id"] == reply["id"] and item["acceptedSlot"] == 0
                            and item["status"] == "accepted" for item in leader_state["applications"]))
        self.assertNotIn(party["id"], [item["id"] for item in self.request(
            observer, "POST", "/api/parties/search", {**search, "className": "Paladin"})["parties"]])
        bishop_matches = self.request(observer, "POST", "/api/parties/search",
                                      {**search, "className": "Bishop"})["parties"]
        bishop_listing = next(item for item in bishop_matches if item["id"] == party["id"])
        self.assertEqual(bishop_listing["acceptedMembers"], listing["acceptedMembers"])
        self.request(leader, "PATCH", f"/api/applications/{quote(reply['id'], safe='')}",
                     {"status": "removed"})
        self.assertIn(party["id"], [item["id"] for item in self.request(
            observer, "POST", "/api/parties/search", {**search, "className": "Paladin"})["parties"]])


if __name__ == "__main__":
    unittest.main()
