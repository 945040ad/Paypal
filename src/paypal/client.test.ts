import { describe, expect, it } from "vitest";
import { createPayPalClient } from "./client";

type Call = { url: string; init: RequestInit };

const ENV = {
  PAYPAL_ENV: "sandbox",
  PAYPAL_CLIENT_ID: "client-id",
  PAYPAL_CLIENT_SECRET: "client-secret",
};

/** A fake PayPal: answers the token endpoint and echoes everything else. */
function fakePayPal(opts: { expiresIn?: number } = {}) {
  const calls: Call[] = [];
  let tokensIssued = 0;
  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/v1/oauth2/token")) {
      tokensIssued += 1;
      return Response.json({
        access_token: `token-${tokensIssued}`,
        token_type: "Bearer",
        expires_in: opts.expiresIn ?? 3600,
      });
    }
    return Response.json({ ok: true });
  };
  return { calls, fetchImpl: fetchImpl as typeof fetch, tokenCalls: () => calls.filter((c) => c.url.endsWith("/v1/oauth2/token")) };
}

function header(call: Call, name: string) {
  return new Headers(call.init.headers).get(name);
}

describe("createPayPalClient", () => {
  it("refuses to start when PAYPAL_ENV is not sandbox", () => {
    const { fetchImpl } = fakePayPal();
    expect(() => createPayPalClient({ env: { ...ENV, PAYPAL_ENV: "live" }, fetch: fetchImpl })).toThrow(/sandbox/);
  });

  it("refuses to start when PAYPAL_ENV is missing", () => {
    const { fetchImpl } = fakePayPal();
    expect(() =>
      createPayPalClient({ env: { PAYPAL_CLIENT_ID: "a", PAYPAL_CLIENT_SECRET: "b" }, fetch: fetchImpl }),
    ).toThrow(/sandbox/);
  });

  it("refuses to start without client credentials", () => {
    const { fetchImpl } = fakePayPal();
    expect(() => createPayPalClient({ env: { PAYPAL_ENV: "sandbox" }, fetch: fetchImpl })).toThrow(
      /PAYPAL_CLIENT_ID/,
    );
  });

  it("requests a token from the sandbox host with basic auth and client_credentials", async () => {
    const pp = fakePayPal();
    const client = createPayPalClient({ env: ENV, fetch: pp.fetchImpl });

    const token = await client.getAccessToken();

    expect(token.accessToken).toBe("token-1");
    const call = pp.tokenCalls()[0];
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect(call.init.method).toBe("POST");
    expect(header(call, "authorization")).toBe(
      `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
    );
    expect(header(call, "content-type")).toBe("application/x-www-form-urlencoded");
    expect(String(call.init.body)).toBe("grant_type=client_credentials");
  });

  it("reports when the token expires", async () => {
    const pp = fakePayPal({ expiresIn: 1000 });
    const client = createPayPalClient({ env: ENV, fetch: pp.fetchImpl, now: () => 5_000_000 });

    const token = await client.getAccessToken();

    expect(token.expiresAt).toBe(5_000_000 + 1000 * 1000);
  });

  it("reuses a cached token until it is close to expiry", async () => {
    const pp = fakePayPal({ expiresIn: 1000 });
    let now = 0;
    const client = createPayPalClient({ env: ENV, fetch: pp.fetchImpl, now: () => now });

    await client.getAccessToken();
    now = 900_000; // 100s left: still usable
    const second = await client.getAccessToken();

    expect(second.accessToken).toBe("token-1");
    expect(pp.tokenCalls()).toHaveLength(1);
  });

  it("fetches a new token once the cached one is within 60s of expiry", async () => {
    const pp = fakePayPal({ expiresIn: 1000 });
    let now = 0;
    const client = createPayPalClient({ env: ENV, fetch: pp.fetchImpl, now: () => now });

    await client.getAccessToken();
    now = 950_000; // 50s left
    const second = await client.getAccessToken();

    expect(second.accessToken).toBe("token-2");
  });

  it("shares one token request between concurrent callers", async () => {
    const pp = fakePayPal();
    const client = createPayPalClient({ env: ENV, fetch: pp.fetchImpl });

    await Promise.all([client.getAccessToken(), client.getAccessToken()]);

    expect(pp.tokenCalls()).toHaveLength(1);
  });

  it("throws with PayPal's error text when the token call fails", async () => {
    const fetchImpl = (async () =>
      Response.json({ error: "invalid_client", error_description: "Client Authentication failed" }, { status: 401 })) as typeof fetch;
    const client = createPayPalClient({ env: ENV, fetch: fetchImpl });

    await expect(client.getAccessToken()).rejects.toThrow(/401[\s\S]*invalid_client/);
  });

  it("sends the bearer token and a JSON body to the sandbox host", async () => {
    const pp = fakePayPal();
    const client = createPayPalClient({ env: ENV, fetch: pp.fetchImpl });

    await client.paypalFetch("/v2/checkout/orders", { method: "POST", requestId: "req-1", body: { intent: "AUTHORIZE" } });

    const call = pp.calls.at(-1)!;
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    expect(header(call, "authorization")).toBe("Bearer token-1");
    expect(header(call, "content-type")).toBe("application/json");
    expect(call.init.body).toBe('{"intent":"AUTHORIZE"}');
  });

  it("sends the caller's PayPal-Request-Id on a POST", async () => {
    const pp = fakePayPal();
    const client = createPayPalClient({ env: ENV, fetch: pp.fetchImpl });

    await client.paypalFetch("/v2/checkout/orders", { method: "POST", requestId: "req-abc", body: {} });

    expect(header(pp.calls.at(-1)!, "paypal-request-id")).toBe("req-abc");
  });

  it("refuses a POST that has no PayPal-Request-Id", async () => {
    const pp = fakePayPal();
    const client = createPayPalClient({ env: ENV, fetch: pp.fetchImpl });

    await expect(client.paypalFetch("/v2/checkout/orders", { method: "POST", body: {} })).rejects.toThrow(
      /PayPal-Request-Id/,
    );
    expect(pp.calls).toHaveLength(0);
  });

  it("does not need a PayPal-Request-Id on a GET", async () => {
    const pp = fakePayPal();
    const client = createPayPalClient({ env: ENV, fetch: pp.fetchImpl });

    const res = await client.paypalFetch("/v2/checkout/orders/123");

    expect(res.status).toBe(200);
    expect(header(pp.calls.at(-1)!, "paypal-request-id")).toBeNull();
  });

  it("passes a string body through byte for byte", async () => {
    const pp = fakePayPal();
    const client = createPayPalClient({ env: ENV, fetch: pp.fetchImpl });
    const raw = '{"b":1,  "a":2}';

    await client.paypalFetch("/v1/notifications/verify-webhook-signature", { method: "POST", requestId: "r", body: raw });

    expect(pp.calls.at(-1)!.init.body).toBe(raw);
  });

  it("rejects a path that would leave the sandbox host", async () => {
    const pp = fakePayPal();
    const client = createPayPalClient({ env: ENV, fetch: pp.fetchImpl });

    await expect(client.paypalFetch("https://api-m.paypal.com/v2/checkout/orders/1")).rejects.toThrow(/path/);
    expect(pp.calls).toHaveLength(0);
  });
});
