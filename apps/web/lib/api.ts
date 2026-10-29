import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:4000';
export const SESSION_COOKIE = 'owdms_session';

export interface ApiErrorBody { code: string; safeMessage: string; fieldErrors: Record<string, string>; requestId: string }

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: ApiErrorBody) {
    super(body.safeMessage);
  }
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** 서버에서만 API를 호출한다. 토큰은 httpOnly 쿠키에만 있고 브라우저 JS에 노출하지 않는다. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  const token = await sessionToken();
  if (!token) redirect('/login');
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  if (res.status === 401) redirect('/login?expired=1');
  const data = (await res.json()) as T | ApiErrorBody;
  if (!res.ok) throw new ApiError(res.status, data as ApiErrorBody);
  return data as T;
}

export async function rawApi(path: string): Promise<Response> {
  const token = await sessionToken();
  if (!token) return new Response('unauthorized', { status: 401 });
  return fetch(`${API_BASE}${path}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
}

export interface Me { userId: string; displayName: string; tenantName: string; roles: string[]; roleLabels: string[]; actions: string[] }

export const can = (me: Me, action: string) => me.actions.includes(action);

/** 권한 없음(403)이면 null. 화면은 권한 안내를 보여 주고, 실제 차단은 API가 한다. */
export async function apiIfAllowed<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return null;
    throw e;
  }
}
