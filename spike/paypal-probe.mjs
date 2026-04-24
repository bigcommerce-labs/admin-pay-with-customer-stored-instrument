#!/usr/bin/env node
// Read-only probe: discover the actual shape of stored PayPal instruments
// returned by BigCommerce, so we can type them correctly in lib/bigcommerce.ts
// and pass the right `instrument.type` string to POST /payments.
//
// This file contains no credentials. Store hash + access token are read at
// runtime from the shared env at ../../.env. Logged output redacts tokens,
// emails, and long id fields via redactDeep().
//
// Usage:
//   node spike/paypal-probe.mjs              # read-only
//   node spike/paypal-probe.mjs --write      # also create an Incomplete test
//                                            # order for customer 16 if none
//                                            # exists in usable status
//   ORDER_ID=<n> node spike/paypal-probe.mjs # probe a specific order

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
    }),
);

const STORE_HASH = env.BIGCOMMERCE_STORE_HASH;
const TOKEN = env.BIGCOMMERCE_STOREFRONT_TOKEN;

if (!STORE_HASH || !TOKEN) {
  console.error('Missing BIGCOMMERCE_STORE_HASH or BIGCOMMERCE_STOREFRONT_TOKEN in shared .env');
  process.exit(1);
}

const BASE = `https://api.bigcommerce.com/stores/${STORE_HASH}`;
const AUTH = { 'X-Auth-Token': TOKEN, Accept: 'application/json', 'Content-Type': 'application/json' };
const CUSTOMER_ID = 16;

async function req(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...AUTH, ...(init.headers || {}) } });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

const WRITE = process.argv.includes('--write');

// Redact PII values but preserve keys + type hints so we can see the full shape.
function redactValue(key, value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    const sensitive = ['token', 'email', 'access_token', 'id'];
    if (sensitive.includes(key) && value.length > 6) return `<string:len=${value.length}>`;
  }
  return value;
}
function redactDeep(obj) {
  return JSON.parse(JSON.stringify(obj, (k, v) => redactValue(k, v)));
}

function summarizeInstrument(i) {
  return {
    type: i.type,
    fields: Object.keys(i).sort(),
    is_default: i.is_default,
    has_email: 'email' in i,
    has_brand: 'brand' in i,
    has_last_4: 'last_4' in i,
  };
}

function hr(label) {
  console.log(`\n${'─'.repeat(6)} ${label} ${'─'.repeat(Math.max(0, 64 - label.length))}`);
}

// Endpoint A: customer-scoped stored instruments (independent of any order).
hr(`A. GET /v3/customers/${CUSTOMER_ID}/stored-instruments`);
const custInstruments = await req(`/v3/customers/${CUSTOMER_ID}/stored-instruments`);
console.log(`  status: ${custInstruments.status}`);
const custList = Array.isArray(custInstruments.data?.data) ? custInstruments.data.data : [];
console.log(`  count:  ${custList.length}`);
custList.forEach((i, idx) => console.log(`   [${idx}]`, summarizeInstrument(i)));
const paypalFromCustomer = custList.filter((i) => String(i.type).toLowerCase().includes('paypal'));
if (paypalFromCustomer.length > 0) {
  console.log('\n  PayPal entries (redacted):');
  console.log(JSON.stringify(redactDeep(paypalFromCustomer), null, 2));
} else {
  console.log('  No PayPal entries found on this endpoint.');
}

// Endpoint B: order-scoped payment methods — the one the app actually reads.
// The /payments/methods response shape is independent of order status, so we
// can probe against any recent order for customer 16. Allow override via
// ORDER_ID=<n> node spike/paypal-probe.mjs.
hr(`B. Find an order for customer ${CUSTOMER_ID}`);
let order = null;
if (process.env.ORDER_ID) {
  const res = await req(`/v2/orders/${process.env.ORDER_ID}`);
  if (res.ok && res.data?.customer_id === CUSTOMER_ID) {
    order = { id: res.data.id, statusId: res.data.status_id, statusLabel: res.data.status };
  } else {
    console.log(`  ORDER_ID=${process.env.ORDER_ID} did not resolve to an order owned by customer ${CUSTOMER_ID}.`);
    process.exit(1);
  }
} else {
  // Prefer incomplete (the only status the app itself accepts), then pending,
  // then fall back to most recent of any status.
  for (const qs of [`?customer_id=${CUSTOMER_ID}&status_id=0&limit=1`, `?customer_id=${CUSTOMER_ID}&status_id=1&limit=1`, `?customer_id=${CUSTOMER_ID}&limit=1&sort=id:desc`]) {
    const res = await req(`/v2/orders${qs}`);
    if (Array.isArray(res.data) && res.data.length > 0) {
      order = { id: res.data[0].id, statusId: res.data[0].status_id, statusLabel: res.data[0].status };
      break;
    }
  }
}

// If no usable incomplete/pending order exists and --write was passed, create
// one (status_id=0, $1 test item) so /payments/methods has something to answer.
if ((!order || (order.statusId !== 0 && order.statusId !== 1)) && WRITE) {
  hr('B-write. Create Incomplete (status_id=0) test order for customer 16');
  const cust = await req(`/v3/customers?id:in=${CUSTOMER_ID}`);
  const customer = cust.data?.data?.[0];
  if (!customer) {
    console.error('  Customer 16 not found; cannot create order.');
    process.exit(1);
  }
  const orderBody = {
    customer_id: CUSTOMER_ID,
    status_id: 0,
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
    products: [{ name: 'PayPal probe item', quantity: 1, price_inc_tax: 1.00, price_ex_tax: 1.00 }],
  };
  const created = await req('/v2/orders', { method: 'POST', body: JSON.stringify(orderBody) });
  console.log(`  status: ${created.status}, order id: ${created.data?.id}`);
  if (!created.ok) {
    console.error('  order creation failed:', created.data);
    process.exit(1);
  }
  order = { id: created.data.id, statusId: created.data.status_id, statusLabel: created.data.status };
}

if (!order) {
  console.log('  No order for customer 16. Pass ORDER_ID=<n> or re-run with --write to create one.');
  process.exit(0);
}
console.log(`  using order ${order.id} (status_id=${order.statusId}, ${order.statusLabel})`);

hr(`C. GET /v3/payments/methods?order_id=${order.id}`);
const methods = await req(`/v3/payments/methods?order_id=${order.id}`);
console.log(`  status: ${methods.status}`);
const methodList = Array.isArray(methods.data?.data) ? methods.data.data : [];
console.log(`  methods: ${methodList.length}`);
methodList.forEach((m) => {
  console.log(`   - id="${m.id}"  name="${m.name}"  type="${m.type}"  instruments=${m.stored_instruments?.length ?? 0}`);
  (m.stored_instruments ?? []).forEach((i, idx) => console.log(`       [${idx}]`, summarizeInstrument(i)));
});

const paypalMethods = methodList.filter((m) =>
  (m.stored_instruments ?? []).some((i) => String(i.type).toLowerCase().includes('paypal')),
);
if (paypalMethods.length > 0) {
  hr('D. Redacted PayPal instruments from /payments/methods');
  for (const m of paypalMethods) {
    console.log(`\n  payment_method_id: "${m.id}"   (pass this as paymentMethodId)`);
    const paypal = (m.stored_instruments ?? []).filter((i) => String(i.type).toLowerCase().includes('paypal'));
    console.log(JSON.stringify(redactDeep(paypal), null, 2));
  }
} else {
  console.log('\n  No PayPal instruments in /payments/methods for this order. If the customer does have a PayPal on file, the saved instrument may not be offered by BC for this order (eg. gateway/currency mismatch).');
}

console.log('\nDone.');
