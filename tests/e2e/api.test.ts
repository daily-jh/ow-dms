import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type pg from 'pg';
import { createApp } from '@owdms/api';
import { SEED } from '@owdms/db';
import { setupTestDb } from '../integration/helpers';
import { moneyFormInput } from '../../apps/web/lib/money-form';

let app: INestApplication;
let base: string;
let pools: pg.Pool[] = [];
let scenario: Record<string, string>;

beforeAll(async () => {
  const db = await setupTestDb();
  scenario = db.scenario;
  pools = [db.owner, db.app];
  ({ app } = await createApp({
    databaseUrl: db.appUrl, sessionSecret: 'test-secret-test-secret-test-secret!!', devLoginEnabled: true, demoMode: false, requireMfa: false,
    piiKey: Buffer.alloc(32, 7).toString('base64'), port: 0,
  }));
  await app.listen(0);
  const addr = app.getHttpServer().address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(async () => {
  await app?.close();
  for (const p of pools) await p.end();
});

async function login(username: string) {
  const r = await fetch(`${base}/v1/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username }) });
  expect(r.status).toBe(201);
  return ((await r.json()) as { token: string }).token;
}

function api(token: string) {
  return async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json, headers: r.headers };
  };
}

describe('API 수직 기능: 로그인 → 초안 → 승인 → 재고 → 문서', () => {
  it('물품담당 초안·승인요청, 승인권자 승인, 재고·인수증 확인', async () => {
    const goods = api(await login('a.goods'));
    const approver = api(await login('a.approver'));

    const me = await goods('GET', '/v1/auth/me');
    expect(me.json.roleLabels).toEqual(['물품담당']);

    const created = await goods('POST', '/v1/goods-receipts', {
      facilityId: SEED.facilityA, receivedOn: '2026-10-29',
      lines: [{ itemId: SEED.itemRiceA, warehouseId: SEED.warehouseA2, quantity: '20', unit: '포', unitValue: '30000' }],
    }, { 'Idempotency-Key': 'e2e-goods-0001' });
    expect(created.status).toBe(201);
    const receiptId = created.json.id as string;

    const req = await goods('POST', '/v1/approvals', { targetType: 'GOODS_RECEIPT', targetId: receiptId });
    expect(req.status).toBe(201);

    // 본인 승인 시도: 물품담당은 승인 권한 없음
    const selfTry = await goods('POST', `/v1/approvals/${req.json.approvalId}/decide`, { decision: 'APPROVE' });
    expect(selfTry.status).toBe(403);
    expect(selfTry.json).toMatchObject({ code: 'FORBIDDEN' });
    expect(selfTry.json.requestId).toBeTruthy();

    const ok = await approver('POST', `/v1/approvals/${req.json.approvalId}/decide`, { decision: 'APPROVE' });
    expect(ok.json).toEqual({ status: 'APPROVED' });

    const stock = await goods('GET', '/v1/stock');
    const lot = stock.json.find((s: any) => s.receiptId === receiptId);
    expect(lot).toMatchObject({ onHand: '20', reserved: '0', available: '20' });

    const doc = await goods('POST', '/v1/documents', { documentType: 'GOODS_RECEIPT_CERT', sourceId: receiptId });
    expect(doc.json.isDraft).toBe(false);
    const html = await goods('GET', `/v1/documents/${doc.json.id}/html`);
    expect(html.status).toBe(200);
    expect(html.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(String(html.json)).toContain('후원품 인수증');
    expect(String(html.json)).toContain('600,000원');
  });

  it('T01 B기관 토큰으로 A기관 자료 ID 접근 시 404', async () => {
    const b = api(await login('b.goods'));
    const r = await b('GET', `/v1/goods-receipts/${scenario.rice100Receipt}`);
    expect(r.status).toBe(404);
    const stock = await b('GET', '/v1/stock');
    expect(stock.json).toEqual([]);
  });

  it('위조·누락 토큰은 401, 잘못된 입력은 필드 오류 422', async () => {
    const bad = api('x.y');
    expect((await bad('GET', '/v1/dashboard')).status).toBe(401);
    const goods = api(await login('a.goods'));
    const r = await goods('POST', '/v1/goods-receipts', { facilityId: SEED.facilityA, receivedOn: '2026/10/29', lines: [] });
    expect(r.status).toBe(422);
    expect(Object.keys(r.json.fieldErrors)).toEqual(expect.arrayContaining(['receivedOn', 'lines']));
  });

  it('후원금 화면 값으로 초안을 저장하고 필수값 누락·타 기관·권한초과는 거부한다', async () => {
    const staff = api(await login('a.donation'));
    const f = new FormData();
    for (const [k, v] of Object.entries({ facilityId: SEED.facilityA, amount: '100,000', fundId0: SEED.fundGeneralA, fundAmount0: '100,000', receivedOn: '2026-10-30', method: 'BANK_TRANSFER' })) f.set(k, v);
    const { errors, input } = moneyFormInput(f);
    expect(errors).toEqual({});
    const saved = await staff('POST', '/v1/money-receipts', input, { 'Idempotency-Key': 'money-form-regression-0001' });
    expect(saved.status).toBe(201);
    const list = await staff('GET', '/v1/money-receipts');
    expect(list.json.find((r: any) => r.id === saved.json.id)).toMatchObject({ status: 'DRAFT', amount: '100000' });
    expect((await staff('POST', '/v1/money-receipts', { ...input, facilityId: null, fundLines: [] })).status).toBe(422);
    expect((await staff('POST', '/v1/money-receipts', { ...input, facilityId: SEED.facilityB })).status).toBe(404);
    const goods = api(await login('a.goods'));
    expect((await goods('POST', '/v1/money-receipts', input)).status).toBe(403);
    const admin = api(await login('a.admin'));
    expect((await admin('POST', '/v1/settings/presets/yeonmu', { legalEntityId: SEED.legalA, fundKeys: ['GENERAL'], reviewed: false })).status).toBe(422);
    expect((await staff('POST', '/v1/settings/presets/yeonmu', { legalEntityId: SEED.legalA, fundKeys: ['GENERAL'], reviewed: true })).status).toBe(403);
  });

  it('T11 같은 Idempotency-Key 재전송은 같은 결과, 다른 내용은 409', async () => {
    const goods = api(await login('a.goods'));
    const body = { facilityId: SEED.facilityA, receivedOn: '2026-10-29', lines: [{ itemId: SEED.itemWaterA, warehouseId: SEED.warehouseA1, quantity: '6', unit: '병' }] };
    const r1 = await goods('POST', '/v1/goods-receipts', body, { 'Idempotency-Key': 'e2e-idem-0001' });
    const r2 = await goods('POST', '/v1/goods-receipts', body, { 'Idempotency-Key': 'e2e-idem-0001' });
    expect(r2.json.id).toBe(r1.json.id);
    const r3 = await goods('POST', '/v1/goods-receipts', { ...body, memo: 'changed' }, { 'Idempotency-Key': 'e2e-idem-0001' });
    expect(r3.status).toBe(409);
    expect(r3.json.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('T13 희망이음 전송은 비활성(422 CAPABILITY_DISABLED)', async () => {
    const staff = api(await login('a.donation'));
    const caps = await staff('GET', '/v1/integrations/capabilities');
    expect(caps.json.filter((c: any) => c.enabled).map((c: any) => c.mode)).toEqual(['reference']);
    const batch = await staff('POST', '/v1/integration-batches', { operation: 'goodsReceipt', sourceIds: [scenario.rice100Receipt] }, { 'Idempotency-Key': 'e2e-batch-0001' });
    const sub = await staff('POST', `/v1/integration-batches/${batch.json.batchId}/submit`);
    expect(sub.status).toBe(422);
    expect(sub.json.code).toBe('CAPABILITY_DISABLED');
  });

  it('정정 요청 → 승인 → 역거래, 월 마감 점검표·권한', async () => {
    const goods = api(await login('a.goods'));
    const approver = api(await login('a.approver'));
    const created = await goods('POST', '/v1/goods-receipts', {
      facilityId: SEED.facilityA, receivedOn: '2026-10-29',
      lines: [{ itemId: SEED.itemWaterA, warehouseId: SEED.warehouseA2, quantity: '4', unit: '병' }],
    });
    const req = await goods('POST', '/v1/approvals', { targetType: 'GOODS_RECEIPT', targetId: created.json.id });
    await approver('POST', `/v1/approvals/${req.json.approvalId}/decide`, { decision: 'APPROVE' });

    const bad = await goods('POST', '/v1/corrections', { targetType: 'GOODS_RECEIPT', targetId: created.json.id, reason: '', businessDate: '2026-10-29' });
    expect(bad.status).toBe(422);
    const corr = await goods('POST', '/v1/corrections', { targetType: 'GOODS_RECEIPT', targetId: created.json.id, reason: '오입력', businessDate: '2026-10-29' });
    expect(corr.status).toBe(201);
    expect(corr.json.kind).toBe('REVERSAL');
    const ok = await approver('POST', `/v1/approvals/${corr.json.approvalId}/decide`, { decision: 'APPROVE' });
    expect(ok.json).toEqual({ status: 'APPROVED' });
    const after = await goods('GET', `/v1/goods-receipts/${created.json.id}`);
    expect(after.json.status).toBe('REVERSED');

    const checklist = await approver('GET', '/v1/period-closures/2026-10');
    expect(checklist.json.items.map((i: any) => i.code)).toContain('PENDING_APPROVALS');
    expect((await goods('POST', '/v1/period-closures', { period: '2026-10' })).status).toBe(403);
    expect((await approver('GET', '/v1/period-closures/2026-13')).status).toBe(422);
    expect((await goods('GET', '/v1/audit-events')).status).toBe(403);
    const auditor = api(await login('a.auditor'));
    const events = await auditor('GET', '/v1/audit-events?category=LEDGER');
    expect(events.json.some((e: any) => e.action === 'correction.apply.reversal')).toBe(true);
  });
});
