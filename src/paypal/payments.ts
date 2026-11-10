/** Payments v2: capture, void, refund. Shapes follow https://developer.paypal.com/docs/api/payments/v2/. */
import { paypalJson } from "./api";
import type { PayPalClient } from "./client";

export type Capture = { id: string; status: string; amount?: { currency_code: string; value: string }; custom_id?: string };
export type Refund = { id: string; status: string };

/** Captures the full authorized amount. */
export function captureAuthorization(client: PayPalClient, authorizationId: string, requestId: string): Promise<Capture> {
  return paypalJson<Capture>(client, `/v2/payments/authorizations/${authorizationId}/capture`, {
    method: "POST",
    requestId,
    headers: { Prefer: "return=representation" },
    body: { final_capture: true },
  });
}

/** Releases the buyer's funds. PayPal answers 204 with no body. */
export async function voidAuthorization(client: PayPalClient, authorizationId: string, requestId: string): Promise<void> {
  await paypalJson(client, `/v2/payments/authorizations/${authorizationId}/void`, { method: "POST", requestId, body: "" });
}

/** Full refund: PayPal's docs call for an empty JSON object as the body. */
export function refundCapture(client: PayPalClient, captureId: string, requestId: string): Promise<Refund> {
  return paypalJson<Refund>(client, `/v2/payments/captures/${captureId}/refund`, {
    method: "POST",
    requestId,
    headers: { Prefer: "return=representation" },
    body: {},
  });
}
