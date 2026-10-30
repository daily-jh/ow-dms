import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * 서명 토큰(HMAC-SHA256). 세션 토큰은 서버 세션(auth_sessions)을 가리키므로 로그아웃·비밀번호 초기화·권한 회수가
 * 즉시 반영된다. 기관·권한은 토큰이 아니라 요청마다 DB 멤버십에서 다시 판정한다.
 * typ='mfa'는 비밀번호 확인 후 OTP 입력까지 5분간만 쓰는 중간 토큰으로, 업무 API에는 쓸 수 없다.
 */
export interface SessionClaims {
  typ: 'session' | 'mfa';
  sid?: string; // 서버 세션 id (typ=session)
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
    if (claims.typ !== 'session' && claims.typ !== 'mfa') return null;
    return claims;
  } catch {
    return null;
  }
}
