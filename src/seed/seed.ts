/**
 * Demo data. Loads the real sandbox history recorded while building Verdict (one signed mandate, its
 * purchases and its two finished disputes) into an empty database, then signs one fresh mandate so a
 * visitor can use the agent straight away.
 *
 * The hosted database is wiped on every deploy and every time the free instance sleeps, so this runs
 * whenever the server starts with an empty ledger.
 */
import { randomBytes } from "node:crypto";
import type { Db } from "../db";
import { createLedger, type EntryType } from "../ledger/ledger";
import type { Mandate, PublicKeyJwk } from "../mandate/schema";
import { exportPublicJwk, generateSigningKeyPair, signMandate } from "../mandate/sign";
import { registerPublicKey, submitSignedMandate } from "../mandate/store";
import { verifyMandateSignature } from "../mandate/verify";

type Row = Record<string, string | number | null>;

export type SeedData = {
  mandate: { mandate: Mandate; signature: string; public_key_jwk: PublicKeyJwk };
  entries: { seq: number; ts: string; type: EntryType; mandate_id: string | null; intent_id: string | null; payload: Record<string, unknown> }[];
  gate_decisions: Row[];
  purchases: Row[];
  shipments: Row[];
  disputes: (Row & { dispute_id: string; outcome: string | null })[];
};

const DEMO_USER = "demo-user";
const FRESH_MANDATE_DAYS = 45;

function insertRow(db: Db, table: string, row: Row) {
  const columns = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((c) => `@${c}`).join(", ")})`).run(row);
}

/**
 * The recorded entries get new sequence numbers (1, 2, 3, ...), so numbers that entries quote about each
 * other, in `cited_seqs` and as "#12" inside evidence notes, are renumbered to match.
 */
function renumber(payload: Record<string, unknown>, map: Map<number, number>): Record<string, unknown> {
  const out = { ...payload };
  if (Array.isArray(out.cited_seqs)) out.cited_seqs = (out.cited_seqs as number[]).map((n) => map.get(n) ?? n);
  if (typeof out.notes === "string") out.notes = out.notes.replace(/#(\d+)\b/g, (whole, n) => (map.has(Number(n)) ? `#${map.get(Number(n))}` : whole));
  return out;
}

export async function seedDemo(db: Db, data: SeedData, opts: { vaultId?: string } = {}): Promise<{ seeded: boolean; entries: number }> {
  const count = () => (db.prepare("SELECT COUNT(*) AS n FROM ledger").get() as { n: number }).n;
  if (count() > 0) return { seeded: false, entries: 0 };

  const recorded = data.mandate;
  if (!verifyMandateSignature({ mandate: recorded.mandate, signature: recorded.signature, publicKeyJwk: recorded.public_key_jwk })) {
    throw new Error("Seed data is corrupt: the recorded mandate's signature does not verify.");
  }

  let clock = new Date();
  const ledger = createLedger(db, { now: () => clock });
  const map = new Map(data.entries.map((e, i) => [e.seq, i + 1]));

  db.transaction(() => {
    if (count() > 0) return; // another start-up got here first
    db.prepare("INSERT INTO mandates (id, user_id, mandate_json, signature, public_key_jwk, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      recorded.mandate.id,
      recorded.mandate.user_id,
      JSON.stringify(recorded.mandate),
      recorded.signature,
      JSON.stringify(recorded.public_key_jwk),
      recorded.mandate.created_at,
    );
    for (const e of data.entries) {
      clock = new Date(e.ts);
      ledger.append({ type: e.type, mandate_id: e.mandate_id, intent_id: e.intent_id, payload: renumber(e.payload, map) });
    }
    for (const row of data.gate_decisions) insertRow(db, "gate_decisions", row);
    for (const row of data.purchases) insertRow(db, "purchases", row);
    for (const row of data.shipments) insertRow(db, "shipments", row);
    for (const row of data.disputes) insertRow(db, "disputes", { ...row, detail_json: "{}" });
    if (opts.vaultId) {
      db.prepare("INSERT INTO vault_tokens (user_id, vault_id, customer_id, saved_at) VALUES (?, ?, NULL, ?)").run(DEMO_USER, opts.vaultId, new Date().toISOString());
    }
  }).immediate();

  // A fresh mandate for visitors, signed with a key made for this purpose. Signing your own on the
  // Mandate page replaces it.
  clock = new Date();
  const keyPair = await generateSigningKeyPair();
  registerPublicKey(db, DEMO_USER, await exportPublicJwk(keyPair.publicKey));
  const mandate: Mandate = {
    id: `mnd_${randomBytes(8).toString("hex")}`,
    version: 1,
    user_id: DEMO_USER,
    currency: "USD",
    per_purchase_cap_cents: 4000,
    total_budget_cents: 10000,
    approval_threshold_cents: 3000,
    allowed_merchants: ["demo-store"],
    allowed_categories: ["keyboards", "cables"],
    max_quantity_per_item: 2,
    expires_at: new Date(clock.getTime() + FRESH_MANDATE_DAYS * 86_400_000).toISOString(),
    created_at: clock.toISOString(),
    nonce: randomBytes(16).toString("hex"),
  };
  submitSignedMandate(db, ledger, { mandate, signature: await signMandate(keyPair.privateKey, mandate) });

  return { seeded: true, entries: count() };
}
