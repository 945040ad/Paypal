import type { PayPalClient, PayPalFetchOptions } from "./client";

export class PayPalApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    public debugId: string | null,
    what: string,
  ) {
    super(`PayPal ${what} failed: ${status} ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
}

/** Calls PayPal and parses the JSON reply. Throws PayPalApiError on any non-2xx status. */
export async function paypalJson<T = Record<string, unknown>>(client: PayPalClient, path: string, options: PayPalFetchOptions = {}): Promise<T> {
  const res = await client.paypalFetch(path, options);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new PayPalApiError(res.status, body, res.headers.get("paypal-debug-id"), `${options.method ?? "GET"} ${path}`);
  return body as T;
}
