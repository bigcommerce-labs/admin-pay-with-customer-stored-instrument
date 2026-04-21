# Spike findings — admin pay-with-stored-instrument POC

Test store (hash + name redacted). Customer 16: Judy Jetson (test account with 4 stored cards across Braintree + Stripe).

## 1. Order status requirement (MOST IMPORTANT)

Payments API **rejects** orders in status_id=1 (Pending):

```
409 Conflict
code: 30101  title: "Order is not in a correct status."
```

This affects both `/v3/payments/methods?order_id=X` **and** `/v3/payments/access_tokens`.

**Fix:** order must be status_id=0 (Incomplete). Updating an existing Pending order to Incomplete via `PUT /v2/orders/{id}` works. Then both endpoints succeed.

**Implication for the app:** the extension can't filter by status, so it will render on every order. The app must (a) check current status_id on load, (b) if the order is in an eligible "unpaid" status but not 0, flip to 0 before calling Payments API, (c) rely on the Payments API to transition the status afterward (or restore on failure).

Open decision for user: which statuses are "eligible" to initiate this flow — {0}, {0,1}, {0,1,7}, etc.?

## 2. `/v3/payments/methods?order_id=X` response shape

```jsonc
{
  "data": [
    {
      "id": "braintree.card",                  // ← payment_method_id for process-payment
      "name": "Braintree",
      "test_mode": true,
      "type": "card",
      "supported_instruments": [
        { "instrument_type": "VISA", "verification_value_required": true },
        { "instrument_type": "STORED_CARD", "verification_value_required": false }
      ],
      "stored_instruments": [
        { "type": "stored_card", "brand": "VISA", "last_4": "1111",
          "expiry_month": 12, "expiry_year": 2029, "token": "...", "is_default": true }
      ]
    },
    // more gateways...
  ],
  "meta": {}
}
```

Two critical pieces:
- `payment_method_id` = the gateway's `id` (`braintree.card`, `stripeupe.card`, ...). We pass this + the instrument's `token` to process-payment.
- `verification_value_required: false` on every gateway's STORED_CARD entry → CVV genuinely isn't needed for stored-card off-session.

## 3. `GET /v3/customers/{id}/stored-instruments` response shape

Raw array at the root (no `data` wrapper). 4 VISA stored cards for customer 16. No PayPal/bank instruments present on this customer on this store. **We'll use `/v3/payments/methods` as the primary source — it has the `payment_method_id` we need anyway.**

## 4. Token in `.env`

`BIGCOMMERCE_STOREFRONT_TOKEN` is misleadingly named — it's actually a Store-level V3 REST access token with scopes covering Orders, Customers, Stored Instruments, Payments Create. Works for the spike. Final app uses the OAuth'd app access token, not this one.

## 5. PAT returns JWT; 1-hour TTL as documented

`POST /v3/payments/access_tokens { order: { id } }` → `201` with `data.id` = JWT. We haven't yet called `POST https://payments.bigcommerce.com/stores/{hash}/payments`; that's gated behind a follow-up `--charge` run per user request, or may be deferred to end-to-end validation via the real app UI.

## 6. Customer 16 stored instruments summary

| Gateway | Count | Sample brand/last4 | Notes |
|---|---|---|---|
| braintree.card | 1 | VISA ****1111 (12/2029) | IIN 411111 = real VISA sandbox test card |
| stripeupe.card | 3 | VISA ****1111 (various expiries) | All IIN 000000 = Stripe test tokens |
| authorizenet.card | 0 | — | gateway configured, no stored card |
| worldpayaccess.card | 0 | — | gateway configured, no stored card |
| braintree.paypal | 0 | — | no stored PayPal |

UI should group by gateway label, or flatten into one list with gateway shown per row. Flat list is simpler for POC.

## 7. Test order used

Order 207 created Apr 20 during spike, customer 16, $1.00. Currently status_id=0 (Incomplete). Reuse for subsequent --charge test, or delete after POC demo.
