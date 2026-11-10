import { getDb } from "@/db";
import { getPayPalClient } from "@/paypal/client";
import { reconcile } from "@/paypal/reconcile";
import { getLedger } from "@/server";

/** "Sync from PayPal": catches up on anything a webhook missed. */
export async function POST() {
  try {
    return Response.json(await reconcile({ db: getDb(), ledger: getLedger(), paypal: getPayPalClient() }));
  } catch (err) {
    console.error("Reconcile failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "RECONCILE_FAILED" }, { status: 502 });
  }
}
