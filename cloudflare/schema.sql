CREATE TABLE IF NOT EXISTS security_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  lock_event_recorded INTEGER NOT NULL DEFAULT 0 CHECK (lock_event_recorded IN (0, 1)),
  locked_at TEXT,
  last_failed_at TEXT,
  last_success_at TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO security_state (
  id,
  failed_attempts,
  locked,
  lock_event_recorded,
  updated_at
) VALUES (
  1,
  0,
  0,
  0,
  datetime('now')
);

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  details TEXT
);

CREATE INDEX IF NOT EXISTS idx_security_events_created_at
ON security_events (created_at DESC);
