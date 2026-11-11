import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { openDb } from "../db";
import { createGate } from "../gate/gate";
import { createLedger } from "../ledger/ledger";
import { registerPublicKey, submitSignedMandate } from "../mandate/store";
import { sampleMandate, testSigner } from "../mandate/testing";
import { recordDispute, type DisputeDetail } from "../paypal/disputes";
import { stubPayPal, type StubCall, type StubReply } from "../paypal/testing";
import { fakePayPal } from "../purchase/fake-paypal";
import { createPurchaseFlow } from "../purchase/flow";
import { PRODUCTS } from "../store/products";
import { classifyDispute } from "./classifier";
import { createDesk } from "./desk";
import { checkCitations, templateNotes } from "./notes";
import { buildEvidencePdf } from "./pdf";

const NOW = new Date("2026-11-12T00:00:00Z");
const PAYEE = "store@business.example.com";

/** A world with one signed mandate and a purchase flow on a fake PayPal, plus a separate stub for dispute calls. */
async function setup() {
  const db = openDb(":memory:");
  const ledger = createLedger(db);
  const signer = await testSigner();
  registerPublicKey(db, "demo-user", signer.publicKeyJwk);
  const mandate = sampleMandate();
  submitSignedMandate(db, ledger, { mandate, signature: await signer.sign(mandate) });
  const gate = createGate(db, ledger, { now: () => NOW });
  const payments = fakePayPal({ payeeEmail: PAYEE });
  const flow = createPurchaseFlow({ db, ledger, gate, paypal: payments.client, catalog: PRODUCTS, merchantEmail: PAYEE, baseUrl: "https://app.example.com" });

  const world: { dispute?: DisputeDetail; failNext?: boolean } = {};
  const paypal = stubPayPal((call: StubCall): StubReply => {
    if (call.method === "GET" && call.path.startsWith("/v1/customer/disputes/")) return world.dispute ? { body: world.dispute } : { status: 404, body: {} };
    if (call.method === "POST" && call.path.startsWith("/v1/customer/disputes/")) {
      if (world.failNext) return { status: 400, body: { name: "INVALID_REQUEST", details: [{ issue: "ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE" }] } };
      return { body: { links: [] } };
    }
    return undefined;
  });
  const desk = createDesk({ db, ledger, paypal: paypal.client });
  const entries = (type?: string) => ledger.export().entries.filter((e) => !type || e.type === type);

  /** Buys a product through the flow and returns what a dispute on it would carry. */
  async function buy(productId: string, mode: "ENFORCE" | "OBSERVE" = "ENFORCE", quantity = 1) {
    const r = await flow.propose({ mandate_id: mandate.id, product_id: productId, quantity, mode });
    const done = r.status === "NEEDS_BUYER" ? await flow.complete(r.intent_id) : r;
    return { intent_id: r.intent_id, capture_id: done.capture_id!, total_cents: done.total_cents!, custom: `${mandate.id}:${r.intent_id}` };
  }

  function openDispute(p: { capture_id: string; total_cents: number; custom: string }, overrides: Partial<DisputeDetail> = {}) {
    world.dispute = {
      dispute_id: "PP-R-AAA-1",
      status: "WAITING_FOR_SELLER_RESPONSE",
      reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
      dispute_life_cycle_stage: "INQUIRY",
      dispute_amount: { currency_code: "USD", value: (p.total_cents / 100).toFixed(2) },
      disputed_transactions: [{ seller_transaction_id: p.capture_id, custom: p.custom }],
      evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", source: "REQUESTED_FROM_SELLER" }],
      links: [
        { rel: "self", href: "x" },
        { rel: "provide_evidence", href: "x" },
        { rel: "accept_claim", href: "x" },
        { rel: "escalate", href: "x" },
      ],
      ...overrides,
    };
    recordDispute({ db, ledger }, world.dispute);
    return world.dispute;
  }

  return { db, ledger, gate, flow, mandate, paypal, desk, world, entries, buy, openDispute };
}

describe("classifyDispute", () => {
  it("IN_MANDATE when the gate allowed the purchase and the captured amount matches", async () => {
    const s = await setup();
    const p = await s.buy("cable-usbc-1m");
    s.openDispute(p);

    const c = classifyDispute(s.db, s.ledger, "PP-R-AAA-1");

    expect(c.classification).toBe("IN_MANDATE");
    expect(c.cited_seqs.length).toBeGreaterThanOrEqual(2);
    expect(c.reason).toMatch(/ALLOW/);
  });

  it("IN_MANDATE when the gate escalated and the user approved", async () => {
    const s = await setup();
    const r = await s.flow.propose({ mandate_id: s.mandate.id, product_id: "kb-tactile-75", quantity: 1, mode: "ENFORCE" });
    await s.flow.approve(r.intent_id);
    const done = await s.flow.complete(r.intent_id);
    s.openDispute({ capture_id: done.capture_id!, total_cents: 3500, custom: `${s.mandate.id}:${r.intent_id}` });

    expect(classifyDispute(s.db, s.ledger, "PP-R-AAA-1")).toMatchObject({ classification: "IN_MANDATE", reason: expect.stringMatching(/APPROVAL/) });
  });

  it("VIOLATION when the ledger holds a VIOLATION entry for the purchase", async () => {
    const s = await setup();
    const p = await s.buy("kb-flagship-tkl", "OBSERVE");
    s.openDispute(p);

    const c = classifyDispute(s.db, s.ledger, "PP-R-AAA-1");

    expect(c.classification).toBe("VIOLATION");
    expect(c.reason).toMatch(/PER_PURCHASE_CAP/);
    expect(c.cited_seqs).toContain(s.entries("VIOLATION")[0].seq);
  });

  it("VIOLATION when the ledger holds an UNMATCHED_CAPTURE entry for the purchase", async () => {
    const s = await setup();
    const p = await s.buy("cable-usbc-1m");
    s.ledger.append({ type: "UNMATCHED_CAPTURE", mandate_id: s.mandate.id, intent_id: p.intent_id, payload: { capture_id: p.capture_id, reason: "AMOUNT_MISMATCH" } });
    s.openDispute(p);

    expect(classifyDispute(s.db, s.ledger, "PP-R-AAA-1").classification).toBe("VIOLATION");
  });

  it("UNKNOWN when the payment has no ledger record", async () => {
    const s = await setup();
    s.openDispute({ capture_id: "CAPX", total_cents: 1000, custom: "spike:a:1" });

    expect(classifyDispute(s.db, s.ledger, "PP-R-AAA-1")).toMatchObject({ classification: "UNKNOWN", cited_seqs: [] });
  });

  it("UNKNOWN when the disputed amount is more than was captured", async () => {
    const s = await setup();
    const p = await s.buy("cable-usbc-1m");
    s.openDispute({ ...p, total_cents: 5000 });

    expect(classifyDispute(s.db, s.ledger, "PP-R-AAA-1").classification).toBe("UNKNOWN");
  });

  it("UNKNOWN when the ledger chain has been tampered with", async () => {
    const s = await setup();
    const p = await s.buy("cable-usbc-1m");
    s.openDispute(p);
    s.db.prepare("UPDATE ledger SET payload = '{}' WHERE seq = 2").run();

    expect(classifyDispute(s.db, s.ledger, "PP-R-AAA-1")).toMatchObject({ classification: "UNKNOWN", reason: expect.stringMatching(/chain/i) });
  });
});

describe("checkCitations", () => {
  it("accepts notes whose cited entries all exist", () => {
    expect(checkCitations("The gate allowed it [#3] and it was captured [#7].", [1, 3, 7])).toEqual({ ok: true, cited: [3, 7], problems: [] });
  });

  it("rejects a cited number that is not in the ledger extract", () => {
    const r = checkCitations("Approved [#3], shipped [#99].", [1, 3, 7]);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/99/);
  });

  it("checks every number in a grouped citation", () => {
    expect(checkCitations("Verified twice [#3, #7].", [1, 3, 7])).toMatchObject({ ok: true, cited: [3, 7] });
    expect(checkCitations("Verified twice [#3, #98].", [1, 3, 7]).ok).toBe(false);
  });

  it("rejects notes that cite nothing", () => {
    expect(checkCitations("The buyer definitely authorised this.", [1, 3]).ok).toBe(false);
  });

  it("rejects notes over 2,000 characters", () => {
    expect(checkCitations(`[#1] ${"x".repeat(2000)}`, [1]).ok).toBe(false);
  });

  it("the built-in template always passes its own check", async () => {
    const s = await setup();
    const p = await s.buy("cable-usbc-1m");
    s.openDispute(p);
    const c = classifyDispute(s.db, s.ledger, "PP-R-AAA-1");

    const notes = templateNotes({ classification: c, extract: c.extract, disputeId: "PP-R-AAA-1" });

    expect(checkCitations(notes, c.extract.map((e) => e.seq)).ok).toBe(true);
  });
});

describe("buildEvidencePdf", () => {
  it("produces a readable PDF that names the dispute, the mandate and the capture", async () => {
    const s = await setup();
    const p = await s.buy("cable-usbc-1m");
    s.openDispute(p);

    const { bytes, text } = await buildEvidencePdf(s.db, s.ledger, "PP-R-AAA-1");

    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
    expect(text).toContain("PP-R-AAA-1");
    expect(text).toContain(s.mandate.id);
    expect(text).toContain(p.capture_id);
    expect(text).toMatch(/Signature check: VALID/);
    expect(text).toMatch(/Ledger chain: VALID/);
  });
});

describe("dispute desk", () => {
  it("files the evidence type PayPal asked for, with the PDF, and records EVIDENCE_SUBMITTED", async () => {
    const s = await setup();
    const p = await s.buy("cable-usbc-1m");
    s.openDispute(p);

    await s.desk.fileEvidence("PP-R-AAA-1");

    const post = s.paypal.calls.find((c) => c.method === "POST")!;
    expect(post.path).toBe("/v1/customer/disputes/PP-R-AAA-1/provide-evidence");
    const form = post.rawBody as FormData;
    const input = JSON.parse(await (form.get("input") as Blob).text());
    expect(input.evidences).toHaveLength(1);
    expect(input.evidences[0].evidence_type).toBe("PROOF_OF_FULFILLMENT");
    expect(input.evidences[0].evidence_info.tracking_info[0].tracking_number).toMatch(/^\d+$/);
    expect((form.get("evidence-file") as File).type).toBe("application/pdf");
    expect(s.entries("EVIDENCE_SUBMITTED")[0].payload).toMatchObject({ dispute_id: "PP-R-AAA-1", evidence_type: "PROOF_OF_FULFILLMENT", stage: "INQUIRY" });
  });

  it("sends OTHER once PayPal requests it at the claim stage", async () => {
    const s = await setup();
    const p = await s.buy("cable-usbc-1m");
    s.openDispute(p, {
      dispute_life_cycle_stage: "CHARGEBACK",
      evidences: [
        { evidence_type: "PROOF_OF_FULFILLMENT", source: "REQUESTED_FROM_SELLER" },
        { evidence_type: "OTHER", source: "REQUESTED_FROM_SELLER" },
      ],
    });

    await s.desk.fileEvidence("PP-R-AAA-1");

    const form = s.paypal.calls.find((c) => c.method === "POST")!.rawBody as FormData;
    expect(JSON.parse(await (form.get("input") as Blob).text()).evidences[0].evidence_type).toBe("OTHER");
  });

  it("re-fetches the dispute and refuses when provide_evidence is not in its links", async () => {
    const s = await setup();
    const p = await s.buy("cable-usbc-1m");
    s.openDispute(p, { links: [{ rel: "self", href: "x" }] });

    await expect(s.desk.fileEvidence("PP-R-AAA-1")).rejects.toThrow(/not available/i);
    expect(s.paypal.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(s.entries("EVIDENCE_SUBMITTED")).toHaveLength(0);
  });

  it("refuses to file evidence against a dispute the ledger says is a violation", async () => {
    const s = await setup();
    const p = await s.buy("kb-flagship-tkl", "OBSERVE");
    s.openDispute(p);

    await expect(s.desk.fileEvidence("PP-R-AAA-1")).rejects.toThrow(/violation/i);
    expect(s.paypal.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("accepts the claim with a full refund and records CLAIM_ACCEPTED citing the violation", async () => {
    const s = await setup();
    const p = await s.buy("kb-flagship-tkl", "OBSERVE");
    s.openDispute(p);

    await s.desk.acceptClaim("PP-R-AAA-1");

    const post = s.paypal.calls.find((c) => c.method === "POST")!;
    expect(post.path).toBe("/v1/customer/disputes/PP-R-AAA-1/accept-claim");
    expect(post.body).toMatchObject({ accept_claim_type: "REFUND" });
    const [entry] = s.entries("CLAIM_ACCEPTED");
    expect(entry.payload).toMatchObject({ dispute_id: "PP-R-AAA-1", classification: "VIOLATION" });
    expect(entry.payload.cited_seqs).toContain(s.entries("VIOLATION")[0].seq);
  });

  it("refuses accept-claim when it is not in the dispute's links", async () => {
    const s = await setup();
    const p = await s.buy("kb-flagship-tkl", "OBSERVE");
    s.openDispute(p, { links: [{ rel: "self", href: "x" }] });

    await expect(s.desk.acceptClaim("PP-R-AAA-1")).rejects.toThrow(/not available/i);
    expect(s.entries("CLAIM_ACCEPTED")).toHaveLength(0);
  });

  it("writes nothing to the ledger when PayPal rejects the action", async () => {
    const s = await setup();
    const p = await s.buy("kb-flagship-tkl", "OBSERVE");
    s.openDispute(p);
    s.world.failNext = true;

    await expect(s.desk.acceptClaim("PP-R-AAA-1")).rejects.toThrow(/400/);
    expect(s.entries("CLAIM_ACCEPTED")).toHaveLength(0);
    expect(s.paypal.calls.filter((c) => c.method === "POST")).toHaveLength(1); // no automatic retry
  });

  it("escalates only when escalate is in the links, and records it", async () => {
    const s = await setup();
    const p = await s.buy("cable-usbc-1m");
    s.openDispute(p);

    await s.desk.escalate("PP-R-AAA-1");

    expect(s.paypal.calls.find((c) => c.method === "POST")!.path).toBe("/v1/customer/disputes/PP-R-AAA-1/escalate");
    expect(s.entries("DISPUTE_ESCALATED")).toHaveLength(1);
  });

  it("adjudicate is refused unless PayPal offers it", async () => {
    const s = await setup();
    const p = await s.buy("cable-usbc-1m");
    s.openDispute(p);

    await expect(s.desk.adjudicate("PP-R-AAA-1", "SELLER_FAVOR")).rejects.toThrow(/not available/i);

    s.world.dispute!.links!.push({ rel: "adjudicate", href: "x" });
    await s.desk.adjudicate("PP-R-AAA-1", "SELLER_FAVOR");
    expect(s.paypal.calls.find((c) => c.method === "POST")!.body).toEqual({ adjudication_outcome: "SELLER_FAVOR" });
  });

  it("lists the actions PayPal currently offers, using its underscore link names", async () => {
    const s = await setup();
    const p = await s.buy("cable-usbc-1m");
    s.openDispute(p);

    const view = await s.desk.view("PP-R-AAA-1");

    expect(view.actions.sort()).toEqual(["accept_claim", "escalate", "provide_evidence"]);
    expect(view.classification.classification).toBe("IN_MANDATE");
  });
});
