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
-- One row per purchase attempt that reached the gate; tracks where it is in the PayPal flow.
CREATE TABLE IF NOT EXISTS purchases (
  intent_id        TEXT PRIMARY KEY,
  mandate_id       TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  product_id       TEXT NOT NULL,
  quantity         INTEGER NOT NULL,
  total_cents      INTEGER NOT NULL,
  currency         TEXT NOT NULL,
  custom_id        TEXT NOT NULL,
  status           TEXT NOT NULL,
  order_id         TEXT,
  approve_url      TEXT,
  authorization_id TEXT,
  capture_id       TEXT,
  refund_id        TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS purchases_order ON purchases (order_id);
CREATE INDEX IF NOT EXISTS purchases_capture ON purchases (capture_id);
-- The stored PayPal-Request-Id for each logical PayPal action, reused on retry.
CREATE TABLE IF NOT EXISTS paypal_request_ids (
  action     TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- The buyer's saved PayPal, used to pay with no buyer present.
CREATE TABLE IF NOT EXISTS vault_tokens (
  user_id     TEXT PRIMARY KEY,
  vault_id    TEXT NOT NULL,
  customer_id TEXT,
  saved_at    TEXT NOT NULL
);
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
