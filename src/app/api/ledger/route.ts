import { connection } from "next/server";
import { getLedger } from "@/server";

/** The whole chain as JSON, so anyone can re-verify it. */
export async function GET() {
  await connection();
  return Response.json(getLedger().export());
}
