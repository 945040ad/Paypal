/** Plain-language one-liners for ledger entries. Pure: safe to use in the browser and on the server. */
import type { LedgerEntry } from "./ledger";

export const dollars = (cents: unknown) => (typeof cents === "number" ? `$${(cents / 100).toFixed(2)}` : "an unknown amount");

/** One line per ledger entry, for the model, the PDF and the ledger page. */
export function describeEntry(e: LedgerEntry): string {
  const p = e.payload;
  const detail: Record<string, string> = {
    MANDATE_SIGNED: "the buyer signed the spending mandate",
    INTENT: `agent proposed ${p.quantity} x ${p.product_name ?? p.product_id}, total ${dollars(p.total_cents)}`,
    DECISION: `gate decision ${p.decision}${p.rule ? ` (rule ${p.rule})` : ""}, ${p.rules_passed} rules passed, total ${dollars(p.total_cents)}, mode ${p.mode}`,
    VIOLATION: `would have been blocked on rule ${p.rule}; gate was in observe mode`,
    APPROVAL: `the buyer approved ${dollars(p.total_cents)}`,
    ORDER_CREATED: `PayPal order ${p.order_id}, ${dollars(p.total_cents)}`,
    AUTHORIZED: `PayPal authorization ${p.authorization_id}`,
    RECHECK_OK: "PayPal's order matched what the gate approved",
    RECHECK_FAILED: "PayPal's order did not match what the gate approved",
    CAPTURED: `PayPal capture ${p.capture_id}, ${dollars(p.total_cents)}`,
    VOIDED: "authorization voided",
    REFUNDED: `refund ${p.refund_id}`,
    UNMATCHED_CAPTURE: `capture ${p.capture_id} did not match a gate decision (${p.reason})`,
    DISPUTE_OPENED: `dispute ${p.dispute_id} opened, reason ${p.reason}`,
    DISPUTE_ESCALATED: `dispute ${p.dispute_id} escalated to a PayPal claim`,
    EVIDENCE_SUBMITTED: `evidence ${p.evidence_type} filed for ${p.dispute_id}`,
    CLAIM_ACCEPTED: `claim accepted for ${p.dispute_id}`,
    DISPUTE_RESOLVED: `dispute ${p.dispute_id} resolved, ${p.outcome}`,
    WEBHOOK: `PayPal event ${p.event_type}`,
  };
  return `#${e.seq} ${e.ts} ${e.type}: ${detail[e.type] ?? ""}`;
}
