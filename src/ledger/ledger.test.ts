import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDb } from "../db";
import { canonicalString } from "../mandate/canonical";
import { createLedger, GENESIS_HASH } from "./ledger";

function setup() {
  const db = openDb(":memory:");
  let tick = 0;
  const ledger = createLedger(db, { now: () => new Date(Date.UTC(2026, 10, 11, 9, 0, tick++)) });
  return { db, ledger };
}

function three() {
  const s = setup();
  s.ledger.append({ type: "INTENT", mandate_id: "mnd_1", intent_id: "int_1", payload: { total_cents: 3500 } });
  s.ledger.append({ type: "DECISION", mandate_id: "mnd_1", intent_id: "int_1", payload: { decision: "ALLOW" } });
  s.ledger.append({ type: "CAPTURED", mandate_id: "mnd_1", intent_id: "int_1", payload: { capture_id: "CAP1" } });
  return s;
}

describe("ledger append", () => {
  it("gives the first entry sequence 1 and the genesis previous hash", () => {
    const { ledger } = setup();

    const entry = ledger.append({ type: "INTENT", mandate_id: "mnd_1", intent_id: "int_1", payload: { total_cents: 3500 } });

    expect(entry.seq).toBe(1);
    expect(entry.prev_hash).toBe(GENESIS_HASH);
    expect(entry.ts).toBe("2026-11-11T09:00:00.000Z");
  });

  it("hashes the previous hash plus the canonical entry without its hash", () => {
    const { ledger } = setup();

    const { hash, ...rest } = ledger.append({ type: "INTENT", mandate_id: "mnd_1", intent_id: null, payload: { b: 1, a: 2 } });

    const expected = createHash("sha256").update(rest.prev_hash + canonicalString(rest)).digest("hex");
    expect(hash).toBe(expected);
  });

  it("chains each entry to the one before it with no sequence gaps", () => {
    const { ledger } = three();

    const { entries } = ledger.export();

    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(entries[1].prev_hash).toBe(entries[0].hash);
    expect(entries[2].prev_hash).toBe(entries[1].hash);
  });

  it("rejects an entry type that is not in the plan", () => {
    const { ledger } = setup();

    expect(() => ledger.append({ type: "MADE_UP" as never, payload: {} })).toThrow(/type/);
    expect(ledger.export().entries).toHaveLength(0);
  });

  it("returns the payload it was given", () => {
    const { ledger } = setup();
    ledger.append({ type: "DECISION", mandate_id: "mnd_1", intent_id: "int_1", payload: { decision: "ALLOW", rules_passed: 7 } });

    expect(ledger.export().entries[0].payload).toEqual({ decision: "ALLOW", rules_passed: 7 });
  });
});

describe("ledger verifyChain", () => {
  it("passes on an empty ledger", () => {
    const { ledger } = setup();

    expect(ledger.verifyChain()).toEqual({ ok: true, length: 0, head_hash: GENESIS_HASH });
  });

  it("passes on an untouched chain and reports the head hash", () => {
    const { ledger } = three();

    const result = ledger.verifyChain();

    expect(result).toEqual({ ok: true, length: 3, head_hash: ledger.export().entries[2].hash });
  });

  it("fails at the edited row when a stored payload is changed", () => {
    const { db, ledger } = three();
    db.prepare("UPDATE ledger SET payload = ? WHERE seq = 2").run('{"decision":"BLOCK"}');

    expect(ledger.verifyChain()).toMatchObject({ ok: false, first_bad_seq: 2 });
  });

  it.each(["ts", "type", "mandate_id", "intent_id"])("fails at the edited row when %s is changed", (column) => {
    const { db, ledger } = three();
    db.prepare(`UPDATE ledger SET ${column} = ? WHERE seq = 1`).run(column === "type" ? "VIOLATION" : "changed");

    expect(ledger.verifyChain()).toMatchObject({ ok: false, first_bad_seq: 1 });
  });

  it("fails at the next row when an edited row's hash is recomputed to match", () => {
    const { db, ledger } = three();
    const row = ledger.export().entries[1];
    const withoutHash = { seq: row.seq, ts: row.ts, type: row.type, mandate_id: row.mandate_id, intent_id: row.intent_id, payload: { decision: "BLOCK" }, prev_hash: row.prev_hash };
    const newHash = createHash("sha256").update(row.prev_hash + canonicalString(withoutHash)).digest("hex");
    db.prepare("UPDATE ledger SET payload = ?, hash = ? WHERE seq = 2").run('{"decision":"BLOCK"}', newHash);

    expect(ledger.verifyChain()).toMatchObject({ ok: false, first_bad_seq: 3 });
  });

  it("detects a deleted row as a sequence gap", () => {
    const { db, ledger } = three();
    db.prepare("DELETE FROM ledger WHERE seq = 2").run();

    expect(ledger.verifyChain()).toMatchObject({ ok: false, first_bad_seq: 3, reason: expect.stringMatching(/gap/i) });
  });

  it("detects a chain that does not start at sequence 1", () => {
    const { db, ledger } = three();
    db.prepare("DELETE FROM ledger WHERE seq = 1").run();

    expect(ledger.verifyChain()).toMatchObject({ ok: false, first_bad_seq: 2 });
  });
});

describe("ledger export", () => {
  it("returns every entry with the head hash", () => {
    const { ledger } = three();

    const out = ledger.export();

    expect(out.entries).toHaveLength(3);
    expect(out.head_hash).toBe(out.entries[2].hash);
    expect(out.length).toBe(3);
  });

  it("offers no way to update or delete an entry", () => {
    const { ledger } = setup();

    expect(Object.keys(ledger).sort()).toEqual(["append", "export", "verifyChain"]);
  });
});
