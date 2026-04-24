import { NextRequest, NextResponse } from 'next/server';
import { verifySignedPayload, storeHashFromSub, issueSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getStore } from '@/lib/db';
import { publicOrigin } from '@/lib/url';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const signedPayload = req.nextUrl.searchParams.get('signed_payload_jwt');
  if (!signedPayload) {
    return NextResponse.json({ error: 'Missing signed_payload_jwt' }, { status: 400 });
  }

  let decoded;
  try {
    decoded = verifySignedPayload(signedPayload);
  } catch (err) {
    return NextResponse.json({ error: 'Invalid signed_payload_jwt', detail: String(err) }, { status: 401 });
  }

  const storeHash = storeHashFromSub(decoded.sub);
  if (!(await getStore(storeHash))) {
    return NextResponse.json({ error: 'App is not installed for this store' }, { status: 403 });
  }

  const destination = decoded.url || '/';
  const res = NextResponse.redirect(new URL(destination, publicOrigin(req)));

  const cookie = issueSessionCookie({
    storeHash,
    userId: decoded.user.id,
    userEmail: decoded.user.email,
  });
  res.cookies.set(SESSION_COOKIE_NAME, cookie.value, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: cookie.maxAge,
    path: '/',
  });
  return res;
}
