import { z } from "zod";

const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const isoTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO date-time");

/** The signed rules. Unknown fields are rejected so nothing unsigned-looking can ride along. */
export const mandateSchema = z
  .strictObject({
    id: z.string().regex(/^mnd_[A-Za-z0-9_-]{4,64}$/),
    version: z.literal(1),
    user_id: z.string().min(1).max(64),
    currency: z.literal("USD"),
    per_purchase_cap_cents: cents.positive(),
    total_budget_cents: cents.positive(),
    approval_threshold_cents: cents,
    allowed_merchants: z.array(z.string().min(1).max(64)).min(1).max(20),
    allowed_categories: z.array(z.string().min(1).max(64)).min(1).max(20),
    max_quantity_per_item: z.number().int().min(1).max(1000),
    expires_at: isoTime,
    created_at: isoTime,
    nonce: z.string().min(16).max(128),
  })
  .refine((m) => Date.parse(m.expires_at) > Date.parse(m.created_at), {
    message: "expires_at must be after created_at",
    path: ["expires_at"],
  });

export type Mandate = z.infer<typeof mandateSchema>;

/** An ECDSA P-256 public key as a JWK, with no private part. */
export type PublicKeyJwk = { kty: "EC"; crv: "P-256"; x: string; y: string };
