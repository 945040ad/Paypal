/**
 * Mandate drafter: the user's sentence in, mandate fields out. The result only fills an editable form.
 * Nothing is stored until the user reviews it and signs it in the browser.
 */
import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { MERCHANT_ID } from "../store/products";

const draftSchema = z.object({
  per_purchase_cap_usd: z.number().describe("Most the agent may spend on one purchase, in US dollars"),
  total_budget_usd: z.number().describe("Most the agent may spend in total, in US dollars"),
  approval_threshold_usd: z.number().describe("Purchases above this amount need the user's approval first, in US dollars"),
  allowed_categories: z.array(z.string()).describe("Product categories the agent may buy from"),
  max_quantity_per_item: z.number().describe("Most units of one item per purchase"),
  valid_days: z.number().describe("How many days the rules stay valid"),
});

export type RawDraft = z.infer<typeof draftSchema>;

export type MandateDraft = {
  per_purchase_cap_cents: number;
  total_budget_cents: number;
  approval_threshold_cents: number;
  allowed_merchants: string[];
  allowed_categories: string[];
  max_quantity_per_item: number;
  valid_days: number;
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
const cents = (usd: number, min: number) => clamp(Math.round(usd * 100), min, 100_000_00);

/** Code, not the model, has the last word on the draft: amounts become cents and stay consistent with each other. */
export function normalizeDraft(raw: RawDraft, storeCategories: string[]): MandateDraft {
  const total = cents(raw.total_budget_usd, 1);
  const cap = Math.min(cents(raw.per_purchase_cap_usd, 1), total);
  const wanted = raw.allowed_categories.map((c) => c.trim().toLowerCase());
  return {
    per_purchase_cap_cents: cap,
    total_budget_cents: total,
    approval_threshold_cents: Math.min(cents(raw.approval_threshold_usd, 0), cap),
    allowed_merchants: [MERCHANT_ID],
    allowed_categories: storeCategories.filter((c) => wanted.includes(c)).sort((a, b) => wanted.indexOf(a) - wanted.indexOf(b)),
    max_quantity_per_item: clamp(Math.round(raw.max_quantity_per_item), 1, 100),
    valid_days: clamp(Math.round(raw.valid_days), 1, 90),
  };
}

export async function draftMandate(input: { sentence: string; model: LanguageModel; storeCategories: string[] }): Promise<MandateDraft> {
  const { output } = await generateText({
    model: input.model,
    output: Output.object({ schema: draftSchema }),
    system:
      "You turn a shopper's plain-language spending rules into structured fields. " +
      `The store's categories are: ${input.storeCategories.join(", ")}. Use only those category names. ` +
      "If the user gives no value for a field, choose a cautious default: approval threshold equal to the per-purchase cap, " +
      "per-purchase cap equal to the total budget, quantity 1, validity 7 days.",
    prompt: input.sentence,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(45_000),
  });
  return normalizeDraft(output, input.storeCategories);
}
