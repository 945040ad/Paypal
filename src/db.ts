import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ledger (
  seq        INTEGER PRIMARY KEY,
  ts         TEXT NOT NULL,
  type       TEXT NOT NULL,
  mandate_id TEXT,
  intent_id  TEXT,
  payload    TEXT NOT NULL,
  prev_hash  TEXT NOT NULL,
  hash       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_keys (
  user_id        TEXT PRIMARY KEY,
  public_key_jwk TEXT NOT NULL,
  registered_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mandates (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  mandate_json   TEXT NOT NULL,
  signature      TEXT NOT NULL,
  public_key_jwk TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  revoked_at     TEXT
);
-- One row per gate decision. status tracks the budget hold:
-- BLOCKED (nothing held), AWAITING_APPROVAL, RESERVED, SPENT (all three count against the budget), RELEASED.
CREATE TABLE IF NOT EXISTS gate_decisions (
  intent_id   TEXT PRIMARY KEY,
  mandate_id  TEXT NOT NULL,
  decision    TEXT NOT NULL,
  rule        TEXT,
  mode        TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  status      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS gate_decisions_mandate ON gate_decisions (mandate_id, status);
`;

/** Opens (and creates, if needed) the database at `path`. Use ":memory:" in tests. */
export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

// Kept on globalThis so Next's dev-mode module reloads reuse one connection.
const holder = globalThis as { __auditDb?: Db };

/** The app's database, opened from DATABASE_PATH on first use. */
export function getDb(): Db {
  return (holder.__auditDb ??= openDb(process.env.DATABASE_PATH ?? "./data/audit.db"));
}
