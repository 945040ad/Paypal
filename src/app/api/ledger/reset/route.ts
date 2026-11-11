import { getDb } from "@/db";
import { resetTamper } from "@/ledger/tamper-demo";

/** Puts the tampered row back as it was. */
export async function POST() {
  return Response.json(resetTamper(getDb()));
}
