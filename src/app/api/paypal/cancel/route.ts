/** PayPal sends the buyer here if they cancel at the approval screen. Nothing was authorized, so nothing is charged. */
export async function GET(request: Request) {
  const intentId = new URL(request.url).searchParams.get("intent") ?? "";
  return Response.redirect(new URL(`/agent?${new URLSearchParams({ intent: intentId, status: "CANCELLED_BY_BUYER" })}`, process.env.APP_BASE_URL ?? request.url), 303);
}
