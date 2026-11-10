import { PayPalApiError } from "@/paypal/api";
import { getPurchaseFlow } from "@/server";

/** The user clicked Approve on a purchase the gate escalated. Writes APPROVAL, then starts the payment. */
export async function POST(_request: Request, ctx: RouteContext<"/api/purchases/[intent]/approve">) {
  const { intent } = await ctx.params;
  const flow = getPurchaseFlow();
  const purchase = flow.get(intent);
  if (!purchase) return Response.json({ error: "UNKNOWN_INTENT" }, { status: 404 });
  if (purchase.status !== "AWAITING_APPROVAL") {
    return Response.json({ error: "NOT_AWAITING_APPROVAL", purchase }, { status: 409 });
  }
  try {
    return Response.json(await flow.approve(intent));
  } catch (err) {
    console.error("Approve failed:", err instanceof Error ? err.message : err);
    const status = err instanceof PayPalApiError ? 502 : 500;
    return Response.json({ error: status === 502 ? "PAYPAL_ERROR" : "INTERNAL", purchase: flow.get(intent) }, { status });
  }
}
