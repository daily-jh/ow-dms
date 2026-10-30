import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  PiiCipher, SEED, createDonor, createMoneyReceiptDraft, createPledge, createReceiptFromBank, decideApproval, endPledge,
  importBankStatement, listBankTransactions, listPledges, requestApproval, todayDashboard, withTenant,
} from '@owdms/db';
import type { Grid } from '@owdms/domain';
import { A, B, expectCode, setupTestDb } from './helpers';

// 합성 자료만 사용한다(실제 이름·계좌 아님).
let owner: pg.Pool;
let app: pg.Pool;
const cipher = new PiiCipher(randomBytes(32).toString('base64'));
let donorId: string;
let otherDonorId: string;
let pledgeId: string;

beforeAll(async () => {
  ({ owner, app } = await setupTestDb());
  donorId = (await withTenant(app, A.donation, (db) =>
    createDonor(db, A.donation, cipher, { donorType: 'INDIVIDUAL', displayName: '정기후원(가상)' }))).id;
  otherDonorId = (await withTenant(app, A.donation, (db) =>
    createDonor(db, A.donation, cipher, { donorType: 'INDIVIDUAL', displayName: '다른후원자(가상)' }))).id;
});
afterAll(async () => {
  await app?.end();
  await owner?.end();
});

async function receipt(month: string, amount: string, approve: boolean, donor = donorId, pledge: string | null = pledgeId) {
  const r = await withTenant(app, A.donation, (db) => createMoneyReceiptDraft(db, A.donation, {
    facilityId: SEED.facilityA, donorId: donor, receivedOn: `${month}-15`, amount, method: 'CMS',
    fundLines: [{ fundId: SEED.fundGeneralA, amount }], pledgeId: pledge,
  }));
  if (approve) {
    const a = await withTenant(app, A.donation, (db) => requestApproval(db, A.donation, 'MONEY_RECEIPT', r.id));
    await withTenant(app, A.approver, (db) => decideApproval(db, A.approver, a.approvalId, { decision: 'APPROVE' }));
  }
  return r.id;
}

const list = (current = '2026-10') => withTenant(app, A.donation, (db) => listPledges(db, A.donation, { current, months: 4 }));

describe('정기후원 약정', () => {
  it('약정 등록만으로는 수입이 생기지 않는다', async () => {
    const before = await owner.query(`select count(*)::int as n from money_receipts where tenant_id = $1`, [SEED.tenantA]);
    pledgeId = (await withTenant(app, A.donation, (db) => createPledge(db, A.donation, {
      donorId, fundId: SEED.fundGeneralA, facilityId: SEED.facilityA, amount: '30000', startMonth: '2026-07', method: 'CMS',
    }))).id;
    const after = await owner.query(`select count(*)::int as n from money_receipts where tenant_id = $1`, [SEED.tenantA]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const l = await list();
    expect(l.months).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    expect(l.pledges[0]!.statuses.map((s) => s.status)).toEqual(['UNPAID', 'UNPAID', 'UNPAID', 'UNPAID']);
  });

  it('승인된 수납만 납입으로 센다: 납입·미납·일부·승인 대기(T03)', async () => {
    await receipt('2026-07', '30000', true);
    await receipt('2026-09', '10000', true);
    await receipt('2026-10', '30000', false);
    const p = (await list()).pledges.find((x) => x.id === pledgeId)!;
    expect(p.statuses.map((s) => [s.month, s.status])).toEqual([
      ['2026-07', 'PAID'], ['2026-08', 'UNPAID'], ['2026-09', 'PARTIAL'], ['2026-10', 'PENDING'],
    ]);
    expect(p.unpaidPastMonths).toEqual(['2026-08', '2026-09']);
    expect(p.currentMonthOpen).toBe(false);
    // 오늘의 업무: 지난달까지 미납이 있는 진행 중 약정 1건
    const d = await withTenant(app, A.donation, (db) => todayDashboard(db, A.donation, '2026-10-20'));
    expect(d.pledgesInArrears).toBe(1);
    // 수입은 실제 승인된 40,000원뿐(약정액 120,000원이 아님)
    const s = await owner.query(`select sum(amount)::text as s from money_receipts where pledge_id = $1 and status = 'APPROVED'`, [pledgeId]);
    expect(s.rows[0].s).toBe('40000');
  });

  it('후원자가 다르거나 약정 기간 밖이면 연결할 수 없다', async () => {
    await expectCode(receipt('2026-10', '30000', false, otherDonorId), 'VALIDATION_FAILED');
    await expectCode(receipt('2026-06', '30000', false), 'VALIDATION_FAILED');
    await expectCode(withTenant(app, A.donation, (db) => createMoneyReceiptDraft(db, A.donation, {
      facilityId: SEED.facilityA, donorId: null, receivedOn: '2026-10-15', amount: '30000', method: 'CMS',
      fundLines: [{ fundId: SEED.fundGeneralA, amount: '30000' }], pledgeId,
    })), 'VALIDATION_FAILED');
    // 늦게 낸 8월분: 수납일은 10월이어도 약정 월은 8월로 연결할 수 있다
    const late = await withTenant(app, A.donation, (db) => createMoneyReceiptDraft(db, A.donation, {
      facilityId: SEED.facilityA, donorId, receivedOn: '2026-10-16', amount: '30000', method: 'BANK_TRANSFER',
      fundLines: [{ fundId: SEED.fundGeneralA, amount: '30000' }], pledgeId, pledgeMonth: '2026-08',
    }));
    const m = await owner.query(`select to_char(pledge_month, 'YYYY-MM') as m from money_receipts where id = $1`, [late.id]);
    expect(m.rows[0].m).toBe('2026-08');
    const p = (await list()).pledges.find((x) => x.id === pledgeId)!;
    expect(p.statuses[1]).toEqual({ month: '2026-08', status: 'PENDING' });
  });

  it('통장 입금: 이름이 같은 후원자의 약정을 후보로 보여 주고, 약정을 고르면 후원자를 채운다', async () => {
    const g: Grid = [['거래일시', '기재내용', '찾으신금액', '맡기신금액'], ['2026.10.21 09:00:00', '정기후원(가상)', '0', '30,000']];
    await withTenant(app, A.donation, (db) =>
      importBankStatement(db, A.donation, { fileName: 'p.csv', content: Buffer.from('pledge-test'), grid: g, accountLabel: '후원금 통장' }));
    const tx = (await withTenant(app, A.donation, (db) => listBankTransactions(db, A.donation))).find((t) => t.counterparty === '정기후원(가상)')!;
    expect(tx.pledgeCandidates).toEqual([{ id: pledgeId, donorId, amount: '30000', sameAmount: true }]);
    const r = await withTenant(app, A.donation, (db) => createReceiptFromBank(db, A.donation, cipher, tx.id, {
      facilityId: SEED.facilityA, fundId: SEED.fundGeneralA, pledgeId, pledgeMonth: '2026-09',
    }));
    expect(r.donorId).toBe(donorId);
    const m = await owner.query(`select donor_id, pledge_id, to_char(pledge_month, 'YYYY-MM') as m from money_receipts where id = $1`, [r.receiptId]);
    expect(m.rows[0]).toEqual({ donor_id: donorId, pledge_id: pledgeId, m: '2026-09' });
    // 새 후원자 등록과 약정 연결은 함께 할 수 없다
    await expectCode(withTenant(app, A.donation, (db) => createReceiptFromBank(db, A.donation, cipher, tx.id, {
      facilityId: SEED.facilityA, fundId: SEED.fundGeneralA, pledgeId, newDonor: { donorType: 'INDIVIDUAL' },
    })), 'VALIDATION_FAILED');
  });

  it('약정 끝내기: 연결된 달 이전으로는 못 끝내고, 한 번만 끝낸다. 약정 내용은 직접 고칠 수 없다', async () => {
    await expectCode(withTenant(app, A.donation, (db) => endPledge(db, A.donation, pledgeId, { endMonth: '2026-09', reason: '후원자 요청' })), 'VALIDATION_FAILED');
    await withTenant(app, A.donation, (db) => endPledge(db, A.donation, pledgeId, { endMonth: '2026-10', reason: '후원자 요청' }));
    await expectCode(withTenant(app, A.donation, (db) => endPledge(db, A.donation, pledgeId, { endMonth: '2026-11', reason: '다시' })), 'INVALID_STATE_TRANSITION');
    // 11월은 이제 약정 기간 밖
    expect((await list('2026-11')).pledges.some((p) => p.id === pledgeId)).toBe(false);
    await expectCode(receipt('2026-11', '30000', false), 'VALIDATION_FAILED');
    await expectCode(withTenant(app, A.donation, (db) => db.query(`update pledges set amount = 1 where id = $1`, [pledgeId])), '42501');
    await expectCode(withTenant(app, A.donation, (db) => db.query(`delete from pledges where id = $1`, [pledgeId])), '42501');
  });

  it('권한: 물품담당은 약정을 보지도 만들지도 못하고, 승인권자는 보기만 한다', async () => {
    await expectCode(withTenant(app, A.goods, (db) => listPledges(db, A.goods, { current: '2026-10' })), 'FORBIDDEN');
    await expectCode(withTenant(app, A.approver, (db) => createPledge(db, A.approver, {
      donorId, fundId: SEED.fundGeneralA, facilityId: SEED.facilityA, amount: '10000', startMonth: '2026-10', method: 'OTHER',
    })), 'FORBIDDEN');
    await expectCode(withTenant(app, A.admin, (db) => endPledge(db, A.admin, pledgeId, { endMonth: '2026-10', reason: 'x' })), 'FORBIDDEN');
    const seen = await withTenant(app, A.approver, (db) => listPledges(db, A.approver, { current: '2026-10', view: 'all' }));
    expect(seen.pledges.length).toBeGreaterThan(0);
    // 물품담당의 오늘의 업무에는 약정 미납 수가 나오지 않는다
    const d = await withTenant(app, A.goods, (db) => todayDashboard(db, A.goods, '2026-10-20'));
    expect(d.pledgesInArrears).toBeNull();
  });

  it('기관 격리: 다른 기관의 약정은 보이지 않고 연결·종료도 안 된다', async () => {
    const b = await withTenant(app, B.donation, (db) => listPledges(db, B.donation, { current: '2026-10', view: 'all' }));
    expect(b.pledges).toEqual([]);
    await expectCode(withTenant(app, B.donation, (db) => endPledge(db, B.donation, pledgeId, { endMonth: '2026-12', reason: 'x' })), 'NOT_FOUND');
    await expectCode(withTenant(app, B.donation, (db) => createMoneyReceiptDraft(db, B.donation, {
      facilityId: SEED.facilityB, donorId, receivedOn: '2026-10-15', amount: '1000', method: 'CMS',
      fundLines: [{ fundId: SEED.fundGeneralB, amount: '1000' }], pledgeId,
    })), 'NOT_FOUND');
    // 다른 기관 후원자로 약정 만들기: 복합 FK가 막는다
    await expectCode(withTenant(app, B.donation, (db) => createPledge(db, B.donation, {
      donorId, fundId: SEED.fundGeneralB, facilityId: SEED.facilityB, amount: '1000', startMonth: '2026-10', method: 'OTHER',
    })), '23503');
    // 직접 SQL로도 다른 기관 tenant_id를 쓸 수 없다(RLS)
    await expectCode(withTenant(app, B.donation, (db) => db.query(
      `insert into pledges (tenant_id, donor_id, fund_id, facility_id, amount, start_month, method, created_by)
       values ($1, $2, $3, $4, 1000, '2026-10-01', 'OTHER', $5)`,
      [SEED.tenantA, donorId, SEED.fundGeneralA, SEED.facilityA, SEED.users.bDonation])), '42501');
  });
});
