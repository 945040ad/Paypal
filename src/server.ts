/** Server-side singletons and helpers shared by route handlers. */
import { getDb } from "./db";
import { createGate, type Gate } from "./gate/gate";
import { createLedger, type Ledger } from "./ledger/ledger";
import { MandateError } from "./mandate/store";
import { getPayPalClient } from "./paypal/client";
import { createPurchaseFlow, type PurchaseFlow } from "./purchase/flow";
import { PRODUCTS } from "./store/products";

/** No login in the demo: every request acts as this user. */
export const DEMO_USER_ID = "demo-user";

export function getLedger(): Ledger {
  return createLedger(getDb());
}

export function getGate(): Gate {
  return createGate(getDb(), getLedger());
}

/** The purchase flow wired to the real PayPal sandbox. */
export function getPurchaseFlow(): PurchaseFlow {
  const merchantEmail = process.env.PAYPAL_MERCHANT_EMAIL;
  const baseUrl = process.env.APP_BASE_URL;
  if (!merchantEmail || !baseUrl) throw new Error("PAYPAL_MERCHANT_EMAIL and APP_BASE_URL must be set.");
  return createPurchaseFlow({
    db: getDb(),
    ledger: getLedger(),
    gate: getGate(),
    paypal: getPayPalClient(),
    catalog: PRODUCTS,
    merchantEmail,
    baseUrl: baseUrl.replace(/\/+$/, ""),
  });
}

const STATUS: Record<MandateError["code"], number> = {
  INVALID_KEY: 400,
  INVALID_MANDATE: 400,
  NO_PUBLIC_KEY: 400,
  BAD_SIGNATURE: 400,
  DUPLICATE_MANDATE: 409,
};

/** Turns a thrown error into a JSON response. Unknown errors become a plain 500 with no internals. */
export function errorResponse(err: unknown): Response {
  if (err instanceof MandateError) {
    return Response.json({ error: err.code, message: err.message }, { status: STATUS[err.code] });
  }
  console.error(err);
  return Response.json({ error: "INTERNAL", message: "Something went wrong." }, { status: 500 });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
