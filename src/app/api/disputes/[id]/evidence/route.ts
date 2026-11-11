import { getDb } from "@/db";
import { getDisputeRow } from "@/evidence/classifier";
import { buildEvidencePdf } from "@/evidence/pdf";
import { getLedger } from "@/server";

/** The evidence PDF for a dispute, built from stored facts at the moment it is requested. */
export async function GET(_request: Request, ctx: RouteContext<"/api/disputes/[id]/evidence">) {
  const { id } = await ctx.params;
  const db = getDb();
  if (!getDisputeRow(db, id)) return Response.json({ error: "UNKNOWN_DISPUTE" }, { status: 404 });
  const { bytes } = await buildEvidencePdf(db, getLedger(), id);
  return new Response(bytes as BodyInit, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="evidence-${id}.pdf"`, "Cache-Control": "no-store" },
  });
}
