/** Server-side signature check. Synchronous, so the gate can run it inside a database transaction. */
import { createPublicKey, verify } from "node:crypto";
import { canonicalBytes } from "./canonical";
import type { PublicKeyJwk } from "./schema";

/** Returns the key as a clean P-256 public JWK, or null if it is anything else (including a private key). */
export function toPublicKeyJwk(value: unknown): PublicKeyJwk | null {
  if (typeof value !== "object" || value === null) return null;
  const jwk = value as Record<string, unknown>;
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") return null;
  if (typeof jwk.x !== "string" || typeof jwk.y !== "string") return null;
  if ("d" in jwk) return null;
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

/** True only if `signature` is a valid ECDSA P-256 / SHA-256 signature of the mandate's canonical bytes. */
export function verifyMandateSignature(input: { mandate: unknown; signature: string; publicKeyJwk: unknown }): boolean {
  try {
    const jwk = toPublicKeyJwk(input.publicKeyJwk);
    if (!jwk) return false;
    const signature = Buffer.from(input.signature, "base64url");
    if (signature.length !== 64) return false;
    const key = createPublicKey({ key: jwk, format: "jwk" });
    return verify("sha256", canonicalBytes(input.mandate), { key, dsaEncoding: "ieee-p1363" }, signature);
  } catch {
    return false;
  }
}
