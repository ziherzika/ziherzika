CREATE TABLE personal_tracks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

CREATE INDEX idx_personal_tracks_owner_updated ON personal_tracks(owner_id, updated_at DESC);
PRAGMA optimize;
