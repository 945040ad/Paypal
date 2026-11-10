import { connection } from "next/server";
import { getDb } from "@/db";
import { createGate } from "@/gate/gate";
import { getLatestMandate } from "@/mandate/store";
import { DEMO_USER_ID, getLedger } from "@/server";

/** The mandate the agent is currently bound by, plus how much of its budget is used. */
export async function GET() {
  await connection();
  const db = getDb();
  const stored = getLatestMandate(db, DEMO_USER_ID);
  if (!stored) return Response.json({ mandate: null });
  const committed_cents = createGate(db, getLedger()).committedCents(stored.mandate.id);
  return Response.json({ mandate: stored.mandate, committed_cents });
}
