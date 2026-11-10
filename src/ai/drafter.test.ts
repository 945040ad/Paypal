import { describe, expect, it } from "vitest";
import { normalizeDraft } from "./drafter";

const CATEGORIES = ["keyboards", "cables", "gift-cards"];
const draft = (overrides: Record<string, unknown> = {}) => ({
  per_purchase_cap_usd: 40,
  total_budget_usd: 100,
  approval_threshold_usd: 30,
  allowed_categories: ["keyboards", "cables"],
  max_quantity_per_item: 2,
  valid_days: 7,
  ...overrides,
});

describe("normalizeDraft", () => {
  it("converts dollars to integer cents", () => {
    expect(normalizeDraft(draft({ per_purchase_cap_usd: 39.99 }), CATEGORIES)).toMatchObject({
      per_purchase_cap_cents: 3999,
      total_budget_cents: 10000,
      approval_threshold_cents: 3000,
    });
  });

  it("drops categories the store does not have", () => {
    const out = normalizeDraft(draft({ allowed_categories: ["keyboards", "weapons", "CABLES"] }), CATEGORIES);
    expect(out.allowed_categories).toEqual(["keyboards", "cables"]);
  });

  it("never lets the per-purchase cap exceed the total budget", () => {
    expect(normalizeDraft(draft({ per_purchase_cap_usd: 500, total_budget_usd: 100 }), CATEGORIES).per_purchase_cap_cents).toBe(10000);
  });

  it("never lets the approval threshold exceed the per-purchase cap", () => {
    expect(normalizeDraft(draft({ approval_threshold_usd: 90 }), CATEGORIES).approval_threshold_cents).toBe(4000);
  });

  it("keeps quantity and validity inside sane bounds", () => {
    const out = normalizeDraft(draft({ max_quantity_per_item: 0, valid_days: 9999 }), CATEGORIES);
    expect(out.max_quantity_per_item).toBe(1);
    expect(out.valid_days).toBe(90);
  });

  it("always fixes the merchant to the demo store, whatever the model says", () => {
    const out = normalizeDraft({ ...draft(), allowed_merchants: ["evil-store"] } as never, CATEGORIES);
    expect(out.allowed_merchants).toEqual(["demo-store"]);
  });
});
