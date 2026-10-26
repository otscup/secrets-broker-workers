-- Secrets Broker v2: a vault of ciphertext rows and the keyrings allowed to open
-- them. Deliberately independent of the NodeWarden tables: v2 owns its own D1 so
-- the Bitwarden compatibility layer can be retired without a data migration of
-- the old schema.
--
-- Nothing here is readable without the data key. The worker stores ciphertext,
-- wrapped copies of the key, public device keys and a token hash.

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO meta (key, value) VALUES ('revision', '0');

CREATE TABLE IF NOT EXISTS vault_items (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'api' CHECK (kind IN ('api', 'web')),
  ciphertext TEXT NOT NULL,
  revision   INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_vault_items_revision ON vault_items (revision);

-- One row per thing that may unwrap the data key. 'password' rows carry a
-- PBKDF2 envelope; 'device' rows carry an ECDH envelope addressed to one
-- device's public key. Revoking a device means deleting its row, nothing else.
CREATE TABLE IF NOT EXISTS keyrings (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('password', 'device')),
  envelope   TEXT NOT NULL,
  device_id  TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS devices (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  public_jwk   TEXT NOT NULL,
  token_hash   TEXT,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_devices_token ON devices (token_hash);

-- Local or cloud, every vault action is recorded with the revision it produced,
-- so a peer can tell "I have seen up to here" without reading the items.
CREATE TABLE IF NOT EXISTS audit_v2 (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT NOT NULL,
  event    TEXT NOT NULL,
  subject  TEXT,
  detail   TEXT,
  revision INTEGER
);
