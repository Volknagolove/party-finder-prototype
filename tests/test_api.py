"""Run with: python -m unittest discover -s tests -v"""

import http.cookiejar
import http.client
import json
import sqlite3
import threading
import socket
import unittest
import urllib.error
import urllib.request
import uuid
import ipaddress
from contextlib import closing
from pathlib import Path
from urllib.parse import quote

import server as party_server


class ApiFlowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.old_connection = party_server.db_connection
        cls.uri = "file:audit-" + uuid.uuid4().hex + "?mode=memory&cache=shared"
        cls.anchor = sqlite3.connect(cls.uri, uri=True)
        cls.anchor.executescript((party_server.ROOT / "schema.sql").read_text(encoding="utf-8"))
        def connection():
            db = sqlite3.connect(cls.uri, uri=True)
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys=ON")
            return db
        party_server.db_connection = connection
        cls.http = party_server.PartyFinderServer(("127.0.0.1", 0), party_server.Handler)
        cls.base = f"http://127.0.0.1:{cls.http.server_port}"
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join(timeout=2)
        party_server.db_connection = cls.old_connection
        cls.anchor.close()

    def setUp(self):
        party_server.RATE_BUCKETS.clear()
        with closing(party_server.db_connection()) as db, db:
            for table in ('applications', 'vacancies', 'party_members', 'parties', 'sessions'):
                db.execute('DELETE FROM ' + table)

    def test_http_party_limit_bootstrap_and_restore(self):
        browser = self.client()
        self.request(browser, 'POST', '/api/session/guest', {})
        payload = {'serverId':'teon', 'name':'Quota', 'leaderName':'Leader',
            'leaderClass':'Bishop', 'leaderLevel':75, 'contacts':{'telegram':'@leader'},
            'timeZone':'UTC', 'weeklyAvailability':[[19] for _ in range(7)], 'members':[],
            'vacancies':[{'className':'', 'minLevel':1, 'maxLevel':80}]}
        parties = [self.request(browser, 'POST', '/api/parties', payload) for _ in range(5)]
        self.assertEqual(len(self.request(browser, 'GET', '/api/bootstrap')['listings']), 5)
        other = self.client()
        self.request(other, 'POST', '/api/session/guest', {})
        for client in (browser, other):
            with self.assertRaises(urllib.error.HTTPError) as blocked:
                self.request(client, 'POST', '/api/parties', payload)
            self.assertEqual(blocked.exception.code, 409)
            blocked.exception.close()
        self.request(browser, 'DELETE', '/api/parties/' + quote(parties[0]['id'], safe=''))
        self.request(other, 'POST', '/api/parties', payload)
        with self.assertRaises(urllib.error.HTTPError) as blocked:
            self.request(browser, 'POST', '/api/parties/' + quote(parties[0]['id'], safe='') + '/restore', {})
        self.assertEqual(blocked.exception.code, 409)
        blocked.exception.close()

    def request(self, client, method, path, data=None, access="guest"):
        body = json.dumps(data).encode("utf-8") if data is not None else None
        request = urllib.request.Request(self.base + path, data=body, method=method,
                                         headers={"X-Party-Access": access,
                                                  **({"Content-Type": "application/json"} if body else {})})
        with client.open(request) as response:
            return json.load(response)

    def client(self):
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def raw(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=5)
        connection.request(method, path, body, headers or {})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_invalid_pagination_and_unicode_return_400(self):
        for value in (str(2**100), '-1', '10001', '1&offset=2', 'not-a-number'):
            self.assertEqual(self.raw('GET', '/api/parties?offset=' + value)[0], 400)
        browser = self.client()
        self.request(browser, 'POST', '/api/session/guest', {})
        for payload in ({'name':'\ud800'}, {'unknown':'\udfff'}, {'\ud800':'value'}):
            with self.assertRaises(urllib.error.HTTPError) as invalid:
                self.request(browser, 'POST', '/api/parties', payload)
            self.assertEqual(invalid.exception.code, 400)
            invalid.exception.close()
        deeply_nested = '{"value":' + '['*40 + '0' + ']'*40 + '}'
        self.assertEqual(self.raw('POST', '/api/session/guest', deeply_nested,
                                 {'Content-Type':'application/json'})[0], 400)

    def test_proxy_headers_only_trusted_when_configured(self):
        old = party_server.TRUSTED_PROXY_NETWORKS
        try:
            party_server.TRUSTED_PROXY_NETWORKS = ()
            _, headers, _ = self.raw('GET', '/api/session', headers={
                'X-Forwarded-Proto':'https', 'X-Forwarded-For':'203.0.113.5'})
            self.assertNotIn('Strict-Transport-Security', headers)
            party_server.TRUSTED_PROXY_NETWORKS = (ipaddress.ip_network('127.0.0.1/32'),)
            status, headers, _ = self.raw('POST', '/api/session/guest', '{}', {
                'Content-Type':'application/json', 'X-Forwarded-Proto':'https',
                'Origin':'https://127.0.0.1:' + str(self.http.server_port),
                'X-Forwarded-For':'198.51.100.10, 203.0.113.5'})
            self.assertEqual(status, 200)
            self.assertIn('; Secure', headers['Set-Cookie'])
            self.assertIn('Strict-Transport-Security', headers)
            self.assertIn(('203.0.113.5','sessions'), party_server.RATE_BUCKETS)
            self.assertNotIn(('198.51.100.10','sessions'), party_server.RATE_BUCKETS)
        finally:
            party_server.TRUSTED_PROXY_NETWORKS = old

    def test_incomplete_request_body_does_not_lock_database(self):
        reading = threading.Event()
        original = party_server.Handler.json_body
        def observed(handler):
            reading.set()
            return original(handler)
        party_server.Handler.json_body = observed
        slow = socket.create_connection(('127.0.0.1', self.http.server_port), timeout=3)
        try:
            slow.sendall(('POST /api/session/guest HTTP/1.0\r\nHost: 127.0.0.1:' + str(self.http.server_port)
                + '\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{').encode())
            self.assertTrue(reading.wait(2))
            self.assertEqual(self.raw('POST', '/api/session/guest', '{}', {'Content-Type':'application/json'})[0], 200)
            slow.sendall(b'}')
            slow.recv(4096)
        finally:
            slow.close()
            party_server.Handler.json_body = original

    def test_paginated_application_history(self):
        leader = self.client()
        self.request(leader, 'POST', '/api/session/guest', {})
        party = self.request(leader, 'POST', '/api/parties', {
            'serverId':'teon', 'name':'History', 'leaderName':'Leader', 'leaderClass':'Bishop',
            'leaderLevel':75, 'contacts':{'telegram':'@leader'}, 'timeZone':'UTC',
            'weeklyAvailability':[[19] for _ in range(7)], 'members':[],
            'vacancies':[{'className':'', 'minLevel':1, 'maxLevel':80}]})
        for name in ('First', 'Second'):
            applicant = self.client()
            self.request(applicant, 'POST', '/api/session/guest', {})
            self.request(applicant, 'POST', '/api/parties/' + quote(party['id'], safe='') + '/applications', {
                'characterName':name, 'className':'Paladin', 'level':75,
                'contacts':{'discord':'player'}, 'timeZone':'UTC', 'availability':[[19] for _ in range(7)]})
        first = self.request(leader, 'GET', '/api/bootstrap?limit=1')
        second = self.request(leader, 'GET', '/api/bootstrap?limit=1&offset=1')
        self.assertTrue(first['applicationsHasMore'])
        self.assertFalse(second['applicationsHasMore'])
        self.assertEqual(first['applicationsNextOffset'], 1)
        self.assertEqual(len(first['applications']), 1)
        self.assertNotEqual(first['applications'][0]['id'], second['applications'][0]['id'])

    def test_static_private_paths_and_page_addresses(self):
        for method in ('GET', 'HEAD'):
            for path in ('/DATA/party-finder.sqlite3', '/data/party-finder.sqlite3',
                         '/SeRvEr.py', '/assets/../server.py', '/assets/%2e%2e/server.py',
                         '/%2egit/config', '/tests/', '/schema.sql', '/data%5cparty-finder.sqlite3',
                         '/assets/%00bad'):
                self.assertEqual(self.raw(method, path)[0], 404, (method, path))
        for path in ('/', '/party-finder', '/party-finder/index.html'):
            status, headers, _ = self.raw('GET', path + '?mode=find')
            self.assertEqual(status, 308)
            self.assertEqual(headers['Location'], '/party-finder/?mode=find')
        for path in ('/party-finder/', '/party-finder/?mode=find', '/party-finder/?mode=create', '/app.js'):
            self.assertEqual(self.raw('GET', path)[0], 200, path)

    def test_reject_unsafe_origins_removed_login_and_invalid_payloads(self):
        self.assertEqual(self.raw('POST', '/api/session/guest', '{}',
            {'Content-Type':'application/json', 'Origin':'https://untrusted.example'})[0], 403)
        self.assertEqual(self.raw('POST', '/api/session/guest', '{}', {'Content-Type':'text/plain'})[0], 415)
        self.assertEqual(self.raw('GET', '/api/session', headers={'Host':'untrusted.example'})[0], 403)
        for path in ('/api/session/login', '/api/demo/reset'):
            self.assertEqual(self.raw('POST', path, '{}', {'Content-Type':'application/json'})[0], 404)
        browser = self.client()
        self.request(browser, 'POST', '/api/session/guest', {})
        payload = {'serverId':'teon', 'name':'Validation', 'contacts':['not-an-object']}
        with self.assertRaises(urllib.error.HTTPError) as invalid:
            self.request(browser, 'POST', '/api/parties', payload)
        self.assertEqual(invalid.exception.code, 400)
        invalid.exception.close()

    def test_rate_limit_and_expired_cookie_replacement(self):
        with party_server.RATE_LOCK:
            party_server.RATE_BUCKETS[('127.0.0.1', 'sessions')] = party_server.deque([party_server.time.monotonic()] * 20)
        self.assertEqual(self.raw('POST', '/api/session/guest', '{}', {'Content-Type':'application/json'})[0], 429)

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

    def test_guest_cookie_survives_exit_and_expires_on_server(self):
        browser = self.client()
        self.request(browser, "POST", "/api/session/guest", {})
        with closing(party_server.db_connection()) as db:
            token = db.execute("SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1").fetchone()[0]
        self.request(browser, "DELETE", "/api/session")
        self.assertTrue(self.request(browser, "GET", "/api/session")["returningGuest"])
        self.request(browser, "POST", "/api/session/guest", {})
        with closing(party_server.db_connection()) as db, db:
            self.assertIsNotNone(db.execute("SELECT id FROM sessions WHERE id=?", (token,)).fetchone())
            db.execute("UPDATE sessions SET created_at=? WHERE id=?", (party_server.now_ms() - party_server.SESSION_LIFETIME_MS - 1, token))
        self.assertFalse(self.request(browser, "GET", "/api/session")["returningGuest"])

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
