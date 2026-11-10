/**
 * The gate: plain code that checks a proposed purchase against the signed mandate.
 * No model is involved. The decision, the ledger entry and the budget hold happen in one database transaction.
 */
import type { Db } from "../db";
import type { Ledger } from "../ledger/ledger";
import { getMandate, type StoredMandate } from "../mandate/store";
import { verifyMandateSignature } from "../mandate/verify";

/** The seven rules, in the order they are checked. */
export const RULES = [
  "MANDATE_VALID",
  "MERCHANT_ALLOWED",
  "CATEGORY_ALLOWED",
  "QUANTITY_LIMIT",
  "PER_PURCHASE_CAP",
  "TOTAL_BUDGET",
  "APPROVAL_THRESHOLD",
] as const;

export type RuleName = (typeof RULES)[number];
export type Mode = "ENFORCE" | "OBSERVE";
export type DecisionKind = "ALLOW" | "ESCALATE" | "BLOCK";

export type Proposal = {
  intent_id: string;
  mandate_id: string;
  merchant: string;
  /** null when the product's category is unknown; that fails rule 3. */
  category: string | null;
  quantity: number;
  /** Items, shipping and tax, in integer cents. Computed by the server, never taken from the agent. */
  total_cents: number;
};

export type Verdict = {
  decision: DecisionKind;
  /** The rule that blocked or escalated; null for ALLOW. */
  rule: RuleName | null;
  rules_passed: number;
};

export type GateDecision = Verdict & {
  intent_id: string;
  mandate_id: string;
  total_cents: number;
  mode: Mode;
  /** Whether the payment may go ahead now. */
  proceed: boolean;
};

export type Gate = {
  decide(proposal: Proposal, mode: Mode): GateDecision;
  /** The user clicked Approve on an escalated order. */
  approve(intentId: string): { intent_id: string; total_cents: number; proceed: true };
  /** Frees the held budget after a void, a failure or a rejected escalation. */
  release(intentId: string): void;
  /** The payment was captured; the amount is now spent for good. */
  markSpent(intentId: string): void;
  /** Spent plus reserved, in cents, for a mandate. */
  committedCents(mandateId: string): number;
};

const isPositiveInt = (n: number) => Number.isSafeInteger(n) && n > 0;

/** Pure rule check. `committedCents` is what the mandate has already spent or reserved. */
export function evaluate(stored: StoredMandate | null, proposal: Proposal, ctx: { now: Date; committedCents: number }): Verdict {
  const checks: [RuleName, () => boolean][] = [
    [
      "MANDATE_VALID",
      () =>
        stored !== null &&
        stored.revoked_at === null &&
        ctx.now.getTime() < Date.parse(stored.mandate.expires_at) &&
        verifyMandateSignature({ mandate: stored.mandate, signature: stored.signature, publicKeyJwk: stored.public_key_jwk }),
    ],
    ["MERCHANT_ALLOWED", () => stored!.mandate.allowed_merchants.includes(proposal.merchant)],
    ["CATEGORY_ALLOWED", () => proposal.category !== null && stored!.mandate.allowed_categories.includes(proposal.category)],
    ["QUANTITY_LIMIT", () => isPositiveInt(proposal.quantity) && proposal.quantity <= stored!.mandate.max_quantity_per_item],
    ["PER_PURCHASE_CAP", () => isPositiveInt(proposal.total_cents) && proposal.total_cents <= stored!.mandate.per_purchase_cap_cents],
    ["TOTAL_BUDGET", () => ctx.committedCents + proposal.total_cents <= stored!.mandate.total_budget_cents],
  ];
  for (let i = 0; i < checks.length; i++) {
    const [rule, passes] = checks[i];
    if (!passes()) return { decision: "BLOCK", rule, rules_passed: i };
  }
  if (proposal.total_cents > stored!.mandate.approval_threshold_cents) {
    return { decision: "ESCALATE", rule: "APPROVAL_THRESHOLD", rules_passed: 6 };
  }
  return { decision: "ALLOW", rule: null, rules_passed: 7 };
}

type Status = "BLOCKED" | "AWAITING_APPROVAL" | "RESERVED" | "SPENT" | "RELEASED";
type Row = { intent_id: string; mandate_id: string; total_cents: number; status: Status };

export function createGate(db: Db, ledger: Ledger, deps: { now?: () => Date } = {}): Gate {
  const now = deps.now ?? (() => new Date());

  const committedStmt = db.prepare(
    "SELECT COALESCE(SUM(total_cents), 0) AS cents FROM gate_decisions WHERE mandate_id = ? AND status IN ('AWAITING_APPROVAL', 'RESERVED', 'SPENT')",
  );
  const getRow = db.prepare("SELECT intent_id, mandate_id, total_cents, status FROM gate_decisions WHERE intent_id = ?");
  const insertRow = db.prepare(
    "INSERT INTO gate_decisions (intent_id, mandate_id, decision, rule, mode, total_cents, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const setStatus = db.prepare("UPDATE gate_decisions SET status = ?, updated_at = ? WHERE intent_id = ?");

  const committedCents = (mandateId: string) => (committedStmt.get(mandateId) as { cents: number }).cents;

  const decideTx = db.transaction((proposal: Proposal, mode: Mode): GateDecision => {
    if (getRow.get(proposal.intent_id)) throw new Error(`Intent ${proposal.intent_id} has already been decided.`);

    const at = now();
    const verdict = evaluate(getMandate(db, proposal.mandate_id), proposal, {
      now: at,
      committedCents: committedCents(proposal.mandate_id),
    });

    const observe = mode === "OBSERVE";
    // Observe mode never stops a payment, so the money is really spent and must count against the budget.
    const status: Status =
      verdict.decision === "ALLOW" || observe ? "RESERVED" : verdict.decision === "ESCALATE" ? "AWAITING_APPROVAL" : "BLOCKED";
    const ids = { mandate_id: proposal.mandate_id, intent_id: proposal.intent_id };
    const facts = { ...verdict, total_cents: proposal.total_cents, mode };

    ledger.append({ type: "DECISION", ...ids, payload: facts });
    if (observe && verdict.decision === "BLOCK") {
      ledger.append({
        type: "VIOLATION",
        ...ids,
        payload: { rule: verdict.rule, total_cents: proposal.total_cents, merchant: proposal.merchant, category: proposal.category, quantity: proposal.quantity },
      });
    }
    const ts = at.toISOString();
    insertRow.run(proposal.intent_id, proposal.mandate_id, verdict.decision, verdict.rule, mode, proposal.total_cents, status, ts, ts);

    return { ...facts, ...ids, proceed: status === "RESERVED" };
  });

  const approveTx = db.transaction((intentId: string) => {
    const row = getRow.get(intentId) as Row | undefined;
    if (!row || row.status !== "AWAITING_APPROVAL") throw new Error(`Intent ${intentId} is not awaiting approval.`);
    ledger.append({ type: "APPROVAL", mandate_id: row.mandate_id, intent_id: intentId, payload: { total_cents: row.total_cents, approved_by: "user" } });
    setStatus.run("RESERVED", now().toISOString(), intentId);
    return { intent_id: intentId, total_cents: row.total_cents, proceed: true as const };
  });

  const releaseTx = db.transaction((intentId: string) => {
    const row = getRow.get(intentId) as Row | undefined;
    if (!row) throw new Error(`Intent ${intentId} has no gate decision.`);
    if (row.status === "SPENT") throw new Error(`Intent ${intentId} is already spent and cannot be released.`);
    if (row.status === "AWAITING_APPROVAL" || row.status === "RESERVED") setStatus.run("RELEASED", now().toISOString(), intentId);
  });

  const markSpentTx = db.transaction((intentId: string) => {
    const row = getRow.get(intentId) as Row | undefined;
    if (!row || (row.status !== "RESERVED" && row.status !== "SPENT")) {
      throw new Error(`Intent ${intentId} has no budget reservation to spend.`);
    }
    setStatus.run("SPENT", now().toISOString(), intentId);
  });

  return {
    decide: (proposal, mode) => decideTx.immediate(proposal, mode),
    approve: (intentId) => approveTx.immediate(intentId),
    release: (intentId) => releaseTx.immediate(intentId),
    markSpent: (intentId) => markSpentTx.immediate(intentId),
    committedCents,
  };
}
