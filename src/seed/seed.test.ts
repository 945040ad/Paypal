import { describe, expect, it } from "vitest";
import { openDb } from "../db";
import { classifyDispute } from "../evidence/classifier";
import { checkCitations } from "../evidence/notes";
import { createGate } from "../gate/gate";
import { createLedger } from "../ledger/ledger";
import { getLatestMandate, getMandate } from "../mandate/store";
import { verifyMandateSignature } from "../mandate/verify";
import data from "./demo-data.json";
import { seedDemo, type SeedData } from "./seed";

const seed = data as unknown as SeedData;

async function seeded(opts: { vaultId?: string } = {}) {
  const db = openDb(":memory:");
  const result = await seedDemo(db, seed, opts);
  return { db, ledger: createLedger(db), result };
}

describe("seedDemo", () => {
  it("loads the recorded history plus one fresh mandate, and the chain verifies", async () => {
    const { ledger, result } = await seeded();

    expect(result).toMatchObject({ seeded: true, entries: seed.entries.length + 1 });
    expect(ledger.verifyChain()).toMatchObject({ ok: true, length: seed.entries.length + 1 });
  });

  it("numbers the entries from 1 with no gaps, in their original order and with their original times", async () => {
    const { ledger } = await seeded();
    const entries = ledger.export().entries;

    expect(entries.slice(0, seed.entries.length).map((e) => e.type)).toEqual(seed.entries.map((e) => e.type));
    expect(entries[0]).toMatchObject({ seq: 1, type: "MANDATE_SIGNED", ts: seed.entries[0].ts });
    expect(entries.map((e) => e.seq)).toEqual(entries.map((_, i) => i + 1));
  });

  it("keeps the recorded mandate's real signature, which still verifies", async () => {
    const { db } = await seeded();
    const stored = getMandate(db, seed.mandate.mandate.id)!;

    expect(verifyMandateSignature({ mandate: stored.mandate, signature: stored.signature, publicKeyJwk: stored.public_key_jwk })).toBe(true);
  });

  it("classifies the two recorded disputes the way they were really settled", async () => {
    const { db, ledger } = await seeded();
    const byOutcome = Object.fromEntries(seed.disputes.map((d) => [d.outcome, d.dispute_id]));

    expect(classifyDispute(db, ledger, byOutcome.RESOLVED_SELLER_FAVOUR).classification).toBe("IN_MANDATE");
    expect(classifyDispute(db, ledger, byOutcome.RESOLVED_BUYER_FAVOUR).classification).toBe("VIOLATION");
  });

  it("renumbers the ledger entries cited inside recorded evidence so every citation still points at a real entry", async () => {
    const { db, ledger } = await seeded();
    const entries = ledger.export().entries;
    const evidence = entries.filter((e) => e.type === "EVIDENCE_SUBMITTED");
    expect(evidence.length).toBeGreaterThan(0);

    for (const e of evidence) {
      const extract = classifyDispute(db, ledger, e.payload.dispute_id as string).extract.map((x) => x.seq);
      const check = checkCitations(e.payload.notes as string, [...extract, ...entries.filter((x) => x.payload.dispute_id === e.payload.dispute_id).map((x) => x.seq)]);
      expect(check.problems).toEqual([]);
      expect(e.payload.cited_seqs).toEqual(check.cited);
    }
  });

  it("points a renumbered citation at the same kind of entry as before", async () => {
    const { ledger } = await seeded();
    const entries = ledger.export().entries;
    const claim = entries.find((e) => e.type === "CLAIM_ACCEPTED")!;

    const cited = (claim.payload.cited_seqs as number[]).map((seq) => entries[seq - 1].type);

    expect(cited).toEqual(["VIOLATION"]);
  });

  it("does nothing when the ledger already has entries", async () => {
    const { db, ledger } = await seeded();
    const before = ledger.export();

    const again = await seedDemo(db, seed);

    expect(again).toEqual({ seeded: false, entries: 0 });
    expect(ledger.export()).toEqual(before);
  });

  it("leaves a fresh mandate in force with its whole budget unspent and weeks left to run", async () => {
    const { db, ledger } = await seeded();
    const latest = getLatestMandate(db, "demo-user")!;

    expect(latest.mandate.id).not.toBe(seed.mandate.mandate.id);
    expect(createGate(db, ledger).committedCents(latest.mandate.id)).toBe(0);
    expect(Date.parse(latest.mandate.expires_at) - Date.now()).toBeGreaterThan(30 * 86_400_000);
    expect(verifyMandateSignature({ mandate: latest.mandate, signature: latest.signature, publicKeyJwk: latest.public_key_jwk })).toBe(true);
  });

  it("lets the gate allow a normal purchase under the fresh mandate", async () => {
    const { db, ledger } = await seeded();
    const latest = getLatestMandate(db, "demo-user")!;

    const d = createGate(db, ledger).decide(
      { intent_id: "int_after_seed", mandate_id: latest.mandate.id, merchant: "demo-store", category: "keyboards", quantity: 1, total_cents: 2900 },
      "ENFORCE",
    );

    expect(d.decision).toBe("ALLOW");
  });

  it("stores the saved-PayPal ID only when one is given", async () => {
    const without = await seeded();
    const withVault = await seeded({ vaultId: "VAULT-FROM-ENV" });

    expect(without.db.prepare("SELECT COUNT(*) AS n FROM vault_tokens").get()).toEqual({ n: 0 });
    expect(withVault.db.prepare("SELECT vault_id FROM vault_tokens WHERE user_id = 'demo-user'").get()).toEqual({ vault_id: "VAULT-FROM-ENV" });
  });

  it("restores purchases, shipments and disputes for the recorded history", async () => {
    const { db } = await seeded();
    const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

    expect(count("purchases")).toBe(seed.purchases.length);
    expect(count("shipments")).toBe(seed.shipments.length);
    expect(count("disputes")).toBe(seed.disputes.length);
    expect(count("gate_decisions")).toBe(seed.gate_decisions.length);
  });
});
