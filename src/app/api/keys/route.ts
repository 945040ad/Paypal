import { getDb } from "@/db";
import { registerPublicKey } from "@/mandate/store";
import { DEMO_USER_ID, errorResponse, readJson } from "@/server";

/** The browser sends its public key here once, before signing its first mandate. */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body) return Response.json({ error: "INVALID_BODY", message: "Expected a JSON object." }, { status: 400 });
  try {
    const publicKeyJwk = registerPublicKey(getDb(), DEMO_USER_ID, body.public_key_jwk);
    return Response.json({ user_id: DEMO_USER_ID, public_key_jwk: publicKeyJwk });
  } catch (err) {
    return errorResponse(err);
  }
}
