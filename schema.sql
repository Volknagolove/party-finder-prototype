PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('guest', 'demo')),
  created_at INTEGER NOT NULL,
  owner_key TEXT
);

CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY,
  owner_key TEXT,
  server_id TEXT NOT NULL,
  name TEXT NOT NULL,
  leader_character_id TEXT,
  leader_name TEXT NOT NULL,
  leader_class TEXT NOT NULL,
  leader_level INTEGER NOT NULL,
  auth_status TEXT NOT NULL CHECK (auth_status IN ('guest', 'profile', 'demo')),
  telegram TEXT NOT NULL DEFAULT '',
  discord TEXT NOT NULL DEFAULT '',
  time_zone TEXT NOT NULL,
  weekly_availability TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('user', 'fixture')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (owner_key) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS parties_active_server ON parties(server_id, status, expires_at);
CREATE INDEX IF NOT EXISTS parties_owner ON parties(owner_key, status);

CREATE TABLE IF NOT EXISTS party_members (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  slot_number INTEGER NOT NULL CHECK (slot_number BETWEEN 1 AND 9),
  name TEXT NOT NULL,
  class_name TEXT NOT NULL,
  level INTEGER,
  character_id TEXT,
  is_leader INTEGER NOT NULL DEFAULT 0 CHECK (is_leader IN (0, 1)),
  UNIQUE(party_id, slot_number)
);

CREATE TABLE IF NOT EXISTS vacancies (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  slot_number INTEGER NOT NULL CHECK (slot_number BETWEEN 1 AND 9),
  class_name TEXT,
  min_level INTEGER NOT NULL CHECK (min_level BETWEEN 1 AND 80),
  max_level INTEGER NOT NULL CHECK (max_level BETWEEN 1 AND 80),
  UNIQUE(party_id, slot_number)
);
CREATE INDEX IF NOT EXISTS vacancies_party ON vacancies(party_id);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id),
  owner_key TEXT NOT NULL REFERENCES sessions(id),
  character_id TEXT,
  character_name TEXT NOT NULL,
  class_name TEXT NOT NULL,
  level INTEGER NOT NULL,
  auth_status TEXT NOT NULL CHECK (auth_status IN ('guest', 'profile')),
  telegram TEXT NOT NULL DEFAULT '',
  discord TEXT NOT NULL DEFAULT '',
  time_zone TEXT NOT NULL,
  weekly_availability TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'removed')),
  accepted_slot INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS applications_party ON applications(party_id, status);
CREATE INDEX IF NOT EXISTS applications_owner ON applications(owner_key, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS applications_accepted_slot ON applications(party_id, accepted_slot) WHERE status = 'accepted';
