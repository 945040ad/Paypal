/**
 * The evidence PDF: the signed mandate, the signature check, the public key, the ledger extract with its
 * hashes, the PayPal IDs and, when there is one, the shipment record. Built only from stored facts.
 */
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Db } from "../db";
import type { Ledger } from "../ledger/ledger";
import { getMandate } from "../mandate/store";
import { verifyMandateSignature } from "../mandate/verify";
import { getShipment } from "../store/shipments";
import { classifyDispute, getDisputeRow } from "./classifier";
import { describeEntry } from "./notes";

const PAGE = { width: 595, height: 842, margin: 40 };
const SIZE = 8;
const LINE = 11;
const COLUMNS = 104; // Courier at 8pt fits this many characters between the margins

/** pdf-lib's standard fonts cannot draw characters outside Latin-1; anything else becomes "?". */
const printable = (s: string) => s.replace(/[^\x20-\x7E]/g, "?");

function wrap(line: string): string[] {
  const out: string[] = [];
  let rest = printable(line);
  while (rest.length > COLUMNS) {
    out.push(rest.slice(0, COLUMNS));
    rest = `    ${rest.slice(COLUMNS)}`;
  }
  out.push(rest);
  return out;
}

export async function buildEvidencePdf(db: Db, ledger: Ledger, disputeId: string): Promise<{ bytes: Uint8Array; text: string; sha256: string }> {
  const row = getDisputeRow(db, disputeId);
  if (!row) throw new Error(`No record of dispute ${disputeId}.`);
  const classification = classifyDispute(db, ledger, disputeId);
  const stored = row.mandate_id ? getMandate(db, row.mandate_id) : null;
  const chain = ledger.verifyChain();
  const purchase = row.intent_id
    ? (db.prepare("SELECT order_id, authorization_id, capture_id, custom_id, total_cents, currency FROM purchases WHERE intent_id = ?").get(row.intent_id) as
        | Record<string, string | number | null>
        | undefined)
    : undefined;
  const shipment = row.intent_id ? getShipment(db, row.intent_id) : null;
  const signatureValid = stored ? verifyMandateSignature({ mandate: stored.mandate, signature: stored.signature, publicKeyJwk: stored.public_key_jwk }) : false;

  const lines: string[] = [
    "SYSTEM//AUDIT  EVIDENCE PACK",
    `Generated ${new Date().toISOString()}  (PayPal sandbox)`,
    "",
    "1. DISPUTE",
    `Dispute ID: ${row.dispute_id}`,
    `Reason: ${row.reason ?? "-"}    Stage: ${row.stage ?? "-"}    Amount: ${row.amount_cents ?? "-"} cents ${row.currency ?? ""}`,
    `Finding: ${classification.classification}`,
    classification.reason,
    "",
    "2. AUTHORISATION: THE SIGNED MANDATE",
  ];
  if (stored) {
    const m = stored.mandate;
    lines.push(
      `Mandate ID: ${m.id}    User: ${m.user_id}    Version: ${m.version}`,
      `Per-purchase cap: ${m.per_purchase_cap_cents} cents    Total budget: ${m.total_budget_cents} cents    Approval needed above: ${m.approval_threshold_cents} cents`,
      `Allowed merchants: ${m.allowed_merchants.join(", ")}    Allowed categories: ${m.allowed_categories.join(", ")}`,
      `Max quantity per item: ${m.max_quantity_per_item}    Created: ${m.created_at}    Expires: ${m.expires_at}`,
      `Nonce: ${m.nonce}`,
      "Signed with ECDSA P-256 / SHA-256 over the RFC 8785 canonical JSON of the mandate.",
      `Signature (base64url): ${stored.signature}`,
      `Public key (JWK): ${JSON.stringify(stored.public_key_jwk)}`,
      `Signature check: ${signatureValid ? "VALID" : "INVALID"} (re-verified when this document was generated)`,
    );
  } else {
    lines.push("No mandate on record for this payment.");
  }

  lines.push("", "3. LEDGER EXTRACT (append-only, hash-chained)", "Each entry's hash is sha256(previous hash + canonical JSON of the entry). Changing any entry breaks every later hash.");
  for (const e of classification.extract) {
    lines.push(describeEntry(e), `    hash ${e.hash}`, `    prev ${e.prev_hash}`);
  }
  lines.push(
    `Ledger chain: ${chain.ok ? `VALID (${chain.length} entries, head hash ${chain.head_hash})` : `INVALID at entry ${chain.first_bad_seq}`}`,
    "",
    "4. PAYPAL RECORDS",
    `Order: ${purchase?.order_id ?? "-"}    Authorization: ${purchase?.authorization_id ?? "-"}    Capture: ${purchase?.capture_id ?? row.capture_id ?? "-"}`,
    `custom_id on the PayPal order (mandate:intent): ${purchase?.custom_id ?? row.custom ?? "-"}`,
  );
  if (shipment) {
    lines.push("", "5. SHIPMENT", `Carrier: ${shipment.carrier}    Tracking number: ${shipment.tracking_number}    Shipped: ${shipment.shipped_at}`);
  }

  const pdf = await PDFDocument.create();
  pdf.setTitle(`SYSTEM//AUDIT evidence for ${row.dispute_id}`);
  const font = await pdf.embedFont(StandardFonts.Courier);
  const bold = await pdf.embedFont(StandardFonts.CourierBold);
  let page = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - PAGE.margin;
  for (const line of lines) {
    const heading = /^(\d\. |SYSTEM\/\/AUDIT)/.test(line);
    for (const part of wrap(line)) {
      if (y < PAGE.margin) {
        page = pdf.addPage([PAGE.width, PAGE.height]);
        y = PAGE.height - PAGE.margin;
      }
      if (part) page.drawText(part, { x: PAGE.margin, y, size: heading ? SIZE + 1 : SIZE, font: heading ? bold : font });
      y -= LINE;
    }
  }
  const bytes = await pdf.save();
  return { bytes, text: lines.join("\n"), sha256: createHash("sha256").update(bytes).digest("hex") };
}
