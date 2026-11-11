/**
 * Decides, with plain code, which side the ledger supports in a dispute.
 *   IN_MANDATE  the gate allowed the purchase (or the user approved it) and the captured amount matches
 *   VIOLATION   the ledger holds a VIOLATION or UNMATCHED_CAPTURE entry for it
 *   UNKNOWN     anything else; a person has to look
 * No model is involved.
 */
import type { Db } from "../db";
import type { Ledger, LedgerEntry } from "../ledger/ledger";

export type Classification = {
  classification: "IN_MANDATE" | "VIOLATION" | "UNKNOWN";
  reason: string;
  /** Ledger sequence numbers that support the classification. */
  cited_seqs: number[];
  /** The mandate's MANDATE_SIGNED entry followed by every entry for the disputed purchase. */
  extract: LedgerEntry[];
  mandate_id: string | null;
  intent_id: string | null;
};

export type DisputeRow = {
  dispute_id: string;
  status: string | null;
  stage: string | null;
  reason: string | null;
  amount_cents: number | null;
  currency: string | null;
  capture_id: string | null;
  custom: string | null;
  mandate_id: string | null;
  intent_id: string | null;
  outcome: string | null;
  detail_json: string;
  first_seen_at: string;
  updated_at: string;
};

export function getDisputeRow(db: Db, disputeId: string): DisputeRow | null {
  return (db.prepare("SELECT * FROM disputes WHERE dispute_id = ?").get(disputeId) as DisputeRow | undefined) ?? null;
}

export function classifyDispute(db: Db, ledger: Ledger, disputeId: string): Classification {
  const row = getDisputeRow(db, disputeId);
  const base = { cited_seqs: [] as number[], extract: [] as LedgerEntry[], mandate_id: row?.mandate_id ?? null, intent_id: row?.intent_id ?? null };
  const unknown = (reason: string, more: Partial<Classification> = {}): Classification => ({ ...base, ...more, classification: "UNKNOWN", reason });

  if (!row) return unknown("We have no record of this dispute.");
  if (!row.intent_id || !row.mandate_id) return unknown("The disputed payment does not point to any purchase in the ledger.");

  const all = ledger.export().entries;
  const extract = all.filter((e) => (e.type === "MANDATE_SIGNED" && e.mandate_id === row.mandate_id) || e.intent_id === row.intent_id);
  const withExtract = { extract };

  const chain = ledger.verifyChain();
  if (!chain.ok) return unknown(`The ledger chain fails verification at entry ${chain.first_bad_seq}, so it cannot be used as evidence.`, withExtract);

  const of = (type: string) => extract.filter((e) => e.type === type);
  const flagged = [...of("VIOLATION"), ...of("UNMATCHED_CAPTURE")];
  if (flagged.length > 0) {
    const first = flagged[0];
    const what = first.type === "VIOLATION" ? `the gate would have blocked this purchase on rule ${first.payload.rule}` : `the capture did not match a gate decision (${first.payload.reason})`;
    return {
      ...base,
      ...withExtract,
      classification: "VIOLATION",
      reason: `Ledger entry #${first.seq} is a ${first.type}: ${what}. The buyer's claim is valid.`,
      cited_seqs: flagged.map((e) => e.seq),
    };
  }

  const decision = of("DECISION")[0];
  const approval = of("APPROVAL")[0];
  const captured = of("CAPTURED")[0];
  if (!decision || !captured) return unknown("The ledger has no gate decision or no capture for this purchase.", withExtract);

  const allowed = decision.payload.decision === "ALLOW";
  const approved = decision.payload.decision === "ESCALATE" && Boolean(approval);
  if (!allowed && !approved) return unknown("The gate did not allow this purchase and the user did not approve it, yet no violation was recorded.", withExtract);
  if (captured.payload.total_cents !== decision.payload.total_cents) {
    return unknown("The captured amount differs from the amount the gate decided on.", withExtract);
  }
  if (row.amount_cents === null || row.amount_cents > (captured.payload.total_cents as number)) {
    return unknown("The disputed amount is more than the amount that was captured.", withExtract);
  }

  const mandateSigned = of("MANDATE_SIGNED")[0];
  const support = approved ? `the gate escalated it (#${decision.seq}) and the user gave APPROVAL (#${approval!.seq})` : `the gate decided ALLOW (#${decision.seq})`;
  return {
    ...base,
    ...withExtract,
    classification: "IN_MANDATE",
    reason: `The purchase was inside the signed mandate${mandateSigned ? ` (#${mandateSigned.seq})` : ""}: ${support}, and the captured amount (#${captured.seq}) matches.`,
    cited_seqs: [mandateSigned?.seq, decision.seq, approval?.seq, captured.seq].filter((n): n is number => typeof n === "number"),
  };
}
