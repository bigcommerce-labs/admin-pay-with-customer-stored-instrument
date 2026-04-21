#!/usr/bin/env node
// Re-register the ORDERS app extension with PANEL context.
// Reads credentials from data/stores.json (written by /oauth on install).
// Use this if you've already installed the app and need to flip LINK → PANEL
// without a full uninstall/reinstall.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(HERE, '..', 'data', 'stores.json');

const LABEL = 'Pay with customer saved payments';
const EXTENSION_URL = '/orders/${id}/pay-with-saved';
const DESIRED_CONTEXT = 'PANEL';

const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
const entries = Object.entries(db);
if (entries.length === 0) {
  console.error('No installs found in data/stores.json. Install the app first.');
  process.exit(1);
}

const LIST = `query { store { appExtensions { edges { node { id model context url } } } } }`;
const CREATE = `
  mutation Create($input: CreateAppExtensionInput!) {
    appExtension { createAppExtension(input: $input) { appExtension { id context } } }
  }`;
const DELETE = `
  mutation Delete($input: DeleteAppExtensionInput!) {
    appExtension { deleteAppExtension(input: $input) { deletedAppExtensionId } }
  }`;

async function gql(storeHash, token, query, variables) {
  const res = await fetch(`https://api.bigcommerce.com/stores/${storeHash}/graphql`, {
    method: 'POST',
    headers: { 'X-Auth-Token': token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

for (const [storeHash, record] of entries) {
  if (!record.accessToken) continue;
  console.log(`\n── Store ${storeHash} ──`);

  const list = await gql(storeHash, record.accessToken, LIST);
  const existing = list.store.appExtensions.edges.map((e) => e.node).filter((n) => n.model === 'ORDERS');
  console.log(`  existing ORDERS extensions: ${existing.length}`);
  for (const ext of existing) {
    console.log(`   - ${ext.id} context=${ext.context} url=${ext.url}`);
  }

  const match = existing.find((e) => e.url === EXTENSION_URL && e.context === DESIRED_CONTEXT);
  if (match) {
    console.log(`  ✓ already correct (id=${match.id})`);
    continue;
  }

  for (const stale of existing) {
    console.log(`  deleting ${stale.id}...`);
    await gql(storeHash, record.accessToken, DELETE, { input: { id: stale.id } });
  }

  console.log(`  creating PANEL extension...`);
  const created = await gql(storeHash, record.accessToken, CREATE, {
    input: {
      context: DESIRED_CONTEXT,
      model: 'ORDERS',
      url: EXTENSION_URL,
      label: { defaultValue: LABEL, locales: [{ value: LABEL, localeCode: 'en-US' }] },
    },
  });
  console.log(`  ✓ created id=${created.appExtension.createAppExtension.appExtension.id}`);
}

console.log('\nDone.');
