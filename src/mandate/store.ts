/** Stores the user's public key and accepts signed mandates. Nothing is stored unless the signature verifies. */
import type { Db } from "../db";
import type { Ledger, LedgerEntry } from "../ledger/ledger";
import { mandateSchema, type Mandate, type PublicKeyJwk } from "./schema";
import { toPublicKeyJwk, verifyMandateSignature } from "./verify";

export type MandateErrorCode = "INVALID_KEY" | "INVALID_MANDATE" | "NO_PUBLIC_KEY" | "BAD_SIGNATURE" | "DUPLICATE_MANDATE";

export class MandateError extends Error {
  constructor(
    public code: MandateErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type StoredMandate = {
  mandate: Mandate;
  signature: string;
  public_key_jwk: PublicKeyJwk;
  revoked_at: string | null;
};

/** Records the user's public key. A later call replaces it (one demo user, no login). */
export function registerPublicKey(db: Db, userId: string, key: unknown): PublicKeyJwk {
  const jwk = toPublicKeyJwk(key);
  if (!jwk) throw new MandateError("INVALID_KEY", "Key must be an ECDSA P-256 public key in JWK form, with no private part.");
  db.prepare(
    "INSERT INTO user_keys (user_id, public_key_jwk, registered_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET public_key_jwk = excluded.public_key_jwk, registered_at = excluded.registered_at",
  ).run(userId, JSON.stringify(jwk), new Date().toISOString());
  return jwk;
}

export function getPublicKey(db: Db, userId: string): PublicKeyJwk | null {
  const row = db.prepare("SELECT public_key_jwk FROM user_keys WHERE user_id = ?").get(userId) as
    | { public_key_jwk: string }
    | undefined;
  return row ? (JSON.parse(row.public_key_jwk) as PublicKeyJwk) : null;
}

export function getMandate(db: Db, id: string): StoredMandate | null {
  const row = db.prepare("SELECT mandate_json, signature, public_key_jwk, revoked_at FROM mandates WHERE id = ?").get(id) as
    | { mandate_json: string; signature: string; public_key_jwk: string; revoked_at: string | null }
    | undefined;
  if (!row) return null;
  return {
    mandate: JSON.parse(row.mandate_json) as Mandate,
    signature: row.signature,
    public_key_jwk: JSON.parse(row.public_key_jwk) as PublicKeyJwk,
    revoked_at: row.revoked_at,
  };
}

/** Verifies the signature against the user's registered key, then stores the mandate and writes MANDATE_SIGNED. */
export function submitSignedMandate(
  db: Db,
  ledger: Ledger,
  input: { mandate: unknown; signature: string },
): { mandate: Mandate; entry: LedgerEntry } {
  const parsed = mandateSchema.safeParse(input.mandate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new MandateError("INVALID_MANDATE", `Invalid mandate: ${issue.path.join(".") || "(root)"} ${issue.message}`);
  }
  const mandate = parsed.data;

  const publicKeyJwk = getPublicKey(db, mandate.user_id);
  if (!publicKeyJwk) throw new MandateError("NO_PUBLIC_KEY", `No public key is registered for ${mandate.user_id}.`);

  if (!verifyMandateSignature({ mandate, signature: input.signature, publicKeyJwk })) {
    throw new MandateError("BAD_SIGNATURE", "Signature does not verify against the registered public key.");
  }

  const store = db.transaction(() => {
    if (db.prepare("SELECT 1 FROM mandates WHERE id = ?").get(mandate.id)) {
      throw new MandateError("DUPLICATE_MANDATE", `Mandate ${mandate.id} already exists.`);
    }
    db.prepare(
      "INSERT INTO mandates (id, user_id, mandate_json, signature, public_key_jwk, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(mandate.id, mandate.user_id, JSON.stringify(mandate), input.signature, JSON.stringify(publicKeyJwk), mandate.created_at);
    return ledger.append({
      type: "MANDATE_SIGNED",
      mandate_id: mandate.id,
      payload: { mandate, signature: input.signature, public_key_jwk: publicKeyJwk },
    });
  });

  return { mandate, entry: store.immediate() };
}

/** The newest mandate for a user that is neither revoked nor expired, or null. */
export function getLatestMandate(db: Db, userId: string, now: Date = new Date()): StoredMandate | null {
  const rows = db.prepare("SELECT id FROM mandates WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC").all(userId) as { id: string }[];
  for (const { id } of rows) {
    const stored = getMandate(db, id)!;
    if (Date.parse(stored.mandate.expires_at) > now.getTime()) return stored;
  }
  return null;
}
