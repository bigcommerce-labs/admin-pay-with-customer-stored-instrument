import { cookies } from 'next/headers';
import { readSessionCookie, SESSION_COOKIE_NAME, AppSession } from './auth';
import { getStore } from './db';
import { BigCommerceClient } from './bigcommerce';

export interface RequestContext {
  session: AppSession;
  client: BigCommerceClient;
}

export async function requireContext(): Promise<RequestContext> {
  const cookieStore = await cookies();
  const cookieVal = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = readSessionCookie(cookieVal);
  if (!session) throw new UnauthorizedError('No valid session cookie');

  const store = getStore(session.storeHash);
  if (!store) throw new UnauthorizedError('Store not installed');

  return {
    session,
    client: new BigCommerceClient(session.storeHash, store.accessToken),
  };
}

export class UnauthorizedError extends Error {}
