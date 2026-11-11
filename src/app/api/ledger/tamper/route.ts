import { connection } from "next/server";
import { getDb } from "@/db";
import { isTampered, tamperWithRow } from "@/ledger/tamper-demo";

/** Whether the demo has a tampered row at the moment. */
export async function GET() {
  await connection();
  return Response.json({ tampered: isTampered(getDb()) });
}

/** DEMO ONLY: edits one ledger row directly in the database so that Verify fails. */
export async function POST() {
  try {
    return Response.json(tamperWithRow(getDb()));
  } catch (err) {
    return Response.json({ error: "CANNOT_TAMPER", message: err instanceof Error ? err.message : "Could not edit a row." }, { status: 409 });
  }
}
