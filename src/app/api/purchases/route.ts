import { connection } from "next/server";
import { getDb } from "@/db";
import { getLatestMandate } from "@/mandate/store";
import { DEMO_USER_ID } from "@/server";

/**
 * Purchases under the current mandate that are waiting for the person: escalated ones to approve, and allowed
 * ones that still need the buyer's approval in PayPal. Agents that come in over MCP never see these links;
 * the person finds them here.
 */
export async function GET() {
  await connection();
  const db = getDb();
  const stored = getLatestMandate(db, DEMO_USER_ID);
  if (!stored) return Response.json({ waiting: [] });
  const waiting = db
    .prepare(
      "SELECT intent_id, product_id, quantity, total_cents, status, approve_url, created_at FROM purchases WHERE mandate_id = ? AND status IN ('AWAITING_APPROVAL', 'NEEDS_BUYER') ORDER BY created_at DESC LIMIT 20",
    )
    .all(stored.mandate.id);
  return Response.json({ waiting });
}
