import { connection } from "next/server";

export async function GET() {
  await connection(); // always answer at request time, never from a prerender
  return Response.json({
    ok: true,
    service: "system-audit",
    paypal_env: process.env.PAYPAL_ENV ?? null,
    time: new Date().toISOString(),
  });
}
