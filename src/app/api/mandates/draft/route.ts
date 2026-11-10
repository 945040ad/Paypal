import { draftMandate } from "@/ai/drafter";
import { getModels, withModelFallback } from "@/ai/model";
import { readJson } from "@/server";
import { CATEGORIES } from "@/store/products";

/** Turns the user's sentence into mandate fields for the form. Nothing is stored here. */
export async function POST(request: Request) {
  const body = await readJson(request);
  const sentence = typeof body?.sentence === "string" ? body.sentence.trim().slice(0, 1000) : "";
  if (!sentence) return Response.json({ error: "MISSING_SENTENCE", message: "Describe your rules in a sentence." }, { status: 400 });
  try {
    const draft = await withModelFallback(getModels(), (model) => draftMandate({ sentence, model, storeCategories: CATEGORIES }));
    return Response.json({ draft, store_categories: CATEGORIES });
  } catch (err) {
    console.error("Mandate draft failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "DRAFT_FAILED", message: "The AI model could not draft the rules just now. Fill in the form by hand or try again." }, { status: 502 });
  }
}
