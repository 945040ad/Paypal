/**
 * npx tsx --env-file=.env.local scripts/export-seed.ts [mandateId]
 * Developer tool: writes src/seed/demo-data.json from the local database, so the hosted demo can start with
 * the real sandbox history (one signed mandate, its purchases and its two finished disputes).
 * The data holds PayPal sandbox IDs and test-account details only; no credentials.
 */
import { writeFileSync } from "node:fs";
import { getDb } from "../src/db";
import { getMandate } from "../src/mandate/store";

const mandateId = process.argv[2] ?? "mnd_9eb37f8a2b3aecd3";
const db = getDb();
const stored = getMandate(db, mandateId);
if (!stored) throw new Error(`No mandate ${mandateId} in the local database.`);

const all = <T>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...params) as T[];

const entries = all<{ seq: number; ts: string; type: string; mandate_id: string | null; intent_id: string | null; payload: string }>(
  "SELECT seq, ts, type, mandate_id, intent_id, payload FROM ledger WHERE mandate_id = ? ORDER BY seq",
  mandateId,
).map((e) => ({ ...e, payload: JSON.parse(e.payload) }));

const data = {
  exported_at: new Date().toISOString(),
  note: "Real PayPal sandbox history recorded while building Verdict. Sandbox IDs and test accounts only.",
  mandate: { mandate: stored.mandate, signature: stored.signature, public_key_jwk: stored.public_key_jwk },
  entries,
  gate_decisions: all("SELECT * FROM gate_decisions WHERE mandate_id = ? ORDER BY created_at", mandateId),
  purchases: all("SELECT * FROM purchases WHERE mandate_id = ? ORDER BY created_at", mandateId),
  shipments: all("SELECT * FROM shipments WHERE intent_id IN (SELECT intent_id FROM purchases WHERE mandate_id = ?)", mandateId),
  disputes: all<Record<string, unknown>>("SELECT * FROM disputes WHERE mandate_id = ? ORDER BY first_seen_at", mandateId).map(({ detail_json: _d, ...row }) => {
    void _d;
    return row;
  }),
};

writeFileSync("src/seed/demo-data.json", `${JSON.stringify(data, null, 2)}\n`);
console.log(`Wrote src/seed/demo-data.json: ${entries.length} ledger entries, ${data.purchases.length} purchases, ${data.disputes.length} disputes.`);
