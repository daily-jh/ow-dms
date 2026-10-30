'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import QRCode from 'qrcode';
import { API_BASE, ApiError, MFA_COOKIE, SESSION_COOKIE, api, type ApiErrorBody } from './api';
import { secureCookie } from './cookies';

const s = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' ? v : '';
};

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function message(e: unknown): string {
  if (e instanceof ApiError) {
    const fields = Object.values(e.body.fieldErrors ?? {}).filter((v) => v && v !== e.body.safeMessage);
    return `${e.body.safeMessage}${fields.length ? ` (${fields.join(', ')})` : ''}`;
  }
  throw e;
}

async function publicPost<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: ApiErrorBody }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store',
  });
  const data = await res.json();
  return res.ok ? { ok: true, data: data as T } : { ok: false, error: data as ApiErrorBody };
}

async function startSession(token: string, expiresAt: string) {
  const jar = await cookies();
  jar.delete({ name: MFA_COOKIE, path: '/login' });
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: secureCookie(), path: '/', expires: new Date(expiresAt) });
}

/** 아이디·비밀번호 로그인. OTP 계정이면 중간 토큰을 5분짜리 쿠키에 담아 코드 입력 화면으로 보낸다. */
export async function passwordLogin(form: FormData) {
  const r = await publicPost<{ mfaRequired: boolean; mfaToken?: string; token?: string; expiresAt?: string }>('/v1/auth/login', {
    username: s(form, 'username'), password: s(form, 'password'),
  });
  if (!r.ok) fail('/login', r.error.safeMessage ?? '로그인할 수 없습니다.');
  if (r.data.mfaRequired) {
    (await cookies()).set(MFA_COOKIE, r.data.mfaToken!, { httpOnly: true, sameSite: 'strict', secure: secureCookie(), path: '/login', maxAge: 300 });
    redirect('/login/otp');
  }
  await startSession(r.data.token!, r.data.expiresAt!);
  redirect('/');
}

export async function totpLogin(form: FormData) {
  const mfaToken = (await cookies()).get(MFA_COOKIE)?.value;
  if (!mfaToken) fail('/login', '시간이 지났습니다. 처음부터 다시 로그인하십시오.');
  const r = await publicPost<{ token: string; expiresAt: string }>('/v1/auth/login/totp', { mfaToken, code: s(form, 'code') });
  if (!r.ok) fail('/login/otp', r.error.safeMessage ?? '인증 코드가 올바르지 않습니다.');
  await startSession(r.data.token, r.data.expiresAt);
  redirect('/');
}

export async function changePassword(form: FormData) {
  if (s(form, 'newPassword') !== s(form, 'confirmPassword')) fail('/account', '새 비밀번호 두 칸이 서로 다릅니다.');
  try {
    await api('/v1/auth/password', { method: 'POST', body: { currentPassword: s(form, 'currentPassword'), newPassword: s(form, 'newPassword') } });
  } catch (e) {
    fail('/account', message(e));
  }
  revalidatePath('/', 'layout');
  redirect(`/account?ok=${encodeURIComponent('비밀번호를 바꿨습니다. 다른 기기의 로그인은 모두 끊겼습니다.')}`);
}

export type TotpSetupState = { secret: string; qrSvg: string; uri: string } | { error: string } | null;

/** OTP 등록 시작: 비밀키와 QR을 화면에만 보여 준다(쿠키·주소에 남기지 않음). */
export async function startTotp(_prev: TotpSetupState): Promise<TotpSetupState> {
  try {
    const r = await api<{ secret: string; otpauthUri: string }>('/v1/auth/totp/setup', { method: 'POST' });
    const qrSvg = await QRCode.toString(r.otpauthUri, { type: 'svg', margin: 1, width: 200, errorCorrectionLevel: 'M' });
    return { secret: r.secret, qrSvg, uri: r.otpauthUri };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function enableTotp(form: FormData) {
  try {
    await api('/v1/auth/totp/enable', { method: 'POST', body: { code: s(form, 'code') } });
  } catch (e) {
    fail('/account', message(e));
  }
  revalidatePath('/', 'layout');
  redirect(`/account?ok=${encodeURIComponent('2단계 인증을 켰습니다. 다음 로그인부터 OTP 코드를 입력합니다.')}`);
}

// ───────────── 직원 관리(기관관리자) ─────────────
export type TempPasswordState = { username: string; temporaryPassword: string } | { error: string } | null;

export async function createUser(_prev: TempPasswordState, form: FormData): Promise<TempPasswordState> {
  try {
    const r = await api<{ username: string; temporaryPassword: string }>('/v1/admin/users', {
      method: 'POST', body: { username: s(form, 'username'), displayName: s(form, 'displayName'), roles: form.getAll('roles').map(String) },
    });
    revalidatePath('/admin/users');
    return r;
  } catch (e) {
    return { error: message(e) };
  }
}

export async function resetUserPassword(_prev: TempPasswordState, form: FormData): Promise<TempPasswordState> {
  try {
    const r = await api<{ temporaryPassword: string }>(`/v1/admin/users/${encodeURIComponent(s(form, 'userId'))}/reset-password`, {
      method: 'POST', body: { resetMfa: s(form, 'resetMfa') === 'on' },
    });
    revalidatePath('/admin/users');
    return { username: s(form, 'username'), temporaryPassword: r.temporaryPassword };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function setMembership(form: FormData) {
  try {
    await api(`/v1/admin/users/${encodeURIComponent(s(form, 'userId'))}/membership`, {
      method: 'POST', body: { roles: form.getAll('roles').map(String), revoke: s(form, 'revoke') === 'true' },
    });
  } catch (e) {
    fail('/admin/users', message(e));
  }
  revalidatePath('/admin/users');
  redirect(`/admin/users?ok=${encodeURIComponent('권한을 저장했습니다.')}`);
}
