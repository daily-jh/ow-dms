import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  SEED, createDistributionDraft, createGoodsReceiptDraft, createMoneyReceiptDraft, decideApproval, generateDocument, getGoodsReceipt,
  listDonors, listGoodsReceipts, listStock, mapPgError, postDistribution, renderStoredDocument, requestApproval, runIdempotent,
  verifyStockLedger, withTenant, PiiCipher, DEV_PII_KEY, createGoodsReceiptBatch, exportGoodsReceiptBatch, submitBatch, capabilities,
  createDonor,
} from '@owdms/db';
import { requestHash } from '@owdms/domain';
import ExcelJS from 'exceljs';
import { A, B, expectCode, setupTestDb } from './helpers';

let owner: pg.Pool;
let app: pg.Pool;
let scenario: Record<string, string>;
const cipher = new PiiCipher(DEV_PII_KEY);

beforeAll(async () => {
  ({ owner, app, scenario } = await setupTestDb());
});
afterAll(async () => {
  await app?.end();
  await owner?.end();
});

/** 승인 요청 → 승인 → (배분이면) 출고 */
async function approve(type: 'GOODS_RECEIPT' | 'DISTRIBUTION' | 'MONEY_RECEIPT', id: string, requester = A.goods) {
  const r = await withTenant(app, requester, (db) => requestApproval(db, requester, type, id));
  await withTenant(app, A.approver, (db) => decideApproval(db, A.approver, r.approvalId, { decision: 'APPROVE' }));
}

async function receiveRice(quantity: string, receivedOn = '2026-10-29') {
  const g = await withTenant(app, A.goods, (db) =>
    createGoodsReceiptDraft(db, A.goods, {
      facilityId: SEED.facilityA, receivedOn,
      lines: [{ itemId: SEED.itemRiceA, warehouseId: SEED.warehouseA1, quantity, unit: '포' }],
    }),
  );
  await approve('GOODS_RECEIPT', g.id);
  const view = await withTenant(app, A.goods, (db) => getGoodsReceipt(db, A.goods, g.id));
  return { receiptId: g.id, lotId: view.lines[0]!.lotId! };
}

async function draftDistribution(lotId: string, quantity: string, program = '가상 사업') {
  return withTenant(app, A.goods, (db) =>
    createDistributionDraft(db, A.goods, {
      facilityId: SEED.facilityA, programName: program, plannedOn: '2026-10-29',
      lines: [{ lotId, warehouseId: SEED.warehouseA1, quantity }],
    }),
  );
}

describe('seed 시나리오', () => {
  it('T06: 쌀 100포 입고 후 30+20+15 배분 → 현재고 35포, 원장=잔고', async () => {
    const stock = await withTenant(app, A.goods, (db) => listStock(db, A.goods));
    expect(stock.find((s) => s.lotId === scenario.rice100Lot)?.onHand).toBe('35');
    expect(await withTenant(app, A.goods, (db) => verifyStockLedger(db))).toEqual([]);
  });
});

describe('22.2 쌀 20포 단일 입력 수직 기능', () => {
  it('승인 → 로트 20포 → 8+7 배분 → 잔량 5포, 인수증·배분명부가 같은 원거래를 가리킴', async () => {
    const { receiptId, lotId } = await receiveRice('20');
    for (const [program, q] of [['가상 사례관리사업', '8'], ['가상 지역사회보호사업', '7']] as const) {
      const d = await draftDistribution(lotId, q, program);
      await approve('DISTRIBUTION', d.id);
      await withTenant(app, A.goods, (db) => postDistribution(db, A.goods, d.id));
      const doc = await withTenant(app, A.goods, (db) => generateDocument(db, A.goods, { documentType: 'DISTRIBUTION_LIST', sourceId: d.id }));
      const rendered = await withTenant(app, A.goods, (db) => renderStoredDocument(db, A.goods, doc.id));
      expect(rendered.html).toContain(receiptId.slice(0, 8));
    }
    const stock = await withTenant(app, A.goods, (db) => listStock(db, A.goods));
    expect(stock.find((s) => s.lotId === lotId)?.onHand).toBe('5');
    // 입고 당시 20포는 덮어쓰지 않는다
    const g = await withTenant(app, A.goods, (db) => getGoodsReceipt(db, A.goods, receiptId));
    expect(g.lines[0]!.quantity).toBe('20');
  });
});

describe('T01 기관 격리', () => {
  it('B기관 사용자는 A기관 후원자·수입·문서를 볼 수 없다', async () => {
    const donors = await withTenant(app, B.donation, (db) => listDonors(db, B.donation, cipher));
    expect(donors.every((d) => d.displayName !== '예시기업-A')).toBe(true);
    const receipts = await withTenant(app, B.goods, (db) => listGoodsReceipts(db, B.goods));
    expect(receipts).toHaveLength(0);
    await expectCode(withTenant(app, B.goods, (db) => getGoodsReceipt(db, B.goods, scenario.rice100Receipt!)), 'NOT_FOUND');
    const doc = await withTenant(app, A.goods, (db) => generateDocument(db, A.goods, { documentType: 'GOODS_RECEIPT_CERT', sourceId: scenario.rice100Receipt! }));
    await expectCode(withTenant(app, B.goods, (db) => renderStoredDocument(db, B.goods, doc.id)), 'NOT_FOUND');
  });
  it('B기관이 A기관 창고·로트를 참조한 거래를 만들 수 없다(복합 FK)', async () => {
    const p = withTenant(app, B.goods, (db) =>
      createDistributionDraft(db, B.goods, {
        facilityId: SEED.facilityB, programName: 'x', plannedOn: '2026-10-29',
        lines: [{ lotId: scenario.rice100Lot!, warehouseId: SEED.warehouseA1, quantity: '1' }],
      }),
    ).catch((e) => { throw mapPgError(e); });
    await expectCode(p, 'NOT_FOUND');
  });
  it('B기관 승인권자가 A기관 승인건 ID로 결정할 수 없다', async () => {
    const g = await withTenant(app, A.goods, (db) =>
      createGoodsReceiptDraft(db, A.goods, { facilityId: SEED.facilityA, receivedOn: '2026-10-29', lines: [{ itemId: SEED.itemWaterA, warehouseId: SEED.warehouseA1, quantity: '1', unit: '병' }] }),
    );
    const r = await withTenant(app, A.goods, (db) => requestApproval(db, A.goods, 'GOODS_RECEIPT', g.id));
    await expectCode(withTenant(app, B.approver, (db) => decideApproval(db, B.approver, r.approvalId, { decision: 'APPROVE' })), 'NOT_FOUND');
  });
  it('기관 컨텍스트 없는 연결은 아무 행도 보지 못한다', async () => {
    const r = await app.query('select count(*)::int as n from donors');
    expect(r.rows[0].n).toBe(0);
  });
});

describe('T19 연결풀 컨텍스트 누출 없음', () => {
  it('같은 연결을 A→B 순서로 재사용해도 이전 기관 컨텍스트가 남지 않는다', async () => {
    const { createPool } = await import('@owdms/db');
    const single = createPool((app as unknown as { options: { connectionString: string } }).options.connectionString, 1);
    try {
      const a = await withTenant(single, A.goods, async (db) => (await db.query('select count(*)::int as n from goods_receipts')).rows[0].n);
      const b = await withTenant(single, B.goods, async (db) => (await db.query('select count(*)::int as n from goods_receipts')).rows[0].n);
      const none = await single.query(`select current_setting('app.tenant_id', true) as t`);
      expect(a).toBeGreaterThan(0);
      expect(b).toBe(0);
      expect(none.rows[0].t ?? '').toBe('');
    } finally {
      await single.end();
    }
  });
});

describe('T07 동시 출고', () => {
  it('잔량 10개 로트에 7개씩 두 배분을 동시에 승인하면 하나만 성공한다', async () => {
    const { lotId } = await receiveRice('10');
    const d1 = await draftDistribution(lotId, '7');
    const d2 = await draftDistribution(lotId, '7');
    const r1 = await withTenant(app, A.goods, (db) => requestApproval(db, A.goods, 'DISTRIBUTION', d1.id));
    const r2 = await withTenant(app, A.goods, (db) => requestApproval(db, A.goods, 'DISTRIBUTION', d2.id));
    const results = await Promise.allSettled([
      withTenant(app, A.approver, (db) => decideApproval(db, A.approver, r1.approvalId, { decision: 'APPROVE' })),
      withTenant(app, A.approver, (db) => decideApproval(db, A.approver, r2.approvalId, { decision: 'APPROVE' })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.code).toBe('INSUFFICIENT_STOCK');
  });
  it('같은 배분을 동시에 두 번 출고해도 원장에는 한 번만 기록된다', async () => {
    const { lotId } = await receiveRice('5');
    const d = await draftDistribution(lotId, '3');
    await approve('DISTRIBUTION', d.id);
    const results = await Promise.all([
      withTenant(app, A.goods, (db) => postDistribution(db, A.goods, d.id)),
      withTenant(app, A.goods, (db) => postDistribution(db, A.goods, d.id)),
    ]);
    expect(results.filter((r) => !r.alreadyPosted)).toHaveLength(1);
    const ledger = await withTenant(app, A.goods, (db) => db.query(`select count(*)::int as n from stock_ledger where ref_id = $1`, [d.id]));
    expect(ledger.rows[0].n).toBe(1);
    const stock = await withTenant(app, A.goods, (db) => listStock(db, A.goods));
    expect(stock.find((s) => s.lotId === lotId)?.onHand).toBe('2');
  });
});

describe('T08 트랜잭션 원자성', () => {
  it('승인 처리 중 실패하면 로트·원장·잔고·outbox 모두 롤백된다', async () => {
    const g = await withTenant(app, A.goods, (db) =>
      createGoodsReceiptDraft(db, A.goods, { facilityId: SEED.facilityA, receivedOn: '2026-10-29', lines: [{ itemId: SEED.itemRiceA, warehouseId: SEED.warehouseA2, quantity: '9', unit: '포' }] }),
    );
    const r = await withTenant(app, A.goods, (db) => requestApproval(db, A.goods, 'GOODS_RECEIPT', g.id));
    await expect(
      withTenant(app, A.approver, async (db) => {
        await decideApproval(db, A.approver, r.approvalId, { decision: 'APPROVE' });
        throw new Error('simulated crash after approval');
      }),
    ).rejects.toThrow('simulated crash');
    const view = await withTenant(app, A.goods, (db) => getGoodsReceipt(db, A.goods, g.id));
    expect(view.status).toBe('PENDING_APPROVAL');
    expect(view.lines[0]!.lotId).toBeNull();
    const outbox = await withTenant(app, A.goods, (db) => db.query(`select count(*)::int as n from outbox where aggregate_id = $1`, [g.id]));
    expect(outbox.rows[0].n).toBe(0);
  });
});

describe('T10 승인 거래 불변·마감', () => {
  it('승인된 수입은 앱 계정으로도 직접 수정할 수 없다', async () => {
    const p = withTenant(app, A.goods, (db) => db.query(`update goods_receipts set memo = 'tamper' where id = $1`, [scenario.rice100Receipt])).catch((e) => {
      throw mapPgError(e);
    });
    await expectCode(p, 'APPROVED_IMMUTABLE');
    const p2 = withTenant(app, A.goods, (db) => db.query(`update goods_receipt_lines set quantity = 1 where receipt_id = $1`, [scenario.rice100Receipt])).catch((e) => {
      throw mapPgError(e);
    });
    await expectCode(p2, 'APPROVED_IMMUTABLE');
  });
  it('재고원장은 UPDATE/DELETE 권한이 없다', async () => {
    const p = withTenant(app, A.goods, (db) => db.query(`delete from stock_ledger`)).catch((e) => { throw mapPgError(e); });
    await expectCode(p, 'FORBIDDEN');
  });
  it('마감된 기간에는 초안을 만들 수 없다', async () => {
    await owner.query(`insert into period_closures (tenant_id, period, closed_by) values ($1, '2026-09', $2)`, [SEED.tenantA, SEED.users.aApprover]);
    await expectCode(
      withTenant(app, A.goods, (db) =>
        createGoodsReceiptDraft(db, A.goods, { facilityId: SEED.facilityA, receivedOn: '2026-09-30', lines: [{ itemId: SEED.itemRiceA, warehouseId: SEED.warehouseA1, quantity: '1', unit: '포' }] }),
      ),
      'PERIOD_CLOSED',
    );
  });
});

describe('T20 권한·자기승인', () => {
  it('요청자 본인은 승인할 수 없다(승인 권한이 있어도)', async () => {
    const both = { ...A.goods, roles: ['GOODS_STAFF', 'APPROVER'] };
    const g = await withTenant(app, both, (db) =>
      createGoodsReceiptDraft(db, both, { facilityId: SEED.facilityA, receivedOn: '2026-10-29', lines: [{ itemId: SEED.itemRiceA, warehouseId: SEED.warehouseA1, quantity: '1', unit: '포' }] }),
    );
    const r = await withTenant(app, both, (db) => requestApproval(db, both, 'GOODS_RECEIPT', g.id));
    await expectCode(withTenant(app, both, (db) => decideApproval(db, both, r.approvalId, { decision: 'APPROVE' })), 'SELF_APPROVAL_FORBIDDEN');
  });
  it('물품담당은 승인 API를 쓸 수 없고 후원자 연락처를 받지 않는다', async () => {
    const pending = await withTenant(app, A.goods, (db) => db.query(`select id from approvals where status = 'PENDING' limit 1`));
    await expectCode(withTenant(app, A.goods, (db) => decideApproval(db, A.goods, pending.rows[0].id, { decision: 'APPROVE' })), 'FORBIDDEN');
    const donorsForGoods = await withTenant(app, A.goods, (db) => listDonors(db, A.goods, cipher));
    expect(donorsForGoods.every((d) => !('maskedPhone' in d))).toBe(true);
    const donorsForStaff = await withTenant(app, A.donation, (db) => listDonors(db, A.donation, cipher));
    expect(donorsForStaff.find((d) => d.displayName === '예시기업-A')?.maskedPhone).toBe('010-****-0001');
  });
});

describe('T02·T04 후원자 후보·기금배분', () => {
  it('동명이인은 후보로만 제시하고 새 후원자를 따로 만든다', async () => {
    const r = await withTenant(app, A.donation, (db) => createDonor(db, A.donation, cipher, { donorType: 'INDIVIDUAL', displayName: '홍길동(가상)' }));
    expect(r.duplicateCandidates.length).toBeGreaterThanOrEqual(2);
    const all = await withTenant(app, A.donation, (db) => listDonors(db, A.donation, cipher, { search: '홍길동' }));
    expect(all.length).toBeGreaterThanOrEqual(3);
  });
  it('기금배분 합계가 수납액과 다르면 초안 저장을 거부한다', async () => {
    await expectCode(
      withTenant(app, A.donation, (db) =>
        createMoneyReceiptDraft(db, A.donation, {
          facilityId: SEED.facilityA, receivedOn: '2026-10-29', amount: '100000', method: 'CASH',
          fundLines: [{ fundId: SEED.fundGeneralA, amount: '60000' }, { fundId: SEED.fundDesignatedA, amount: '50000' }],
        }),
      ),
      'ALLOCATION_SUM_MISMATCH',
    );
  });
});

describe('T11 멱등 요청', () => {
  it('같은 키·같은 내용은 1회 효과, 다른 내용은 충돌', async () => {
    const body = { facilityId: SEED.facilityA, receivedOn: '2026-10-29', lines: [{ itemId: SEED.itemWaterA, warehouseId: SEED.warehouseA1, quantity: '12', unit: '병' }] };
    const hash = requestHash('POST', '/v1/goods-receipts', body);
    const run = () =>
      withTenant(app, A.goods, (db) =>
        runIdempotent(db, A.goods, 'idem-test-1', hash, async () => ({ status: 201, body: await createGoodsReceiptDraft(db, A.goods, body) })),
      );
    const [r1, r2] = await Promise.all([run(), run()]);
    expect(r1.body.id).toBe(r2.body.id);
    expect([r1.replayed, r2.replayed].sort()).toEqual([false, true]);
    const other = requestHash('POST', '/v1/goods-receipts', { ...body, memo: 'x' });
    await expectCode(
      withTenant(app, A.goods, (db) => runIdempotent(db, A.goods, 'idem-test-1', other, async () => ({ status: 201, body: {} }))),
      'IDEMPOTENCY_CONFLICT',
    );
  });
});

describe('T13·T14 희망이음 reference 연계', () => {
  it('내부 검토 Excel만 만들고, 다운로드는 EXPORTED, 전송은 차단', async () => {
    const caps = capabilities(A.donation);
    expect(caps.find((c) => c.mode === 'officialFile' && c.operation === 'goodsReceipt')?.enabled).toBe(false);
    const { batchId } = await withTenant(app, A.donation, (db) =>
      createGoodsReceiptBatch(db, A.donation, { sourceIds: [scenario.rice100Receipt!, scenario.rice20Receipt!], idempotencyKey: 'batch-1' }),
    );
    const again = await withTenant(app, A.donation, (db) =>
      createGoodsReceiptBatch(db, A.donation, { sourceIds: [scenario.rice100Receipt!], idempotencyKey: 'batch-1' }),
    );
    expect(again).toEqual({ batchId, replayed: true });
    const file = await withTenant(app, A.donation, (db) => exportGoodsReceiptBatch(db, A.donation, batchId));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    expect(String(wb.getWorksheet('내부검토')!.getCell('A1').value)).toContain('내부 검토용·희망이음 호환 미검증');
    // 사례집 9개 작성항목 대조표: 품명·수량은 확정 입고 행에서, 코드 항목은 비워 두고 확인 필요로 표시
    const fields = wb.getWorksheet('9항목대조')!;
    expect(String(fields.getCell('A1').value)).toContain('희망이음 원본 양식이 아닙니다');
    const firstRow = fields.getRow(5);
    expect(firstRow.getCell(1).value ?? '').toBe('');
    expect(firstRow.getCell(6).value).toBe('100');
    expect(String(firstRow.getCell(12).value)).toContain('후원품 유형 코드 미선택');
    expect(wb.getWorksheet('코드참고')!.getRow(4).getCell(2).value).toBe('01');
    const states = await withTenant(app, A.donation, (db) => db.query(`select source_id, state from integration_rows where batch_id = $1`, [batchId]));
    const byId = Object.fromEntries(states.rows.map((r) => [r.source_id, r.state]));
    expect(byId[scenario.rice100Receipt!]).toBe('EXPORTED'); // 다운로드 사실만
    expect(byId[scenario.rice20Receipt!]).toBe('NOT_READY'); // 미승인 자료는 준비되지 않음
    await expectCode(withTenant(app, A.donation, (db) => submitBatch(db, A.donation, batchId)), 'CAPABILITY_DISABLED');
  });
});

describe('T23 문서 재출력 고정', () => {
  it('저장된 스냅샷으로 다시 렌더해도 해시가 같고, 초안은 초안 표시가 남는다', async () => {
    const draft = await withTenant(app, A.goods, (db) => generateDocument(db, A.goods, { documentType: 'GOODS_RECEIPT_CERT', sourceId: scenario.rice20Receipt! }));
    expect(draft.isDraft).toBe(true);
    const first = await withTenant(app, A.goods, (db) => renderStoredDocument(db, A.goods, draft.id));
    const second = await withTenant(app, A.goods, (db) => renderStoredDocument(db, A.goods, draft.id));
    expect(first.html).toBe(second.html);
    expect(first.html).toContain('초안');
    expect(first.html).toContain('기부금영수증이 아닙니다');
  });
  it('T22 문서는 HTML을 이스케이프한다', async () => {
    const donor = await withTenant(app, A.donation, (db) => createDonor(db, A.donation, cipher, { donorType: 'GROUP', displayName: '<script>alert(1)</script>' }));
    const g = await withTenant(app, A.goods, (db) =>
      createGoodsReceiptDraft(db, A.goods, { facilityId: SEED.facilityA, donorId: donor.id, receivedOn: '2026-10-29', lines: [{ itemId: SEED.itemRiceA, warehouseId: SEED.warehouseA1, quantity: '1', unit: '포' }] }),
    );
    const doc = await withTenant(app, A.goods, (db) => generateDocument(db, A.goods, { documentType: 'GOODS_RECEIPT_CERT', sourceId: g.id }));
    const { html } = await withTenant(app, A.goods, (db) => renderStoredDocument(db, A.goods, doc.id));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
