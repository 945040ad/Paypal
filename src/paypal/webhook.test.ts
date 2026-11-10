import { describe, expect, it } from "vitest";
import { openDb } from "../db";
import { createGate } from "../gate/gate";
import { createLedger } from "../ledger/ledger";
import { registerPublicKey, submitSignedMandate } from "../mandate/store";
import { sampleMandate, testSigner } from "../mandate/testing";
import { reconcile } from "./reconcile";
import { stubPayPal, type StubCall, type StubReply } from "./testing";
import { handleWebhook } from "./webhook";

const NOW = new Date("2026-11-12T00:00:00Z");
const WEBHOOK_ID = "WH-TEST";
const HEADERS = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  "paypal-transmission-id": "tx-1",
  "paypal-transmission-sig": "sig==",
  "paypal-transmission-time": "2026-11-12T00:00:00Z",
};

type World = {
  verification?: string;
  captures?: Record<string, unknown>;
  authorizations?: Record<string, unknown>;
  disputes?: Record<string, unknown>;
  disputeList?: unknown[];
  failRefetch?: boolean;
};

async function setup(world: World = {}) {
  const db = openDb(":memory:");
  const ledger = createLedger(db);
  const signer = await testSigner();
  registerPublicKey(db, "demo-user", signer.publicKeyJwk);
  const mandate = sampleMandate();
  submitSignedMandate(db, ledger, { mandate, signature: await signer.sign(mandate) });
  const gate = createGate(db, ledger, { now: () => NOW });

  const paypal = stubPayPal((call: StubCall): StubReply => {
    if (call.path === "/v1/notifications/verify-webhook-signature") {
      return { body: { verification_status: world.verification ?? "SUCCESS" } };
    }
    if (world.failRefetch) return { status: 503, body: { name: "SERVICE_UNAVAILABLE" } };
    const lookup = (prefix: string, table?: Record<string, unknown>) => {
      if (!call.path.startsWith(prefix)) return undefined;
      const found = table?.[call.path.slice(prefix.length)];
      return found ? { body: found } : { status: 404, body: { name: "RESOURCE_NOT_FOUND" } };
    };
    if (call.path.startsWith("/v1/customer/disputes?")) return { body: { items: world.disputeList ?? [] } };
    return (
      lookup("/v2/payments/captures/", world.captures) ??
      lookup("/v2/payments/authorizations/", world.authorizations) ??
      lookup("/v1/customer/disputes/", world.disputes)
    );
  });

  const deps = { db, ledger, paypal: paypal.client, webhookId: WEBHOOK_ID };
  const deliver = (event: unknown, opts: { raw?: string; headers?: Record<string, string> } = {}) =>
    handleWebhook(deps, { rawBody: opts.raw ?? JSON.stringify(event), headers: new Headers(opts.headers ?? HEADERS) });
  const entries = (type?: string) => ledger.export().entries.filter((e) => !type || e.type === type);
  const decide = (intent_id: string, total_cents: number, mode: "ENFORCE" | "OBSERVE" = "ENFORCE", quantity = 1) =>
    gate.decide({ intent_id, mandate_id: mandate.id, merchant: "demo-store", category: "keyboards", quantity, total_cents }, mode);
  return { db, ledger, gate, paypal, deps, deliver, entries, decide, mandate, world };
}

const captureEvent = (id = "WH-EVT-1", captureId = "CAP1") => ({
  id,
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource_type: "capture",
  resource: { id: captureId, status: "COMPLETED", amount: { currency_code: "USD", value: "999.00" } },
});
const capture = (custom_id: string, value = "25.00", status = "COMPLETED") => ({
  id: "CAP1",
  status,
  custom_id,
  amount: { currency_code: "USD", value },
});
const dispute = (status = "WAITING_FOR_SELLER_RESPONSE", custom = "mnd_test0001:int_1", extra: Record<string, unknown> = {}) => ({
  dispute_id: "PP-R-AAA-1",
  status,
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  dispute_life_cycle_stage: "INQUIRY",
  dispute_amount: { currency_code: "USD", value: "25.00" },
  disputed_transactions: [{ seller_transaction_id: "CAP1", buyer_transaction_id: "BUY1", custom }],
  ...extra,
});

describe("webhook signature", () => {
  it("builds the verify request from the raw body, byte for byte", async () => {
    const { deliver, paypal } = await setup({ captures: { CAP1: capture("x:y") } });
    const raw = '{"id":"WH-EVT-1",  "event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"CAP1","note":"caf\\u00e9 1.50"}}';

    await deliver(null, { raw });

    const verify = paypal.callsTo("verify-webhook-signature")[0];
    expect(typeof verify.rawBody).toBe("string");
    expect(verify.rawBody as string).toContain(`"webhook_event":${raw}`);
    expect(verify.body).toMatchObject({
      auth_algo: "SHA256withRSA",
      cert_url: HEADERS["paypal-cert-url"],
      transmission_id: "tx-1",
      transmission_sig: "sig==",
      transmission_time: "2026-11-12T00:00:00Z",
      webhook_id: WEBHOOK_ID,
    });
  });

  it("answers 400 and writes nothing when the signature does not verify", async () => {
    const { deliver, entries, paypal, db } = await setup({ verification: "FAILURE", captures: { CAP1: capture("x:y") } });
    const before = entries().length;

    const res = await deliver(captureEvent());

    expect(res.status).toBe(400);
    expect(entries()).toHaveLength(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM webhook_events").get()).toEqual({ n: 0 });
    expect(paypal.callsTo("/v2/payments")).toHaveLength(0);
  });

  it("answers 400 without calling PayPal when a signature header is missing", async () => {
    const { deliver, paypal, entries } = await setup();
    const { "paypal-transmission-sig": _omit, ...headers } = HEADERS;
    void _omit;

    const res = await deliver(captureEvent(), { headers });

    expect(res.status).toBe(400);
    expect(paypal.calls).toHaveLength(0);
    expect(entries("WEBHOOK")).toHaveLength(0);
  });

  it("answers 400 when a verified body is not a usable event", async () => {
    const { deliver, entries } = await setup();

    expect((await deliver(null, { raw: '{"hello":"world"}' })).status).toBe(400);
    expect(entries("WEBHOOK")).toHaveLength(0);
  });
});

describe("webhook handling", () => {
  it("writes a WEBHOOK entry from the re-fetched resource, not from the event's own claims", async () => {
    const { deliver, entries } = await setup({ captures: { CAP1: capture("x:y", "25.00", "REFUNDED") } });

    const res = await deliver(captureEvent());

    expect(res.status).toBe(200);
    const [entry] = entries("WEBHOOK");
    expect(entry.payload).toMatchObject({
      event_id: "WH-EVT-1",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource_id: "CAP1",
      status: "REFUNDED",
      amount_cents: 2500,
    });
  });

  it("ignores a repeated event ID", async () => {
    const { deliver, entries } = await setup({ captures: { CAP1: capture("x:y") } });

    await deliver(captureEvent());
    const second = await deliver(captureEvent());

    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ duplicate: true });
    expect(entries("WEBHOOK")).toHaveLength(1);
  });

  it("does not mark an event as seen when the re-fetch fails, so PayPal's retry is processed", async () => {
    const s = await setup({ failRefetch: true, captures: { CAP1: capture("x:y") } });

    await expect(s.deliver(captureEvent())).rejects.toThrow(/503/);
    expect(s.entries("WEBHOOK")).toHaveLength(0);

    s.world.failRefetch = false;
    expect((await s.deliver(captureEvent())).status).toBe(200);
    expect(s.entries("WEBHOOK")).toHaveLength(1);
  });

  it("links the entry to the mandate and intent in custom_id", async () => {
    const s = await setup();
    s.decide("int_1", 2500);
    s.world.captures = { CAP1: capture(`${s.mandate.id}:int_1`) };

    await s.deliver(captureEvent());

    expect(s.entries("WEBHOOK")[0]).toMatchObject({ mandate_id: s.mandate.id, intent_id: "int_1" });
  });

  it("re-fetches an authorization event from the authorizations endpoint", async () => {
    const { deliver, entries } = await setup({ authorizations: { AUTH1: { id: "AUTH1", status: "VOIDED", custom_id: "x:y", amount: { currency_code: "USD", value: "9.00" } } } });

    await deliver({ id: "WH-EVT-2", event_type: "PAYMENT.AUTHORIZATION.VOIDED", resource: { id: "AUTH1" } });

    expect(entries("WEBHOOK")[0].payload).toMatchObject({ resource_type: "authorization", resource_id: "AUTH1", status: "VOIDED" });
  });
});

describe("unmatched captures", () => {
  it("a capture that matches an ALLOW decision writes no UNMATCHED_CAPTURE", async () => {
    const s = await setup();
    s.decide("int_1", 2500);
    s.world.captures = { CAP1: capture(`${s.mandate.id}:int_1`) };

    await s.deliver(captureEvent());

    expect(s.entries("UNMATCHED_CAPTURE")).toHaveLength(0);
  });

  it("a capture that matches an approved escalation writes no UNMATCHED_CAPTURE", async () => {
    const s = await setup();
    s.decide("int_1", 3500);
    s.gate.approve("int_1");
    s.world.captures = { CAP1: capture(`${s.mandate.id}:int_1`, "35.00") };

    await s.deliver(captureEvent());

    expect(s.entries("UNMATCHED_CAPTURE")).toHaveLength(0);
  });

  it("a capture with no gate decision behind it writes UNMATCHED_CAPTURE", async () => {
    const s = await setup({ captures: { CAP1: capture("mnd_other:int_nope") } });

    await s.deliver(captureEvent());

    expect(s.entries("UNMATCHED_CAPTURE")[0].payload).toMatchObject({ capture_id: "CAP1", amount_cents: 2500, reason: "NO_GATE_DECISION" });
  });

  it("a capture for more than the gate allowed writes UNMATCHED_CAPTURE", async () => {
    const s = await setup();
    s.decide("int_1", 2500);
    s.world.captures = { CAP1: capture(`${s.mandate.id}:int_1`, "250.00") };

    await s.deliver(captureEvent());

    expect(s.entries("UNMATCHED_CAPTURE")[0]).toMatchObject({ intent_id: "int_1", payload: { reason: "AMOUNT_MISMATCH", amount_cents: 25000, decided_cents: 2500 } });
  });

  it("a capture the gate would have blocked (observe mode) writes UNMATCHED_CAPTURE", async () => {
    const s = await setup();
    s.decide("int_1", 2500, "OBSERVE", 10);
    s.world.captures = { CAP1: capture(`${s.mandate.id}:int_1`) };

    await s.deliver(captureEvent());

    expect(s.entries("UNMATCHED_CAPTURE")[0].payload).toMatchObject({ reason: "NO_ALLOW_OR_APPROVAL" });
  });

  it("an escalation that was never approved (observe mode) writes UNMATCHED_CAPTURE", async () => {
    const s = await setup();
    s.decide("int_1", 3500, "OBSERVE");
    s.world.captures = { CAP1: capture(`${s.mandate.id}:int_1`, "35.00") };

    await s.deliver(captureEvent());

    expect(s.entries("UNMATCHED_CAPTURE")[0].payload).toMatchObject({ reason: "NO_ALLOW_OR_APPROVAL" });
  });

  it("flags the same capture only once across two different events", async () => {
    const s = await setup({ captures: { CAP1: capture("mnd_other:int_nope") } });

    await s.deliver(captureEvent("WH-EVT-1"));
    await s.deliver({ ...captureEvent("WH-EVT-9"), event_type: "PAYMENT.CAPTURE.REFUNDED" });

    expect(s.entries("UNMATCHED_CAPTURE")).toHaveLength(1);
    expect(s.entries("WEBHOOK")).toHaveLength(2);
  });
});

describe("dispute events", () => {
  const disputeEvent = (id: string, type = "CUSTOMER.DISPUTE.CREATED") => ({ id, event_type: type, resource: { dispute_id: "PP-R-AAA-1", status: "OPEN" } });

  it("writes DISPUTE_OPENED once, linked to the ledger through the transaction's custom field", async () => {
    const s = await setup({ disputes: { "PP-R-AAA-1": dispute() } });
    s.decide("int_1", 2500);

    await s.deliver(disputeEvent("WH-D-1"));
    await s.deliver(disputeEvent("WH-D-2", "CUSTOMER.DISPUTE.UPDATED"));

    const opened = s.entries("DISPUTE_OPENED");
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      mandate_id: s.mandate.id,
      intent_id: "int_1",
      payload: { dispute_id: "PP-R-AAA-1", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", capture_id: "CAP1", amount_cents: 2500, status: "WAITING_FOR_SELLER_RESPONSE" },
    });
  });

  it("writes DISPUTE_RESOLVED once when the re-fetched dispute is resolved", async () => {
    const s = await setup({ disputes: { "PP-R-AAA-1": dispute() } });
    await s.deliver(disputeEvent("WH-D-1"));
    s.world.disputes = { "PP-R-AAA-1": dispute("RESOLVED", "mnd_test0001:int_1", { dispute_outcome: { outcome_code: "RESOLVED_SELLER_FAVOUR" } }) };

    await s.deliver(disputeEvent("WH-D-2", "CUSTOMER.DISPUTE.RESOLVED"));
    await s.deliver(disputeEvent("WH-D-3", "CUSTOMER.DISPUTE.UPDATED"));

    const resolved = s.entries("DISPUTE_RESOLVED");
    expect(resolved).toHaveLength(1);
    expect(resolved[0].payload).toMatchObject({ dispute_id: "PP-R-AAA-1", outcome: "RESOLVED_SELLER_FAVOUR" });
  });

  it("leaves mandate and intent empty for a dispute on a payment we have no record of", async () => {
    const s = await setup({ disputes: { "PP-R-AAA-1": dispute("OPEN", "spike:b:123") } });

    await s.deliver(disputeEvent("WH-D-1"));

    expect(s.entries("DISPUTE_OPENED")[0]).toMatchObject({ mandate_id: null, intent_id: null });
  });
});

describe("reconcile", () => {
  it("records a dispute the webhooks missed, using the detail call rather than the lagging list", async () => {
    const s = await setup({
      disputeList: [{ dispute_id: "PP-R-AAA-1", status: "UNDER_REVIEW" }],
      disputes: { "PP-R-AAA-1": dispute("WAITING_FOR_SELLER_RESPONSE") },
    });

    const summary = await reconcile(s.deps);

    expect(summary).toMatchObject({ disputes_seen: 1, disputes_opened: 1 });
    expect(s.entries("DISPUTE_OPENED")[0].payload).toMatchObject({ status: "WAITING_FOR_SELLER_RESPONSE" });
  });

  it("writes nothing new when run again with no changes", async () => {
    const s = await setup({ disputeList: [{ dispute_id: "PP-R-AAA-1" }], disputes: { "PP-R-AAA-1": dispute() } });
    await reconcile(s.deps);
    const before = s.entries().length;

    const summary = await reconcile(s.deps);

    expect(summary).toMatchObject({ disputes_seen: 1, disputes_opened: 0, disputes_resolved: 0 });
    expect(s.entries()).toHaveLength(before);
  });

  it("records a resolution it finds", async () => {
    const s = await setup({ disputeList: [{ dispute_id: "PP-R-AAA-1" }], disputes: { "PP-R-AAA-1": dispute() } });
    await reconcile(s.deps);
    s.world.disputes = { "PP-R-AAA-1": dispute("RESOLVED", "mnd_test0001:int_1", { dispute_outcome: { outcome_code: "RESOLVED_BUYER_FAVOUR" } }) };

    const summary = await reconcile(s.deps);

    expect(summary.disputes_resolved).toBe(1);
    expect(s.entries("DISPUTE_RESOLVED")[0].payload).toMatchObject({ outcome: "RESOLVED_BUYER_FAVOUR" });
  });
});
