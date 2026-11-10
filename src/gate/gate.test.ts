import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db";
import { createLedger } from "../ledger/ledger";
import type { Mandate } from "../mandate/schema";
import { registerPublicKey, submitSignedMandate } from "../mandate/store";
import { sampleMandate, testSigner } from "../mandate/testing";
import { createGate, type Proposal } from "./gate";

const NOW = new Date("2026-11-12T00:00:00Z"); // inside the sample mandate's validity

async function setup(overrides: Partial<Mandate> = {}, db: Db = openDb(":memory:")) {
  const ledger = createLedger(db);
  const signer = await testSigner();
  registerPublicKey(db, "demo-user", signer.publicKeyJwk);
  const mandate = sampleMandate(overrides);
  submitSignedMandate(db, ledger, { mandate, signature: await signer.sign(mandate) });
  let now = NOW;
  const gate = createGate(db, ledger, { now: () => now });
  return { db, ledger, gate, mandate, setNow: (d: Date) => (now = d) };
}

let n = 0;
function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    intent_id: `int_${++n}`,
    mandate_id: "mnd_test0001",
    merchant: "demo-store",
    category: "keyboards",
    quantity: 1,
    total_cents: 2500,
    ...overrides,
  };
}

function entriesOfType(ledger: ReturnType<typeof createLedger>, type: string) {
  return ledger.export().entries.filter((e) => e.type === type);
}

describe("gate rules", () => {
  it("allows a purchase that passes all seven rules and records the decision", async () => {
    const { gate, ledger } = await setup();
    const p = proposal();

    const d = gate.decide(p, "ENFORCE");

    expect(d).toMatchObject({ decision: "ALLOW", rule: null, rules_passed: 7, proceed: true });
    const [entry] = entriesOfType(ledger, "DECISION");
    expect(entry).toMatchObject({ mandate_id: p.mandate_id, intent_id: p.intent_id });
    expect(entry.payload).toMatchObject({ decision: "ALLOW", total_cents: 2500, rules_passed: 7, mode: "ENFORCE" });
  });

  it("rule 1: blocks when the stored mandate no longer matches its signature", async () => {
    const { gate, db, mandate } = await setup();
    db.prepare("UPDATE mandates SET mandate_json = ? WHERE id = ?").run(
      JSON.stringify({ ...mandate, total_budget_cents: 9_999_999 }),
      mandate.id,
    );

    expect(gate.decide(proposal(), "ENFORCE")).toMatchObject({ decision: "BLOCK", rule: "MANDATE_VALID", rules_passed: 0 });
  });

  it("rule 1: blocks when the mandate does not exist", async () => {
    const { gate } = await setup();

    expect(gate.decide(proposal({ mandate_id: "mnd_missing" }), "ENFORCE")).toMatchObject({
      decision: "BLOCK",
      rule: "MANDATE_VALID",
    });
  });

  it("rule 1: blocks an expired mandate", async () => {
    const { gate, setNow } = await setup();
    setNow(new Date("2026-11-20T00:00:00Z")); // exactly the expiry instant

    expect(gate.decide(proposal(), "ENFORCE")).toMatchObject({ decision: "BLOCK", rule: "MANDATE_VALID" });
  });

  it("rule 1: blocks a revoked mandate", async () => {
    const { gate, db, mandate } = await setup();
    db.prepare("UPDATE mandates SET revoked_at = ? WHERE id = ?").run("2026-11-11T12:00:00Z", mandate.id);

    expect(gate.decide(proposal(), "ENFORCE")).toMatchObject({ decision: "BLOCK", rule: "MANDATE_VALID" });
  });

  it("rule 2: blocks a merchant that is not on the list", async () => {
    const { gate } = await setup();

    expect(gate.decide(proposal({ merchant: "evil-store" }), "ENFORCE")).toMatchObject({
      decision: "BLOCK",
      rule: "MERCHANT_ALLOWED",
      rules_passed: 1,
    });
  });

  it("rule 3: blocks a category that is not on the list", async () => {
    const { gate } = await setup();

    expect(gate.decide(proposal({ category: "gift-cards" }), "ENFORCE")).toMatchObject({
      decision: "BLOCK",
      rule: "CATEGORY_ALLOWED",
      rules_passed: 2,
    });
  });

  it("rule 3: blocks an unknown category", async () => {
    const { gate } = await setup();

    expect(gate.decide(proposal({ category: null }), "ENFORCE")).toMatchObject({ decision: "BLOCK", rule: "CATEGORY_ALLOWED" });
  });

  it("rule 4: blocks a quantity above the limit", async () => {
    const { gate } = await setup();

    expect(gate.decide(proposal({ quantity: 10 }), "ENFORCE")).toMatchObject({
      decision: "BLOCK",
      rule: "QUANTITY_LIMIT",
      rules_passed: 3,
    });
  });

  it.each([0, -1, 1.5])("rule 4: blocks a quantity of %s", async (quantity) => {
    const { gate } = await setup();

    expect(gate.decide(proposal({ quantity }), "ENFORCE")).toMatchObject({ decision: "BLOCK", rule: "QUANTITY_LIMIT" });
  });

  it("rule 5: blocks a total above the per-purchase cap", async () => {
    const { gate } = await setup();

    expect(gate.decide(proposal({ total_cents: 4001 }), "ENFORCE")).toMatchObject({
      decision: "BLOCK",
      rule: "PER_PURCHASE_CAP",
      rules_passed: 4,
    });
  });

  it("rule 5: does not block a total exactly at the cap", async () => {
    const { gate } = await setup();

    expect(gate.decide(proposal({ total_cents: 4000 }), "ENFORCE").decision).not.toBe("BLOCK");
  });

  it.each([0, -500, 10.5])("rule 5: blocks a total of %s cents", async (total_cents) => {
    const { gate } = await setup();

    expect(gate.decide(proposal({ total_cents }), "ENFORCE")).toMatchObject({ decision: "BLOCK", rule: "PER_PURCHASE_CAP" });
  });

  it("rule 6: blocks the third of five $35 orders against a $100 budget", async () => {
    const { gate } = await setup({ approval_threshold_cents: 4000 });

    const decisions = [1, 2, 3, 4, 5].map(() => gate.decide(proposal({ total_cents: 3500 }), "ENFORCE"));

    expect(decisions.map((d) => d.decision)).toEqual(["ALLOW", "ALLOW", "BLOCK", "BLOCK", "BLOCK"]);
    expect(decisions[2]).toMatchObject({ rule: "TOTAL_BUDGET", rules_passed: 5 });
  });

  it("rule 6: allows an order that uses the budget exactly", async () => {
    const { gate } = await setup({ approval_threshold_cents: 4000, total_budget_cents: 5000 });
    gate.decide(proposal({ total_cents: 2500 }), "ENFORCE");

    expect(gate.decide(proposal({ total_cents: 2500 }), "ENFORCE").decision).toBe("ALLOW");
  });

  it("rule 7: escalates a total above the approval threshold and does not let it proceed", async () => {
    const { gate } = await setup();

    expect(gate.decide(proposal({ total_cents: 3001 }), "ENFORCE")).toMatchObject({
      decision: "ESCALATE",
      rule: "APPROVAL_THRESHOLD",
      rules_passed: 6,
      proceed: false,
    });
  });

  it("rule 7: allows a total exactly at the approval threshold", async () => {
    const { gate } = await setup();

    expect(gate.decide(proposal({ total_cents: 3000 }), "ENFORCE").decision).toBe("ALLOW");
  });

  it("reports the first failing rule when several fail", async () => {
    const { gate } = await setup();

    const d = gate.decide(proposal({ merchant: "evil-store", quantity: 99, total_cents: 999_999 }), "ENFORCE");

    expect(d).toMatchObject({ decision: "BLOCK", rule: "MERCHANT_ALLOWED" });
  });
});

describe("gate budget reservation", () => {
  it("a blocked order reserves nothing and may not proceed", async () => {
    const { gate, mandate } = await setup();

    const d = gate.decide(proposal({ quantity: 10 }), "ENFORCE");

    expect(d.proceed).toBe(false);
    expect(gate.committedCents(mandate.id)).toBe(0);
  });

  it("an allowed order reserves its total", async () => {
    const { gate, mandate } = await setup();

    gate.decide(proposal({ total_cents: 2500 }), "ENFORCE");

    expect(gate.committedCents(mandate.id)).toBe(2500);
  });

  it("releasing a reservation frees the budget for a later order", async () => {
    const { gate, mandate } = await setup({ approval_threshold_cents: 4000, total_budget_cents: 4000 });
    const first = proposal({ total_cents: 3500 });
    gate.decide(first, "ENFORCE");
    expect(gate.decide(proposal({ total_cents: 3500 }), "ENFORCE").decision).toBe("BLOCK");

    gate.release(first.intent_id);

    expect(gate.committedCents(mandate.id)).toBe(0);
    expect(gate.decide(proposal({ total_cents: 3500 }), "ENFORCE").decision).toBe("ALLOW");
  });

  it("a spent reservation still counts against the budget and cannot be released", async () => {
    const { gate, mandate } = await setup();
    const p = proposal({ total_cents: 2500 });
    gate.decide(p, "ENFORCE");

    gate.markSpent(p.intent_id);

    expect(gate.committedCents(mandate.id)).toBe(2500);
    expect(() => gate.release(p.intent_id)).toThrow(/spent/i);
  });

  it("an escalated order holds its budget until it is approved or released", async () => {
    const { gate, mandate } = await setup();
    const p = proposal({ total_cents: 3500 });

    gate.decide(p, "ENFORCE");

    expect(gate.committedCents(mandate.id)).toBe(3500);
  });

  it("approving an escalated order writes APPROVAL and lets it proceed", async () => {
    const { gate, ledger } = await setup();
    const p = proposal({ total_cents: 3500 });
    gate.decide(p, "ENFORCE");

    const approved = gate.approve(p.intent_id);

    expect(approved.proceed).toBe(true);
    expect(entriesOfType(ledger, "APPROVAL")).toHaveLength(1);
    expect(entriesOfType(ledger, "APPROVAL")[0]).toMatchObject({ intent_id: p.intent_id, payload: { total_cents: 3500 } });
  });

  it("refuses to approve an order that was not escalated", async () => {
    const { gate, ledger } = await setup();
    const blocked = proposal({ quantity: 10 });
    gate.decide(blocked, "ENFORCE");

    expect(() => gate.approve(blocked.intent_id)).toThrow(/not awaiting approval/i);
    expect(() => gate.approve("int_unknown")).toThrow(/not awaiting approval/i);
    expect(entriesOfType(ledger, "APPROVAL")).toHaveLength(0);
  });

  it("refuses to decide the same intent twice", async () => {
    const { gate, ledger } = await setup();
    const p = proposal();
    gate.decide(p, "ENFORCE");

    expect(() => gate.decide(p, "ENFORCE")).toThrow(/already/i);
    expect(entriesOfType(ledger, "DECISION")).toHaveLength(1);
  });
});

describe("gate observe mode", () => {
  it("writes a VIOLATION for a would-be BLOCK and lets the payment continue", async () => {
    const { gate, ledger } = await setup();
    const p = proposal({ quantity: 10, total_cents: 2500 });

    const d = gate.decide(p, "OBSERVE");

    expect(d).toMatchObject({ decision: "BLOCK", rule: "QUANTITY_LIMIT", proceed: true });
    expect(entriesOfType(ledger, "DECISION")[0].payload).toMatchObject({ decision: "BLOCK", mode: "OBSERVE" });
    const [violation] = entriesOfType(ledger, "VIOLATION");
    expect(violation).toMatchObject({ intent_id: p.intent_id, payload: { rule: "QUANTITY_LIMIT", total_cents: 2500 } });
  });

  it("counts a violating payment against the budget, because the money is really spent", async () => {
    const { gate, mandate } = await setup();

    gate.decide(proposal({ total_cents: 9000 }), "OBSERVE");

    expect(gate.committedCents(mandate.id)).toBe(9000);
  });

  it("writes no VIOLATION for an allowed order", async () => {
    const { gate, ledger } = await setup();

    const d = gate.decide(proposal(), "OBSERVE");

    expect(d).toMatchObject({ decision: "ALLOW", proceed: true });
    expect(entriesOfType(ledger, "VIOLATION")).toHaveLength(0);
  });

  it("lets an escalation proceed without waiting", async () => {
    const { gate } = await setup();

    expect(gate.decide(proposal({ total_cents: 3500 }), "OBSERVE")).toMatchObject({ decision: "ESCALATE", proceed: true });
  });

  it("keeps the ledger chain valid", async () => {
    const { gate, ledger } = await setup();
    gate.decide(proposal(), "OBSERVE");
    gate.decide(proposal({ quantity: 10 }), "OBSERVE");

    expect(ledger.verifyChain().ok).toBe(true);
  });
});

describe("gate with two database connections", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("two proposals from separate connections cannot both reserve the last of the budget", async () => {
    dir = mkdtempSync(join(tmpdir(), "gate-"));
    const path = join(dir, "audit.db");
    const a = await setup({ approval_threshold_cents: 4000, total_budget_cents: 4000 }, openDb(path));
    const dbB = openDb(path);
    const gateB = createGate(dbB, createLedger(dbB), { now: () => NOW });

    const first = a.gate.decide(proposal({ total_cents: 3000 }), "ENFORCE");
    const second = gateB.decide(proposal({ total_cents: 3000 }), "ENFORCE");

    expect([first.decision, second.decision]).toEqual(["ALLOW", "BLOCK"]);
    expect(second.rule).toBe("TOTAL_BUDGET");
    expect(gateB.committedCents(a.mandate.id)).toBe(3000);
    a.db.close();
    dbB.close();
  });

  it("a decision waits for the write lock instead of reading a stale budget", async () => {
    dir = mkdtempSync(join(tmpdir(), "gate-"));
    const path = join(dir, "audit.db");
    const a = await setup({}, openDb(path));
    const dbB = openDb(path);
    dbB.pragma("busy_timeout = 0");
    const gateB = createGate(dbB, createLedger(dbB), { now: () => NOW });

    a.db.exec("BEGIN IMMEDIATE"); // connection A is in the middle of its own decision
    expect(() => gateB.decide(proposal(), "ENFORCE")).toThrow(/locked|busy/i);
    a.db.exec("COMMIT");

    expect(gateB.decide(proposal(), "ENFORCE").decision).toBe("ALLOW");
    a.db.close();
    dbB.close();
  });
});
