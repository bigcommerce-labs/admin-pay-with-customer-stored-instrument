import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface StoreRecord {
  accessToken: string;
  scope: string;
  ownerEmail?: string;
  ownerId?: number;
  registeredExtensionId?: string;
}

const DB_PATH = resolve(process.cwd(), 'data', 'stores.json');

function load(): Record<string, StoreRecord> {
  if (!existsSync(DB_PATH)) return {};
  return JSON.parse(readFileSync(DB_PATH, 'utf8'));
}

function save(db: Record<string, StoreRecord>): void {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export function getStore(storeHash: string): StoreRecord | undefined {
  return load()[storeHash];
}

export function upsertStore(storeHash: string, patch: Partial<StoreRecord>): StoreRecord {
  const db = load();
  const next = { ...(db[storeHash] ?? {} as StoreRecord), ...patch };
  db[storeHash] = next;
  save(db);
  return next;
}

export function deleteStore(storeHash: string): void {
  const db = load();
  delete db[storeHash];
  save(db);
}
