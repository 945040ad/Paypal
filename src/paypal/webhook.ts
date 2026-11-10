/**
 * PayPal webhook handler. Order of work:
 * 1. Verify the signature using the raw request body, before parsing it.
 * 2. Ignore event IDs already processed.
 * 3. Never trust the event's contents or order: re-fetch the capture, authorization or dispute from PayPal.
 * 4. Write a WEBHOOK ledger entry, plus UNMATCHED_CAPTURE / DISPUTE_OPENED / DISPUTE_RESOLVED when they apply.
 * Text inside events is untrusted data and is never treated as instructions.
 */
import { randomUUID } from "node:crypto";
import { paypalJson, PayPalApiError } from "./api";
import { getDispute, linkToLedger, recordDispute, safeCents, type Deps } from "./disputes";

export type WebhookDeps = Deps & { webhookId: string };
export type WebhookResult = { status: 200 | 400; body: Record<string, unknown> };

const SIGNATURE_HEADERS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

type Resource = { type: "capture" | "authorization" | "dispute" | "other"; id: string | null; status: string | null; amountCents: number | null; custom: string | undefined; detail: unknown };

/** Asks PayPal whether this delivery is genuine. The raw body is spliced in as is; re-serializing it breaks verification. */
async function verifySignature(deps: WebhookDeps, rawBody: string, headers: Headers): Promise<boolean> {
  const fields: Record<string, string> = { webhook_id: deps.webhookId };
  for (const [field, header] of Object.entries(SIGNATURE_HEADERS)) {
    const value = headers.get(header);
    if (!value) return false;
    fields[field] = value;
  }
  const body = `{${Object.entries(fields)
    .map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`)
    .join(",")},"webhook_event":${rawBody}}`;
  try {
    const res = await paypalJson<{ verification_status?: string }>(deps.paypal, "/v1/notifications/verify-webhook-signature", {
      method: "POST",
      requestId: randomUUID(),
      body,
    });
    return res.verification_status === "SUCCESS";
  } catch (err) {
    // A 4xx means PayPal rejected the request itself (for example a body that is not JSON): not a genuine delivery.
    if (err instanceof PayPalApiError && err.status >= 400 && err.status < 500) return false;
    throw err;
  }
}

async function refetch(deps: WebhookDeps, eventType: string, resource: Record<string, unknown>): Promise<Resource> {
  if (eventType.startsWith("PAYMENT.CAPTURE.") || eventType.startsWith("PAYMENT.AUTHORIZATION.")) {
    const type = eventType.startsWith("PAYMENT.CAPTURE.") ? "capture" : "authorization";
    const id = String(resource.id ?? "");
    const detail = await paypalJson<{ status?: string; custom_id?: string; amount?: { value?: string } }>(
      deps.paypal,
      `/v2/payments/${type}s/${encodeURIComponent(id)}`,
    );
    return { type, id, status: detail.status ?? null, amountCents: safeCents(detail.amount?.value), custom: detail.custom_id, detail };
  }
  if (eventType.startsWith("CUSTOMER.DISPUTE.")) {
    const detail = await getDispute(deps.paypal, String(resource.dispute_id ?? ""));
    return {
      type: "dispute",
      id: detail.dispute_id,
      status: detail.status ?? null,
      amountCents: safeCents(detail.dispute_amount?.value),
      custom: detail.disputed_transactions?.[0]?.custom,
      detail,
    };
  }
  return { type: "other", id: typeof resource.id === "string" ? resource.id : null, status: null, amountCents: null, custom: undefined, detail: null };
}

/** A capture is matched when the gate said ALLOW, or said ESCALATE and the user approved, for exactly this amount. */
function checkCapture(deps: Deps, capture: Resource): void {
  const { db, ledger } = deps;
  if (!capture.id || db.prepare("SELECT 1 FROM capture_checks WHERE capture_id = ?").get(capture.id)) return;
  const link = linkToLedger(db, capture.custom);
  let reason: string | null = null;
  let decidedCents: number | null = null;
  if (!link.intent_id) {
    reason = "NO_GATE_DECISION";
  } else {
    const decision = db.prepare("SELECT decision, total_cents FROM gate_decisions WHERE intent_id = ?").get(link.intent_id) as {
      decision: string;
      total_cents: number;
    };
    decidedCents = decision.total_cents;
    const approved =
      decision.decision === "ALLOW" ||
      (decision.decision === "ESCALATE" && Boolean(db.prepare("SELECT 1 FROM ledger WHERE type = 'APPROVAL' AND intent_id = ?").get(link.intent_id)));
    if (!approved) reason = "NO_ALLOW_OR_APPROVAL";
    else if (capture.amountCents !== decision.total_cents) reason = "AMOUNT_MISMATCH";
  }
  if (reason) {
    ledger.append({
      type: "UNMATCHED_CAPTURE",
      ...link,
      payload: { capture_id: capture.id, amount_cents: capture.amountCents, decided_cents: decidedCents, custom_id: capture.custom ?? null, reason },
    });
  }
  db.prepare("INSERT INTO capture_checks (capture_id, matched, reason, checked_at) VALUES (?, ?, ?, ?)").run(
    capture.id,
    reason ? 0 : 1,
    reason,
    new Date().toISOString(),
  );
}

export async function handleWebhook(deps: WebhookDeps, input: { rawBody: string; headers: Headers }): Promise<WebhookResult> {
  if (!(await verifySignature(deps, input.rawBody, input.headers))) {
    return { status: 400, body: { error: "INVALID_SIGNATURE" } };
  }

  // Only now is the body parsed.
  const event = JSON.parse(input.rawBody) as { id?: unknown; event_type?: unknown; resource?: unknown };
  if (typeof event.id !== "string" || typeof event.event_type !== "string") {
    return { status: 400, body: { error: "NOT_AN_EVENT" } };
  }
  const eventId = event.id;
  const eventType = event.event_type;
  const { db, ledger } = deps;
  const seen = () => Boolean(db.prepare("SELECT 1 FROM webhook_events WHERE event_id = ?").get(eventId));
  if (seen()) return { status: 200, body: { duplicate: true, event_id: eventId } };

  // If this throws, the event is not marked as seen, so PayPal's retry is processed normally.
  const resource = await refetch(deps, eventType, (event.resource ?? {}) as Record<string, unknown>);

  const write = db.transaction(() => {
    if (seen()) return { duplicate: true, event_id: eventId };
    db.prepare("INSERT INTO webhook_events (event_id, event_type, received_at) VALUES (?, ?, ?)").run(eventId, eventType, new Date().toISOString());
    const entry = ledger.append({
      type: "WEBHOOK",
      ...linkToLedger(db, resource.custom),
      payload: {
        event_id: eventId,
        event_type: eventType,
        resource_type: resource.type,
        resource_id: resource.id,
        status: resource.status,
        amount_cents: resource.amountCents,
      },
    });
    if (resource.type === "capture") checkCapture(deps, resource);
    if (resource.type === "dispute") recordDispute(deps, resource.detail as Parameters<typeof recordDispute>[1]);
    return { event_id: eventId, ledger_seq: entry.seq };
  });
  return { status: 200, body: write.immediate() };
}
