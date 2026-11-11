import { connection } from "next/server";
import { getDb } from "@/db";
import { classifyDispute, type DisputeRow } from "@/evidence/classifier";
import { getLedger } from "@/server";

/** Every dispute we know about, newest first, with the classification code gives it. */
export async function GET() {
  await connection();
  const db = getDb();
  const ledger = getLedger();
  const rows = db.prepare("SELECT * FROM disputes ORDER BY first_seen_at DESC").all() as DisputeRow[];
  return Response.json({
    disputes: rows.map(({ detail_json: _detail, ...row }) => {
      void _detail;
      const c = classifyDispute(db, ledger, row.dispute_id);
      return { ...row, classification: c.classification, classification_reason: c.reason };
    }),
  });
}
