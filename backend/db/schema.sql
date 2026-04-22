-- CardMatch database schema
-- Run via seed.js on first startup; do not modify without updating seed.js

CREATE TABLE IF NOT EXISTS cards (
  id               INTEGER PRIMARY KEY,
  name             TEXT    NOT NULL,
  issuer           TEXT    NOT NULL,
  annual_fee       REAL    DEFAULT 0,
  min_credit_score INTEGER DEFAULT 0,
  reward_tiers     TEXT    NOT NULL,  -- JSON string (full rewards object)
  eligibility_rules TEXT,             -- JSON string (level, secured, studentFriendly, etc.)
  created_at       TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recommendation_logs (
  id          TEXT    PRIMARY KEY,  -- UUID v4
  session_id  TEXT,
  profile     TEXT    NOT NULL,     -- JSON string
  spending    TEXT    NOT NULL,     -- JSON string
  results     TEXT    NOT NULL,     -- JSON string
  algo_version TEXT   DEFAULT 'v1.0',
  duration_ms INTEGER,
  created_at  TEXT    DEFAULT (datetime('now'))
);
