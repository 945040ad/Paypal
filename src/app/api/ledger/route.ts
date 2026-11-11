import { connection } from "next/server";
import { getLedger } from "@/server";

/** The whole chain as JSON, so anyone can re-verify it. Add ?download=1 to save it as a file. */
export async function GET(request: Request) {
  await connection();
  const body = getLedger().export();
  if (new URL(request.url).searchParams.has("download")) {
    return new Response(JSON.stringify(body, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="verdict-ledger.json"' },
    });
  }
  return Response.json(body);
}
