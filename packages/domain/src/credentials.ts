import { createHmac, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { DomainError } from './errors';

/** 비밀번호 저장: scrypt(N=2^15, r=8, p=1). 형식 scrypt$N$r$p$salt$hash (base64url) */
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  const opts: ScryptOptions = { N: n, r, p, maxmem: MAXMEM };
  return new Promise((resolve, reject) => scryptCb(password.normalize('NFKC'), salt, KEYLEN, opts, (e, k) => (e ? reject(e) : resolve(k))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const got = await scrypt(password, Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p));
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** 없는 아이디도 같은 시간이 걸리게 하는 비교용 해시(로그인 시 계정 존재 여부 노출 방지). */
export const DUMMY_PASSWORD_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const COMMON = new Set(['password', 'password1', '12345678', '123456789', '1234567890', 'qwerty123', 'qwertyuiop', '1q2w3e4r', '1q2w3e4r5t', 'abcd1234', 'iloveyou']);

/** 길이 중심 정책(10~128자) + 흔한 비밀번호·아이디 포함·한 글자 반복 금지. 실패 시 이유를 돌려준다. */
export function passwordProblem(password: string, username: string): string | null {
  if (password.length < 10) return '10자 이상으로 정하십시오.';
  if (password.length > 128) return '128자 이하로 정하십시오.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return '흔히 쓰이는 비밀번호는 쓸 수 없습니다.';
  if (username && lower.includes(username.toLowerCase())) return '아이디가 들어간 비밀번호는 쓸 수 없습니다.';
  if (new Set(password).size < 4) return '서로 다른 글자를 4개 이상 쓰십시오.';
  return null;
}

export function assertPasswordAcceptable(password: string, username: string): void {
  const problem = passwordProblem(password, username);
  if (problem) throw new DomainError('VALIDATION_FAILED', problem, { newPassword: problem });
}

/** 관리자가 직원에게 전달할 임시 비밀번호(헷갈리는 글자 제외, 14자). 첫 로그인 때 바꿔야 한다. */
export function temporaryPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 14; i++) out += chars[randomInt(chars.length)];
  return out;
}

// ───────────── TOTP (RFC 6238: SHA-1, 30초, 6자리) ─────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / 30);
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return bin.toString().padStart(6, '0');
}

/** 앞뒤 1칸(±30초) 허용. 맞으면 사용한 시간칸을 돌려준다(재사용 방지에 쓴다). */
export function verifyTotp(secret: string, code: string, nowMs = Date.now()): number | null {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const now = totpStep(nowMs);
  for (const step of [now, now - 1, now + 1]) {
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(clean))) return step;
  }
  return null;
}

export function totpUri(secret: string, account: string, issuer = 'OW-DMS'): string {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
