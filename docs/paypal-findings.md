# PayPal findings

What the sandbox and PayPal's docs actually do, where that differs from PLAN.md.

## Phase 0 (docs read 2026-11-10)

- **`PayPal-Request-Id` retention.** PLAN.md says PayPal keeps the key for 6 hours. The REST requests page
  (https://developer.paypal.com/api/rest/requests/) gives an example of retrying "for up to 45 days" and says
  to check each API's reference for support. Not yet measured on the sandbox. Our code stores the key per
  logical action and reuses it, which is correct under either figure.
- **Webhook event names.** All seven names in PLAN.md match PayPal's event list
  (https://developer.paypal.com/api/rest/webhooks/event-names/) exactly.
- **Webhook URLs.** PayPal delivers only to HTTPS on port 443, and an app can hold at most 10 webhooks.
  Registering a URL twice returns `WEBHOOK_URL_ALREADY_EXISTS`; `npm run webhook:setup` handles that by
  looking up the existing ID.
- **`https://docs.paypal.ai/llms.txt`** redirects (301) to `https://developer.paypal.com/docsai/llms.txt`.
