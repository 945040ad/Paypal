/**
 * Phase 1 throwaway: proves the dispute loop on the real PayPal sandbox.
 * Every request and response is appended to data/spike-log.jsonl.
 *
 *   npx tsx --env-file=.env.local scripts/dispute-spike.ts <command> [args]
 *
 *   order [label]                      create a $10 CAPTURE order, print the approval link
 *   capture <orderId>                  capture an approved order, print the capture ID
 *   create-dispute <captureId> [reason]   path 2: POST /v1/customer/disputes
 *   find <captureId>                   disputes for a transaction
 *   list                               all disputes
 *   show <disputeId>                   status, stage, link names
 *   poll <disputeId> [minutes]         print status/stage/links whenever they change
 *   evidence <disputeId> [filePart]    provide-evidence: type OTHER, notes, one-page PDF
 *   require-evidence <disputeId>       sandbox only: ask the seller for evidence
 *   supporting-info <disputeId>        provide-supporting-info with notes
 *   escalate <disputeId>               escalate an inquiry to a claim
 *   adjudicate <disputeId> [outcome]   sandbox only: SELLER_FAVOR (default) or BUYER_FAVOR
 *   accept-claim <disputeId> [json|multipart]   concede with a full refund
 *   raw <METHOD> <path> [jsonBody]     any other call
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createPayPalClient, type PayPalFetchOptions } from "../src/paypal/client";

const client = createPayPalClient();
const LOG = "data/spike-log.jsonl";
mkdirSync("data", { recursive: true });

type Json = Record<string, unknown>;

async function call(path: string, options: PayPalFetchOptions & { describeBody?: unknown } = {}) {
  const method = options.method ?? "GET";
  const requestId = method === "POST" ? (options.requestId ?? randomUUID()) : undefined;
  const started = Date.now();
  const res = await client.paypalFetch(path, { ...options, requestId });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  appendFileSync(
    LOG,
    JSON.stringify({
      ts: new Date().toISOString(),
      method,
      path,
      requestId,
      requestBody: options.describeBody ?? options.body ?? null,
      status: res.status,
      debugId: res.headers.get("paypal-debug-id"),
      ms: Date.now() - started,
      response: json,
    }) + "\n",
  );
  console.log(`${method} ${path} -> ${res.status}${res.ok ? "" : `  (debug ${res.headers.get("paypal-debug-id")})`}`);
  return { ok: res.ok, status: res.status, json: json as Json };
}

function summary(d: Json) {
  const links = ((d.links as { rel: string }[]) ?? []).map((l) => l.rel).join(", ");
  return [
    `status=${d.status}`,
    `stage=${d.dispute_life_cycle_stage}`,
    `state=${d.dispute_state ?? "-"}`,
    `reason=${d.reason}`,
    `outcome=${(d.dispute_outcome as Json | undefined)?.outcome_code ?? "-"}`,
    `links=[${links}]`,
  ].join("  ");
}

async function onePagePdf(disputeId: string) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("SYSTEM//AUDIT evidence (Phase 1 spike)", { x: 50, y: 780, size: 16, font });
  page.drawText(`Dispute ${disputeId}`, { x: 50, y: 750, size: 12, font });
  page.drawText(`Generated ${new Date().toISOString()}`, { x: 50, y: 730, size: 12, font });
  page.drawText("The buyer authorised this purchase under a signed mandate.", { x: 50, y: 700, size: 12, font });
  return pdf.save();
}

function multipart(input: Json, file?: { part: string; name: string; bytes: Uint8Array }) {
  const form = new FormData();
  form.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }), "input.json");
  if (file) form.append(file.part, new Blob([file.bytes as BlobPart], { type: "application/pdf" }), file.name);
  return form;
}

const commands: Record<string, (...args: string[]) => Promise<void>> = {
  async order(label = "a") {
    const base = process.env.APP_BASE_URL ?? "https://example.com";
    const body = {
      intent: "CAPTURE",
      payment_source: {
        paypal: {
          experience_context: {
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: `${base}/?spike=approved`,
            cancel_url: `${base}/?spike=cancelled`,
          },
        },
      },
      purchase_units: [
        {
          custom_id: `spike:${label}:${Date.now()}`,
          description: "SYSTEM//AUDIT dispute spike",
          amount: { currency_code: "USD", value: "10.00" },
        },
      ],
    };
    const r = await call("/v2/checkout/orders", { method: "POST", body });
    if (!r.ok) return console.log(JSON.stringify(r.json, null, 2));
    const links = r.json.links as { rel: string; href: string }[];
    const approve = links.find((l) => l.rel === "payer-action" || l.rel === "approve");
    console.log(`order ${r.json.id}  status=${r.json.status}`);
    console.log(`APPROVE AS THE SANDBOX BUYER: ${approve?.href}`);
  },

  async capture(orderId) {
    const r = await call(`/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: "",
      describeBody: null,
    });
    if (!r.ok) return console.log(JSON.stringify(r.json, null, 2));
    const pu = (r.json.purchase_units as Json[])[0];
    const cap = ((pu.payments as Json).captures as Json[])[0];
    console.log(`order ${r.json.id} status=${r.json.status}`);
    console.log(`capture ${cap.id} status=${cap.status} amount=${JSON.stringify(cap.amount)} custom_id=${cap.custom_id}`);
    console.log(`payer ${JSON.stringify((r.json.payer as Json)?.email_address)}`);
  },

  async "create-dispute"(captureId, reason = "UNAUTHORISED", idField = "buyer_transaction_id") {
    const input = {
      disputed_transactions: [{ [idField]: captureId }],
      reason,
      dispute_amount: { currency_code: "USD", value: "10.00" },
    };
    const r = await call("/v1/customer/disputes", { method: "POST", body: multipart(input), describeBody: { multipart: { input } } });
    console.log(JSON.stringify(r.json, null, 2));
  },

  async find(captureId) {
    const r = await call(`/v1/customer/disputes?disputed_transaction_id=${captureId}`);
    console.log(JSON.stringify(r.json, null, 2));
  },

  async list() {
    const r = await call("/v1/customer/disputes?page_size=50");
    for (const d of (r.json.items as Json[]) ?? []) {
      console.log(`${d.dispute_id}  ${d.create_time}  status=${d.status}  stage=${d.dispute_life_cycle_stage}  reason=${d.reason}  amount=${JSON.stringify(d.dispute_amount)}`);
    }
    if (!r.ok || !(r.json.items as Json[])?.length) console.log(JSON.stringify(r.json, null, 2));
  },

  async show(id) {
    const r = await call(`/v1/customer/disputes/${id}`);
    if (!r.ok) return console.log(JSON.stringify(r.json, null, 2));
    console.log(summary(r.json));
    console.log(`created=${r.json.create_time} updated=${r.json.update_time} seller_due=${r.json.seller_response_due_date ?? "-"}`);
    console.log(`transactions=${JSON.stringify(((r.json.disputed_transactions as Json[]) ?? []).map((t) => ({ seller: t.seller_transaction_id, buyer: t.buyer_transaction_id, custom: t.custom })))}`);
    console.log(`allowed_response_options=${JSON.stringify(r.json.allowed_response_options ?? null)}`);
  },

  async poll(id, minutes = "8") {
    const until = Date.now() + Number(minutes) * 60_000;
    let last = "";
    while (Date.now() < until) {
      const res = await client.paypalFetch(`/v1/customer/disputes/${id}`);
      const d = (await res.json()) as Json;
      const now = res.ok ? summary(d) : `HTTP ${res.status} ${JSON.stringify(d)}`;
      if (now !== last) {
        console.log(`${new Date().toISOString()}  ${now}`);
        appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), poll: id, summary: now }) + "\n");
        last = now;
      }
      await new Promise((r) => setTimeout(r, 20_000));
    }
    console.log(`${new Date().toISOString()}  poll ended`);
  },

  async evidence(id, evidenceType = "OTHER", filePart = "evidence-file") {
    const evidence: Json = {
      evidence_type: evidenceType,
      notes: "Phase 1 spike: the buyer authorised this purchase under a signed mandate. See the attached PDF.",
    };
    if (evidenceType === "PROOF_OF_FULFILLMENT") {
      evidence.evidence_info = { tracking_info: [{ carrier_name: "FEDEX", tracking_number: "122533485" }] };
    }
    const input = { evidences: [evidence] };
    const bytes = await onePagePdf(id);
    const r = await call(`/v1/customer/disputes/${id}/provide-evidence`, {
      method: "POST",
      body: multipart(input, { part: filePart, name: "evidence.pdf", bytes }),
      describeBody: { multipart: { input, [filePart]: `evidence.pdf (${bytes.length} bytes)` } },
    });
    console.log(JSON.stringify(r.json, null, 2));
  },

  async "require-evidence"(id) {
    const r = await call(`/v1/customer/disputes/${id}/require-evidence`, { method: "POST", body: { action: "SELLER_EVIDENCE" } });
    console.log(JSON.stringify(r.json, null, 2));
  },

  async "supporting-info"(id) {
    const input = { notes: "Phase 1 spike: supporting information from the seller." };
    const r = await call(`/v1/customer/disputes/${id}/provide-supporting-info`, {
      method: "POST",
      body: multipart(input),
      describeBody: { multipart: { input } },
    });
    console.log(JSON.stringify(r.json, null, 2));
  },

  async escalate(id) {
    const r = await call(`/v1/customer/disputes/${id}/escalate`, { method: "POST", body: { note: "Phase 1 spike: escalating to a claim." } });
    console.log(JSON.stringify(r.json, null, 2));
  },

  async adjudicate(id, outcome = "SELLER_FAVOR") {
    const r = await call(`/v1/customer/disputes/${id}/adjudicate`, { method: "POST", body: { adjudication_outcome: outcome } });
    console.log(JSON.stringify(r.json, null, 2));
  },

  async "accept-claim"(id, mode = "json") {
    const input = { note: "Phase 1 spike: the agent exceeded the mandate. Full refund.", accept_claim_type: "REFUND" };
    const r = await call(`/v1/customer/disputes/${id}/accept-claim`, {
      method: "POST",
      body: mode === "multipart" ? multipart(input) : input,
      describeBody: mode === "multipart" ? { multipart: { input } } : input,
    });
    console.log(JSON.stringify(r.json, null, 2));
  },

  async raw(method, path, body) {
    const r = await call(path, { method: method as "GET" | "POST", body: body ? JSON.parse(body) : undefined });
    console.log(JSON.stringify(r.json, null, 2));
  },
};

const [name, ...args] = process.argv.slice(2);
const command = commands[name ?? ""];
if (!command) {
  console.error(`Unknown command ${JSON.stringify(name)}. Commands: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}
command(...args).catch((err) => {
  console.error(err);
  process.exit(1);
});
