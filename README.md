THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


# Admin Pay With Customer Stored Instrument — POC



BigCommerce Single-Click app. Adds an App Extension link on the admin Orders page that lets an admin apply payment to an order using one of the customer's stored payment methods.

## What it does

1. Registers an App Extension on the `ORDERS` page (label: **Pay with customer saved payments**) during install.
2. When the admin clicks the extension on an order, the app loads in an iframe.
3. App validates the store session, fetches the order, customer, and available stored instruments via `/v3/payments/methods?order_id=X`.
4. Admin picks a stored card and submits.
5. App requests a Payment Access Token (PAT) and posts to the Payments API.
6. Result (authorized / failed) is shown with a link back to the order in admin.

## Eligibility rules

- Order must be **status_id=0 (Incomplete)**. Payments API rejects other statuses with `409 code 30101`.
- Guest orders (`customer_id=0`) are blocked — no stored instruments.
- Customer must have at least one stored instrument returned by `/v3/payments/methods`.

## What the app does NOT do

- No new-card entry form (admin panel already supports that).
- No CVV collection (stored cards report `verification_value_required: false`).
- No auto-capture — successful process-payment returns an **authorization**. Admin captures in the BC admin panel.

## Local setup

1. **Install deps**
   ```bash
   npm install
   ```

2. **Copy env template**
   ```bash
   cp .env.example .env
   ```
   Fill in:
   - `BIGCOMMERCE_APP_CLIENT_ID` / `BIGCOMMERCE_APP_CLIENT_SECRET` from your Developer Portal app.
   - `APP_URL` — your ngrok HTTPS URL (step 4 below).
   - `JWT_KEY` — `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

3. **Run the app**
   ```bash
   npm run dev
   ```
   Listens on `http://localhost:3000`.

4. **Tunnel to BC** (separate terminal)
   ```bash
   npm run tunnel
   ```
   Copy the `https://<subdomain>.ngrok-free.app` URL into `.env` as `APP_URL`, then restart `npm run dev`.

5. **Register callbacks in Developer Portal**
   In your app's settings on [devtools.bigcommerce.com](https://devtools.bigcommerce.com):
   - Auth callback URL: `${APP_URL}/oauth`
   - Load callback URL: `${APP_URL}/load`
   - Uninstall callback URL: `${APP_URL}/uninstall`
   - Required scopes: `Orders: modify`, `Customers: read-only`, `Stored Payment Instruments: read-only`, `Payments: create`, `App Extensions: modify`

6. **Install on test store**
   From the Developer Portal's "Install" button, or visit your store's App Marketplace → install your app. The install flow hits `/oauth` → exchanges `code` for `access_token` → auto-registers the App Extension → stores credentials in `data/stores.json`.

## Demo walkthrough

1. In the BC admin panel, go to **Orders**.
2. Find an order in **Incomplete** status for a customer with stored cards (e.g. customer 16 on the test store has 4 stored cards across Braintree + Stripe).
   - No incomplete orders? Create one via the V2 Orders API (see `spike/spike.mjs --write`) and set `status_id=0`.
3. Click **Pay with customer saved payments** in the order row menu.
4. App loads: select a card → **Apply payment**.
5. Success message shows the transaction ID. Click **Back to order in admin** to capture in the BC UI.

## Code map

```
app/
  oauth/route.ts                 OAuth install; registers app extension
  load/route.ts                  Validates signed_payload_jwt; issues session cookie
  uninstall/route.ts             Cleans up store record
  api/orders/[id]/route.ts       Aggregates order + customer + stored instruments
  api/orders/[id]/pay/route.ts   PAT + process-payment
  orders/[id]/pay-with-saved/page.tsx   Main UI
lib/
  auth.ts                  JWT verify/issue
  bigcommerce.ts           V3 REST client
  payments.ts              process-payment client (payments.bigcommerce.com)
  appExtension.ts          GraphQL createAppExtension
  db.ts                    stores.json JSON-file persistence
  session.ts               Next.js request-scoped context helper
spike/
  spike.mjs                Read + write spike (create order, inspect shapes)
  status-probe.mjs         Tested status_id requirement for Payments API
  charge.mjs               End-to-end charge validation
  findings.md              Spike output + decisions
```

## Notes

- **Persistence is a JSON file** at `data/stores.json` (gitignored). Swap for SQLite/Firebase if this graduates past POC.
- **Session cookie is an HS256 JWT** signed with `JWT_KEY`. 1-hour TTL, matches PAT TTL.
- **App Extension is registered idempotently** — re-install / re-deploy won't create duplicates.
- **CSP header** in `next.config.mjs` allows `*.mybigcommerce.com` to iframe the app.
