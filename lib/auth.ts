import jwt from 'jsonwebtoken';

const CLIENT_SECRET = process.env.BIGCOMMERCE_APP_CLIENT_SECRET!;
const CLIENT_ID = process.env.BIGCOMMERCE_APP_CLIENT_ID!;
const JWT_KEY = process.env.JWT_KEY!;

const SESSION_COOKIE = 'bc_app_session';
const SESSION_TTL_SECONDS = 60 * 60; // 1 hour — matches PAT TTL

export interface SignedPayload {
  aud: string;
  iss: 'bc';
  sub: string; // "stores/{hash}"
  user: { id: number; email: string; locale?: string };
  owner: { id: number; email: string };
  url: string; // path the extension resolved to, e.g. "/orders/207/pay-with-saved"
}

export interface AppSession {
  storeHash: string;
  userId: number;
  userEmail: string;
}

export function verifySignedPayload(signedPayloadJwt: string): SignedPayload {
  const decoded = jwt.verify(signedPayloadJwt, CLIENT_SECRET, {
    algorithms: ['HS256'],
    audience: CLIENT_ID,
  }) as SignedPayload;
  if (!decoded.sub?.startsWith('stores/')) {
    throw new Error('Invalid signed_payload_jwt: missing stores/{hash} sub');
  }
  return decoded;
}

export function storeHashFromSub(sub: string): string {
  return sub.replace(/^stores\//, '');
}

export function issueSessionCookie(session: AppSession): { name: string; value: string; maxAge: number } {
  const token = jwt.sign(session, JWT_KEY, { algorithm: 'HS256', expiresIn: SESSION_TTL_SECONDS });
  return { name: SESSION_COOKIE, value: token, maxAge: SESSION_TTL_SECONDS };
}

export function readSessionCookie(cookieValue: string | undefined): AppSession | null {
  if (!cookieValue) return null;
  try {
    const decoded = jwt.verify(cookieValue, JWT_KEY, { algorithms: ['HS256'] }) as AppSession & jwt.JwtPayload;
    return { storeHash: decoded.storeHash, userId: decoded.userId, userEmail: decoded.userEmail };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
