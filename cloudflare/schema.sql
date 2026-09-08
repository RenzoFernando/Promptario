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

CREATE TABLE IF NOT EXISTS session_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO session_state (
  id,
  version,
  updated_at
) VALUES (
  1,
  1,
  datetime('now')
);

CREATE TABLE IF NOT EXISTS pin_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  algorithm TEXT NOT NULL CHECK (algorithm = 'hmac-sha256-v1'),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recovery_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  requested_ip TEXT,
  used_ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_recovery_tokens_expires_at
ON recovery_tokens (expires_at);

CREATE INDEX IF NOT EXISTS idx_recovery_tokens_requested_ip
ON recovery_tokens (requested_ip, created_at DESC);

CREATE TABLE IF NOT EXISTS blocked_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('ip', 'cidr')),
  created_at TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  details TEXT
);

CREATE INDEX IF NOT EXISTS idx_security_events_created_at
ON security_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_type_created_at
ON security_events (type, created_at DESC);
