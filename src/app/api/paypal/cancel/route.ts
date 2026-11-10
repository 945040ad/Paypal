import { getPurchaseFlow } from "@/server";

/** PayPal sends the buyer here if they cancel at the approval screen. Nothing was authorized, so nothing is charged. */
export async function GET(request: Request) {
  const intentId = new URL(request.url).searchParams.get("intent");
  const purchase = intentId ? getPurchaseFlow().get(intentId) : null;
  return Response.json({ cancelled: true, purchase });
}
