import { PayPalApiError } from "@/paypal/api";
import { getPurchaseFlow } from "@/server";

/**
 * PayPal sends the buyer here after they approve an order. We then authorize, re-check and capture.
 * The intent ID in the URL only selects which purchase to carry forward; PayPal refuses to authorize
 * an order the buyer has not approved, so calling this early does nothing harmful.
 */
export async function GET(request: Request) {
  const intentId = new URL(request.url).searchParams.get("intent");
  if (!intentId) return Response.json({ error: "MISSING_INTENT" }, { status: 400 });
  const flow = getPurchaseFlow();
  if (!flow.get(intentId)) return Response.json({ error: "UNKNOWN_INTENT" }, { status: 404 });
  try {
    return Response.json(await flow.complete(intentId));
  } catch (err) {
    if (err instanceof PayPalApiError) {
      console.error(err.message);
      return Response.json({ error: "PAYPAL_ERROR", status: err.status, debug_id: err.debugId, purchase: flow.get(intentId) }, { status: 502 });
    }
    console.error(err);
    return Response.json({ error: "INTERNAL", purchase: flow.get(intentId) }, { status: 500 });
  }
}
