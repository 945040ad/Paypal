import { describe, expect, it } from "vitest";
import { openDb } from "../db";
import { createLedger } from "../ledger/ledger";
import { getMandate, registerPublicKey, submitSignedMandate } from "./store";
import { sampleMandate, testSigner } from "./testing";

async function setup() {
  const db = openDb(":memory:");
  const ledger = createLedger(db);
  const signer = await testSigner();
  return { db, ledger, signer };
}

describe("submitSignedMandate", () => {
  it("writes MANDATE_SIGNED as ledger entry 1 with the mandate, signature and public key", async () => {
    const { db, ledger, signer } = await setup();
    registerPublicKey(db, "demo-user", signer.publicKeyJwk);
    const mandate = sampleMandate();
    const signature = await signer.sign(mandate);

    const { entry } = submitSignedMandate(db, ledger, { mandate, signature });

    expect(entry.seq).toBe(1);
    expect(entry.type).toBe("MANDATE_SIGNED");
    expect(entry.mandate_id).toBe(mandate.id);
    expect(entry.payload).toEqual({ mandate, signature, public_key_jwk: signer.publicKeyJwk });
    expect(ledger.verifyChain().ok).toBe(true);
  });

  it("stores the mandate so it can be read back with its signature and key", async () => {
    const { db, ledger, signer } = await setup();
    registerPublicKey(db, "demo-user", signer.publicKeyJwk);
    const mandate = sampleMandate();
    const signature = await signer.sign(mandate);
    submitSignedMandate(db, ledger, { mandate, signature });

    expect(getMandate(db, mandate.id)).toEqual({
      mandate,
      signature,
      public_key_jwk: signer.publicKeyJwk,
      revoked_at: null,
    });
  });

  it("rejects a bad signature and stores nothing", async () => {
    const { db, ledger, signer } = await setup();
    registerPublicKey(db, "demo-user", signer.publicKeyJwk);
    const signature = await signer.sign(sampleMandate());
    const tampered = sampleMandate({ total_budget_cents: 999_999 });

    expect(() => submitSignedMandate(db, ledger, { mandate: tampered, signature })).toThrow(/signature/i);
    expect(ledger.export().entries).toHaveLength(0);
    expect(getMandate(db, tampered.id)).toBeNull();
  });

  it("rejects a mandate signed by a key the server has not been given", async () => {
    const { db, ledger, signer } = await setup();
    const other = await testSigner();
    registerPublicKey(db, "demo-user", other.publicKeyJwk);
    const mandate = sampleMandate();

    expect(() => submitSignedMandate(db, ledger, { mandate, signature: "" })).toThrow(/signature/i);
    await expect(signer.sign(mandate).then((signature) => submitSignedMandate(db, ledger, { mandate, signature }))).rejects.toThrow(
      /signature/i,
    );
    expect(ledger.export().entries).toHaveLength(0);
  });

  it("rejects a mandate when the user has no registered key", async () => {
    const { db, ledger, signer } = await setup();
    const mandate = sampleMandate();
    const signature = await signer.sign(mandate);

    expect(() => submitSignedMandate(db, ledger, { mandate, signature })).toThrow(/public key/i);
  });

  it("rejects a mandate that fails the schema", async () => {
    const { db, ledger, signer } = await setup();
    registerPublicKey(db, "demo-user", signer.publicKeyJwk);

    expect(() => submitSignedMandate(db, ledger, { mandate: { id: "mnd_x" }, signature: "AAAA" })).toThrow(/mandate/i);
  });

  it("rejects the same mandate id twice and writes one ledger entry", async () => {
    const { db, ledger, signer } = await setup();
    registerPublicKey(db, "demo-user", signer.publicKeyJwk);
    const mandate = sampleMandate();
    const signature = await signer.sign(mandate);
    submitSignedMandate(db, ledger, { mandate, signature });

    expect(() => submitSignedMandate(db, ledger, { mandate, signature })).toThrow(/already/i);
    expect(ledger.export().entries).toHaveLength(1);
  });
});

describe("registerPublicKey", () => {
  it("rejects a key that carries a private part", async () => {
    const { db, signer } = await setup();

    expect(() => registerPublicKey(db, "demo-user", { ...signer.publicKeyJwk, d: "secret" })).toThrow(/public/i);
  });

  it("rejects a key on the wrong curve", async () => {
    const { db } = await setup();

    expect(() => registerPublicKey(db, "demo-user", { kty: "EC", crv: "P-384", x: "AA", y: "AA" })).toThrow(/P-256/);
  });
});
