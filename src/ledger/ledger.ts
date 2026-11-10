/**
 * Append-only, hash-chained log.
 * hash = sha256(prev_hash + canonical(entry without hash)). There is no update or delete path.
 */
import { createHash } from "node:crypto";
import type { Db } from "../db";
import { canonicalString } from "../mandate/canonical";

export const GENESIS_HASH = "0".repeat(64);

export const ENTRY_TYPES = [
  "MANDATE_SIGNED",
  "INTENT",
  "DECISION",
  "VIOLATION",
  "APPROVAL",
  "ORDER_CREATED",
  "AUTHORIZED",
  "RECHECK_OK",
  "RECHECK_FAILED",
  "CAPTURED",
  "VOIDED",
  "REFUNDED",
  "WEBHOOK",
  "UNMATCHED_CAPTURE",
  "DISPUTE_OPENED",
  "EVIDENCE_SUBMITTED",
  "CLAIM_ACCEPTED",
  "DISPUTE_RESOLVED",
] as const;

export type EntryType = (typeof ENTRY_TYPES)[number];

export type LedgerEntry = {
  seq: number;
  ts: string;
  type: EntryType;
  mandate_id: string | null;
  intent_id: string | null;
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
};

export type AppendInput = {
  type: EntryType;
  mandate_id?: string | null;
  intent_id?: string | null;
  payload: Record<string, unknown>;
};

export type VerifyResult =
  | { ok: true; length: number; head_hash: string }
  | { ok: false; length: number; first_bad_seq: number; reason: string };

export type Ledger = {
  append(input: AppendInput): LedgerEntry;
  verifyChain(): VerifyResult;
  export(): { length: number; head_hash: string; entries: LedgerEntry[] };
};

type Row = Omit<LedgerEntry, "payload"> & { payload: string };

export function hashEntry(entry: Omit<LedgerEntry, "hash">): string {
  return createHash("sha256").update(entry.prev_hash + canonicalString(entry)).digest("hex");
}

export function createLedger(db: Db, deps: { now?: () => Date } = {}): Ledger {
  const now = deps.now ?? (() => new Date());

  const selectAll = db.prepare("SELECT seq, ts, type, mandate_id, intent_id, payload, prev_hash, hash FROM ledger ORDER BY seq");
  const selectHead = db.prepare("SELECT seq, hash FROM ledger ORDER BY seq DESC LIMIT 1");
  const insert = db.prepare(
    "INSERT INTO ledger (seq, ts, type, mandate_id, intent_id, payload, prev_hash, hash) VALUES (@seq, @ts, @type, @mandate_id, @intent_id, @payload, @prev_hash, @hash)",
  );

  // One transaction reads the head and writes the next row, so two writers cannot take the same seq.
  const appendTx = db.transaction((input: AppendInput): LedgerEntry => {
    if (!ENTRY_TYPES.includes(input.type)) {
      throw new Error(`Unknown ledger entry type ${JSON.stringify(input.type)}.`);
    }
    const head = selectHead.get() as { seq: number; hash: string } | undefined;
    const payload = JSON.parse(canonicalString(input.payload)) as Record<string, unknown>;
    const withoutHash = {
      seq: (head?.seq ?? 0) + 1,
      ts: now().toISOString(),
      type: input.type,
      mandate_id: input.mandate_id ?? null,
      intent_id: input.intent_id ?? null,
      payload,
      prev_hash: head?.hash ?? GENESIS_HASH,
    };
    const entry: LedgerEntry = { ...withoutHash, hash: hashEntry(withoutHash) };
    insert.run({ ...entry, payload: canonicalString(payload) });
    return entry;
  });

  function rows(): Row[] {
    return selectAll.all() as Row[];
  }

  function verifyChain(): VerifyResult {
    const all = rows();
    let prevHash = GENESIS_HASH;
    let expectedSeq = 1;
    for (const row of all) {
      const bad = (reason: string): VerifyResult => ({ ok: false, length: all.length, first_bad_seq: row.seq, reason });
      if (row.seq !== expectedSeq) return bad(`Sequence gap: expected ${expectedSeq}, found ${row.seq}.`);
      if (row.prev_hash !== prevHash) return bad("prev_hash does not match the hash of the entry before it.");
      let payload: unknown;
      try {
        payload = JSON.parse(row.payload);
      } catch {
        return bad("Stored payload is not valid JSON.");
      }
      const { hash, ...withoutHash } = { ...row, payload } as LedgerEntry;
      if (hashEntry(withoutHash) !== hash) return bad("Entry contents do not match its hash.");
      prevHash = hash;
      expectedSeq += 1;
    }
    return { ok: true, length: all.length, head_hash: prevHash };
  }

  function exportAll() {
    const entries = rows().map((row) => ({ ...row, payload: JSON.parse(row.payload) }) as LedgerEntry);
    return { length: entries.length, head_hash: entries.at(-1)?.hash ?? GENESIS_HASH, entries };
  }

  return { append: (input) => appendTx.immediate(input), verifyChain, export: exportAll };
}
