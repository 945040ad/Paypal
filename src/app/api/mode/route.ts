import { connection } from "next/server";
import { getDb } from "@/db";
import { readJson } from "@/server";
import { getMode, setMode } from "@/settings";

export async function GET() {
  await connection();
  return Response.json({ mode: getMode(getDb()) });
}

/** Enforce: the gate stops payments. Observe: the gate only records what it would have done. */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body?.mode !== "ENFORCE" && body?.mode !== "OBSERVE") {
    return Response.json({ error: "INVALID_MODE", message: 'mode must be "ENFORCE" or "OBSERVE".' }, { status: 400 });
  }
  return Response.json({ mode: setMode(getDb(), body.mode) });
}
