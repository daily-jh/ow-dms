import { afterAll, beforeAll, expect, it } from 'vitest';
import type pg from 'pg';
import { SEED, withTenant, createMoneyReceiptDraft, confirmTransaction, confirmCorrection, listMoneyReceipts,
  todayDashboard, listApprovals, requestApproval, generateDocument, renderStoredDocument, listDocuments,
  createGoodsReceiptDraft, getGoodsReceipt, createDistributionDraft, postDistribution, listStock,
  closePeriod, reopenPeriod, createFacility, confirmPendingCorrection, requestCorrection } from '@owdms/db';
import { A, B, expectCode, setupTestDb } from './helpers';
let owner: pg.Pool, app: pg.Pool;
beforeAll(async () => { ({ owner, app } = await setupTestDb()); });
afterAll(async () => { await app?.end(); await owner?.end(); });
const tx = <T>(fn: (db: pg.PoolClient) => Promise<T>) => withTenant(app, A.donation, fn);
const input = { facilityId: SEED.facilityA, receivedOn: '2026-11-02', amount: '123456', method: 'BANK_TRANSFER' as const,
  fundLines: [{ fundId: SEED.fundGeneralA, amount: '123456' }], sourceChannel: 'HAPPYBEAN' as const,
  projectName: '가상 겨울나기', evidenceRef: 'TEST-001' };
let moneyId: string;
it('후원담당 혼자 저장·확정: 연무 분류 보존, 재확정 중복 방지, 월 집계', async () => {
  moneyId = (await tx(async db => { const r = await createMoneyReceiptDraft(db, A.donation, input); await confirmTransaction(db, A.donation, 'MONEY_RECEIPT', r.id); return r; })).id;
  await tx(db => confirmTransaction(db, A.donation, 'MONEY_RECEIPT', moneyId));
  const rows = await tx(db => listMoneyReceipts(db, A.donation));
  expect(rows.find(r => r.id === moneyId)).toMatchObject({ status: 'APPROVED', sourceChannel: 'HAPPYBEAN', projectName: input.projectName, evidenceRef: input.evidenceRef });
  expect((await tx(db => todayDashboard(db, A.donation, '2026-11-02'))).monthConfirmedIncome).toBe('123456');
  const a = await owner.query('select count(*)::int as n from approvals where target_id=$1', [moneyId]);
  expect(a.rows[0].n).toBe(1);
});
it('관리자·다른 기관·물품 전용 역할은 후원금 확정 불가', async () => {
  for (const ctx of [A.admin, A.goods]) await expectCode(withTenant(app, ctx, db => confirmTransaction(db, ctx, 'MONEY_RECEIPT', moneyId)), 'FORBIDDEN');
  await expectCode(withTenant(app, B.donation, db => confirmTransaction(db, B.donation, 'MONEY_RECEIPT', moneyId)), 'NOT_FOUND');
  await expectCode(withTenant(app, A.goods, db => requestApproval(db, A.goods, 'MONEY_RECEIPT', moneyId)), 'FORBIDDEN');
});
it('금전정보가 대시보드·처리이력·생성문서를 통해 물품 역할에 노출되지 않는다', async () => {
  const d = await withTenant(app, A.goods, db => todayDashboard(db, A.goods, '2026-11-02'));
  expect(d).toMatchObject({ monthConfirmedIncome: null, moneyDrafts: null, unmatchedDeposits: null, pendingApprovals: null });
  const a = await withTenant(app, A.goods, db => listApprovals(db, A.goods));
  expect(a.some(r => r.targetType === 'MONEY_RECEIPT')).toBe(false);
  const doc = await tx(db => generateDocument(db, A.donation, { documentType: 'MONEY_RECEIPT_NOTE', sourceId: moneyId }));
  await expectCode(withTenant(app, A.goods, db => renderStoredDocument(db, A.goods, doc.id)), 'FORBIDDEN');
  await expectCode(withTenant(app, A.goods, db => generateDocument(db, A.goods, { documentType: 'MONEY_RECEIPT_NOTE', sourceId: moneyId })), 'FORBIDDEN');
  expect((await withTenant(app, A.goods, db => listDocuments(db, A.goods))).some(r => r.id === doc.id)).toBe(false);
});
it('잘못된 입력·마감기간 저장은 롤백되고 담당자가 사유를 남겨 재개방한다', async () => {
  const before = await tx(db => listMoneyReceipts(db, A.donation));
  await expectCode(tx(db => createMoneyReceiptDraft(db, A.donation, { ...input, fundLines: [] })), 'ALLOCATION_SUM_MISMATCH');
  expect((await tx(db => listMoneyReceipts(db, A.donation))).length).toBe(before.length);
  await tx(db => closePeriod(db, A.donation, '2026-11'));
  await expectCode(tx(db => createMoneyReceiptDraft(db, A.donation, input)), 'PERIOD_CLOSED');
  await tx(db => reopenPeriod(db, A.donation, '2026-11', '가상 자료 추가 확인'));
});
it('담당자가 직접 취소하고 원본과 사유는 남긴다', async () => {
  await tx(db => confirmCorrection(db, A.donation, { targetType: 'MONEY_RECEIPT', targetId: moneyId, businessDate: '2026-11-03', reason: '가상 입력 오류' }));
  expect((await tx(db => listMoneyReceipts(db, A.donation))).find(r => r.id === moneyId)?.status).toBe('REVERSED');
  expect((await tx(db => todayDashboard(db, A.donation, '2026-11-03'))).monthConfirmedIncome).toBe('0');
  await expectCode(tx(db => confirmCorrection(db, A.donation, { targetType: 'MONEY_RECEIPT', targetId: moneyId, businessDate: '2026-11-03', reason: '중복' })), 'INVALID_STATE_TRANSITION');
});
it('후원담당 혼자 입고·배분확정·출고·검수반품을 처리하며 재고가 일치한다', async () => {
  const g = await tx(db => createGoodsReceiptDraft(db, A.donation, { facilityId: SEED.facilityA, receivedOn: '2026-11-03', lines: [{ itemId: SEED.itemRiceA, warehouseId: SEED.warehouseA2, quantity: '10', unit: '포' }] }));
  await tx(db => confirmTransaction(db, A.donation, 'GOODS_RECEIPT', g.id));
  const lot = (await tx(db => getGoodsReceipt(db, A.donation, g.id))).lines[0]!.lotId!;
  const dist = await tx(db => createDistributionDraft(db, A.donation, { facilityId: SEED.facilityA, programName: '가상 나눔', plannedOn: '2026-11-03', lines: [{ lotId: lot, warehouseId: SEED.warehouseA2, quantity: '3' }] }));
  await tx(db => confirmTransaction(db, A.donation, 'DISTRIBUTION', dist.id));
  await tx(db => postDistribution(db, A.donation, dist.id));
  expect((await tx(db => listStock(db, A.donation))).find(r => r.lotId === lot)?.onHand).toBe('7');
  const correction = { targetType: 'DISTRIBUTION' as const, targetId: dist.id, businessDate: '2026-11-04', reason: '가상 회수' };
  await expectCode(tx(db => confirmCorrection(db, A.donation, correction)), 'VALIDATION_FAILED');
  await tx(db => confirmCorrection(db, A.donation, { ...correction, inspectionConfirmed: true }));
  expect((await tx(db => listStock(db, A.donation))).find(r => r.lotId === lot)?.onHand).toBe('10');
});
it('기존 승인대기·정정대기를 담당자가 마무리할 수 있다', async () => {
  const r = await tx(db => createMoneyReceiptDraft(db, A.donation, input));
  await tx(db => requestApproval(db, A.donation, 'MONEY_RECEIPT', r.id));
  await tx(db => confirmTransaction(db, A.donation, 'MONEY_RECEIPT', r.id));
  const c = await tx(db => requestCorrection(db, A.donation, { targetType: 'MONEY_RECEIPT', targetId: r.id, businessDate: '2026-11-04', reason: '이전 대기 해소' }));
  await expectCode(withTenant(app, A.goods, db => confirmPendingCorrection(db, A.goods, c.approvalId)), 'FORBIDDEN');
  await tx(db => confirmPendingCorrection(db, A.donation, c.approvalId));
});
it('다른 시설의 창고로 입고할 수 없다', async () => {
  const f = await withTenant(app, A.admin, db => createFacility(db, A.admin, { name: '별도 가상시설', legalEntityId: SEED.legalA }));
  await expectCode(tx(db => createGoodsReceiptDraft(db, A.donation, { facilityId: f.id, receivedOn: '2026-11-04', lines: [{ itemId: SEED.itemRiceA, warehouseId: SEED.warehouseA2, quantity: '1', unit: '포' }] })), 'VALIDATION_FAILED');
});
