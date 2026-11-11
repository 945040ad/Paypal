import { describe, expect, it } from "vitest";
import { openDb } from "../db";
import { createLedger } from "./ledger";
import { isTampered, resetTamper, tamperWithRow } from "./tamper-demo";

function setup() {
  const db = openDb(":memory:");
  const ledger = createLedger(db);
  ledger.append({ type: "INTENT", mandate_id: "mnd_1", intent_id: "int_1", payload: { total_cents: 3500 } });
  ledger.append({ type: "DECISION", mandate_id: "mnd_1", intent_id: "int_1", payload: { decision: "BLOCK", total_cents: 3500 } });
  ledger.append({ type: "INTENT", mandate_id: "mnd_1", intent_id: "int_2", payload: { total_cents: 900 } });
  ledger.append({ type: "DECISION", mandate_id: "mnd_1", intent_id: "int_2", payload: { decision: "ALLOW", total_cents: 900 } });
  ledger.append({ type: "CAPTURED", mandate_id: "mnd_1", intent_id: "int_2", payload: { capture_id: "CAP1", total_cents: 900 } });
  return { db, ledger };
}

describe("tamper demo", () => {
  it("edits one stored row so that Verify fails at exactly that row", () => {
    const { db, ledger } = setup();

    const result = tamperWithRow(db);

    expect(result).toMatchObject({ seq: 4, type: "DECISION" });
    expect(ledger.verifyChain()).toMatchObject({ ok: false, first_bad_seq: 4 });
    expect(isTampered(db)).toBe(true);
  });

  it("says what it changed", () => {
    const { db } = setup();

    const result = tamperWithRow(db);

    expect(result.before).toContain('"total_cents":900');
    expect(result.after).not.toBe(result.before);
  });

  it("reset puts the original row back and the chain verifies again", () => {
    const { db, ledger } = setup();
    const before = ledger.export();
    tamperWithRow(db);

    const reset = resetTamper(db);

    expect(reset).toEqual({ restored: true, seq: 4 });
    expect(ledger.verifyChain().ok).toBe(true);
    expect(ledger.export()).toEqual(before);
    expect(isTampered(db)).toBe(false);
  });

  it("tampering twice still restores the true original", () => {
    const { db, ledger } = setup();
    const before = ledger.export();
    tamperWithRow(db);
    tamperWithRow(db);

    resetTamper(db);

    expect(ledger.export()).toEqual(before);
  });

  it("reset with nothing tampered does nothing", () => {
    const { db, ledger } = setup();

    expect(resetTamper(db)).toEqual({ restored: false, seq: null });
    expect(ledger.verifyChain().ok).toBe(true);
  });

  it("refuses on an empty ledger", () => {
    const db = openDb(":memory:");

    expect(() => tamperWithRow(db)).toThrow(/empty/i);
  });

  it("entries appended while a row is tampered are kept when it is reset", () => {
    const { db, ledger } = setup();
    tamperWithRow(db);
    ledger.append({ type: "WEBHOOK", payload: { event_id: "e1" } });

    resetTamper(db);

    expect(ledger.export().length).toBe(6);
    expect(ledger.verifyChain().ok).toBe(true);
  });
});
