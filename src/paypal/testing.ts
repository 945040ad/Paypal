/** Unit tests only: a PayPal client whose replies come from a function. Never used by the app. */
import type { PayPalClient, PayPalFetchOptions } from "./client";

export type StubCall = { method: string; path: string; body: unknown; rawBody: unknown; requestId?: string };
export type StubReply = { status?: number; body?: unknown } | undefined;

export function stubPayPal(handler: (call: StubCall) => StubReply) {
  const calls: StubCall[] = [];
  const client: PayPalClient = {
    async getAccessToken() {
      return { accessToken: "stub", expiresAt: Number.MAX_SAFE_INTEGER };
    },
    async paypalFetch(path: string, options: PayPalFetchOptions = {}) {
      const method = options.method ?? "GET";
      if (method === "POST" && !options.requestId) throw new Error("stub PayPal: POST without requestId");
      let body: unknown = options.body ?? null;
      if (typeof body === "string" && body) {
        try {
          body = JSON.parse(body);
        } catch {
          /* keep the string */
        }
      }
      const call = { method, path, body, rawBody: options.body ?? null, requestId: options.requestId };
      calls.push(call);
      const reply = handler(call) ?? { status: 404, body: { name: "RESOURCE_NOT_FOUND" } };
      return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 });
    },
  };
  return { client, calls, callsTo: (fragment: string) => calls.filter((c) => c.path.includes(fragment)) };
}
