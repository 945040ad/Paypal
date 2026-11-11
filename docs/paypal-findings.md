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

## Phase 1: dispute spike (sandbox, 2026-11-10, all times UTC)

Script: `scripts/dispute-spike.ts`. Full request and response bodies: `data/spike-log.jsonl` (not committed).

### IDs

| | Case A: evidence | Case B: accept claim |
| --- | --- | --- |
| Order | `9WC71710WN442234V` | `5GH134579N421341M` |
| Capture (seller transaction) | `810210159B466410X` | `4MN86938CL2064124` |
| Buyer transaction | `529994032M8365944` | `7CF35599R4790580D` |
| Dispute | `PP-R-QZE-10198059` | `PP-R-IYD-10198060` |
| `custom_id` sent | `spike:b:1794325794414` | `spike:a:1794325779580` |

Seller: `sb-cufup53822799@business.example.com` (merchant `Q8AMAAA47MYEE`). Buyer: `sb-xuzwb53836574@personal.example.com`.

### How the disputes were opened

- **Path 1, Resolution Center: works.** Buyer logs in at sandbox.paypal.com, Activity, the payment, Report a problem,
  "item not received". Reason comes through as `MERCHANDISE_OR_SERVICE_NOT_RECEIVED`, stage `INQUIRY`.
- **Path 2, `POST /v1/customer/disputes`: does not work with merchant credentials.** The endpoint exists and parses a
  multipart `input` part, but:
  - `disputed_transactions[0].buyer_transaction_id` = the capture ID -> 400 `TRANSACTION_NOT_ELIGIBLE`.
  - `seller_transaction_id` instead -> 400 `Buyer Transaction id cannot be blank`.
  The buyer-side transaction ID is a different ID from the capture ID, and we only learn it from the dispute itself.
  Not retried with the real buyer transaction ID or a `PayPal-Auth-Assertion` header.
- Path 3 (chargeback API) not tried.

### Orders

- Create with `payment_source.paypal.experience_context.{return_url,cancel_url}` returns **HTTP 200** (not 201),
  status `PAYER_ACTION_REQUIRED`, approval link rel **`payer-action`**.
- `POST /v2/checkout/orders/{id}/capture` with an empty body and `Prefer: return=representation` returns 201; capture ID
  at `purchase_units[0].payments.captures[0].id`, and `custom_id` is echoed on the capture.

### Dispute behaviour that differs from PLAN.md

1. **HATEOAS rel names use underscores**: `provide_evidence`, `accept_claim`, `send_message`, `make_offer`, `escalate`,
   `provide_supporting_info`. The URL paths use hyphens. Code that checks links must compare against the underscore form.
2. **`custom_id` comes back as `disputed_transactions[0].custom`**, alongside `seller_transaction_id` (our capture ID)
   and `buyer_transaction_id`. This is the ledger lookup key.
3. **Evidence type must be one PayPal requested.** The dispute's `evidences` array lists entries with
   `source: "REQUESTED_FROM_SELLER"`. At the INQUIRY stage only `PROOF_OF_FULFILLMENT` was requested, and sending
   `OTHER` returned 400 `EVIDENCE_TYPE_IS_NOT_ALLOWED`. At the CHARGEBACK (claim) stage `PROOF_OF_FULFILLMENT`,
   `PROOF_OF_REFUND` and `OTHER` were requested, and `OTHER` was accepted.
4. **The list endpoint lags the detail endpoint.** `GET /v1/customer/disputes` showed `UNDER_REVIEW` while
   `GET /v1/customer/disputes/{id}` already showed `WAITING_FOR_SELLER_RESPONSE`. Always act on the detail call.
5. **Filing evidence at INQUIRY does not lead to adjudication.** It moves the dispute to `WAITING_FOR_BUYER_RESPONSE`.
   The seller has to call `escalate` to reach the claim stage.

### Request bodies that worked

`provide-evidence` (multipart/form-data; part `input` is `application/json`, part `evidence-file` is the PDF):

```json
{ "evidences": [ { "evidence_type": "PROOF_OF_FULFILLMENT", "notes": "...",
    "evidence_info": { "tracking_info": [ { "carrier_name": "FEDEX", "tracking_number": "122533485" } ] } } ] }
```

```json
{ "evidences": [ { "evidence_type": "OTHER", "notes": "..." } ] }
```

Both returned 200, and the PDF shows up under that evidence's `documents` as `evidence.pdf`.

`accept-claim` (plain `application/json`, no multipart needed) -> 200:

```json
{ "note": "...", "accept_claim_type": "REFUND" }
```

`escalate` (`application/json`) -> 200:

```json
{ "note": "..." }
```

All POSTs carried a `PayPal-Request-Id`; none was rejected for it.

### Timeline

| Time | Dispute | Event |
| --- | --- | --- |
| 15:51 | both | Payments captured |
| 15:56:05 | A | Buyer opens case |
| 15:57:12 | B | Buyer opens case |
| ~15:59:34 | A | Visible to seller API, `WAITING_FOR_SELLER_RESPONSE`, links include `provide_evidence`, `accept_claim` (about 3.5 min after opening) |
| 16:00:42 | A | `provide-evidence` PROOF_OF_FULFILLMENT -> 200; `UNDER_REVIEW`, then `WAITING_FOR_BUYER_RESPONSE` |
| ~16:02 | B | Visible to seller API (about 5 min after opening) |
| 16:02:59 | B | `accept-claim` REFUND -> 200; `UNDER_REVIEW` |
| 16:03:20 | A | `escalate` -> 200; `UNDER_REVIEW`, stage still `INQUIRY` |
| 16:05:03 | B | **`RESOLVED`, outcome `RESOLVED_BUYER_FAVOUR`** (2 min after accept) |
| 16:06:03 | A | Stage `CHARGEBACK`, `WAITING_FOR_SELLER_RESPONSE`, links `accept_claim`, `provide_evidence` (2.7 min after escalate) |
| ~16:08 | A | `provide-evidence` OTHER -> 200; `UNDER_REVIEW`, links `self`, `provide_supporting_info` |
| ~16:13 | A | `adjudicate` SELLER_FAVOR -> 400 `ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE` (no `adjudicate` link offered) |
| 16:15 to 16:27 | A | `adjudicate` retried 4 more times -> same 400. `require-evidence` -> same 400. `provide-supporting-info` (multipart `input` with `{ "notes": "..." }`) -> 200, no change to status or links |
| ~16:36:02 | A | Links become `accept_claim`, `adjudicate`, `require_evidence`, `provide_supporting_info` (**about 28 min after the claim-stage evidence**) |
| 16:37:21 | A | `adjudicate` `{ "adjudication_outcome": "SELLER_FAVOR" }` (`application/json`) -> 200. Response body is a single link object, not `{ links }` |
| 16:39:43 | A | **`RESOLVED`, outcome `RESOLVED_SELLER_FAVOUR`** (reason `INELIGIBLE_BUYER_PROTECTION_POLICY`), seller hold of 9.19 released (2.4 min after adjudicate) |

Case A took 44 minutes from the buyer opening the case to `RESOLVED`. Case B took 8 minutes.

### More behaviour that differs from PLAN.md

6. **`adjudicate` and `require-evidence` are refused until their link is offered**, even when status is `UNDER_REVIEW`.
   `UNDER_REVIEW` appeared with three different link sets. Decide by the links, never by the status.
7. **The wait for the `adjudicate` link was about 28 minutes**, not "a few minutes". Another entry (Cleared) recorded
   4 to 25 minutes. The demo's Case A must be recorded ahead of time.
8. **A dispute holds the seller's funds** (`fund_movements`: `HOLD_PLACED` 9.19 of the 10.00, released on resolution).
9. **Not tested here, reported by Cleared:** `PayPal-Request-Id` is not an idempotency key on Disputes v1, and a resend
   can create a duplicate entry. Until we test it, dispute writes are never retried automatically.

### What this means for the build

- Dispute desk (Phase 7): pick the evidence type from the dispute's `REQUESTED_FROM_SELLER` entries. For an
  item-not-received inquiry, send `PROOF_OF_FULFILLMENT` with the store's shipment record and the PDF, then `escalate`,
  then send `OTHER` with the mandate PDF at the claim stage.
- Action guard: re-fetch the dispute and require the underscore rel (`provide_evidence`, `accept_claim`, `adjudicate`,
  `escalate`) before every write.
- Ledger lookup: `disputed_transactions[0].custom` holds `mandate_id:intent_id`.
- Opening disputes for the demo is a manual step in the buyer's Resolution Center.
- Unauthorised-transaction disputes were not exercised; only item-not-received.

## Phase 4: payment flow (sandbox, 2026-11-10 UTC)

Command: `npm run purchase -- [productId] [quantity] [--observe] [--new-mandate] [--refund]`.

| Run | Order | Authorization | Capture | Result |
| --- | --- | --- | --- | --- |
| 1. First purchase, buyer approves, vault requested | `5C651359AV1545924` | `8T328425DH833232C` | none | **VOIDED** by the re-check (payee mismatch, see below) |
| 2. Saved PayPal, no buyer present | `5R801904SB554005J` | `6RX26793M3170941N` | `5LJ675062T815071M` | CAPTURED, 29.00 USD |
| 3. Saved PayPal, then full refund | `4FP30572A88777347` | `1KS088664P912844N` | `6YK17107FB711121X` | REFUNDED, refund `4YC29806XT1357503` |

- **The REST app's payee is the sandbox default business account**, `sb-cufup53822799@business.example.com`
  (merchant `Q8AMAAA47MYEE`, "Test Store"), not the separately created `sb-gbef4753787824@business.example.com`.
  Run 1's re-check caught this and voided. `PAYPAL_MERCHANT_EMAIL` must be the account the app is linked to.
- **Vault works.** Creating the order with `payment_source.paypal.attributes.vault`
  (`store_in_vault: ON_SUCCESS`, `usage_type: MERCHANT`, `customer_type: CONSUMER`) and authorizing after buyer approval
  returned `payment_source.paypal.attributes.vault` = `{ id: "39l54937ns878884n", status: "VAULTED", customer: { id } }`
  straight away. No webhook wait was needed.
- **Paying with the vault ID needs nothing else.** `payment_source: { paypal: { vault_id } }` with intent `AUTHORIZE`
  returned the order already holding an authorization; no `/authorize` call, no `stored_credential`, no buyer.
- **Capture idempotency is real on Payments v2.** Repeating `POST /v2/payments/authorizations/{id}/capture` with the
  same `PayPal-Request-Id` returned the same capture ID (`5LJ675062T815071M`), not a second capture.
- `GET /v2/checkout/orders/{id}` returns `purchase_units[0].payee.email_address`, `merchant_id`, `custom_id` and
  `amount` with its breakdown, which is what the re-check compares. The capture echoes `custom_id`.
- Void returned no body; full refund with `{}` returned a refund ID.

## Phase 5: webhooks (sandbox, 2026-11-10 UTC)

- A capture made from a local run (`3NT61042S4762943M`, 9.00 USD) reached the hosted app as
  `PAYMENT.CAPTURE.COMPLETED`, event `WH-4UL20603RY495563E-2P388694EM401541N`, within about 30 seconds.
  `POST /v1/notifications/verify-webhook-signature` returned `SUCCESS` when the body was built from the raw request text.
- The same call with made-up signature headers returns a non-success status, and the route answers 400.
- The hosted database is separate from the local one, so a purchase made locally shows up on the host as
  `UNMATCHED_CAPTURE` (`NO_GATE_DECISION`). That is the intended behaviour for a capture the host never approved.

## Phase 7: dispute desk (sandbox, 2026-11-10 to 11 UTC)

| | Case A: inside the mandate | Case B: agent exceeded the mandate |
| --- | --- | --- |
| Purchase | HDMI cable, 14.00 USD, gate ALLOW (Enforce) | Flagship keyboard, 89.00 USD, gate would BLOCK on `PER_PURCHASE_CAP` (Observe), `VIOLATION` entry |
| Capture | `6D457443W5985701S` | `02M07087YF5997353` |
| Dispute | `PP-R-WSK-10198178` | `PP-R-BQE-10198182` |
| Classifier | `IN_MANDATE` | `VIOLATION` |
| Desk actions | `provide-evidence` PROOF_OF_FULFILLMENT + PDF, `escalate`, `provide-evidence` OTHER + PDF, `adjudicate` SELLER_FAVOR (clicked on /disputes) | `accept-claim` REFUND |
| Outcome | `RESOLVED_SELLER_FAVOUR` | `RESOLVED_BUYER_FAVOUR` |

- Timings for Case A matched Phase 1: claim stage 2.8 min after `escalate`; the `adjudicate` link appeared 28 min after
  the claim-stage evidence (06:54:29 -> 07:22:49); `RESOLVED` 2.5 min after `adjudicate`. Case B resolved 2.3 min after `accept-claim`.
- After the INQUIRY-stage evidence the dispute sat in `WAITING_FOR_BUYER_RESPONSE` and offered `escalate` and `accept_claim`.
- With `adjudicate` offered, PayPal's links were `accept_claim, adjudicate` (the Phase 1 run also listed `require_evidence`).
- `@paypal/agent-toolkit` 1.11.0 ships tools for AI SDK v4 (`parameters`), so `src/ai/paypal-toolkit.ts` adapts them to
  the installed v7 (`inputSchema`). With only `disputes.list/get` and `orders.get` switched on, the toolkit exposes
  exactly `get_dispute`, `list_disputes`, `get_order`; the analyst model called `get_dispute` and `get_order` on the sandbox.
- Gemini free tier: per-minute quota errors are common. Notes drafting falls back across models, then to a fixed template.
