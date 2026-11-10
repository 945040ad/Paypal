import { getDb } from "@/db";
import { submitSignedMandate } from "@/mandate/store";
import { errorResponse, getLedger, readJson } from "@/server";

/** Accepts a mandate signed in the browser. Nothing is stored unless the signature verifies. */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body || typeof body.signature !== "string") {
    return Response.json({ error: "INVALID_BODY", message: "Expected { mandate, signature }." }, { status: 400 });
  }
  try {
    const { mandate, entry } = submitSignedMandate(getDb(), getLedger(), { mandate: body.mandate, signature: body.signature });
    return Response.json({ mandate_id: mandate.id, ledger_seq: entry.seq, ledger_hash: entry.hash }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
