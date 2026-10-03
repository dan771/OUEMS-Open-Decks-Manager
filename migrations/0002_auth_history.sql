CREATE TABLE IF NOT EXISTS app_security (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL
);
INSERT OR IGNORE INTO app_security (id, version, data)
VALUES (1, 0, '{"version":0,"users":[],"sessions":[],"attempts":[]}');
CREATE TABLE IF NOT EXISTS app_snapshots (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  name TEXT NOT NULL,
  author TEXT NOT NULL,
  board_version INTEGER NOT NULL,
  data TEXT NOT NULL
);
