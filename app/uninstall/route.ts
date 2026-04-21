import { NextRequest, NextResponse } from 'next/server';
import { verifySignedPayload, storeHashFromSub } from '@/lib/auth';
import { deleteStore } from '@/lib/db';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const signedPayload = req.nextUrl.searchParams.get('signed_payload_jwt');
  if (!signedPayload) return NextResponse.json({ error: 'Missing signed_payload_jwt' }, { status: 400 });

  try {
    const decoded = verifySignedPayload(signedPayload);
    deleteStore(storeHashFromSub(decoded.sub));
  } catch (err) {
    return NextResponse.json({ error: 'Invalid signed_payload_jwt', detail: String(err) }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
