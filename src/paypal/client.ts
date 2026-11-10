/**
 * PayPal REST client. Sandbox only: it refuses to start for any other PAYPAL_ENV.
 */

export const PAYPAL_SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

/** A cached token is replaced once it has less than this long to live. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export type PayPalEnv = Record<string, string | undefined>;

export type AccessToken = {
  accessToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
};

export type PayPalFetchOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Idempotency key. Required on every POST; store it and reuse it on retry. */
  requestId?: string;
  /** An object is sent as JSON. A string, FormData or other BodyInit is sent as is. */
  body?: unknown;
  headers?: Record<string, string>;
};

export type PayPalClient = {
  getAccessToken(): Promise<AccessToken>;
  paypalFetch(path: string, options?: PayPalFetchOptions): Promise<Response>;
};

type ClientDeps = {
  env?: PayPalEnv;
  fetch?: typeof fetch;
  now?: () => number;
};

export function createPayPalClient(deps: ClientDeps = {}): PayPalClient {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;

  if (env.PAYPAL_ENV !== "sandbox") {
    throw new Error(
      `PAYPAL_ENV must be "sandbox" (got ${JSON.stringify(env.PAYPAL_ENV)}). This app never talks to live PayPal.`,
    );
  }
  const clientId = env.PAYPAL_CLIENT_ID;
  const clientSecret = env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set.");
  }

  let cached: AccessToken | undefined;
  let pending: Promise<AccessToken> | undefined;

  async function requestToken(): Promise<AccessToken> {
    const requestedAt = now();
    const res = await fetchImpl(`${PAYPAL_SANDBOX_BASE_URL}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) {
      throw new Error(`PayPal token request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    return { accessToken: json.access_token, expiresAt: requestedAt + json.expires_in * 1000 };
  }

  async function getAccessToken(): Promise<AccessToken> {
    if (cached && cached.expiresAt - now() > TOKEN_EXPIRY_MARGIN_MS) return cached;
    pending ??= requestToken()
      .then((token) => (cached = token))
      .finally(() => (pending = undefined));
    return pending;
  }

  async function paypalFetch(path: string, options: PayPalFetchOptions = {}): Promise<Response> {
    const method = options.method ?? "GET";
    if (!path.startsWith("/")) {
      throw new Error(`PayPal path must start with "/" (got ${JSON.stringify(path)}).`);
    }
    if (method === "POST" && !options.requestId) {
      throw new Error(`POST ${path} needs a PayPal-Request-Id (pass requestId).`);
    }

    const headers = new Headers(options.headers);
    let body: BodyInit | undefined;
    if (isPlainObject(options.body) || Array.isArray(options.body)) {
      body = JSON.stringify(options.body);
      headers.set("Content-Type", "application/json");
    } else if (options.body != null) {
      body = options.body as BodyInit;
      // FormData sets its own multipart Content-Type with the boundary.
      if (typeof body === "string" && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
    }
    if (options.requestId) headers.set("PayPal-Request-Id", options.requestId);

    const { accessToken } = await getAccessToken();
    headers.set("Authorization", `Bearer ${accessToken}`);

    return fetchImpl(`${PAYPAL_SANDBOX_BASE_URL}${path}`, { method, headers, body });
  }

  return { getAccessToken, paypalFetch };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

let defaultClient: PayPalClient | undefined;

/** The process-wide client, built from process.env on first use. */
export function getPayPalClient(): PayPalClient {
  return (defaultClient ??= createPayPalClient());
}
