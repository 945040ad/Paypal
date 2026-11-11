import { DeskError } from "@/evidence/desk";
import { PayPalApiError } from "@/paypal/api";
import { getDesk, readJson } from "@/server";

/**
 * One-click dispute actions: file-evidence, escalate, accept-claim, adjudicate.
 * Each re-fetches the dispute first and refuses unless PayPal lists the action in its links.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/disputes/[id]/[action]">) {
  const { id, action } = await ctx.params;
  const desk = getDesk();
  try {
    if (action === "file-evidence") return Response.json(await desk.fileEvidence(id));
    if (action === "escalate") return Response.json(await desk.escalate(id));
    if (action === "accept-claim") return Response.json(await desk.acceptClaim(id));
    if (action === "adjudicate") {
      const outcome = (await readJson(request))?.outcome;
      if (outcome !== "SELLER_FAVOR" && outcome !== "BUYER_FAVOR") {
        return Response.json({ error: "INVALID_OUTCOME", message: 'outcome must be "SELLER_FAVOR" or "BUYER_FAVOR".' }, { status: 400 });
      }
      return Response.json(await desk.adjudicate(id, outcome));
    }
    return Response.json({ error: "UNKNOWN_ACTION" }, { status: 404 });
  } catch (err) {
    if (err instanceof DeskError) return Response.json({ error: err.code, message: err.message }, { status: 409 });
    if (err instanceof PayPalApiError) {
      console.error(err.message);
      const issue = (err.body as { details?: { issue?: string }[] } | null)?.details?.[0]?.issue;
      return Response.json({ error: "PAYPAL_ERROR", message: `PayPal refused the action${issue ? ` (${issue})` : ""}. Nothing was recorded.`, debug_id: err.debugId }, { status: 502 });
    }
    console.error(err);
    return Response.json({ error: "INTERNAL", message: "The action failed. Nothing was recorded." }, { status: 500 });
  }
}
