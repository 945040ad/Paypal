/** The one place the app picks its model. Swap the provider here, or change AI_MODEL / AI_MODEL_FALLBACKS. */
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

const DEFAULT_MODEL = "gemini-flash-latest";
const DEFAULT_FALLBACKS = "gemini-3-flash-preview,gemini-flash-lite-latest";

/** Model names to try, in order: AI_MODEL first, then AI_MODEL_FALLBACKS. */
export function modelNames(env: Record<string, string | undefined> = process.env): string[] {
  const names = [env.AI_MODEL || DEFAULT_MODEL, ...(env.AI_MODEL_FALLBACKS ?? DEFAULT_FALLBACKS).split(",")];
  return [...new Set(names.map((n) => n.trim()).filter(Boolean))];
}

export function getModels(): LanguageModel[] {
  return modelNames().map((name) => google(name));
}

/**
 * Runs `run` with each model in turn until one succeeds (the free tier often answers 503 "high demand").
 * `mayRetry` lets the caller forbid a second attempt once the run has done something that must not be
 * repeated, such as proposing a purchase.
 */
export async function withModelFallback<M, T>(models: M[], run: (model: M) => Promise<T>, opts: { mayRetry?: () => boolean } = {}): Promise<T> {
  let lastError: unknown = new Error("No model configured.");
  for (const model of models) {
    try {
      return await run(model);
    } catch (err) {
      lastError = err;
      if (opts.mayRetry && !opts.mayRetry()) break;
    }
  }
  throw lastError;
}
