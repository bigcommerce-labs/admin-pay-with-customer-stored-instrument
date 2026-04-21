import { NextRequest, NextResponse } from 'next/server';
import { upsertStore } from '@/lib/db';
import { ensureOrdersExtension } from '@/lib/appExtension';
import { publicOrigin } from '@/lib/url';

const CLIENT_ID = process.env.BIGCOMMERCE_APP_CLIENT_ID!;
const CLIENT_SECRET = process.env.BIGCOMMERCE_APP_CLIENT_SECRET!;
const APP_URL = (process.env.APP_URL ?? '').replace(/\/+$/, '');
const LABEL = process.env.APP_EXTENSION_LABEL ?? 'Pay with customer saved payments';
const EXTENSION_URL = '/orders/${id}/pay-with-saved';

function resolveRedirectUri(req: NextRequest): { envBased: string; requestBased: string } {
  return {
    envBased: `${APP_URL}/oauth`,
    requestBased: `${publicOrigin(req)}${req.nextUrl.pathname}`,
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const code = params.get('code');
  const scope = params.get('scope');
  const context = params.get('context');
  if (!code || !scope || !context) {
    return NextResponse.json({ error: 'Missing code/scope/context' }, { status: 400 });
  }

  const { envBased, requestBased } = resolveRedirectUri(req);
  const redirectUri = requestBased; // trust the URL BC just called us on
  console.log('[oauth] token exchange', { redirectUri, envBased, match: redirectUri === envBased });

  const tokenRes = await fetch('https://login.bigcommerce.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      scope,
      context,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    return NextResponse.json(
      { error: 'Token exchange failed', detail: body, sentRedirectUri: redirectUri, envBasedWouldHaveBeen: envBased, appUrlEnv: APP_URL },
      { status: 502 }
    );
  }

  const payload = (await tokenRes.json()) as {
    access_token: string;
    scope: string;
    user: { id: number; email: string };
    owner: { id: number; email: string };
    context: string;
  };

  const storeHash = payload.context.replace(/^stores\//, '');

  let registeredExtensionId: string | undefined;
  try {
    registeredExtensionId = await ensureOrdersExtension({
      storeHash,
      accessToken: payload.access_token,
      label: LABEL,
      url: EXTENSION_URL,
      context: 'PANEL',
    });
  } catch (err) {
    console.error('App extension registration failed:', err);
  }

  upsertStore(storeHash, {
    accessToken: payload.access_token,
    scope: payload.scope,
    ownerEmail: payload.owner?.email,
    ownerId: payload.owner?.id,
    registeredExtensionId,
  });

  return NextResponse.redirect(
    `https://store-${storeHash}.mybigcommerce.com/manage/app/${CLIENT_ID}`
  );
}
