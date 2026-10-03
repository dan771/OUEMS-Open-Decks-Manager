CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL
);
INSERT OR IGNORE INTO app_state (id, version, data)
VALUES (1, 0, '{"schemaVersion":1,"version":0,"terms":[]}');
