/**
 * DEMO ONLY. Edits one ledger row directly in the database, behind the ledger's back, to show that the
 * hash chain catches it. The ledger module itself still has no update or delete path; this file is the
 * "attacker with database access" in the demo. Reset puts the original row back.
 */
import type { Db } from "../db";

const TABLE = "CREATE TABLE IF NOT EXISTS tamper_backup (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL, payload TEXT NOT NULL)";

type Backup = { seq: number; payload: string };

function backup(db: Db): Backup | undefined {
  db.exec(TABLE);
  return db.prepare("SELECT seq, payload FROM tamper_backup WHERE id = 1").get() as Backup | undefined;
}

export function isTampered(db: Db): boolean {
  return backup(db) !== undefined;
}

/** Rewrites the newest gate decision (or the newest entry, if there is none) without touching its hash. */
export function tamperWithRow(db: Db): { seq: number; type: string; before: string; after: string } {
  const existing = backup(db);
  const row = (existing
    ? db.prepare("SELECT seq, type, payload FROM ledger WHERE seq = ?").get(existing.seq)
    : (db.prepare("SELECT seq, type, payload FROM ledger WHERE type = 'DECISION' ORDER BY seq DESC LIMIT 1").get() ??
      db.prepare("SELECT seq, type, payload FROM ledger ORDER BY seq DESC LIMIT 1").get())) as { seq: number; type: string; payload: string } | undefined;
  if (!row) throw new Error("The ledger is empty, so there is no row to tamper with.");

  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  // What someone covering their tracks might do: shrink the amount and make the decision look like an ALLOW.
  payload.total_cents = typeof payload.total_cents === "number" ? Math.max(1, Math.floor(payload.total_cents / 10)) : 1;
  if ("decision" in payload) payload.decision = "ALLOW";
  payload.edited_outside_the_ledger = true;
  const after = JSON.stringify(payload);

  db.transaction(() => {
    if (!existing) db.prepare("INSERT INTO tamper_backup (id, seq, payload) VALUES (1, ?, ?)").run(row.seq, row.payload);
    db.prepare("UPDATE ledger SET payload = ? WHERE seq = ?").run(after, row.seq);
  })();
  return { seq: row.seq, type: row.type, before: existing?.payload ?? row.payload, after };
}

export function resetTamper(db: Db): { restored: boolean; seq: number | null } {
  const existing = backup(db);
  if (!existing) return { restored: false, seq: null };
  db.transaction(() => {
    db.prepare("UPDATE ledger SET payload = ? WHERE seq = ?").run(existing.payload, existing.seq);
    db.prepare("DELETE FROM tamper_backup WHERE id = 1").run();
  })();
  return { restored: true, seq: existing.seq };
}
