/** Orders v2. Request shapes follow https://developer.paypal.com/docs/api/orders/v2/ and docs/paypal-findings.md. */
import { paypalJson } from "./api";
import type { PayPalClient } from "./client";
import { centsToDecimal } from "./money";

export type OrderItem = { name: string; quantity: number; unit_price_cents: number };

export type CreateOrderInput = {
  requestId: string;
  customId: string;
  description: string;
  currency: string;
  items: OrderItem[];
  shippingCents: number;
  totalCents: number;
  /** How the buyer pays: a saved PayPal (no buyer present), or approval in the browser that also saves their PayPal. */
  payment: { vaultId: string } | { returnUrl: string; cancelUrl: string };
};

export type PayPalOrder = {
  id: string;
  status: string;
  links?: { rel: string; href: string }[];
  payment_source?: { paypal?: { attributes?: { vault?: { id?: string; status?: string; customer?: { id?: string } } } } };
  purchase_units?: {
    custom_id?: string;
    amount?: { currency_code?: string; value?: string };
    payee?: { email_address?: string; merchant_id?: string };
    payments?: { authorizations?: { id: string; status: string }[] };
  }[];
};

export function createOrder(client: PayPalClient, input: CreateOrderInput): Promise<PayPalOrder> {
  const money = (cents: number) => ({ currency_code: input.currency, value: centsToDecimal(cents) });
  const itemTotal = input.items.reduce((sum, i) => sum + i.unit_price_cents * i.quantity, 0);
  const paypal =
    "vaultId" in input.payment
      ? { vault_id: input.payment.vaultId }
      : {
          experience_context: {
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: input.payment.returnUrl,
            cancel_url: input.payment.cancelUrl,
          },
          attributes: { vault: { store_in_vault: "ON_SUCCESS", usage_type: "MERCHANT", customer_type: "CONSUMER" } },
        };
  return paypalJson<PayPalOrder>(client, "/v2/checkout/orders", {
    method: "POST",
    requestId: input.requestId,
    headers: { Prefer: "return=representation" },
    body: {
      intent: "AUTHORIZE",
      payment_source: { paypal },
      purchase_units: [
        {
          custom_id: input.customId,
          description: input.description.slice(0, 127),
          amount: { ...money(input.totalCents), breakdown: { item_total: money(itemTotal), shipping: money(input.shippingCents) } },
          items: input.items.map((i) => ({ name: i.name.slice(0, 127), quantity: String(i.quantity), unit_amount: money(i.unit_price_cents) })),
        },
      ],
    },
  });
}

/** After the buyer approves in PayPal. The reply holds the authorization and, when saved, the vault ID. */
export function authorizeOrder(client: PayPalClient, orderId: string, requestId: string): Promise<PayPalOrder> {
  return paypalJson<PayPalOrder>(client, `/v2/checkout/orders/${orderId}/authorize`, {
    method: "POST",
    requestId,
    headers: { Prefer: "return=representation" },
    body: {},
  });
}

export function getOrder(client: PayPalClient, orderId: string): Promise<PayPalOrder> {
  return paypalJson<PayPalOrder>(client, `/v2/checkout/orders/${orderId}`);
}

export function approvalLink(order: PayPalOrder): string | undefined {
  return order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
}

export function firstAuthorizationId(order: PayPalOrder): string | undefined {
  return order.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
}
