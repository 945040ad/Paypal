import { connection } from "next/server";
import { getLedger } from "@/server";

/** Recomputes every hash in the chain. */
export async function GET() {
  await connection();
  return Response.json(getLedger().verifyChain());
}
