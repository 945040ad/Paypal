import { describe, expect, it } from "vitest";
import { modelNames, withModelFallback } from "./model";

describe("modelNames", () => {
  it("puts AI_MODEL first, then the fallbacks, without repeats", () => {
    expect(modelNames({ AI_MODEL: "a", AI_MODEL_FALLBACKS: "b, a ,c" })).toEqual(["a", "b", "c"]);
  });

  it("has defaults when nothing is set", () => {
    expect(modelNames({}).length).toBeGreaterThan(1);
  });
});

describe("withModelFallback", () => {
  it("returns the first model's result when it works", async () => {
    const tried: string[] = [];
    const out = await withModelFallback(["a", "b"], async (m) => (tried.push(m), `done by ${m}`));
    expect(out).toBe("done by a");
    expect(tried).toEqual(["a"]);
  });

  it("moves to the next model when one fails", async () => {
    const out = await withModelFallback(["a", "b"], async (m) => {
      if (m === "a") throw new Error("503 high demand");
      return `done by ${m}`;
    });
    expect(out).toBe("done by b");
  });

  it("throws the last error when every model fails", async () => {
    await expect(withModelFallback(["a", "b"], async (m) => Promise.reject(new Error(`${m} down`)))).rejects.toThrow("b down");
  });

  it("does not try another model once the run has done something that must not be repeated", async () => {
    const tried: string[] = [];
    let proposed = false;
    const run = withModelFallback(
      ["a", "b"],
      async (m) => {
        tried.push(m);
        proposed = true; // the first model proposed a purchase, then failed
        throw new Error("503 after proposing");
      },
      { mayRetry: () => !proposed },
    );
    await expect(run).rejects.toThrow("503 after proposing");
    expect(tried).toEqual(["a"]);
  });
});
