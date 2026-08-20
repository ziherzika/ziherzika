PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY(project_id, user_id)
);

CREATE TABLE tracks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  youtube_id TEXT NOT NULL,
  youtube_url TEXT NOT NULL,
  title TEXT NOT NULL,
  channel TEXT,
  thumbnail_url TEXT,
  bpm INTEGER CHECK(bpm IS NULL OR (bpm BETWEEN 20 AND 300)),
  musical_key TEXT,
  notes TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  is_favorite INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE invites (
  token_hash TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('editor','viewer')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX idx_projects_owner ON projects(owner_id);
CREATE INDEX idx_members_user ON project_members(user_id);
CREATE INDEX idx_tracks_project_updated ON tracks(project_id, updated_at DESC);
CREATE INDEX idx_invites_project ON invites(project_id);
PRAGMA optimize;
