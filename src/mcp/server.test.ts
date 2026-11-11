import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { openDb } from "../db";
import { createGate } from "../gate/gate";
import { createLedger } from "../ledger/ledger";
import { registerPublicKey, submitSignedMandate } from "../mandate/store";
import { sampleMandate, testSigner } from "../mandate/testing";
import { fakePayPal } from "../purchase/fake-paypal";
import { createPurchaseFlow } from "../purchase/flow";
import { PRODUCTS } from "../store/products";
import { createVerdictMcpServer } from "./server";

/** A fresh world with the standard mandate: cap $40, budget $100, approval above $30, keyboards + cables, max 2 per item. */
async function world({ mandate = true } = {}) {
  const db = openDb(":memory:");
  const ledger = createLedger(db);
  const gate = createGate(db, ledger);
  if (mandate) {
    const signer = await testSigner();
    registerPublicKey(db, "demo-user", signer.publicKeyJwk);
    const now = new Date();
    const m = sampleMandate({ created_at: now.toISOString(), expires_at: new Date(now.getTime() + 86_400_000).toISOString() });
    submitSignedMandate(db, ledger, { mandate: m, signature: await signer.sign(m) });
  }
  const flow = createPurchaseFlow({
    db,
    ledger,
    gate,
    paypal: fakePayPal({ payeeEmail: "store@example.com" }).client,
    catalog: PRODUCTS,
    merchantEmail: "store@example.com",
    baseUrl: "https://verdict.example",
  });
  const server = createVerdictMcpServer({ db, ledger, gate, flow, userId: "demo-user", baseUrl: "https://verdict.example" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { type: string; text: string }[])[0].text;
    return { isError: Boolean(res.isError), text, json: JSON.parse(text) };
  };
  return { db, ledger, client, call };
}

describe("Verdict MCP server", () => {
  it("offers shopping and read-only tools, and nothing that approves, signs or acts on a dispute", async () => {
    const { client } = await world();

    const names = (await client.listTools()).tools.map((t) => t.name).sort();

    expect(names).toEqual(["get_ledger", "get_spending_status", "list_disputes", "propose_purchase", "search_products", "verify_ledger", "view_product"]);
  });

  it("reports the signed limits and what is left of the budget", async () => {
    const { call } = await world();

    const { json } = await call("get_spending_status");

    expect(json).toMatchObject({
      mode: "ENFORCE",
      per_purchase_cap_cents: 4000,
      total_budget_cents: 10000,
      committed_cents: 0,
      remaining_cents: 10000,
      approval_threshold_cents: 3000,
      allowed_categories: ["keyboards", "cables"],
      max_quantity_per_item: 2,
    });
  });

  it("puts an allowed purchase through the gate and counts it against the budget", async () => {
    const { call } = await world();

    const { json } = await call("propose_purchase", { product_id: "cable-usbc-1m", quantity: 1 });

    expect(json).toMatchObject({ decision: "ALLOW", rule: null, total_cents: 900 });
    expect((await call("get_spending_status")).json).toMatchObject({ committed_cents: 900, remaining_cents: 9100 });
  });

  it("never hands the client a payment link or an intent id it could approve with", async () => {
    const { call } = await world();

    const { text, json } = await call("propose_purchase", { product_id: "cable-usbc-1m", quantity: 1 });

    expect(json.status).toBe("NEEDS_BUYER"); // the fake PayPal has no saved buyer, so a PayPal approval link exists
    expect(text).not.toContain("paypal.com");
    expect(text).not.toContain("int_");
  });

  it("blocks a quantity above the limit and names the rule", async () => {
    const { call } = await world();

    const { json } = await call("propose_purchase", { product_id: "cable-usbc-1m", quantity: 10 });

    expect(json).toMatchObject({ status: "BLOCKED", decision: "BLOCK", rule: "QUANTITY_LIMIT" });
  });

  it("leaves a purchase above the approval threshold waiting for the person, unpaid", async () => {
    const { call, db } = await world();

    const { json } = await call("propose_purchase", { product_id: "kb-tactile-75", quantity: 1 });

    expect(json).toMatchObject({ status: "AWAITING_APPROVAL", decision: "ESCALATE", rule: "APPROVAL_THRESHOLD" });
    expect(json.message).toContain("https://verdict.example/agent");
    expect(db.prepare("SELECT count(*) AS n FROM ledger WHERE type IN ('APPROVAL', 'ORDER_CREATED')").get()).toEqual({ n: 0 });
  });

  it("refuses to propose anything when no mandate is signed", async () => {
    const { call, db } = await world({ mandate: false });

    const res = await call("propose_purchase", { product_id: "cable-usbc-1m", quantity: 1 });

    expect(res.isError).toBe(true);
    expect(res.json.error).toBe("NO_MANDATE");
    expect(db.prepare("SELECT count(*) AS n FROM purchases").get()).toEqual({ n: 0 });
  });

  it("marks product page text as untrusted data", async () => {
    const { call } = await world();

    const { json } = await call("view_product", { product_id: "cable-coiled-aviator" });

    expect(json.page).toMatch(/^<untrusted_data/);
  });

  it("finds products by keyword", async () => {
    const { call } = await world();

    const { json } = await call("search_products", { query: "usb-c" });

    expect(json.products.map((p: { id: string }) => p.id)).toContain("cable-usbc-1m");
  });

  it("verifies the ledger chain and shows recent entries in plain words", async () => {
    const { call } = await world();
    await call("propose_purchase", { product_id: "cable-usbc-1m", quantity: 10 });

    const verify = (await call("verify_ledger")).json;
    const ledger = (await call("get_ledger", { limit: 2 })).json;

    expect(verify).toMatchObject({ ok: true, length: 3 });
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.entries[1]).toContain("DECISION: gate decision BLOCK (rule QUANTITY_LIMIT)");
  });

  it("lists disputes with the classification code gave them", async () => {
    const { call } = await world();

    expect((await call("list_disputes")).json).toEqual({ disputes: [] });
  });
});
