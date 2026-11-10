import { describe, expect, it } from "vitest";
import { recheckOrder } from "./recheck";

const expected = { total_cents: 2900, currency: "USD", custom_id: "mnd_1:int_1", payee_email: "store@business.example.com" };

function order(overrides: { value?: string; currency?: string; custom_id?: string; payee?: string } = {}) {
  return {
    id: "ORDER1",
    purchase_units: [
      {
        custom_id: overrides.custom_id ?? "mnd_1:int_1",
        amount: { currency_code: overrides.currency ?? "USD", value: overrides.value ?? "29.00" },
        payee: { email_address: overrides.payee ?? "store@business.example.com" },
      },
    ],
  };
}

describe("recheckOrder", () => {
  it("passes when PayPal's order matches what the gate approved", () => {
    expect(recheckOrder(order(), expected)).toEqual({ ok: true, mismatches: [] });
  });

  it("fails on a changed amount and names both values", () => {
    expect(recheckOrder(order({ value: "290.00" }), expected)).toEqual({
      ok: false,
      mismatches: [{ field: "amount", expected: "29.00", actual: "290.00" }],
    });
  });

  it("fails on a changed currency", () => {
    expect(recheckOrder(order({ currency: "EUR" }), expected).mismatches.map((m) => m.field)).toEqual(["currency"]);
  });

  it("fails on a changed payee", () => {
    expect(recheckOrder(order({ payee: "thief@example.com" }), expected).mismatches.map((m) => m.field)).toEqual(["payee"]);
  });

  it("ignores letter case in the payee email", () => {
    expect(recheckOrder(order({ payee: "Store@Business.Example.com" }), expected).ok).toBe(true);
  });

  it("fails on a changed custom_id", () => {
    expect(recheckOrder(order({ custom_id: "mnd_1:int_2" }), expected).mismatches.map((m) => m.field)).toEqual(["custom_id"]);
  });

  it("fails when the order has no purchase unit at all", () => {
    expect(recheckOrder({ id: "ORDER1" }, expected).ok).toBe(false);
  });

  it("fails when the order has more than one purchase unit", () => {
    const o = order();
    o.purchase_units.push(o.purchase_units[0]);
    expect(recheckOrder(o, expected).mismatches.map((m) => m.field)).toEqual(["purchase_units"]);
  });
});
