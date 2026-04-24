import { Redis } from '@upstash/redis';

export interface StoreRecord {
  accessToken: string;
  scope: string;
  ownerEmail?: string;
  ownerId?: number;
  registeredExtensionId?: string;
}

const redis = Redis.fromEnv();
const key = (storeHash: string) => `store:${storeHash}`;

export async function getStore(storeHash: string): Promise<StoreRecord | null> {
  return redis.get<StoreRecord>(key(storeHash));
}

export async function upsertStore(
  storeHash: string,
  patch: Partial<StoreRecord>,
): Promise<StoreRecord> {
  const existing = (await redis.get<StoreRecord>(key(storeHash))) ?? ({} as StoreRecord);
  const next = { ...existing, ...patch };
  await redis.set(key(storeHash), next);
  return next;
}

export async function deleteStore(storeHash: string): Promise<void> {
  await redis.del(key(storeHash));
}
