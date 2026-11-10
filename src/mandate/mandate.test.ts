import { describe, expect, it } from "vitest";
import { canonicalBytes } from "./canonical";
import { mandateSchema } from "./schema";
import { sampleMandate, testSigner } from "./testing";
import { verifyMandateSignature } from "./verify";

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString();

describe("mandate schema", () => {
  it("accepts the mandate from the plan", () => {
    expect(mandateSchema.safeParse(sampleMandate()).success).toBe(true);
  });

  it("rejects an unknown field", () => {
    expect(mandateSchema.safeParse({ ...sampleMandate(), extra_budget_cents: 1 }).success).toBe(false);
  });

  it("rejects a fractional cent amount", () => {
    expect(mandateSchema.safeParse(sampleMandate({ per_purchase_cap_cents: 40.5 })).success).toBe(false);
  });

  it("rejects a negative budget", () => {
    expect(mandateSchema.safeParse(sampleMandate({ total_budget_cents: -1 })).success).toBe(false);
  });

  it("rejects an expiry that is not after the creation time", () => {
    const m = sampleMandate({ expires_at: "2026-11-11T09:00:00Z" });
    expect(mandateSchema.safeParse(m).success).toBe(false);
  });

  it("rejects an empty merchant list", () => {
    expect(mandateSchema.safeParse(sampleMandate({ allowed_merchants: [] })).success).toBe(false);
  });
});

describe("canonical bytes", () => {
  it("are the same for two objects with different key order", () => {
    const m = sampleMandate();
    const reordered = Object.fromEntries(Object.entries(m).reverse());
    expect(text(canonicalBytes(reordered))).toBe(text(canonicalBytes(m)));
  });

  it("sort keys and drop whitespace", () => {
    expect(text(canonicalBytes({ b: 1, a: [2, { d: 1, c: 2 }] }))).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });
});

describe("mandate signature", () => {
  it("verifies a mandate signed with the matching key", async () => {
    const signer = await testSigner();
    const mandate = sampleMandate();
    const signature = await signer.sign(mandate);

    expect(verifyMandateSignature({ mandate, signature, publicKeyJwk: signer.publicKeyJwk })).toBe(true);
  });

  it("fails when a field changes after signing", async () => {
    const signer = await testSigner();
    const signature = await signer.sign(sampleMandate());
    const tampered = sampleMandate({ total_budget_cents: 1_000_000 });

    expect(verifyMandateSignature({ mandate: tampered, signature, publicKeyJwk: signer.publicKeyJwk })).toBe(false);
  });

  it("still verifies when the JSON keys arrive in a different order", async () => {
    const signer = await testSigner();
    const mandate = sampleMandate();
    const signature = await signer.sign(mandate);
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(mandate).reverse())));

    expect(Object.keys(reordered)[0]).toBe("nonce");
    expect(verifyMandateSignature({ mandate: reordered, signature, publicKeyJwk: signer.publicKeyJwk })).toBe(true);
  });

  it("fails against a different key", async () => {
    const signer = await testSigner();
    const other = await testSigner();
    const mandate = sampleMandate();
    const signature = await signer.sign(mandate);

    expect(verifyMandateSignature({ mandate, signature, publicKeyJwk: other.publicKeyJwk })).toBe(false);
  });

  it("returns false for a garbage signature instead of throwing", async () => {
    const signer = await testSigner();

    expect(
      verifyMandateSignature({ mandate: sampleMandate(), signature: "not-a-signature", publicKeyJwk: signer.publicKeyJwk }),
    ).toBe(false);
  });

  it("returns false for a key that is not a P-256 public key", () => {
    const publicKeyJwk = { kty: "EC", crv: "P-384", x: "AA", y: "AA" };

    expect(verifyMandateSignature({ mandate: sampleMandate(), signature: "AAAA", publicKeyJwk })).toBe(false);
  });

  it("exports a public key with no private part", async () => {
    const signer = await testSigner();

    expect(signer.publicKeyJwk).toMatchObject({ kty: "EC", crv: "P-256" });
    expect(signer.publicKeyJwk).not.toHaveProperty("d");
  });
});
