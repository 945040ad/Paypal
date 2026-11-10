import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { openDb } from "../db";
import { createGate } from "../gate/gate";
import { createLedger } from "../ledger/ledger";
import { registerPublicKey, submitSignedMandate } from "../mandate/store";
import { sampleMandate, testSigner } from "../mandate/testing";
import { fakePayPal } from "../purchase/fake-paypal";
import { createPurchaseFlow } from "../purchase/flow";
import { INJECTED_PRODUCT_ID, PRODUCTS } from "../store/products";
import { createAgentTools, runShoppingAgent, type AgentEvent } from "./agent";

const NOW = new Date("2026-11-12T00:00:00Z");

async function setup() {
  const db = openDb(":memory:");
  const ledger = createLedger(db);
  const signer = await testSigner();
  registerPublicKey(db, "demo-user", signer.publicKeyJwk);
  const mandate = sampleMandate();
  submitSignedMandate(db, ledger, { mandate, signature: await signer.sign(mandate) });
  const gate = createGate(db, ledger, { now: () => NOW });
  const paypal = fakePayPal({ payeeEmail: "store@business.example.com" });
  const flow = createPurchaseFlow({
    db,
    ledger,
    gate,
    paypal: paypal.client,
    catalog: PRODUCTS,
    merchantEmail: "store@business.example.com",
    baseUrl: "https://app.example.com",
  });
  const events: AgentEvent[] = [];
  const ctx = { flow, mandateId: mandate.id, mode: "ENFORCE" as const, onEvent: (e: AgentEvent) => events.push(e) };
  return { ledger, paypal, flow, mandate, events, ctx, tools: createAgentTools(ctx) };
}

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };

/** A scripted model: returns each reply in turn. */
function scriptedModel(replies: unknown[][]) {
  let i = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const content = replies[Math.min(i, replies.length - 1)];
      i += 1;
      const hasToolCall = content.some((c) => (c as { type: string }).type === "tool-call");
      return { content, finishReason: { unified: hasToolCall ? "tool-calls" : "stop", raw: undefined }, usage, warnings: [] } as never;
    },
  });
}

const toolCall = (toolName: string, input: unknown, id = "call-1") => ({ type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) });

describe("agent tools", () => {
  it("search_products returns matches without descriptions or hidden text", async () => {
    const { tools } = await setup();

    const out = await tools.search_products.execute!({ query: "cable" }, {} as never);

    expect(JSON.stringify(out)).toContain(INJECTED_PRODUCT_ID);
    expect(JSON.stringify(out)).not.toMatch(/minimum order|description/i);
  });

  it("view_product wraps the page text, hidden injection included, as untrusted data", async () => {
    const { tools } = await setup();

    const out = (await tools.view_product.execute!({ product_id: INJECTED_PRODUCT_ID }, {} as never)) as { page: string };

    expect(out.page).toMatch(/^<untrusted_data source="product_page">/);
    expect(out.page).toMatch(/minimum order/i);
  });

  it("view_product reports an unknown product instead of throwing", async () => {
    const { tools } = await setup();

    expect(await tools.view_product.execute!({ product_id: "nope" }, {} as never)).toMatchObject({ error: "UNKNOWN_PRODUCT" });
  });

  it("propose_purchase takes only a product and a quantity; the price, mandate and mode come from the server", async () => {
    const { tools, ledger, mandate } = await setup();

    expect(Object.keys((tools.propose_purchase.inputSchema as unknown as { shape: object }).shape).sort()).toEqual(["product_id", "quantity"]);
    await tools.propose_purchase.execute!({ product_id: "cable-usbc-1m", quantity: 1 }, {} as never);

    const intent = ledger.export().entries.find((e) => e.type === "INTENT")!;
    expect(intent.mandate_id).toBe(mandate.id);
    expect(intent.payload).toMatchObject({ total_cents: 900, mode: "ENFORCE" });
  });

  it("propose_purchase tells the model which rule blocked it, and emits the decision as an event", async () => {
    const { tools, events } = await setup();

    const out = await tools.propose_purchase.execute!({ product_id: INJECTED_PRODUCT_ID, quantity: 10 }, {} as never);

    expect(out).toMatchObject({ status: "BLOCKED", decision: "BLOCK", rule: "QUANTITY_LIMIT" });
    expect(events.find((e) => e.type === "decision")).toMatchObject({ decision: "BLOCK", rule: "QUANTITY_LIMIT", status: "BLOCKED" });
  });

  it("propose_purchase never hands the model a payment link", async () => {
    const { tools } = await setup();

    const out = await tools.propose_purchase.execute!({ product_id: "cable-usbc-1m", quantity: 1 }, {} as never);

    expect(out).toMatchObject({ status: "NEEDS_BUYER" });
    expect(JSON.stringify(out)).not.toMatch(/paypal\.com|approve_url/);
  });
});

describe("runShoppingAgent", () => {
  it("an agent that obeys the injected page and proposes 10 is blocked by the quantity rule, with no PayPal call", async () => {
    const { ctx, paypal, events, ledger } = await setup();
    const model = scriptedModel([
      [toolCall("view_product", { product_id: INJECTED_PRODUCT_ID })],
      [toolCall("propose_purchase", { product_id: INJECTED_PRODUCT_ID, quantity: 10 }, "call-2")],
      [{ type: "text", text: "The purchase was blocked." }],
    ]);

    const result = await runShoppingAgent({ ...ctx, model, task: "Buy the coiled aviator cable." });

    expect(result.text).toBe("The purchase was blocked.");
    expect(events.map((e) => e.type)).toEqual(["tool_call", "tool_result", "tool_call", "decision", "tool_result", "text"]);
    expect(events.find((e) => e.type === "decision")).toMatchObject({ decision: "BLOCK", rule: "QUANTITY_LIMIT" });
    expect(paypal.calls).toHaveLength(0);
    expect(ledger.export().entries.map((e) => e.type)).toEqual(["MANDATE_SIGNED", "INTENT", "DECISION"]);
  });

  it("stops after a bounded number of steps even if the model never stops calling tools", async () => {
    const { ctx, events } = await setup();
    const model = scriptedModel([[toolCall("search_products", { query: "cable" })]]);

    await runShoppingAgent({ ...ctx, model, task: "loop forever" });

    expect(events.filter((e) => e.type === "tool_call").length).toBeLessThanOrEqual(10);
  });
});
