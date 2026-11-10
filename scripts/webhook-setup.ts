/**
 * npm run webhook:setup
 * Registers <APP_BASE_URL>/api/webhooks/paypal as a sandbox webhook and prints its ID.
 * Safe to run again: if the URL is already registered, it prints the existing ID.
 */
import { randomUUID } from "node:crypto";
import { createPayPalClient } from "../src/paypal/client";

// Names confirmed against https://developer.paypal.com/api/rest/webhooks/event-names/ on 2026-11-10.
const EVENT_NAMES = [
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.REFUNDED",
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.UPDATED",
  "CUSTOMER.DISPUTE.RESOLVED",
];

type Webhook = { id: string; url: string; event_types: { name: string }[] };

async function main() {
  const base = process.env.APP_BASE_URL?.replace(/\/+$/, "");
  if (!base || !base.startsWith("https://")) {
    throw new Error("APP_BASE_URL must be the public https:// URL of the deployed app (PayPal only delivers to HTTPS port 443).");
  }
  const url = `${base}/api/webhooks/paypal`;
  const client = createPayPalClient();

  const res = await client.paypalFetch("/v1/notifications/webhooks", {
    method: "POST",
    requestId: randomUUID(),
    body: { url, event_types: EVENT_NAMES.map((name) => ({ name })) },
  });
  const text = await res.text();

  let webhook: Webhook | undefined;
  if (res.ok) {
    webhook = JSON.parse(text) as Webhook;
    console.log(`Registered webhook for ${url}`);
  } else if (text.includes("WEBHOOK_URL_ALREADY_EXISTS")) {
    const list = await client.paypalFetch("/v1/notifications/webhooks");
    if (!list.ok) throw new Error(`Listing webhooks failed: ${list.status} ${await list.text()}`);
    const { webhooks } = (await list.json()) as { webhooks: Webhook[] };
    webhook = webhooks.find((w) => w.url === url);
    if (!webhook) throw new Error(`PayPal says ${url} is already registered, but it is not in this app's webhook list.`);
    console.log(`Webhook for ${url} already exists`);
    const missing = EVENT_NAMES.filter((name) => !webhook!.event_types.some((e) => e.name === name || e.name === "*"));
    if (missing.length) console.warn(`WARNING: existing webhook is not subscribed to: ${missing.join(", ")}`);
  } else {
    throw new Error(`Creating the webhook failed: ${res.status} ${text}`);
  }

  console.log(`\nPAYPAL_WEBHOOK_ID=${webhook.id}\n`);
  console.log("Put that line in .env.local and in the Render service's environment.");
}

main().catch((err) => {
  console.error(`webhook:setup failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
