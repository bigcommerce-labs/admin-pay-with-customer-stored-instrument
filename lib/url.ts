import { NextRequest } from 'next/server';

/**
 * Resolve the public origin (scheme + host) the user's browser used to reach us.
 * Behind ngrok/reverse proxies Next.js sees req.url as http://localhost:3000,
 * so we prefer X-Forwarded-Proto / X-Forwarded-Host when present.
 */
export function publicOrigin(req: NextRequest): string {
  const xfProto = req.headers.get('x-forwarded-proto');
  const xfHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (xfProto && xfHost) return `${xfProto}://${xfHost}`;
  return new URL(req.url).origin;
}
