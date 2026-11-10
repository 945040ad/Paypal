import { describe, expect, it } from "vitest";
import { openDb } from "../db";
import { createGate } from "../gate/gate";
import { createLedger } from "../ledger/ledger";
import type { Mandate } from "../mandate/schema";
import { registerPublicKey, submitSignedMandate } from "../mandate/store";
import { sampleMandate, testSigner } from "../mandate/testing";
import type { Product } from "../store/products";
import { fakePayPal } from "./fake-paypal";
import { createPurchaseFlow } from "./flow";

const NOW = new Date("2026-11-12T00:00:00Z");
const PAYEE = "store@business.example.com";

const CATALOG: Product[] = [
  { id: "kb-1", name: "Compact Keyboard", category: "keyboards", merchant: "demo-store", price_cents: 2500, shipping_cents: 400, description: "" },
  { id: "kb-2", name: "Tactile Keyboard", category: "keyboards", merchant: "demo-store", price_cents: 3500, shipping_cents: 0, description: "" },
  { id: "cable-1", name: "USB-C Cable", category: "cables", merchant: "demo-store", price_cents: 900, shipping_cents: 0, description: "" },
];

async function setup(overrides: Partial<Mandate> = {}) {
  const db = openDb(":memory:");
  const ledger = createLedger(db);
  const signer = await testSigner();
  registerPublicKey(db, "demo-user", signer.publicKeyJwk);
  const mandate = sampleMandate(overrides);
  submitSignedMandate(db, ledger, { mandate, signature: await signer.sign(mandate) });
  const gate = createGate(db, ledger, { now: () => NOW });
  const paypal = fakePayPal({ payeeEmail: PAYEE });
  let n = 0;
  const flow = createPurchaseFlow({
    db,
    ledger,
    gate,
    paypal: paypal.client,
    catalog: CATALOG,
    merchantEmail: PAYEE,
    baseUrl: "https://app.example.com",
    newIntentId: () => `int_${++n}`,
  });
  const types = () => ledger.export().entries.map((e) => e.type);
  const propose = (product_id: string, quantity = 1, mode: "ENFORCE" | "OBSERVE" = "ENFORCE") =>
    flow.propose({ mandate_id: mandate.id, product_id, quantity, mode });
  return { db, ledger, gate, paypal, flow, mandate, types, propose };
}

describe("purchase flow: first purchase, buyer present", () => {
  it("prices the order itself, records INTENT and DECISION, and returns PayPal's approval link", async () => {
    const { propose, ledger, paypal } = await setup();

    const r = await propose("kb-1");

    expect(r).toMatchObject({ status: "NEEDS_BUYER", approve_url: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1" });
    const entries = ledger.export().entries;
    expect(entries.map((e) => e.type)).toEqual(["MANDATE_SIGNED", "INTENT", "DECISION", "ORDER_CREATED"]);
    expect(entries[1].payload).toMatchObject({ product_id: "kb-1", quantity: 1, total_cents: 2900 });
    expect(entries[3].payload).toMatchObject({ order_id: "ORDER1", total_cents: 2900 });
    expect(paypal.callsTo("/v2/checkout/orders")).toHaveLength(1);
  });

  it("creates an AUTHORIZE order with decimal amounts, custom_id pointing at the ledger, and a vault request", async () => {
    const { propose, paypal, mandate } = await setup();

    await propose("kb-1");

    const body = paypal.calls[0].body!;
    expect(body.intent).toBe("AUTHORIZE");
    const unit = (body.purchase_units as Record<string, unknown>[])[0];
    expect(unit.custom_id).toBe(`${mandate.id}:int_1`);
    expect(unit.amount).toEqual({
      currency_code: "USD",
      value: "29.00",
      breakdown: { item_total: { currency_code: "USD", value: "25.00" }, shipping: { currency_code: "USD", value: "4.00" } },
    });
    expect(body.payment_source).toMatchObject({
      paypal: { attributes: { vault: { store_in_vault: "ON_SUCCESS", usage_type: "MERCHANT", customer_type: "CONSUMER" } } },
    });
  });

  it("after the buyer approves: authorizes, re-checks, captures, and writes the entries in order", async () => {
    const { propose, flow, types, ledger, gate, mandate } = await setup();
    const { intent_id } = await propose("kb-1");

    const r = await flow.complete(intent_id);

    expect(r).toMatchObject({ status: "CAPTURED", capture_id: expect.stringMatching(/^CAP/) });
    expect(types()).toEqual(["MANDATE_SIGNED", "INTENT", "DECISION", "ORDER_CREATED", "AUTHORIZED", "RECHECK_OK", "CAPTURED"]);
    expect(ledger.export().entries.at(-1)!.payload).toMatchObject({ capture_id: r.capture_id, total_cents: 2900 });
    expect(gate.committedCents(mandate.id)).toBe(2900);
    expect(ledger.verifyChain().ok).toBe(true);
  });

  it("every PayPal POST carries a PayPal-Request-Id", async () => {
    const { propose, flow, paypal } = await setup();
    const { intent_id } = await propose("kb-1");
    await flow.complete(intent_id);

    const posts = paypal.calls.filter((c) => c.method === "POST");
    expect(posts.length).toBe(3);
    expect(posts.every((c) => typeof c.requestId === "string" && c.requestId.length > 0)).toBe(true);
  });
});

describe("purchase flow: gate outcomes", () => {
  it("a BLOCK makes no PayPal call at all", async () => {
    const { propose, paypal, types } = await setup();

    const r = await propose("cable-1", 10);

    expect(r).toMatchObject({ status: "BLOCKED", decision: { decision: "BLOCK", rule: "QUANTITY_LIMIT" } });
    expect(paypal.calls).toHaveLength(0);
    expect(types()).toEqual(["MANDATE_SIGNED", "INTENT", "DECISION"]);
  });

  it("an ESCALATE waits, and creates the order only after the user approves", async () => {
    const { propose, flow, paypal, types } = await setup();

    const r = await propose("kb-2");
    expect(r.status).toBe("AWAITING_APPROVAL");
    expect(paypal.calls).toHaveLength(0);

    const approved = await flow.approve(r.intent_id);
    expect(approved.status).toBe("NEEDS_BUYER");
    expect(types()).toEqual(["MANDATE_SIGNED", "INTENT", "DECISION", "APPROVAL", "ORDER_CREATED"]);
  });

  it("an unknown product is recorded and rejected without reaching PayPal", async () => {
    const { propose, paypal, types } = await setup();

    const r = await propose("no-such-product");

    expect(r).toMatchObject({ status: "REJECTED", reason: "UNKNOWN_PRODUCT" });
    expect(paypal.calls).toHaveLength(0);
    expect(types()).toEqual(["MANDATE_SIGNED", "INTENT"]);
  });

  it("observe mode pays for an order the gate would have blocked, and the VIOLATION is on the ledger", async () => {
    const { propose, flow, types } = await setup();

    const r = await propose("cable-1", 3, "OBSERVE");
    const done = await flow.complete(r.intent_id);

    expect(done.status).toBe("CAPTURED");
    expect(types()).toEqual(["MANDATE_SIGNED", "INTENT", "DECISION", "VIOLATION", "ORDER_CREATED", "AUTHORIZED", "RECHECK_OK", "CAPTURED"]);
  });
});

describe("purchase flow: re-check", () => {
  it("voids and releases the budget when PayPal's order shows a different amount", async () => {
    const { propose, flow, paypal, types, gate, mandate, ledger } = await setup();
    const { intent_id } = await propose("kb-1");
    paypal.tamperAmount("290.00");

    const r = await flow.complete(intent_id);

    expect(r.status).toBe("VOIDED");
    expect(types().slice(-3)).toEqual(["AUTHORIZED", "RECHECK_FAILED", "VOIDED"]);
    expect(ledger.export().entries.at(-2)!.payload).toMatchObject({
      mismatches: [{ field: "amount", expected: "29.00", actual: "290.00" }],
    });
    expect(paypal.callsTo("/void")).toHaveLength(1);
    expect(paypal.callsTo("/capture")).toHaveLength(0);
    expect(gate.committedCents(mandate.id)).toBe(0);
  });
});

describe("purchase flow: retries", () => {
  it("completing the same intent twice produces one capture", async () => {
    const { propose, flow, paypal, types } = await setup();
    const { intent_id } = await propose("kb-1");

    const first = await flow.complete(intent_id);
    const second = await flow.complete(intent_id);

    expect(second).toMatchObject({ status: "CAPTURED", capture_id: first.capture_id });
    expect(paypal.callsTo("/capture")).toHaveLength(1);
    expect(types().filter((t) => t === "CAPTURED")).toHaveLength(1);
  });

  it("a capture retried after a network failure reuses the same PayPal-Request-Id", async () => {
    const { propose, flow, paypal, db } = await setup();
    const { intent_id } = await propose("kb-1");
    paypal.failNext("/capture");

    await expect(flow.complete(intent_id)).rejects.toThrow(/fetch failed/);
    const stored = db.prepare("SELECT request_id FROM paypal_request_ids WHERE action = ?").get(`capture:${intent_id}`) as { request_id: string };
    const r = await flow.complete(intent_id);

    expect(r.status).toBe("CAPTURED");
    expect(paypal.callsTo("/capture").map((c) => c.requestId)).toEqual([stored.request_id]);
  });

  it("a capture whose response was lost is not charged twice on retry", async () => {
    const { propose, flow, paypal, db } = await setup();
    const { intent_id } = await propose("kb-1");
    await flow.complete(intent_id);
    // Simulate a crash after PayPal captured but before we saved it.
    db.prepare("UPDATE purchases SET status = 'RECHECKED', capture_id = NULL WHERE intent_id = ?").run(intent_id);

    await flow.complete(intent_id);

    expect(paypal.callsTo("/capture")).toHaveLength(2);
    expect(paypal.distinctResults("/capture")).toBe(1);
  });
});

describe("purchase flow: saved PayPal (vault)", () => {
  it("stores the vault ID from the first purchase and pays the next one with no buyer present", async () => {
    const { propose, flow, paypal, types } = await setup();
    const first = await propose("kb-1");
    await flow.complete(first.intent_id);

    const second = await propose("cable-1");

    expect(second).toMatchObject({ status: "CAPTURED", capture_id: expect.stringMatching(/^CAP/) });
    expect(second.approve_url).toBeUndefined();
    const createBody = paypal.callsTo("/v2/checkout/orders").filter((c) => c.path === "/v2/checkout/orders")[1].body!;
    expect(createBody.payment_source).toEqual({ paypal: { vault_id: "VAULT1" } });
    expect(types().slice(-6)).toEqual(["INTENT", "DECISION", "ORDER_CREATED", "AUTHORIZED", "RECHECK_OK", "CAPTURED"]);
  });

  it("keeps asking the buyer when PayPal returned no vault ID", async () => {
    const { propose, flow, paypal } = await setup();
    paypal.noVault();
    const first = await propose("kb-1");
    await flow.complete(first.intent_id);

    expect((await propose("cable-1")).status).toBe("NEEDS_BUYER");
  });
});

describe("purchase flow: refund", () => {
  it("refunds a captured purchase once and records REFUNDED", async () => {
    const { propose, flow, paypal, types } = await setup();
    const { intent_id } = await propose("kb-1");
    await flow.complete(intent_id);

    const r = await flow.refund(intent_id);
    await flow.refund(intent_id);

    expect(r).toMatchObject({ status: "REFUNDED", refund_id: expect.stringMatching(/^REF/) });
    expect(paypal.callsTo("/refund")).toHaveLength(1);
    expect(types().filter((t) => t === "REFUNDED")).toHaveLength(1);
  });

  it("refuses to refund a purchase that was never captured", async () => {
    const { propose, flow } = await setup();
    const { intent_id } = await propose("kb-1");

    await expect(flow.refund(intent_id)).rejects.toThrow(/not captured/i);
  });
});
