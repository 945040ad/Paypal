/** Unit tests only: an in-memory stand-in for the PayPal calls the purchase flow makes. Never used by the app. */
import type { PayPalClient, PayPalFetchOptions } from "../paypal/client";

type Json = Record<string, unknown>;
type Call = { method: string; path: string; requestId?: string; body: Json | null };

export function fakePayPal(opts: { payeeEmail: string }) {
  const calls: Call[] = [];
  const orders = new Map<string, Json>();
  const byRequestId = new Map<string, { status: number; body: Json | null }>();
  let seq = 0;
  /** Set to make GET order report a different amount than was created. */
  let tamperedAmount: string | undefined;
  /** Set to make the next call to a path containing this text throw a network error once. */
  let failOnce: string | undefined;
  /** Whether authorizing returns a vault ID for the buyer's saved PayPal. */
  let vaultOnAuthorize = true;

  const authorization = (orderId: string) => ({ id: `AUTH-${orderId}`, status: "CREATED" });

  function handle(method: string, path: string, body: Json | null): { status: number; body: Json | null } {
    if (method === "POST" && path === "/v2/checkout/orders") {
      const id = `ORDER${++seq}`;
      const unit = (body!.purchase_units as Json[])[0];
      const paypal = ((body!.payment_source as Json)?.paypal ?? {}) as Json;
      const order: Json = {
        id,
        intent: body!.intent,
        purchase_units: [{ ...unit, payee: { email_address: opts.payeeEmail } }],
      };
      if (paypal.vault_id) {
        order.status = "COMPLETED";
        (order.purchase_units as Json[])[0].payments = { authorizations: [authorization(id)] };
      } else {
        order.status = "PAYER_ACTION_REQUIRED";
        order.links = [{ rel: "payer-action", href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}`, method: "GET" }];
      }
      orders.set(id, order);
      return { status: paypal.vault_id ? 201 : 200, body: order };
    }
    const authorize = path.match(/^\/v2\/checkout\/orders\/([^/]+)\/authorize$/);
    if (method === "POST" && authorize) {
      const order = orders.get(authorize[1])!;
      order.status = "COMPLETED";
      (order.purchase_units as Json[])[0].payments = { authorizations: [authorization(authorize[1])] };
      if (vaultOnAuthorize) {
        order.payment_source = { paypal: { attributes: { vault: { id: "VAULT1", status: "VAULTED", customer: { id: "CUST1" } } } } };
      }
      return { status: 201, body: order };
    }
    const get = path.match(/^\/v2\/checkout\/orders\/([^/]+)$/);
    if (method === "GET" && get) {
      const order = structuredClone(orders.get(get[1])!);
      if (tamperedAmount) ((order.purchase_units as Json[])[0].amount as Json).value = tamperedAmount;
      return { status: 200, body: order };
    }
    const capture = path.match(/^\/v2\/payments\/authorizations\/([^/]+)\/capture$/);
    if (method === "POST" && capture) {
      return { status: 201, body: { id: `CAP${++seq}`, status: "COMPLETED", amount: { currency_code: "USD", value: "0.00" } } };
    }
    if (method === "POST" && /^\/v2\/payments\/authorizations\/[^/]+\/void$/.test(path)) return { status: 204, body: null };
    if (method === "POST" && /^\/v2\/payments\/captures\/[^/]+\/refund$/.test(path)) {
      return { status: 201, body: { id: `REF${++seq}`, status: "COMPLETED" } };
    }
    return { status: 404, body: { name: "RESOURCE_NOT_FOUND" } };
  }

  const client: PayPalClient = {
    async getAccessToken() {
      return { accessToken: "fake", expiresAt: Number.MAX_SAFE_INTEGER };
    },
    async paypalFetch(path: string, options: PayPalFetchOptions = {}) {
      const method = options.method ?? "GET";
      if (method === "POST" && !options.requestId) throw new Error("fake PayPal: POST without requestId");
      if (failOnce && path.includes(failOnce)) {
        failOnce = undefined;
        throw new TypeError("fetch failed");
      }
      const body = (typeof options.body === "string" ? (options.body ? JSON.parse(options.body) : null) : (options.body ?? null)) as Json | null;
      calls.push({ method, path, requestId: options.requestId, body });
      // Like PayPal: a POST repeated with the same PayPal-Request-Id returns the first result.
      const key = options.requestId && `${path}|${options.requestId}`;
      const result = (key && byRequestId.get(key)) || handle(method, path, body);
      if (key) byRequestId.set(key, result);
      return new Response(result.body === null ? null : JSON.stringify(result.body), { status: result.status });
    },
  };

  return {
    client,
    calls,
    callsTo: (fragment: string) => calls.filter((c) => c.path.includes(fragment)),
    /** Distinct results PayPal produced for a path, i.e. how many captures really exist. */
    distinctResults: (fragment: string) => new Set([...byRequestId.entries()].filter(([k]) => k.includes(fragment)).map(([, v]) => v.body?.id)).size,
    tamperAmount: (value: string) => (tamperedAmount = value),
    failNext: (fragment: string) => (failOnce = fragment),
    noVault: () => (vaultOnAuthorize = false),
  };
}
