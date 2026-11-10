import { PayPalApiError } from "@/paypal/api";
import { getPurchaseFlow } from "@/server";

/**
 * PayPal sends the buyer here after they approve an order. We then authorize, re-check and capture,
 * and send the buyer back to the agent page with the outcome.
 * The intent ID in the URL only selects which purchase to carry forward; PayPal refuses to authorize
 * an order the buyer has not approved, so calling this early does nothing harmful.
 */
export async function GET(request: Request) {
  const intentId = new URL(request.url).searchParams.get("intent");
  const back = (params: Record<string, string>) =>
    Response.redirect(new URL(`/agent?${new URLSearchParams(params)}`, process.env.APP_BASE_URL ?? request.url), 303);
  if (!intentId) return back({ error: "MISSING_INTENT" });
  const flow = getPurchaseFlow();
  if (!flow.get(intentId)) return back({ error: "UNKNOWN_INTENT" });
  try {
    const result = await flow.complete(intentId);
    return back({ intent: intentId, status: result.status, ...(result.capture_id && { capture: result.capture_id }) });
  } catch (err) {
    console.error("Completing the purchase failed:", err instanceof Error ? err.message : err);
    return back({ intent: intentId, error: err instanceof PayPalApiError ? "PAYPAL_ERROR" : "INTERNAL" });
  }
}
