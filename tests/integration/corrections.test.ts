import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  SEED, closePeriod, createDistributionDraft, createGoodsReceiptDraft, createMoneyReceiptDraft, decideApproval, getGoodsReceipt,
  listAuditEvents, listStock, periodChecklist, postDistribution, reopenPeriod, requestApproval, requestCorrection, verifyStockLedger,
  withTenant, actor,
} from '@owdms/db';
import { A, B, expectCode, setupTestDb } from './helpers';

let owner: pg.Pool;
let app: pg.Pool;
let scenario: Record<string, string>;
const auditor = actor(SEED.users.aAuditor, SEED.tenantA, ['AUDITOR']);

beforeAll(async () => {
  ({ owner, app, scenario } = await setupTestDb());
});
afterAll(async () => {
  await app?.end();
  await owner?.end();
});

const TODAY = '2026-10-29';

async function approve(approvalId: string) {
  return withTenant(app, A.approver, (db) => decideApproval(db, A.approver, approvalId, { decision: 'APPROVE' }));
}

async function receive(quantity: string, warehouseId: string = SEED.warehouseA2) {
  const g = await withTenant(app, A.goods, (db) =>
    createGoodsReceiptDraft(db, A.goods, { facilityId: SEED.facilityA, receivedOn: TODAY, lines: [{ itemId: SEED.itemRamenA, warehouseId, quantity, unit: '개' }] }),
  );
  const r = await withTenant(app, A.goods, (db) => requestApproval(db, A.goods, 'GOODS_RECEIPT', g.id));
  await approve(r.approvalId);
  const v = await withTenant(app, A.goods, (db) => getGoodsReceipt(db, A.goods, g.id));
  return { receiptId: g.id, lotId: v.lines[0]!.lotId!, warehouseId };
}

async function distribution(lotId: string, warehouseId: string, quantity: string) {
  const d = await withTenant(app, A.goods, (db) =>
    createDistributionDraft(db, A.goods, { facilityId: SEED.facilityA, programName: '정정 시험', plannedOn: TODAY, lines: [{ lotId, warehouseId, quantity }] }),
  );
  const r = await withTenant(app, A.goods, (db) => requestApproval(db, A.goods, 'DISTRIBUTION', d.id));
  await approve(r.approvalId);
  return d.id;
}

const stockOf = async (lotId: string) =>
  (await withTenant(app, A.goods, (db) => listStock(db, A.goods, { includeEmpty: true }))).find((s) => s.lotId === lotId)!;

describe('후원품 입고 역거래', () => {
  it('움직이지 않은 로트는 정정 승인 시 역거래(REVERSAL_OUT)로 0이 되고 원거래는 보존된다', async () => {
    const { receiptId, lotId } = await receive('12');
    const c = await withTenant(app, A.goods, (db) =>
      requestCorrection(db, A.goods, { targetType: 'GOODS_RECEIPT', targetId: receiptId, reason: '중복 입력(합성)', businessDate: TODAY }),
    );
    expect(c.kind).toBe('REVERSAL');
    // 요청 시점에는 아무것도 바뀌지 않는다
    expect((await stockOf(lotId)).onHand).toBe('12');
    await approve(c.approvalId);
    expect((await stockOf(lotId)).onHand).toBe('0');
    const g = await withTenant(app, A.goods, (db) => getGoodsReceipt(db, A.goods, receiptId));
    expect(g.status).toBe('REVERSED');
    expect(g.lines[0]!.quantity).toBe('12'); // 원 입고 수량은 덮어쓰지 않음
    const ledger = await withTenant(app, A.goods, (db) =>
      db.query(`select movement_type, quantity_delta, reverses_id is not null as linked from stock_ledger where lot_id = $1 order by id`, [lotId]),
    );
    expect(ledger.rows.map((r) => [r.movement_type, r.quantity_delta, r.linked])).toEqual([
      ['RECEIPT', '12.000', false],
      ['REVERSAL_OUT', '-12.000', true],
    ]);
    expect(await withTenant(app, A.goods, (db) => verifyStockLedger(db))).toEqual([]);
  });

  it('이미 배분된 로트의 입고는 역거래를 거부한다', async () => {
    const { receiptId, lotId, warehouseId } = await receive('10');
    await distribution(lotId, warehouseId, '3');
    await expectCode(
      withTenant(app, A.goods, (db) => requestCorrection(db, A.goods, { targetType: 'GOODS_RECEIPT', targetId: receiptId, reason: 'x', businessDate: TODAY })),
      'INVALID_STATE_TRANSITION',
    );
  });

  it('요청자는 자기 정정 요청을 승인할 수 없고, 사유 없는 정정은 거부된다', async () => {
    const { receiptId } = await receive('2');
    const both = { ...A.goods, roles: ['GOODS_STAFF', 'APPROVER'] };
    await expectCode(
      withTenant(app, both, (db) => requestCorrection(db, both, { targetType: 'GOODS_RECEIPT', targetId: receiptId, reason: '  ', businessDate: TODAY })),
      'VALIDATION_FAILED',
    );
    const c = await withTenant(app, both, (db) => requestCorrection(db, both, { targetType: 'GOODS_RECEIPT', targetId: receiptId, reason: '시험', businessDate: TODAY }));
    await expectCode(withTenant(app, both, (db) => decideApproval(db, both, c.approvalId, { decision: 'APPROVE' })), 'SELF_APPROVAL_FORBIDDEN');
  });
});

describe('배분 취소·반품', () => {
  it('출고 전 취소는 예약만 해제한다(원장 변화 없음)', async () => {
    const { lotId, warehouseId } = await receive('10');
    const d = await distribution(lotId, warehouseId, '4');
    expect((await stockOf(lotId)).available).toBe('6');
    const c = await withTenant(app, A.goods, (db) => requestCorrection(db, A.goods, { targetType: 'DISTRIBUTION', targetId: d, reason: '행사 취소', businessDate: TODAY }));
    expect(c.kind).toBe('CANCEL');
    await approve(c.approvalId);
    const s = await stockOf(lotId);
    expect([s.onHand, s.reserved, s.available]).toEqual(['10', '0', '10']);
    await expectCode(withTenant(app, A.goods, (db) => postDistribution(db, A.goods, d)), 'INVALID_STATE_TRANSITION');
  });

  it('출고 후 반품은 회수·상태검사 확인이 있어야 하고 재고를 되돌린다', async () => {
    const { lotId, warehouseId } = await receive('10');
    const d = await distribution(lotId, warehouseId, '7');
    await withTenant(app, A.goods, (db) => postDistribution(db, A.goods, d));
    expect((await stockOf(lotId)).onHand).toBe('3');
    await expectCode(
      withTenant(app, A.goods, (db) => requestCorrection(db, A.goods, { targetType: 'DISTRIBUTION', targetId: d, reason: '반품', businessDate: TODAY })),
      'VALIDATION_FAILED',
    );
    const c = await withTenant(app, A.goods, (db) =>
      requestCorrection(db, A.goods, { targetType: 'DISTRIBUTION', targetId: d, reason: '미사용 반품(합성)', businessDate: TODAY, inspectionConfirmed: true }),
    );
    expect(c.kind).toBe('RETURN');
    await approve(c.approvalId);
    expect((await stockOf(lotId)).onHand).toBe('10');
    expect(await withTenant(app, A.goods, (db) => verifyStockLedger(db))).toEqual([]);
  });
});

describe('T17 계열: 정정과 외부연계', () => {
  it('등록확인된 연계행은 CORRECTION_REQUIRED, 다운로드만 된 행은 NOT_READY로 바뀐다', async () => {
    const m = await withTenant(app, A.donation, (db) =>
      createMoneyReceiptDraft(db, A.donation, { facilityId: SEED.facilityA, receivedOn: TODAY, amount: '50000', method: 'CASH', fundLines: [{ fundId: SEED.fundGeneralA, amount: '50000' }] }),
    );
    const r = await withTenant(app, A.donation, (db) => requestApproval(db, A.donation, 'MONEY_RECEIPT', m.id));
    await approve(r.approvalId);
    // 외부 등록확인 상태를 합성(공식 연계가 없으므로 시험용으로 직접 기록)
    const batch = await owner.query(
      `insert into integration_batches (tenant_id, target_system, operation, mode, idempotency_key, created_by)
       values ($1, 'HOPE_EUM', 'moneyReceipt', 'reference', 'corr-test', $2) returning id`,
      [SEED.tenantA, SEED.users.aDonation],
    );
    await owner.query(
      `insert into integration_rows (tenant_id, batch_id, source_type, source_id, source_version, source_snapshot_hash, state)
       values ($1, $2, 'MONEY_RECEIPT', $3, 1, 'x', 'VERIFIED')`,
      [SEED.tenantA, batch.rows[0].id, m.id],
    );
    const c = await withTenant(app, A.donation, (db) => requestCorrection(db, A.donation, { targetType: 'MONEY_RECEIPT', targetId: m.id, reason: '환불(합성)', businessDate: TODAY }));
    await approve(c.approvalId);
    const row = await owner.query(`select state, issues from integration_rows where source_id = $1`, [m.id]);
    expect(row.rows[0].state).toBe('CORRECTION_REQUIRED');
    expect(row.rows[0].issues[0].code).toBe('SOURCE_CORRECTED');
    const status = await owner.query(`select status from money_receipts where id = $1`, [m.id]);
    expect(status.rows[0].status).toBe('REVERSED');
  });
});

describe('월 마감', () => {
  it('승인 대기가 있으면 마감을 막고, 정리 후 마감하면 그 기간의 신규 거래·정정을 막는다', async () => {
    const draft = await withTenant(app, A.goods, (db) =>
      createGoodsReceiptDraft(db, A.goods, { facilityId: SEED.facilityA, receivedOn: '2026-08-10', lines: [{ itemId: SEED.itemWaterA, warehouseId: SEED.warehouseA1, quantity: '5', unit: '병' }] }),
    );
    const req = await withTenant(app, A.goods, (db) => requestApproval(db, A.goods, 'GOODS_RECEIPT', draft.id));
    const before = await withTenant(app, A.approver, (db) => periodChecklist(db, A.approver, '2026-08'));
    expect(before.canClose).toBe(false);
    await expectCode(withTenant(app, A.approver, (db) => closePeriod(db, A.approver, '2026-08')), 'CLOSE_BLOCKED');

    await approve(req.approvalId);
    const closed = await withTenant(app, A.approver, (db) => closePeriod(db, A.approver, '2026-08'));
    expect(closed.status).toBe('CLOSED');
    await expectCode(withTenant(app, A.approver, (db) => closePeriod(db, A.approver, '2026-08')), 'INVALID_STATE_TRANSITION');

    await expectCode(
      withTenant(app, A.goods, (db) =>
        createGoodsReceiptDraft(db, A.goods, { facilityId: SEED.facilityA, receivedOn: '2026-08-20', lines: [{ itemId: SEED.itemWaterA, warehouseId: SEED.warehouseA1, quantity: '1', unit: '병' }] }),
      ),
      'PERIOD_CLOSED',
    );
    // 마감된 기간 날짜로는 정정할 수 없지만, 열린 기간 날짜로는 역거래할 수 있다
    await expectCode(
      withTenant(app, A.goods, (db) => requestCorrection(db, A.goods, { targetType: 'GOODS_RECEIPT', targetId: draft.id, reason: 'x', businessDate: '2026-08-31' })),
      'PERIOD_CLOSED',
    );
    const c = await withTenant(app, A.goods, (db) => requestCorrection(db, A.goods, { targetType: 'GOODS_RECEIPT', targetId: draft.id, reason: '10월 정정', businessDate: TODAY }));
    expect(c.kind).toBe('REVERSAL');

    // 물품담당은 마감·재개방 권한이 없다
    await expectCode(withTenant(app, A.goods, (db) => reopenPeriod(db, A.goods, '2026-08', 'x')), 'FORBIDDEN');
    await expectCode(withTenant(app, A.approver, (db) => reopenPeriod(db, A.approver, '2026-08', ' ')), 'VALIDATION_FAILED');
    await withTenant(app, A.approver, (db) => reopenPeriod(db, A.approver, '2026-08', '누락 자료 반영(합성)'));
    const after = await withTenant(app, A.approver, (db) => periodChecklist(db, A.approver, '2026-08'));
    expect(after.status).toBe('OPEN');
    expect(after.history).toHaveLength(1);
    expect(after.history[0]!.reopenReason).toBe('누락 자료 반영(합성)');
  });

  it('B기관의 마감은 A기관에 영향을 주지 않는다', async () => {
    await withTenant(app, B.approver, (db) => closePeriod(db, B.approver, '2026-07'));
    const a = await withTenant(app, A.approver, (db) => periodChecklist(db, A.approver, '2026-07'));
    expect(a.status).toBe('OPEN');
  });
});

describe('감사기록 조회', () => {
  it('감사 권한자만 자기 기관 기록을 보고, 조회도 기록된다', async () => {
    const events = await withTenant(app, auditor, (db) => listAuditEvents(db, auditor, { category: 'LEDGER' }));
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.action === 'period.reopen' && e.reason === '누락 자료 반영(합성)')).toBe(true);
    await expectCode(withTenant(app, A.goods, (db) => listAuditEvents(db, A.goods)), 'FORBIDDEN');
    const views = await owner.query(`select count(*)::int as n from audit_events where action = 'audit.view' and tenant_id = $1`, [SEED.tenantA]);
    expect(views.rows[0].n).toBe(1);
    const bAuditView = await owner.query(`select count(*)::int as n from audit_events where tenant_id = $1 and action = 'period.reopen'`, [SEED.tenantB]);
    expect(bAuditView.rows[0].n).toBe(0);
    void scenario;
  });
});
