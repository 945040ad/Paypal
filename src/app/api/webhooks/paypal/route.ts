import { getDb } from "@/db";
import { getPayPalClient } from "@/paypal/client";
import { handleWebhook } from "@/paypal/webhook";
import { getLedger } from "@/server";

/** PayPal delivers events here. The body is read as raw text so the signature check sees the exact bytes. */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    console.error("PAYPAL_WEBHOOK_ID is not set; cannot verify webhooks.");
    return Response.json({ error: "NOT_CONFIGURED" }, { status: 500 });
  }
  try {
    const result = await handleWebhook(
      { db: getDb(), ledger: getLedger(), paypal: getPayPalClient(), webhookId },
      { rawBody, headers: request.headers },
    );
    return Response.json(result.body, { status: result.status });
  } catch (err) {
    // A 500 makes PayPal retry later; the event was not marked as seen.
    console.error("Webhook processing failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "PROCESSING_FAILED" }, { status: 500 });
  }
}
