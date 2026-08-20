CREATE TABLE project_email_invites (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  invited_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('editor','viewer')) DEFAULT 'editor',
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined')) DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  responded_at INTEGER,
  UNIQUE(project_id, invited_user_id)
);

CREATE INDEX idx_email_invites_user_status ON project_email_invites(invited_user_id, status, created_at DESC);
PRAGMA optimize;
