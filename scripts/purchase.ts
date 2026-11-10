/**
 * npm run purchase -- [productId] [quantity] [--observe] [--new-mandate] [--refund]
 *
 * Runs one purchase end to end on the PayPal sandbox: propose, gate decision, order, authorize, re-check, capture.
 * The first purchase prints a PayPal link for the sandbox buyer to approve and waits for it. After that the
 * buyer's saved PayPal is used and no approval is needed.
 */
import { randomBytes } from "node:crypto";
import { getDb } from "../src/db";
import { createGate } from "../src/gate/gate";
import { createLedger } from "../src/ledger/ledger";
import type { Mandate } from "../src/mandate/schema";
import { exportPublicJwk, generateSigningKeyPair, signMandate } from "../src/mandate/sign";
import { registerPublicKey, submitSignedMandate } from "../src/mandate/store";
import { createPayPalClient } from "../src/paypal/client";
import { getOrder } from "../src/paypal/orders";
import { createPurchaseFlow } from "../src/purchase/flow";
import { PRODUCTS } from "../src/store/products";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [productId = "kb-compact-60", quantityArg = "1"] = args.filter((a) => !a.startsWith("--"));

const db = getDb();
const ledger = createLedger(db);
const gate = createGate(db, ledger);
const paypal = createPayPalClient();
const merchantEmail = process.env.PAYPAL_MERCHANT_EMAIL;
if (!merchantEmail) throw new Error("PAYPAL_MERCHANT_EMAIL must be set.");
const flow = createPurchaseFlow({
  db,
  ledger,
  gate,
  paypal,
  catalog: PRODUCTS,
  merchantEmail,
  baseUrl: process.env.APP_BASE_URL ?? "https://example.com",
});

/** Uses the newest unexpired mandate, or signs a fresh one with a key made for this command-line run. */
async function ensureMandate(): Promise<string> {
  if (!flags.has("--new-mandate")) {
    const row = db
      .prepare("SELECT id FROM mandates WHERE revoked_at IS NULL AND json_extract(mandate_json, '$.expires_at') > ? ORDER BY created_at DESC LIMIT 1")
      .get(new Date().toISOString()) as { id: string } | undefined;
    if (row) return row.id;
  }
  const keyPair = await generateSigningKeyPair();
  registerPublicKey(db, "demo-user", await exportPublicJwk(keyPair.publicKey));
  const now = new Date();
  const mandate: Mandate = {
    id: `mnd_${randomBytes(8).toString("hex")}`,
    version: 1,
    user_id: "demo-user",
    currency: "USD",
    per_purchase_cap_cents: 4000,
    total_budget_cents: 10000,
    approval_threshold_cents: 3000,
    allowed_merchants: ["demo-store"],
    allowed_categories: ["keyboards", "cables"],
    max_quantity_per_item: 2,
    expires_at: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
    created_at: now.toISOString(),
    nonce: randomBytes(16).toString("hex"),
  };
  submitSignedMandate(db, ledger, { mandate, signature: await signMandate(keyPair.privateKey, mandate) });
  console.log(`Signed a new mandate ${mandate.id} (cap $40, budget $100, ask above $30, keyboards and cables, max 2 per item).`);
  return mandate.id;
}

async function waitForBuyer(orderId: string) {
  const until = Date.now() + 10 * 60_000;
  while (Date.now() < until) {
    const order = await getOrder(paypal, orderId);
    if (order.status === "APPROVED") return;
    if (order.status !== "PAYER_ACTION_REQUIRED" && order.status !== "CREATED") {
      throw new Error(`Order ${orderId} is ${order.status}; expected the buyer to approve it.`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Gave up after 10 minutes waiting for the buyer to approve.");
}

async function main() {
  const mandate_id = await ensureMandate();
  const mode = flags.has("--observe") ? "OBSERVE" : "ENFORCE";
  console.log(`Proposing ${quantityArg} x ${productId} under ${mandate_id} (${mode})`);

  let r = await flow.propose({ mandate_id, product_id: productId, quantity: Number(quantityArg), mode });
  if (r.decision) console.log(`Gate: ${r.decision.decision}${r.decision.rule ? ` (${r.decision.rule})` : ""}, ${r.decision.rules_passed} rules passed, total ${r.total_cents} cents`);

  if (r.status === "AWAITING_APPROVAL") {
    console.log("Escalated. Approving on the user's behalf (command-line run).");
    r = await flow.approve(r.intent_id);
  }
  if (r.status === "NEEDS_BUYER") {
    console.log(`\nAPPROVE AS THE SANDBOX BUYER: ${r.approve_url}\n`);
    await waitForBuyer(r.order_id!);
    console.log("Buyer approved.");
    r = await flow.complete(r.intent_id);
  }

  if (flags.has("--refund") && r.status === "CAPTURED") {
    console.log(`Captured ${r.capture_id}. Refunding it (--refund).`);
    r = await flow.refund(r.intent_id);
    console.log(`PayPal refund:        ${r.refund_id}`);
  }

  console.log(`\nResult: ${r.status}${r.reason ? ` (${r.reason})` : ""}`);
  if (r.order_id) console.log(`PayPal order:         ${r.order_id}`);
  if (r.authorization_id) console.log(`PayPal authorization: ${r.authorization_id}`);
  if (r.capture_id) console.log(`PayPal capture:       ${r.capture_id}`);

  console.log("\nLedger entries for this purchase:");
  for (const e of ledger.export().entries.filter((e) => e.intent_id === r.intent_id)) {
    console.log(`  ${String(e.seq).padStart(3)}  ${e.ts}  ${e.type.padEnd(15)} ${e.hash.slice(0, 12)}`);
  }
  const chain = ledger.verifyChain();
  console.log(`Chain: ${chain.ok ? `valid, ${chain.length} entries` : `BROKEN at ${chain.first_bad_seq}`}`);
  const vault = db.prepare("SELECT vault_id FROM vault_tokens WHERE user_id = 'demo-user'").get() as { vault_id: string } | undefined;
  console.log(`Saved PayPal (vault): ${vault ? vault.vault_id : "none"}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
