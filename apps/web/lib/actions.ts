'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { API_BASE, ApiError, SESSION_COOKIE, api } from './api';

function back(path: string, params: Record<string, string>): never {
  const q = new URLSearchParams(params).toString();
  redirect(`${path}${path.includes('?') ? '&' : '?'}${q}`);
}

async function run(path: string, fn: () => Promise<unknown>, okMessage: string, nextPath = path): Promise<never> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ApiError) {
      const fields = Object.entries(e.body.fieldErrors ?? {}).map(([k, v]) => `${k}: ${v}`).join(', ');
      back(path, { error: `${e.body.safeMessage}${fields ? ` (${fields})` : ''} [${e.body.code}]` });
    }
    throw e;
  }
  revalidatePath('/', 'layout');
  back(nextPath, { ok: okMessage });
}

const s = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};

export async function devLogin(form: FormData) {
  const username = s(form, 'username') ?? '';
  const res = await fetch(`${API_BASE}/v1/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username }),
    cache: 'no-store',
  });
  if (!res.ok) redirect('/login?error=' + encodeURIComponent('로그인할 수 없습니다.'));
  const { token, expiresAt } = (await res.json()) as { token: string; expiresAt: string };
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'strict', secure: secureCookie(), path: '/', expires: new Date(expiresAt),
  });
  redirect('/');
}

/** 운영 빌드는 Secure 쿠키. 내 PC에서 http://localhost로 띄울 때만 COOKIE_SECURE=false로 끈다. */
function secureCookie(): boolean {
  if (process.env.COOKIE_SECURE === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}

export async function createGoodsReceipt(form: FormData) {
  const lines = [0, 1, 2]
    .map((i) => ({
      itemId: s(form, `itemId${i}`), warehouseId: s(form, `warehouseId${i}`), quantity: s(form, `quantity${i}`), unit: s(form, `unit${i}`),
      expiresOn: s(form, `expiresOn${i}`), unitValue: s(form, `unitValue${i}`)?.replaceAll(',', '') ?? null, valuationBasis: s(form, `valuationBasis${i}`),
    }))
    .filter((l) => l.itemId && l.quantity);
  let id = '';
  await run('/goods/new', async () => {
    const r = await api<{ id: string }>('/v1/goods-receipts', {
      method: 'POST', idempotencyKey: s(form, 'idempotencyKey') ?? undefined,
      body: { facilityId: s(form, 'facilityId'), donorId: s(form, 'donorId'), receivedOn: s(form, 'receivedOn'), memo: s(form, 'memo'), lines },
    });
    id = r.id;
  }, '초안을 저장했습니다.', '/goods');
  void id;
}

export async function requestApproval(form: FormData) {
  const targetType = s(form, 'targetType');
  const targetId = s(form, 'targetId');
  const returnTo = s(form, 'returnTo') ?? '/approvals';
  await run(returnTo, () => api('/v1/approvals', { method: 'POST', body: { targetType, targetId } }), '승인을 요청했습니다.');
}

export async function decideApproval(form: FormData) {
  const id = s(form, 'approvalId');
  await run('/approvals', () => api(`/v1/approvals/${id}/decide`, { method: 'POST', body: { decision: s(form, 'decision'), reason: s(form, 'reason') } }),
    s(form, 'decision') === 'APPROVE' ? '승인했습니다. 원장과 재고에 반영되었습니다.' : '반려했습니다.');
}

export async function createDistribution(form: FormData) {
  await run('/stock', () => api('/v1/distributions', {
    method: 'POST', idempotencyKey: s(form, 'idempotencyKey') ?? undefined,
    body: {
      facilityId: s(form, 'facilityId'), programName: s(form, 'programName'), recipientRef: s(form, 'recipientRef'), plannedOn: s(form, 'plannedOn'),
      lines: [{ lotId: s(form, 'lotId'), warehouseId: s(form, 'warehouseId'), quantity: s(form, 'quantity') }],
    },
  }), '배분 초안을 저장했습니다. 배분 목록에서 승인을 요청하십시오.', '/distributions');
}

export async function postDistribution(form: FormData) {
  const id = s(form, 'distributionId');
  await run('/distributions', () => api(`/v1/distributions/${id}/post`, { method: 'POST', idempotencyKey: `post-${id}` }), '출고를 반영했습니다.');
}

export async function generateDocument(form: FormData) {
  const returnTo = s(form, 'returnTo') ?? '/documents';
  let docId = '';
  try {
    const r = await api<{ id: string }>('/v1/documents', { method: 'POST', body: { documentType: s(form, 'documentType'), sourceId: s(form, 'sourceId') } });
    docId = r.id;
  } catch (e) {
    if (e instanceof ApiError) back(returnTo, { error: e.body.safeMessage });
    throw e;
  }
  redirect(`/documents/${docId}`);
}

export async function createMoneyReceipt(form: FormData) {
  const fundLines = [0, 1].map((i) => ({ fundId: s(form, `fundId${i}`), amount: s(form, `fundAmount${i}`)?.replaceAll(',', '') ?? null })).filter((l) => l.fundId && l.amount);
  await run('/money', () => api('/v1/money-receipts', {
    method: 'POST', idempotencyKey: s(form, 'idempotencyKey') ?? undefined,
    body: {
      facilityId: s(form, 'facilityId'), donorId: s(form, 'donorId'), receivedOn: s(form, 'receivedOn'),
      amount: s(form, 'amount')?.replaceAll(',', ''), method: s(form, 'method'), memo: s(form, 'memo'), fundLines,
    },
  }), '후원금 초안을 저장했습니다.');
}

export async function createDonor(form: FormData) {
  await run('/donors', () => api('/v1/donors', {
    method: 'POST', idempotencyKey: s(form, 'idempotencyKey') ?? undefined,
    body: { donorType: s(form, 'donorType'), displayName: s(form, 'displayName'), contact: { phone: s(form, 'phone') ?? undefined } },
  }), '후원자를 등록했습니다. 같은 이름이 있으면 중복 후보를 확인하십시오.');
}

export async function createBatch(form: FormData) {
  const sourceIds = form.getAll('sourceIds').filter((v): v is string => typeof v === 'string');
  await run('/integrations', () => api('/v1/integration-batches', { method: 'POST', idempotencyKey: s(form, 'idempotencyKey') ?? undefined, body: { operation: 'goodsReceipt', sourceIds } }),
    '내부 검토 배치를 만들었습니다.');
}

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

export async function requestCorrection(form: FormData) {
  const returnTo = s(form, 'returnTo') ?? '/approvals';
  await run(returnTo, () => api('/v1/corrections', {
    method: 'POST', idempotencyKey: s(form, 'idempotencyKey') ?? undefined,
    body: {
      targetType: s(form, 'targetType'), targetId: s(form, 'targetId'), reason: s(form, 'reason') ?? '',
      businessDate: s(form, 'businessDate') ?? seoulToday(), inspectionConfirmed: form.get('inspectionConfirmed') === 'on',
    },
  }), '정정을 요청했습니다. 승인권자가 승인하면 역거래로 반영됩니다.');
}

export async function closePeriod(form: FormData) {
  const period = s(form, 'period') ?? '';
  await run(`/closing?period=${period}`, () => api('/v1/period-closures', { method: 'POST', body: { period } }), `${period}을 마감했습니다.`);
}

export async function reopenPeriod(form: FormData) {
  const period = s(form, 'period') ?? '';
  await run(`/closing?period=${period}`, () => api(`/v1/period-closures/${period}/reopen`, { method: 'POST', body: { reason: s(form, 'reason') ?? '' } }),
    `${period}을 재개방했습니다. 정리 후 다시 마감하십시오.`);
}
