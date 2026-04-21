#!/usr/bin/env node
// End-to-end charge: re-fetch methods, pick the Braintree stored card, request PAT, process payment.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(HERE, '../../.env'), 'utf8')
    .split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const STORE_HASH = env.BIGCOMMERCE_STORE_HASH;
const TOKEN = env.BIGCOMMERCE_STOREFRONT_TOKEN;
const ADMIN_BASE = `https://api.bigcommerce.com/stores/${STORE_HASH}`;
const PAYMENTS_BASE = `https://payments.bigcommerce.com/stores/${STORE_HASH}`;
const ADMIN_HEADERS = { 'X-Auth-Token': TOKEN, Accept: 'application/json', 'Content-Type': 'application/json' };

const ORDER_ID = Number(process.argv[2]) || 207;
const GATEWAY = process.argv[3] || 'braintree.card';

async function req(url, init = {}, headers = ADMIN_HEADERS) {
  const r = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, ok: r.ok, data };
}

console.log(`── 1. GET /v3/payments/methods?order_id=${ORDER_ID} ──`);
const methods = await req(`${ADMIN_BASE}/v3/payments/methods?order_id=${ORDER_ID}`);
if (!methods.ok) { console.error('methods failed:', methods.data); process.exit(1); }
const gateway = methods.data.data.find((m) => m.id === GATEWAY);
if (!gateway) { console.error(`gateway ${GATEWAY} not found`); process.exit(1); }
const instrument = gateway.stored_instruments?.[0];
if (!instrument) { console.error(`no stored instrument on ${GATEWAY}`); process.exit(1); }
console.log(`   gateway: ${gateway.id}  instrument: ${instrument.brand} ****${instrument.last_4} exp ${instrument.expiry_month}/${instrument.expiry_year}`);

console.log(`\n── 2. POST /v3/payments/access_tokens ──`);
const pat = await req(`${ADMIN_BASE}/v3/payments/access_tokens`, {
  method: 'POST', body: JSON.stringify({ order: { id: ORDER_ID } }),
});
if (!pat.ok) { console.error('PAT failed:', pat.data); process.exit(1); }
const patToken = pat.data?.data?.id;
console.log(`   got PAT (len=${patToken?.length})`);

console.log(`\n── 3. POST ${PAYMENTS_BASE}/payments ──`);
const body = {
  payment: {
    instrument: { type: 'stored_card', token: instrument.token },
    payment_method_id: gateway.id,
  },
};
console.log('   request body (token redacted):', JSON.stringify({
  ...body, payment: { ...body.payment, instrument: { ...body.payment.instrument, token: '[REDACTED]' } }
}, null, 2));

const pay = await req(`${PAYMENTS_BASE}/payments`, {
  method: 'POST', body: JSON.stringify(body),
}, {
  Authorization: `PAT ${patToken}`,
  Accept: 'application/vnd.bc.v1+json',
  'Content-Type': 'application/json',
});
console.log(`   status: ${pay.status}`);
console.log('   response:', JSON.stringify(pay.data, null, 2));

console.log(`\n── 4. GET /v2/orders/${ORDER_ID} (post-charge status) ──`);
const order = await req(`${ADMIN_BASE}/v2/orders/${ORDER_ID}`);
console.log(`   status_id: ${order.data?.status_id}  status: ${order.data?.status}  payment_status: ${order.data?.payment_status}`);
