-- Existing workspace JSON is migrated atomically on its next successful save.
CREATE TABLE IF NOT EXISTS workspace_entities (
  kind TEXT NOT NULL, id TEXT NOT NULL, board_id TEXT NOT NULL,
  data TEXT NOT NULL, revision INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS workspace_entities_board ON workspace_entities(board_id, deleted);
CREATE INDEX IF NOT EXISTS workspace_entities_revision ON workspace_entities(revision);
CREATE TABLE IF NOT EXISTS app_snapshot_chunks (
  snapshot_id TEXT NOT NULL REFERENCES app_snapshots(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, sequence)
);
