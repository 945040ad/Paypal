/** Test helpers only. Not imported by app code. */
import { exportPublicJwk, generateSigningKeyPair, signMandate } from "./sign";
import type { Mandate } from "./schema";

export function sampleMandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    id: "mnd_test0001",
    version: 1,
    user_id: "demo-user",
    currency: "USD",
    per_purchase_cap_cents: 4000,
    total_budget_cents: 10000,
    approval_threshold_cents: 3000,
    allowed_merchants: ["demo-store"],
    allowed_categories: ["keyboards", "cables"],
    max_quantity_per_item: 2,
    expires_at: "2026-11-20T00:00:00Z",
    created_at: "2026-11-11T09:00:00Z",
    nonce: "0123456789abcdef0123456789abcdef",
    ...overrides,
  };
}

/** A fresh key pair plus a signer, the way the browser does it. */
export async function testSigner() {
  const keyPair = await generateSigningKeyPair();
  const publicKeyJwk = await exportPublicJwk(keyPair.publicKey);
  return {
    publicKeyJwk,
    sign: (mandate: Mandate) => signMandate(keyPair.privateKey, mandate),
  };
}
