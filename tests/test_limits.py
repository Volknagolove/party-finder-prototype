import sqlite3
import unittest
import json
from unittest.mock import patch

import server


class LimitsTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        server.initialize_database(self.db)
        self.schedule = [[19, 20, 21] for _ in range(7)]

    def tearDown(self):
        self.db.close()

    def test_search_prefilters_large_database_and_reuses_schedules(self):
        owner = self.owner()
        schedule = json.dumps(self.schedule)
        for index in range(2500):
            party_id = 'bulk-' + str(index)
            self.db.execute('''INSERT INTO parties
                (id,owner_key,server_id,name,leader_name,leader_class,leader_level,auth_status,
                 time_zone,weekly_availability,source,created_at,expires_at)
                VALUES (?,?,'teon','Group','Leader','Bishop',75,'guest','UTC',?,'user',?,?)''',
                (party_id,owner,schedule,index,server.now_ms()+server.LIFETIME_MS))
            self.db.execute('''INSERT INTO vacancies (id,party_id,slot_number,class_name,min_level,max_level)
                VALUES (?,?,2,?,1,80)''', ('v-'+str(index),party_id,'Paladin' if index < 100 else 'Bishop'))
        statements = []
        self.db.set_trace_callback(statements.append)
        with patch.object(server, 'weekly_slots', wraps=server.weekly_slots) as conversion:
            result = server.search_parties(self.db,'teon','Paladin',75,self.schedule,'UTC',10,90)
            self.assertEqual(len(result),10)
            self.assertEqual(conversion.call_count,2)
        self.assertLessEqual(len(statements),40)
        self.assertTrue(all(int(item['id'].split('-')[1]) < 100 for item in result))

    def owner(self):
        key = server.new_id('session')
        self.db.execute("INSERT INTO sessions VALUES (?, 'guest', ?, ?)", (key, server.now_ms(), key))
        return key

    def party(self, owner, ip='192.0.2.1', identifier=None):
        return server.save_party(self.db, owner, 'guest', {
            'serverId':'teon', 'name':'Party', 'leaderName':'Leader',
            'leaderClass':'Bishop', 'leaderLevel':75, 'contacts':{'telegram':'@leader'},
            'weeklyAvailability':self.schedule, 'timeZone':'UTC', 'members':[],
            'vacancies':[{'className':'', 'minLevel':1, 'maxLevel':80}],
        }, identifier, ip)

    def apply(self, owner, party, name, ip='192.0.2.2', class_name='Paladin'):
        return server.create_application(self.db, owner, 'guest', party['id'], {
            'characterName':name, 'className':class_name, 'level':75,
            'availability':self.schedule, 'timeZone':'UTC', 'contacts':{'discord':'player'},
        }, ip)

    def test_cookie_party_limit_and_reactivation(self):
        owner = self.owner()
        parties = [self.party(owner, f'192.0.2.{n}') for n in range(5)]
        with self.assertRaises(server.ApiError):
            self.party(owner, '198.51.100.1')
        self.party(owner, '192.0.2.0', parties[0]['id'])  # Editing does not consume a slot.
        self.db.execute("UPDATE parties SET status='closed' WHERE id=?", (parties[0]['id'],))
        self.party(owner, '198.51.100.1')
        with self.assertRaises(server.ApiError):
            self.party(owner, '192.0.2.0', parties[0]['id'])

    def test_new_cookie_cannot_bypass_ip_party_limit(self):
        parties = [self.party(self.owner()) for _ in range(5)]
        with self.assertRaises(server.ApiError):
            self.party(self.owner())
        self.db.execute('UPDATE parties SET expires_at=? WHERE id=?', (server.now_ms()-1, parties[0]['id']))
        self.party(self.owner())

    def test_five_characters_many_applications_and_expiry(self):
        target = self.party(self.owner())
        applicant = self.owner()
        applications = [self.apply(applicant, target, 'Player'+str(n)) for n in range(5)]
        with self.assertRaises(server.ApiError):
            self.apply(applicant, target, 'Sixth', '198.51.100.1')
        for n in range(21):
            other = self.party(self.owner(), f'198.51.100.{n+1}')
            self.apply(applicant, other, 'PLAYER0')  # Same server/name counts once, case-insensitive.
        self.db.execute('UPDATE applications SET expires_at=? WHERE id=?', (server.now_ms()-1, applications[1]['id']))
        expired = server.application_data(self.db, self.db.execute('SELECT * FROM applications WHERE id=?',
                                          (applications[1]['id'],)).fetchone(), applicant)
        self.assertEqual(expired['status'], 'expired')
        self.apply(applicant, target, 'Sixth')
        with self.assertRaises(server.ApiError):
            server.change_application(self.db, target_owner := self.db.execute('SELECT owner_key FROM parties WHERE id=?',
                (target['id'],)).fetchone()[0], applications[1]['id'], 'accepted')

    def test_ip_character_limit_and_retry_of_expired_application(self):
        target = self.party(self.owner())
        applicants = [self.owner() for _ in range(6)]
        applications = [self.apply(applicants[n], target, 'Player'+str(n)) for n in range(5)]
        with self.assertRaises(server.ApiError):
            self.apply(applicants[5], target, 'Sixth')
        self.db.execute('UPDATE applications SET expires_at=?, created_at=? WHERE id=?',
                        (server.now_ms()-1, server.now_ms()-server.LIFETIME_MS-1, applications[0]['id']))
        renewed = self.apply(applicants[0], target, 'Player0', class_name='Gladiator')
        self.assertNotEqual(renewed['id'], applications[0]['id'])
        self.assertAlmostEqual(renewed['expiresAt'] - renewed['createdAt'], server.LIFETIME_MS, delta=1000)
        owner = self.db.execute('SELECT owner_key FROM parties WHERE id=?', (target['id'],)).fetchone()[0]
        server.change_application(self.db, owner, renewed['id'], 'accepted')
        self.db.execute('UPDATE applications SET expires_at=? WHERE id=?', (server.now_ms()-1, renewed['id']))
        accepted = server.application_data(self.db, self.db.execute('SELECT * FROM applications WHERE id=?',
                                           (renewed['id'],)).fetchone(), applicants[0])
        self.assertEqual(accepted['status'], 'accepted')
        self.apply(applicants[5], target := self.party(self.owner(), '203.0.113.1'), 'Sixth')

    def test_same_party_cooldown_across_cookies_and_different_parties_allowed(self):
        target = self.party(self.owner())
        applicant = self.owner()
        application = self.apply(applicant, target, 'Player')
        server.change_application(self.db, applicant, application['id'], 'withdrawn')
        for owner in (applicant, self.owner()):
            with self.assertRaises(server.ApiError) as blocked:
                self.apply(owner, target, 'PLAYER', class_name='Gladiator')
            self.assertEqual(blocked.exception.status, 429)
        other = self.party(self.owner(), '203.0.113.1')
        self.apply(applicant, other, 'Player')
        self.db.execute('UPDATE applications SET created_at=? WHERE id=?',
                        (server.now_ms()-server.APPLICATION_COOLDOWN_MS-1, application['id']))
        self.apply(applicant, target, 'Player')

    def test_guest_character_identity_uses_unicode_casefold(self):
        target = self.party(self.owner())
        applicant = self.owner()
        first = self.apply(applicant, target, 'Playerß')
        self.db.execute('UPDATE applications SET created_at=? WHERE id=?',
                        (server.now_ms()-server.APPLICATION_COOLDOWN_MS-1, first['id']))
        with self.assertRaises(server.ApiError) as duplicate:
            self.apply(applicant, target, 'PlayerSS')
        self.assertEqual(duplicate.exception.status, 409)

    def test_zone_fallback_and_sub_hour_offsets(self):
        for zone in (None, '', '../UTC', 'Not/AZone'):
            self.assertEqual(server.time_zone(zone), 'Europe/Kyiv')
        india = server.weekly_slots([[19]] * 7, 'Asia/Kolkata')
        utc = server.weekly_slots([[13]] * 7, 'UTC')
        self.assertNotEqual(india, utc)
        self.assertEqual(len(india & utc), 30 * 7)
        self.assertTrue(india.issubset(server.weekly_slots([[13,14]] * 7, 'UTC')))
        nepal = server.weekly_slots([[19]] * 7, 'Asia/Kathmandu')
        self.assertEqual(len(nepal & utc), 45 * 7)

    def test_prune_history_preserves_accepted_and_recent_applications(self):
        target = self.party(self.owner())
        applicant = self.owner()
        accepted = self.apply(applicant, target, 'Accepted')
        owner = self.db.execute('SELECT owner_key FROM parties WHERE id=?', (target['id'],)).fetchone()[0]
        server.change_application(self.db, owner, accepted['id'], 'accepted')
        old = self.apply(applicant, self.party(self.owner(), '203.0.113.1'), 'Old')
        self.db.execute("UPDATE applications SET status='withdrawn',created_at=? WHERE id=?",
                        (server.now_ms()-91*86400000,old['id']))
        self.db.execute('UPDATE applications SET created_at=? WHERE id=?',
                        (server.now_ms()-91*86400000,accepted['id']))
        server.prune_history(self.db)
        self.assertIsNone(self.db.execute('SELECT id FROM applications WHERE id=?',(old['id'],)).fetchone())
        self.assertIsNotNone(self.db.execute('SELECT id FROM applications WHERE id=?',(accepted['id'],)).fetchone())
