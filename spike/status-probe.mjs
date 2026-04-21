#!/usr/bin/env node
// Update order to status_id=0 (Incomplete), then hit /v3/payments/methods + access_tokens.

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
const BASE = `https://api.bigcommerce.com/stores/${env.BIGCOMMERCE_STORE_HASH}`;
const AUTH = { 'X-Auth-Token': env.BIGCOMMERCE_STOREFRONT_TOKEN, Accept: 'application/json', 'Content-Type': 'application/json' };
const ORDER_ID = Number(process.argv[2]) || 207;

async function req(path, init = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const r = await fetch(url, { ...init, headers: { ...AUTH, ...(init.headers || {}) } });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, ok: r.ok, data };
}

function redact(obj) {
  return JSON.parse(JSON.stringify(obj, (k, v) => (typeof v === 'string' && k === 'token' ? '[REDACTED]' : v)));
}

console.log(`── PUT /v2/orders/${ORDER_ID}  status_id=0 (Incomplete) ──`);
const put = await req(`/v2/orders/${ORDER_ID}`, { method: 'PUT', body: JSON.stringify({ status_id: 0 }) });
console.log(`   status: ${put.status}`);
if (!put.ok) { console.log('   payload:', put.data); process.exit(1); }
console.log(`   status_id now: ${put.data?.status_id}  (${put.data?.status})`);

console.log(`\n── GET /v3/payments/methods?order_id=${ORDER_ID} ──`);
const methods = await req(`/v3/payments/methods?order_id=${ORDER_ID}`);
console.log(`   status: ${methods.status}`);
console.log(JSON.stringify(redact(methods.data), null, 2));

console.log(`\n── POST /v3/payments/access_tokens ──`);
const pat = await req('/v3/payments/access_tokens', { method: 'POST', body: JSON.stringify({ order: { id: ORDER_ID } }) });
console.log(`   status: ${pat.status}, has token: ${!!pat.data?.data?.id}`);
if (!pat.ok) console.log('   payload:', pat.data);
