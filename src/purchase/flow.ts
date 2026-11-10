/**
 * The purchase flow from PLAN.md: INTENT -> gate DECISION -> PayPal order (AUTHORIZE) -> authorize ->
 * re-check against PayPal -> capture, or void on a mismatch. Deterministic code only; no model is involved.
 * Each step saves its progress, so calling a step again resumes instead of repeating a PayPal action.
 */
import { randomBytes } from "node:crypto";
import type { Db } from "../db";
import type { Gate, GateDecision, Mode } from "../gate/gate";
import type { Ledger } from "../ledger/ledger";
import { getMandate } from "../mandate/store";
import type { PayPalClient } from "../paypal/client";
import { centsToDecimal } from "../paypal/money";
import { approvalLink, authorizeOrder, createOrder, firstAuthorizationId, getOrder, type PayPalOrder } from "../paypal/orders";
import { captureAuthorization, refundCapture, voidAuthorization } from "../paypal/payments";
import { recheckOrder } from "../paypal/recheck";
import { requestIdFor } from "../paypal/request-ids";
import type { Product } from "../store/products";

export type PurchaseStatus =
  | "REJECTED" // never reached the gate (unknown product)
  | "BLOCKED"
  | "AWAITING_APPROVAL" // gate said ESCALATE; waiting for the user
  | "APPROVED_BY_GATE" // may pay; PayPal order not created yet
  | "NEEDS_BUYER" // PayPal order created; buyer must approve in PayPal
  | "AUTHORIZED"
  | "RECHECKED"
  | "RECHECK_FAILED"
  | "CAPTURED"
  | "VOIDED"
  | "REFUNDED";

export type PurchaseResult = {
  intent_id: string;
  status: PurchaseStatus;
  decision?: GateDecision;
  reason?: string;
  total_cents?: number;
  order_id?: string;
  approve_url?: string;
  authorization_id?: string;
  capture_id?: string;
  refund_id?: string;
};

export type PurchaseFlow = {
  /** The agent's only way to spend: propose a product and quantity. The server prices it. */
  propose(input: { mandate_id: string; product_id: string; quantity: number; mode: Mode }): Promise<PurchaseResult>;
  /** The user approved an escalated purchase. */
  approve(intentId: string): Promise<PurchaseResult>;
  /** Carries a purchase forward as far as it can go: authorize, re-check, then capture or void. */
  complete(intentId: string): Promise<PurchaseResult>;
  refund(intentId: string): Promise<PurchaseResult>;
  get(intentId: string): PurchaseResult | null;
};

type Row = {
  intent_id: string;
  mandate_id: string;
  user_id: string;
  product_id: string;
  quantity: number;
  total_cents: number;
  currency: string;
  custom_id: string;
  status: PurchaseStatus;
  order_id: string | null;
  approve_url: string | null;
  authorization_id: string | null;
  capture_id: string | null;
  refund_id: string | null;
};

export type FlowDeps = {
  db: Db;
  ledger: Ledger;
  gate: Gate;
  paypal: PayPalClient;
  catalog: Product[];
  /** The sandbox Business account that must be the payee on every order. */
  merchantEmail: string;
  /** Public URL of this app, for PayPal's return and cancel links. */
  baseUrl: string;
  newIntentId?: () => string;
};

export function createPurchaseFlow(deps: FlowDeps): PurchaseFlow {
  const { db, ledger, gate, paypal } = deps;
  const newIntentId = deps.newIntentId ?? (() => `int_${randomBytes(8).toString("hex")}`);

  const getRow = (intentId: string) => db.prepare("SELECT * FROM purchases WHERE intent_id = ?").get(intentId) as Row | undefined;

  function update(intentId: string, fields: Partial<Row>): Row {
    const keys = Object.keys(fields);
    db.prepare(`UPDATE purchases SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = @updated_at WHERE intent_id = @intent_id`).run({
      ...fields,
      intent_id: intentId,
      updated_at: new Date().toISOString(),
    });
    return getRow(intentId)!;
  }

  const result = (row: Row, decision?: GateDecision): PurchaseResult => ({
    intent_id: row.intent_id,
    status: row.status,
    total_cents: row.total_cents,
    ...(decision && { decision }),
    ...(row.order_id && { order_id: row.order_id }),
    ...(row.status === "NEEDS_BUYER" && row.approve_url && { approve_url: row.approve_url }),
    ...(row.authorization_id && { authorization_id: row.authorization_id }),
    ...(row.capture_id && { capture_id: row.capture_id }),
    ...(row.refund_id && { refund_id: row.refund_id }),
  });

  const ids = (row: Row) => ({ mandate_id: row.mandate_id, intent_id: row.intent_id });

  function mustGet(intentId: string): Row {
    const row = getRow(intentId);
    if (!row) throw new Error(`No purchase found for intent ${intentId}.`);
    return row;
  }

  /** Saves the authorization and, if PayPal vaulted the buyer's wallet, the vault ID. */
  function recordAuthorized(row: Row, order: PayPalOrder, authorizationId: string): Row {
    const vault = order.payment_source?.paypal?.attributes?.vault;
    if (vault?.id) {
      db.prepare(
        "INSERT INTO vault_tokens (user_id, vault_id, customer_id, saved_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET vault_id = excluded.vault_id, customer_id = excluded.customer_id, saved_at = excluded.saved_at",
      ).run(row.user_id, vault.id, vault.customer?.id ?? null, new Date().toISOString());
    }
    ledger.append({
      type: "AUTHORIZED",
      ...ids(row),
      payload: { order_id: order.id, authorization_id: authorizationId, total_cents: row.total_cents, vault_saved: Boolean(vault?.id) },
    });
    return update(row.intent_id, { status: "AUTHORIZED", authorization_id: authorizationId });
  }

  /** Step 4: create the PayPal order. With a saved PayPal the authorization comes back at once. */
  async function createPayPalOrder(row: Row): Promise<Row> {
    const product = deps.catalog.find((p) => p.id === row.product_id)!;
    const saved = db.prepare("SELECT vault_id FROM vault_tokens WHERE user_id = ?").get(row.user_id) as { vault_id: string } | undefined;
    const order = await createOrder(paypal, {
      requestId: requestIdFor(db, `create-order:${row.intent_id}`),
      customId: row.custom_id,
      description: `${product.name} x${row.quantity}`,
      currency: row.currency,
      items: [{ name: product.name, quantity: row.quantity, unit_price_cents: product.price_cents }],
      shippingCents: product.shipping_cents,
      totalCents: row.total_cents,
      payment: saved
        ? { vaultId: saved.vault_id }
        : {
            returnUrl: `${deps.baseUrl}/api/paypal/return?intent=${row.intent_id}`,
            cancelUrl: `${deps.baseUrl}/api/paypal/cancel?intent=${row.intent_id}`,
          },
    });
    ledger.append({
      type: "ORDER_CREATED",
      ...ids(row),
      payload: { order_id: order.id, total_cents: row.total_cents, currency: row.currency, custom_id: row.custom_id, buyer_present: !saved },
    });
    const authorizationId = firstAuthorizationId(order);
    if (authorizationId) return recordAuthorized(update(row.intent_id, { order_id: order.id }), order, authorizationId);
    return update(row.intent_id, { status: "NEEDS_BUYER", order_id: order.id, approve_url: approvalLink(order) ?? null });
  }

  async function advance(row: Row): Promise<Row> {
    if (row.status === "APPROVED_BY_GATE") {
      row = await createPayPalOrder(row);
      if (row.status === "NEEDS_BUYER") return row; // the buyer has to approve in PayPal first
    }
    if (row.status === "NEEDS_BUYER") {
      const order = await authorizeOrder(paypal, row.order_id!, requestIdFor(db, `authorize:${row.intent_id}`));
      const authorizationId = firstAuthorizationId(order);
      if (!authorizationId) throw new Error(`PayPal order ${order.id} has no authorization (status ${order.status}).`);
      row = recordAuthorized(row, order, authorizationId);
    }
    if (row.status === "AUTHORIZED") {
      // Step 6: re-read the order from PayPal and compare it with what the gate approved.
      const order = await getOrder(paypal, row.order_id!);
      const check = recheckOrder(order, {
        total_cents: row.total_cents,
        currency: row.currency,
        custom_id: row.custom_id,
        payee_email: deps.merchantEmail,
      });
      if (check.ok) {
        ledger.append({ type: "RECHECK_OK", ...ids(row), payload: { order_id: row.order_id, total_cents: row.total_cents } });
        row = update(row.intent_id, { status: "RECHECKED" });
      } else {
        ledger.append({ type: "RECHECK_FAILED", ...ids(row), payload: { order_id: row.order_id, mismatches: check.mismatches } });
        row = update(row.intent_id, { status: "RECHECK_FAILED" });
      }
    }
    if (row.status === "RECHECK_FAILED") {
      await voidAuthorization(paypal, row.authorization_id!, requestIdFor(db, `void:${row.intent_id}`));
      ledger.append({ type: "VOIDED", ...ids(row), payload: { authorization_id: row.authorization_id, reason: "RECHECK_FAILED" } });
      gate.release(row.intent_id);
      return update(row.intent_id, { status: "VOIDED" });
    }
    if (row.status === "RECHECKED") {
      const capture = await captureAuthorization(paypal, row.authorization_id!, requestIdFor(db, `capture:${row.intent_id}`));
      ledger.append({
        type: "CAPTURED",
        ...ids(row),
        payload: { capture_id: capture.id, capture_status: capture.status, authorization_id: row.authorization_id, order_id: row.order_id, total_cents: row.total_cents },
      });
      gate.markSpent(row.intent_id);
      row = update(row.intent_id, { status: "CAPTURED", capture_id: capture.id });
    }
    return row;
  }

  return {
    async propose({ mandate_id, product_id, quantity, mode }) {
      const intent_id = newIntentId();
      const product = deps.catalog.find((p) => p.id === product_id);
      if (!product) {
        ledger.append({ type: "INTENT", mandate_id, intent_id, payload: { product_id, quantity, error: "UNKNOWN_PRODUCT" } });
        return { intent_id, status: "REJECTED", reason: "UNKNOWN_PRODUCT" };
      }
      // The price comes from our catalogue, never from the agent.
      const total_cents = product.price_cents * quantity + product.shipping_cents;
      ledger.append({
        type: "INTENT",
        mandate_id,
        intent_id,
        payload: {
          product_id,
          product_name: product.name,
          merchant: product.merchant,
          category: product.category,
          quantity,
          unit_price_cents: product.price_cents,
          shipping_cents: product.shipping_cents,
          total_cents,
          mode,
        },
      });
      const decision = gate.decide({ intent_id, mandate_id, merchant: product.merchant, category: product.category, quantity, total_cents }, mode);
      if (!decision.proceed && decision.decision === "BLOCK") {
        return { intent_id, status: "BLOCKED", decision, total_cents };
      }
      const stored = getMandate(db, mandate_id)!; // exists: the gate just validated it
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO purchases (intent_id, mandate_id, user_id, product_id, quantity, total_cents, currency, custom_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        intent_id,
        mandate_id,
        stored.mandate.user_id,
        product_id,
        quantity,
        total_cents,
        stored.mandate.currency,
        `${mandate_id}:${intent_id}`,
        decision.proceed ? "APPROVED_BY_GATE" : "AWAITING_APPROVAL",
        now,
        now,
      );
      if (!decision.proceed) return result(getRow(intent_id)!, decision);
      return result(await advance(getRow(intent_id)!), decision);
    },

    async approve(intentId) {
      const row = mustGet(intentId);
      if (row.status === "AWAITING_APPROVAL") {
        gate.approve(intentId);
        update(intentId, { status: "APPROVED_BY_GATE" });
      }
      return result(await advance(mustGet(intentId)));
    },

    async complete(intentId) {
      const row = mustGet(intentId);
      if (row.status === "AWAITING_APPROVAL") throw new Error(`Intent ${intentId} is still awaiting the user's approval.`);
      return result(await advance(row));
    },

    async refund(intentId) {
      let row = mustGet(intentId);
      if (row.status === "REFUNDED") return result(row);
      if (row.status !== "CAPTURED") throw new Error(`Intent ${intentId} is not captured (status ${row.status}), so there is nothing to refund.`);
      const refund = await refundCapture(paypal, row.capture_id!, requestIdFor(db, `refund:${intentId}`));
      ledger.append({
        type: "REFUNDED",
        ...ids(row),
        payload: { refund_id: refund.id, refund_status: refund.status, capture_id: row.capture_id, total_cents: row.total_cents, amount: centsToDecimal(row.total_cents) },
      });
      row = update(intentId, { status: "REFUNDED", refund_id: refund.id });
      return result(row);
    },

    get(intentId) {
      const row = getRow(intentId);
      return row ? result(row) : null;
    },
  };
}
