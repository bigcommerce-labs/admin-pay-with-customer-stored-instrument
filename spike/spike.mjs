#!/usr/bin/env node
// Read-only spike: verify token, inspect customer 16 + stored instruments.
// Write-op spike (create order, request PAT, charge) runs only with --write.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(HERE, '../../.env');

const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const STORE_HASH = env.BIGCOMMERCE_STORE_HASH;
const TOKEN = env.BIGCOMMERCE_STOREFRONT_TOKEN;

if (!STORE_HASH || !TOKEN) {
  console.error('Missing BIGCOMMERCE_STORE_HASH or BIGCOMMERCE_STOREFRONT_TOKEN in .env');
  process.exit(1);
}

const BASE = `https://api.bigcommerce.com/stores/${STORE_HASH}`;
const AUTH = { 'X-Auth-Token': TOKEN, Accept: 'application/json', 'Content-Type': 'application/json' };

const CUSTOMER_ID = 16;
const WRITE = process.argv.includes('--write');

async function req(path, init = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const res = await fetch(url, { ...init, headers: { ...AUTH, ...(init.headers || {}) } });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

function redact(obj) {
  return JSON.parse(JSON.stringify(obj, (k, v) => {
    if (typeof v === 'string' && (k === 'token' || k === 'id' && typeof v === 'string' && v.length > 20)) return `[REDACTED len=${v.length}]`;
    return v;
  }));
}

function hr(label) { console.log(`\n${'─'.repeat(6)} ${label} ${'─'.repeat(Math.max(0, 60 - label.length))}`); }

// Step 1: verify auth
hr('1. Verify token');
const storeInfo = await req('/v2/store');
console.log(`  status: ${storeInfo.status}`);
if (!storeInfo.ok) {
  console.error('  Token does not work for V3 admin APIs. Payload:', storeInfo.data);
  console.error('\n  If this token is a Storefront GraphQL token, we need a Store-level V3 REST token.');
  console.error('  Required scopes for POC: Orders (modify), Customers (read-only), Stored Payment Instruments (read-only), Payments Create.');
  process.exit(1);
}
console.log(`  store name: ${storeInfo.data?.name}`);
console.log(`  admin URL:  ${storeInfo.data?.control_panel_base_url}`);

// Step 2: customer 16
hr('2. Fetch customer 16');
const cust = await req(`/v3/customers?id:in=${CUSTOMER_ID}`);
console.log(`  status: ${cust.status}`);
const customer = cust.data?.data?.[0];
if (!customer) {
  console.error('  Customer 16 not found. Aborting.');
  process.exit(1);
}
console.log(`  ${customer.first_name} ${customer.last_name} <${customer.email}>  id=${customer.id}`);

// Step 3: stored instruments
hr('3. GET /v3/customers/16/stored-instruments');
const instruments = await req(`/v3/customers/${CUSTOMER_ID}/stored-instruments`);
console.log(`  status: ${instruments.status}`);
console.log(`  count:  ${instruments.data?.data?.length ?? 'N/A'}`);
if (Array.isArray(instruments.data?.data)) {
  instruments.data.data.forEach((i, idx) => {
    console.log(`   [${idx}] type=${i.type}  ${i.brand ?? ''} ${i.last_4 ? '****' + i.last_4 : ''} ${i.email ?? ''} default=${i.is_default}`);
    console.log(`        fields: ${Object.keys(i).join(', ')}`);
  });
}
console.log('\n  full response (tokens redacted):');
console.log(JSON.stringify(redact(instruments.data), null, 2));

// Step 4: try /payments/methods against an EXISTING pending order if one exists
hr('4. List pending orders (status_id=1) for customer 16');
const pending = await req(`/v2/orders?customer_id=${CUSTOMER_ID}&status_id=1&limit=5`);
console.log(`  status: ${pending.status}`);
if (Array.isArray(pending.data) && pending.data.length > 0) {
  console.log(`  found ${pending.data.length} existing pending order(s):`);
  pending.data.forEach((o) => console.log(`   - order ${o.id}  total=${o.total_inc_tax}  date=${o.date_created}`));
  const sampleId = pending.data[0].id;

  hr(`5. GET /v3/payments/methods?order_id=${sampleId}`);
  const methods = await req(`/v3/payments/methods?order_id=${sampleId}`);
  console.log(`  status: ${methods.status}`);
  console.log(JSON.stringify(redact(methods.data), null, 2));
} else {
  console.log('  none found. Re-run with --write to create a pending order and continue the spike.');
}

// Step 6 (write): create pending order + request PAT. NO actual charge.
if (WRITE) {
  hr('6. CREATE pending order for customer 16 (WRITE)');
  const orderBody = {
    customer_id: CUSTOMER_ID,
    status_id: 1,
    billing_address: {
      first_name: customer.first_name || 'Test',
      last_name: customer.last_name || 'Customer',
      email: customer.email,
      street_1: '123 Test St',
      city: 'Austin',
      state: 'Texas',
      zip: '78701',
      country: 'United States',
      country_iso2: 'US',
    },
    products: [{ name: 'POC Spike Item', quantity: 1, price_inc_tax: 1.00, price_ex_tax: 1.00 }],
  };
  const created = await req('/v2/orders', { method: 'POST', body: JSON.stringify(orderBody) });
  console.log(`  status: ${created.status}, order id: ${created.data?.id}`);
  if (!created.ok) {
    console.error('  order creation failed:', created.data);
    process.exit(1);
  }
  const orderId = created.data.id;

  hr(`7. GET /v3/payments/methods?order_id=${orderId}`);
  const methods = await req(`/v3/payments/methods?order_id=${orderId}`);
  console.log(`  status: ${methods.status}`);
  console.log(JSON.stringify(redact(methods.data), null, 2));

  hr(`8. POST /v3/payments/access_tokens for order ${orderId}`);
  const pat = await req('/v3/payments/access_tokens', {
    method: 'POST',
    body: JSON.stringify({ order: { id: orderId } }),
  });
  console.log(`  status: ${pat.status}, has token: ${!!pat.data?.data?.id}`);
  console.log('  (token value not printed)');

  console.log(`\n  >> Spike write phase complete. To actually charge, re-run with --charge after picking an instrument + payment_method_id from step 7.`);
}

console.log('\nDone.');
