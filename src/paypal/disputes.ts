/** Reading disputes from PayPal and keeping our record of them. See docs/paypal-findings.md for the sandbox's behaviour. */
import type { Db } from "../db";
import type { Ledger } from "../ledger/ledger";
import { paypalJson } from "./api";
import type { PayPalClient } from "./client";
import { decimalToCents } from "./money";

export type DisputeDetail = {
  dispute_id: string;
  status?: string;
  reason?: string;
  dispute_life_cycle_stage?: string;
  dispute_state?: string;
  dispute_amount?: { currency_code?: string; value?: string };
  dispute_outcome?: { outcome_code?: string };
  seller_response_due_date?: string;
  disputed_transactions?: { seller_transaction_id?: string; buyer_transaction_id?: string; custom?: string }[];
  evidences?: { evidence_type?: string; source?: string }[];
  links?: { rel: string; href: string; method?: string }[];
};

export type Deps = { db: Db; ledger: Ledger; paypal: PayPalClient };

export function getDispute(paypal: PayPalClient, disputeId: string): Promise<DisputeDetail> {
  return paypalJson<DisputeDetail>(paypal, `/v1/customer/disputes/${encodeURIComponent(disputeId)}`);
}

export async function listDisputeIds(paypal: PayPalClient): Promise<string[]> {
  const list = await paypalJson<{ items?: { dispute_id: string }[] }>(paypal, "/v1/customer/disputes?page_size=50");
  return (list.items ?? []).map((d) => d.dispute_id);
}

export function safeCents(value: string | undefined): number | null {
  try {
    return value === undefined ? null : decimalToCents(value);
  } catch {
    return null;
  }
}

/**
 * Finds the gate decision a PayPal record points back to. `custom` is the "mandate_id:intent_id" we set as
 * custom_id on the order. Returns nulls unless both parts match a decision we actually made.
 */
export function linkToLedger(db: Db, custom: string | undefined): { mandate_id: string | null; intent_id: string | null } {
  const match = /^(mnd_[^:]+):(int_[^:]+)$/.exec(custom ?? "");
  if (match) {
    const row = db.prepare("SELECT 1 FROM gate_decisions WHERE intent_id = ? AND mandate_id = ?").get(match[2], match[1]);
    if (row) return { mandate_id: match[1], intent_id: match[2] };
  }
  return { mandate_id: null, intent_id: null };
}

/**
 * Stores the latest state of a dispute. Writes DISPUTE_OPENED the first time a dispute is seen and
 * DISPUTE_RESOLVED the first time it is seen resolved; never twice.
 */
export function recordDispute({ db, ledger }: Pick<Deps, "db" | "ledger">, detail: DisputeDetail): { opened: boolean; resolved: boolean } {
  const tx = db.transaction(() => {
    const txn = detail.disputed_transactions?.[0];
    const link = linkToLedger(db, txn?.custom);
    const now = new Date().toISOString();
    const amountCents = safeCents(detail.dispute_amount?.value);
    const outcome = detail.dispute_outcome?.outcome_code ?? null;
    const existing = db.prepare("SELECT resolved_recorded FROM disputes WHERE dispute_id = ?").get(detail.dispute_id) as
      | { resolved_recorded: number }
      | undefined;

    let opened = false;
    if (!existing) {
      db.prepare(
        "INSERT INTO disputes (dispute_id, capture_id, custom, mandate_id, intent_id, detail_json, first_seen_at, updated_at) VALUES (?, ?, ?, ?, ?, '{}', ?, ?)",
      ).run(detail.dispute_id, txn?.seller_transaction_id ?? null, txn?.custom ?? null, link.mandate_id, link.intent_id, now, now);
      ledger.append({
        type: "DISPUTE_OPENED",
        ...link,
        payload: {
          dispute_id: detail.dispute_id,
          reason: detail.reason ?? null,
          status: detail.status ?? null,
          stage: detail.dispute_life_cycle_stage ?? null,
          amount_cents: amountCents,
          capture_id: txn?.seller_transaction_id ?? null,
          custom: txn?.custom ?? null,
        },
      });
      opened = true;
    }

    let resolved = false;
    if (detail.status === "RESOLVED" && !existing?.resolved_recorded) {
      ledger.append({ type: "DISPUTE_RESOLVED", ...link, payload: { dispute_id: detail.dispute_id, outcome, amount_cents: amountCents } });
      resolved = true;
    }

    db.prepare(
      "UPDATE disputes SET status = ?, stage = ?, reason = ?, amount_cents = ?, currency = ?, outcome = ?, resolved_recorded = MAX(resolved_recorded, ?), detail_json = ?, updated_at = ? WHERE dispute_id = ?",
    ).run(
      detail.status ?? null,
      detail.dispute_life_cycle_stage ?? null,
      detail.reason ?? null,
      amountCents,
      detail.dispute_amount?.currency_code ?? null,
      outcome,
      resolved ? 1 : 0,
      JSON.stringify(detail),
      now,
      detail.dispute_id,
    );
    return { opened, resolved };
  });
  return tx.immediate();
}
