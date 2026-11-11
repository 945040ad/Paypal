import { describe, expect, it } from "vitest";
import { sampleMandate } from "../mandate/testing";
import { PRODUCTS } from "../store/products";
import { paymentsOutsideMandate, type Payment } from "./compliance";

const mandate = sampleMandate(); // cap $40, budget $100, approval above $30, keyboards + cables, max 2 per item
const pay = (overrides: Partial<Payment> = {}): Payment => ({ intent_id: "int_1", product_id: "cable-usbc-1m", quantity: 1, total_cents: 900, approved_by_user: false, ...overrides });
const rules = (payments: Payment[]) => paymentsOutsideMandate(mandate, payments, PRODUCTS).map((v) => v.rule);

describe("paymentsOutsideMandate", () => {
  it("finds nothing wrong with ordinary purchases", () => {
    expect(rules([pay(), pay({ intent_id: "int_2", product_id: "kb-compact-60", total_cents: 2900 })])).toEqual([]);
  });

  it("finds nothing wrong with no payments at all", () => {
    expect(rules([])).toEqual([]);
  });

  it("flags a category the mandate does not allow", () => {
    expect(rules([pay({ product_id: "gift-25", total_cents: 2500 })])).toEqual(["CATEGORY"]);
  });

  it("flags a quantity above the limit", () => {
    expect(rules([pay({ quantity: 3, total_cents: 2700 })])).toEqual(["QUANTITY"]);
  });

  it("flags a payment above the per-purchase cap", () => {
    expect(rules([pay({ product_id: "kb-flagship-tkl", total_cents: 8900 })])).toContain("PER_PURCHASE_CAP");
  });

  it("flags the payment that takes the running total over the budget, and only that one", () => {
    const four = [1, 2, 3, 4].map((n) => pay({ intent_id: `int_${n}`, product_id: "kb-compact-60", total_cents: 2900 }));

    const found = paymentsOutsideMandate(mandate, four, PRODUCTS);

    expect(found).toEqual([{ intent_id: "int_4", rule: "TOTAL_BUDGET", detail: expect.any(String) }]);
  });

  it("flags a payment above the approval threshold that the user never approved", () => {
    expect(rules([pay({ product_id: "kb-tactile-75", total_cents: 3500 })])).toEqual(["NOT_APPROVED"]);
  });

  it("accepts that same payment once the user approved it", () => {
    expect(rules([pay({ product_id: "kb-tactile-75", total_cents: 3500, approved_by_user: true })])).toEqual([]);
  });

  it("flags an amount that differs from the catalogue price", () => {
    expect(rules([pay({ product_id: "kb-flagship-tkl", total_cents: 100 })])).toEqual(["PRICE"]);
  });

  it("flags a product the store does not sell", () => {
    expect(rules([pay({ product_id: "mystery-box", total_cents: 500 })])).toEqual(["UNKNOWN_PRODUCT"]);
  });
});
