/**
 * The dispute desk: the actions a person can take on a dispute with one click.
 * Every action first re-fetches the dispute from PayPal and refuses unless PayPal lists that action in the
 * dispute's links. Dispute writes are never retried automatically (see docs/paypal-findings.md).
 */
import { randomUUID } from "node:crypto";
import type { Db } from "../db";
import type { Ledger } from "../ledger/ledger";
import { paypalJson } from "../paypal/api";
import type { PayPalClient } from "../paypal/client";
import { getDispute, recordDispute, safeCents, type DisputeDetail } from "../paypal/disputes";
import { getShipment } from "../store/shipments";
import { classifyDispute, type Classification } from "./classifier";
import { checkCitations, templateNotes } from "./notes";
import { buildEvidencePdf } from "./pdf";

/** PayPal's link names (underscores) for the actions this desk can take. */
export const DESK_ACTIONS = ["provide_evidence", "escalate", "accept_claim", "adjudicate"] as const;
export type DeskAction = (typeof DESK_ACTIONS)[number];

export class DeskError extends Error {
  constructor(
    public code: "ACTION_NOT_AVAILABLE" | "IS_VIOLATION" | "NO_EVIDENCE_TYPE" | "NO_SHIPMENT",
    message: string,
  ) {
    super(message);
  }
}

export type Draft = { notes: string; source: "model" | "template"; problems: string[] };
export type DraftFn = (input: {
  classification: Classification;
  disputeId: string;
  detail: DisputeDetail;
  tracking: { carrier: string; tracking_number: string } | null;
}) => Promise<Draft>;

export type DeskView = {
  dispute_id: string;
  detail: DisputeDetail;
  classification: Classification;
  /** Actions PayPal currently allows, by its link names. */
  actions: DeskAction[];
  /** The evidence type that would be sent now, or null if PayPal has not asked for one we can provide. */
  evidence_type: "OTHER" | "PROOF_OF_FULFILLMENT" | null;
};

export type DeskDeps = { db: Db; ledger: Ledger; paypal: PayPalClient; draftNotes?: DraftFn };

function evidenceTypeFor(detail: DisputeDetail): DeskView["evidence_type"] {
  const requested = (detail.evidences ?? []).filter((e) => e.source === "REQUESTED_FROM_SELLER").map((e) => e.evidence_type);
  if (requested.includes("OTHER")) return "OTHER";
  if (requested.includes("PROOF_OF_FULFILLMENT")) return "PROOF_OF_FULFILLMENT";
  return null;
}

export function createDesk(deps: DeskDeps) {
  const { db, ledger, paypal } = deps;

  /** Always starts from PayPal's current view of the dispute. */
  async function view(disputeId: string): Promise<DeskView> {
    const detail = await getDispute(paypal, disputeId);
    recordDispute({ db, ledger }, detail);
    const rels = new Set((detail.links ?? []).map((l) => l.rel));
    return {
      dispute_id: detail.dispute_id,
      detail,
      classification: classifyDispute(db, ledger, detail.dispute_id),
      actions: DESK_ACTIONS.filter((a) => rels.has(a)),
      evidence_type: evidenceTypeFor(detail),
    };
  }

  function require(v: DeskView, action: DeskAction) {
    if (!v.actions.includes(action)) {
      throw new DeskError("ACTION_NOT_AVAILABLE", `PayPal does not list "${action}" for dispute ${v.dispute_id} right now, so it is not available.`);
    }
  }

  const ids = (c: Classification) => ({ mandate_id: c.mandate_id, intent_id: c.intent_id });
  const post = (disputeId: string, action: string, body: unknown) =>
    paypalJson(paypal, `/v1/customer/disputes/${encodeURIComponent(disputeId)}/${action}`, { method: "POST", requestId: randomUUID(), body });
  /** Refresh our record after an action; a failure here must not hide that the action itself succeeded. */
  const refresh = async (disputeId: string) => {
    try {
      recordDispute({ db, ledger }, await getDispute(paypal, disputeId));
    } catch {
      /* the next sync will pick it up */
    }
  };

  /** The notes that would be filed now. Cached per dispute and stage so the person files what they reviewed. */
  async function prepare(disputeId: string, v?: DeskView): Promise<Draft & { evidence_type: DeskView["evidence_type"]; stage: string }> {
    v ??= await view(disputeId);
    const stage = v.detail.dispute_life_cycle_stage ?? "UNKNOWN";
    const cached = db.prepare("SELECT notes, source FROM evidence_drafts WHERE dispute_id = ? AND stage = ?").get(disputeId, stage) as
      | { notes: string; source: "model" | "template" }
      | undefined;
    if (cached) return { ...cached, problems: [], evidence_type: v.evidence_type, stage };

    const shipment = v.classification.intent_id ? getShipment(db, v.classification.intent_id) : null;
    const input = { classification: v.classification, disputeId, detail: v.detail, tracking: shipment };
    let draft: Draft = { notes: templateNotes({ ...input, extract: v.classification.extract }), source: "template", problems: [] };
    if (deps.draftNotes && v.classification.classification === "IN_MANDATE") draft = await deps.draftNotes(input);
    // The check runs here too, whatever produced the notes.
    const check = checkCitations(draft.notes, v.classification.extract.map((e) => e.seq));
    if (!check.ok && v.classification.classification === "IN_MANDATE") {
      draft = { notes: templateNotes({ ...input, extract: v.classification.extract }), source: "template", problems: check.problems };
    }
    if (v.classification.classification === "IN_MANDATE") {
      db.prepare("INSERT OR REPLACE INTO evidence_drafts (dispute_id, stage, notes, source, created_at) VALUES (?, ?, ?, ?, ?)").run(
        disputeId,
        stage,
        draft.notes,
        draft.source,
        new Date().toISOString(),
      );
    }
    return { ...draft, evidence_type: v.evidence_type, stage };
  }

  async function fileEvidence(disputeId: string) {
    const v = await view(disputeId);
    if (v.classification.classification === "VIOLATION") {
      throw new DeskError("IS_VIOLATION", "The ledger records a violation for this purchase, so the buyer is right. Accept the claim instead of contesting it.");
    }
    require(v, "provide_evidence");
    if (!v.evidence_type) throw new DeskError("NO_EVIDENCE_TYPE", "PayPal has not requested an evidence type this desk can provide.");

    const shipment = v.classification.intent_id ? getShipment(db, v.classification.intent_id) : null;
    if (v.evidence_type === "PROOF_OF_FULFILLMENT" && !shipment) {
      throw new DeskError("NO_SHIPMENT", "PayPal asked for proof of fulfilment but the store has no shipment record for this order.");
    }
    const draft = await prepare(disputeId, v);
    const pdf = await buildEvidencePdf(db, ledger, disputeId);

    const evidence: Record<string, unknown> = { evidence_type: v.evidence_type, notes: draft.notes };
    if (v.evidence_type === "PROOF_OF_FULFILLMENT") {
      evidence.evidence_info = { tracking_info: [{ carrier_name: shipment!.carrier, tracking_number: shipment!.tracking_number }] };
    }
    const form = new FormData();
    form.append("input", new Blob([JSON.stringify({ evidences: [evidence] })], { type: "application/json" }), "input.json");
    form.append("evidence-file", new Blob([pdf.bytes as BlobPart], { type: "application/pdf" }), "evidence.pdf");
    await post(disputeId, "provide-evidence", form);

    const entry = ledger.append({
      type: "EVIDENCE_SUBMITTED",
      ...ids(v.classification),
      payload: {
        dispute_id: disputeId,
        evidence_type: v.evidence_type,
        stage: draft.stage,
        notes: draft.notes,
        notes_source: draft.source,
        cited_seqs: checkCitations(draft.notes, v.classification.extract.map((e) => e.seq)).cited,
        pdf_sha256: pdf.sha256,
      },
    });
    await refresh(disputeId);
    return { ledger_seq: entry.seq, evidence_type: v.evidence_type };
  }

  async function escalate(disputeId: string) {
    const v = await view(disputeId);
    require(v, "escalate");
    await post(disputeId, "escalate", { note: "The seller asks PayPal to review this case. The purchase was authorised under the buyer's signed mandate; evidence follows." });
    const entry = ledger.append({ type: "DISPUTE_ESCALATED", ...ids(v.classification), payload: { dispute_id: disputeId, from_stage: v.detail.dispute_life_cycle_stage ?? null } });
    await refresh(disputeId);
    return { ledger_seq: entry.seq };
  }

  async function acceptClaim(disputeId: string) {
    const v = await view(disputeId);
    require(v, "accept_claim");
    const c = v.classification;
    const note =
      c.classification === "VIOLATION"
        ? `Our audit ledger shows this purchase was outside the buyer's signed mandate (entry ${c.cited_seqs.map((n) => `#${n}`).join(", ")}). We accept the claim and refund in full.`
        : "We accept the claim and refund in full.";
    await post(disputeId, "accept-claim", { note, accept_claim_type: "REFUND" });
    const entry = ledger.append({
      type: "CLAIM_ACCEPTED",
      ...ids(c),
      payload: { dispute_id: disputeId, classification: c.classification, cited_seqs: c.cited_seqs, refund: "FULL", amount_cents: safeCents(v.detail.dispute_amount?.value) },
    });
    await refresh(disputeId);
    return { ledger_seq: entry.seq };
  }

  /** Sandbox only: stands in for PayPal's own decision. */
  async function adjudicate(disputeId: string, outcome: "SELLER_FAVOR" | "BUYER_FAVOR") {
    const v = await view(disputeId);
    require(v, "adjudicate");
    await post(disputeId, "adjudicate", { adjudication_outcome: outcome });
    await refresh(disputeId);
    return { outcome };
  }

  return { view, prepare, fileEvidence, escalate, acceptClaim, adjudicate };
}


export type Desk = ReturnType<typeof createDesk>;
