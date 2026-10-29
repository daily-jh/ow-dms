import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * 개발용 서명 세션 토큰(HMAC-SHA256). 운영 인증은 OIDC(Keycloak/기관 IdP)로 대체하며,
 * 어느 경우든 기관·권한은 토큰이 아니라 요청마다 DB 멤버십에서 다시 판정한다.
 */
export interface SessionClaims {
  sub: string; // user id
  tid: string; // 선택한 기관
  exp: number; // epoch seconds
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

export function signSession(claims: SessionClaims, secret: string): string {
  const body = b64(JSON.stringify(claims));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySession(token: string, secret: string, now = Date.now()): SessionClaims | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionClaims;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < now) return null;
    return claims;
  } catch {
    return null;
  }
}
