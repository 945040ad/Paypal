/**
 * Signing with Web Crypto (ECDSA P-256, SHA-256). Runs in the browser; Node has the same API, which the tests use.
 * The private key is created non-extractable, so its bytes can never be read out, only used to sign.
 */
import { canonicalBytes } from "./canonical";
import type { Mandate, PublicKeyJwk } from "./schema";

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;

export function generateSigningKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ALGORITHM, false, ["sign", "verify"]);
}

export async function exportPublicJwk(publicKey: CryptoKey): Promise<PublicKeyJwk> {
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  return { kty: "EC", crv: "P-256", x: jwk.x!, y: jwk.y! };
}

/** Signs the canonical bytes of the mandate. Returns the raw r||s signature as base64url. */
export async function signMandate(privateKey: CryptoKey, mandate: Mandate): Promise<string> {
  const data = canonicalBytes(mandate) as Uint8Array<ArrayBuffer>;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, data);
  return base64url(new Uint8Array(signature));
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
