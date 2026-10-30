import { describe, expect, it } from 'vitest';
import {
  DUMMY_PASSWORD_HASH, base32Decode, base32Encode, hashPassword, passwordProblem, temporaryPassword, totpCode, verifyPassword, verifyTotp,
} from '../src/credentials';

describe('비밀번호', () => {
  it('scrypt로 저장하고 맞는 비밀번호만 통과한다(같은 비밀번호도 저장값은 매번 다름)', async () => {
    const a = await hashPassword('후원관리-합성-비번-01');
    const b = await hashPassword('후원관리-합성-비번-01');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(await verifyPassword('후원관리-합성-비번-01', a)).toBe(true);
    expect(await verifyPassword('후원관리-합성-비번-02', a)).toBe(false);
    expect(await verifyPassword('anything', 'garbage')).toBe(false);
    expect(await verifyPassword('anything', DUMMY_PASSWORD_HASH)).toBe(false);
  });

  it('정책: 길이·흔한 비밀번호·아이디 포함·반복 글자를 거부한다', () => {
    expect(passwordProblem('short1!', 'kim')).toMatch(/10자/);
    expect(passwordProblem('1234567890', 'kim')).toMatch(/흔히/);
    expect(passwordProblem('kimdonation2026', 'KimDonation')).toMatch(/아이디/);
    expect(passwordProblem('aaaaaaaaaaab', 'kim')).toMatch(/4개/);
    expect(passwordProblem('봄날 후원 장부 2026', 'kim')).toBeNull();
  });

  it('임시 비밀번호는 14자이고 정책을 통과한다', () => {
    const t = temporaryPassword();
    expect(t).toHaveLength(14);
    expect(passwordProblem(t, 'someone')).toBeNull();
  });
});

describe('2단계 인증(TOTP)', () => {
  // RFC 6238 부록 B 시험값(SHA-1, 비밀키 "12345678901234567890")
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('base32 왕복', () => {
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
  });

  it('RFC 6238 시험값과 일치한다', () => {
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(secret, Math.floor(1234567890 / 30))).toBe('005924');
  });

  it('앞뒤 30초까지만 허용하고 사용한 시간칸을 돌려준다', () => {
    const now = 1111111109_000;
    const step = Math.floor(now / 30000);
    expect(verifyTotp(secret, totpCode(secret, step), now)).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step - 2), now)).toBeNull();
    expect(verifyTotp(secret, '12345', now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull();
  });
});
