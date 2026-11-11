import { DeskError } from "@/evidence/desk";
import { describeEntry } from "@/evidence/notes";
import { PayPalApiError } from "@/paypal/api";
import { getDesk, getLedger } from "@/server";

/** One dispute, re-fetched from PayPal: its classification, the actions PayPal allows now, and the evidence that would be filed. */
export async function GET(_request: Request, ctx: RouteContext<"/api/disputes/[id]">) {
  const { id } = await ctx.params;
  const desk = getDesk();
  try {
    const view = await desk.view(id);
    const c = view.classification;
    const canFile = c.classification !== "VIOLATION" && view.actions.includes("provide_evidence") && view.evidence_type !== null;
    const draft = canFile && c.classification === "IN_MANDATE" ? await desk.prepare(id, view) : null;
    // Everything the ledger holds about this purchase and this dispute, in order.
    const timeline = getLedger()
      .export()
      .entries.filter((e) => c.extract.some((x) => x.seq === e.seq) || e.payload.dispute_id === id)
      .map((e) => ({ seq: e.seq, ts: e.ts, type: e.type, hash: e.hash, text: describeEntry(e) }));
    return Response.json({
      dispute_id: view.dispute_id,
      status: view.detail.status ?? null,
      stage: view.detail.dispute_life_cycle_stage ?? null,
      reason: view.detail.reason ?? null,
      amount: view.detail.dispute_amount ?? null,
      outcome: view.detail.dispute_outcome?.outcome_code ?? null,
      seller_response_due: view.detail.seller_response_due_date ?? null,
      classification: c.classification,
      classification_reason: c.reason,
      cited_seqs: c.cited_seqs,
      actions: view.actions,
      evidence_type: view.evidence_type,
      draft,
      timeline,
      has_ledger_record: c.extract.length > 0,
    });
  } catch (err) {
    if (err instanceof PayPalApiError) return Response.json({ error: "PAYPAL_ERROR", message: `PayPal answered ${err.status}.` }, { status: err.status === 404 ? 404 : 502 });
    if (err instanceof DeskError) return Response.json({ error: err.code, message: err.message }, { status: 409 });
    console.error(err);
    return Response.json({ error: "INTERNAL", message: "Could not load the dispute." }, { status: 500 });
  }
}
