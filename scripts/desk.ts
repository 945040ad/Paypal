/**
 * Dispute desk from the command line (the /disputes page does the same with buttons).
 *   npm run desk -- sync | list | view <id> | prepare <id> | evidence <id> | escalate <id> | accept <id> | adjudicate <id> [SELLER_FAVOR|BUYER_FAVOR]
 */
import { getDb } from "../src/db";
import { classifyDispute } from "../src/evidence/classifier";
import { getPayPalClient } from "../src/paypal/client";
import { reconcile } from "../src/paypal/reconcile";
import { getDesk, getLedger } from "../src/server";
import { recordShipment } from "../src/store/shipments";

const [command, id, extra] = process.argv.slice(2);
const db = getDb();
const ledger = getLedger();
const desk = getDesk();

async function main() {
  if (command === "sync") {
    // The demo store ships every captured order; orders captured before shipping existed get their record now.
    for (const { intent_id } of db.prepare("SELECT intent_id FROM purchases WHERE status = 'CAPTURED' AND intent_id NOT IN (SELECT intent_id FROM shipments)").all() as { intent_id: string }[]) {
      recordShipment(db, intent_id);
    }
    console.log(JSON.stringify(await reconcile({ db, ledger, paypal: getPayPalClient() })));
    return main_list();
  }
  if (command === "list") return main_list();
  if (!id) throw new Error("Give a dispute ID.");
  if (command === "view") {
    const v = await desk.view(id);
    console.log(`${v.dispute_id}  status=${v.detail.status}  stage=${v.detail.dispute_life_cycle_stage}  reason=${v.detail.reason}`);
    console.log(`classification: ${v.classification.classification} - ${v.classification.reason}`);
    console.log(`actions PayPal offers: ${v.actions.join(", ") || "none"}   evidence type to send: ${v.evidence_type ?? "-"}`);
    console.log(`outcome: ${v.detail.dispute_outcome?.outcome_code ?? "-"}`);
  } else if (command === "prepare") {
    const d = await desk.prepare(id);
    console.log(`evidence_type=${d.evidence_type} stage=${d.stage} source=${d.source} problems=${JSON.stringify(d.problems)}\n${d.notes}`);
  } else if (command === "evidence") console.log(JSON.stringify(await desk.fileEvidence(id)));
  else if (command === "escalate") console.log(JSON.stringify(await desk.escalate(id)));
  else if (command === "accept") console.log(JSON.stringify(await desk.acceptClaim(id)));
  else if (command === "adjudicate") console.log(JSON.stringify(await desk.adjudicate(id, extra === "BUYER_FAVOR" ? "BUYER_FAVOR" : "SELLER_FAVOR")));
  else throw new Error(`Unknown command ${command}`);
}

function main_list() {
  for (const r of db.prepare("SELECT dispute_id, status, stage, amount_cents, outcome, intent_id FROM disputes ORDER BY first_seen_at DESC").all() as Record<string, unknown>[]) {
    const c = classifyDispute(db, ledger, r.dispute_id as string);
    console.log(`${r.dispute_id}  ${String(r.status).padEnd(28)} ${String(r.stage).padEnd(10)} ${String(r.amount_cents).padStart(5)}c  ${c.classification.padEnd(10)} ${r.outcome ?? ""}  ${r.intent_id ?? ""}`);
  }
}

main().catch((err) => {
  console.error(`${err?.code ? `[${err.code}] ` : ""}${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
