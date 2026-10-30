import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  PiiCipher, SEED, createReceiptFromBank, excludeBankTransaction, importBankStatement, importMoneySheet, listBankTransactions,
  listImportBatches, reopenBankTransaction, requestApproval, withTenant,
} from '@owdms/db';
import type { Grid } from '@owdms/domain';
import { A, B, expectCode, setupTestDb } from './helpers';

// 합성 자료만 사용한다(실제 계좌·이름 아님).
let owner: pg.Pool;
let app: pg.Pool;
const cipher = new PiiCipher(randomBytes(32).toString('base64'));

beforeAll(async () => {
  ({ owner, app } = await setupTestDb());
});
afterAll(async () => {
  await app?.end();
  await owner?.end();
});

const HEAD = ['거래일시', '기재내용', '찾으신금액', '맡기신금액', '거래후잔액'];
const october: Grid = [
  ['가상은행 거래내역'],
  HEAD,
  ['2026.10.07 09:00:00', '홍길동(가상)', '0', '30,000', '1,030,000'],
  ['2026.10.07 09:00:00', '홍길동(가상)', '0', '30,000', '1,060,000'],
  ['2026.10.08 10:00:00', '(주)예시기업-A', '0', '100,000', '1,160,000'],
  ['2026.10.08 11:00:00', '가상마트', '5,000', '0', '1,155,000'],
  ['2026.10.09 00:00:00', '결산이자', '0', '120', '1,155,120'],
];
const file = (g: Grid) => Buffer.from(JSON.stringify(g));

describe('통장 거래내역 반입', () => {
  it('입금만 후보로 쌓고 출금은 버린다. 같은 날 같은 금액 2건도 각각 남는다(T02)', async () => {
    const r = await withTenant(app, A.donation, (db) =>
      importBankStatement(db, A.donation, { fileName: '10월.xlsx', content: file(october), grid: october, accountLabel: '후원금 통장' }));
    expect(r).toMatchObject({ imported: 4, duplicates: 0, withdrawals: 1, errors: [] });
    const open = await withTenant(app, A.donation, (db) => listBankTransactions(db, A.donation));
    expect(open).toHaveLength(4);
    // 후원금 수입은 아직 0원: 반입만으로 수입이 생기지 않는다
    const income = await owner.query(`select count(*)::int as n from money_receipts where tenant_id = $1 and memo like '통장 입금%'`, [SEED.tenantA]);
    expect(income.rows[0].n).toBe(0);
  });

  it('같은 파일 재반입·기간이 겹친 파일은 새 거래만 들어간다(T12)', async () => {
    const again = await withTenant(app, A.donation, (db) =>
      importBankStatement(db, A.donation, { fileName: '10월.xlsx', content: file(october), grid: october, accountLabel: '후원금 통장' }));
    expect(again).toMatchObject({ imported: 0, duplicates: 4 });
    const overlap: Grid = [HEAD, october[6]!, ['2026.10.10 08:00:00', '김가상', '0', '20,000', '1,175,120']];
    const r = await withTenant(app, A.donation, (db) =>
      importBankStatement(db, A.donation, { fileName: '10월 둘째주.csv', content: file(overlap), grid: overlap, accountLabel: '후원금 통장' }));
    expect(r).toMatchObject({ imported: 1, duplicates: 1 });
    const batches = await withTenant(app, A.donation, (db) => listImportBatches(db, A.donation));
    expect(batches.map((b) => [b.importedRows, b.duplicateRows])).toEqual([[1, 1], [0, 4], [4, 0]]);
  });

  it('통장 이름에 계좌번호를 넣지 못한다', async () => {
    await expectCode(withTenant(app, A.donation, (db) =>
      importBankStatement(db, A.donation, { fileName: 'x.csv', content: file(october), grid: october, accountLabel: '국민 123456-01-000000' })), 'VALIDATION_FAILED');
  });

  it('동명이인은 후보만 모두 보여 주고 자동으로 연결하지 않는다', async () => {
    const open = await withTenant(app, A.donation, (db) => listBankTransactions(db, A.donation));
    const hong = open.filter((t) => t.counterparty === '홍길동(가상)');
    expect(hong).toHaveLength(2);
    expect(hong[0]!.donorCandidates).toHaveLength(2);
    expect(hong.every((t) => t.status === 'OPEN' && t.receipts.length === 0)).toBe(true);
    const company = open.find((t) => t.counterparty === '(주)예시기업-A')!;
    expect(company.donorCandidates.map((d) => d.displayName)).toEqual(['예시기업-A']);
  });

  it('입금 1건을 나눠 두 건의 초안으로 연결하고, 남은 금액을 넘으면 거부한다', async () => {
    const open = await withTenant(app, A.donation, (db) => listBankTransactions(db, A.donation));
    const company = open.find((t) => t.counterparty === '(주)예시기업-A')!;
    const donorId = company.donorCandidates[0]!.id;
    const first = await withTenant(app, A.donation, (db) => createReceiptFromBank(db, A.donation, cipher, company.id, {
      facilityId: SEED.facilityA, fundId: SEED.fundGeneralA, amount: '60000', donorId }));
    expect(first.remaining).toBe('40000');
    await expectCode(withTenant(app, A.donation, (db) => createReceiptFromBank(db, A.donation, cipher, company.id, {
      facilityId: SEED.facilityA, fundId: SEED.fundDesignatedA, amount: '40001', donorId })), 'ALLOCATION_EXCEEDS_REMAINING');
    const second = await withTenant(app, A.donation, (db) => createReceiptFromBank(db, A.donation, cipher, company.id, {
      facilityId: SEED.facilityA, fundId: SEED.fundDesignatedA, donorId }));
    expect(second.remaining).toBe('0');
    const all = await withTenant(app, A.donation, (db) => listBankTransactions(db, A.donation, { view: 'all' }));
    const done = all.find((t) => t.id === company.id)!;
    expect(done.status).toBe('MATCHED');
    expect(done.receipts.map((r) => [r.amount, r.status])).toEqual([['60000', 'DRAFT'], ['40000', 'DRAFT']]);
    // 초안은 여느 후원금과 같이 승인 요청할 수 있다(승인 전에는 수입 아님)
    await withTenant(app, A.donation, (db) => requestApproval(db, A.donation, 'MONEY_RECEIPT', first.receiptId));
    const m = await owner.query(`select received_on::text, method, status from money_receipts where id = $1`, [first.receiptId]);
    expect(m.rows[0]).toEqual({ received_on: '2026-10-08', method: 'BANK_TRANSFER', status: 'PENDING_APPROVAL' });
    // 다 연결된 입금은 미대조 목록에서 빠진다
    const stillOpen = await withTenant(app, A.donation, (db) => listBankTransactions(db, A.donation));
    expect(stillOpen.some((t) => t.id === company.id)).toBe(false);
  });

  it('입금자명으로 새 후원자를 만드는 것은 담당자가 고른 경우에만 한다', async () => {
    const open = await withTenant(app, A.donation, (db) => listBankTransactions(db, A.donation));
    const kim = open.find((t) => t.counterparty === '김가상')!;
    expect(kim.donorCandidates).toEqual([]);
    const r = await withTenant(app, A.donation, (db) => createReceiptFromBank(db, A.donation, cipher, kim.id, {
      facilityId: SEED.facilityA, fundId: SEED.fundGeneralA, newDonor: { donorType: 'INDIVIDUAL' } }));
    const d = await owner.query(`select display_name, donor_type from donors where id = $1`, [r.donorId]);
    expect(d.rows[0]).toEqual({ display_name: '김가상', donor_type: 'INDIVIDUAL' });
  });

  it('이자 등은 후원금 아님으로 표시·해제하고, 연결된 입금은 표시할 수 없다', async () => {
    const open = await withTenant(app, A.donation, (db) => listBankTransactions(db, A.donation));
    const interest = open.find((t) => t.counterparty === '결산이자')!;
    await withTenant(app, A.donation, (db) => excludeBankTransaction(db, A.donation, interest.id, '예금 이자'));
    const excluded = await withTenant(app, A.donation, (db) => listBankTransactions(db, A.donation, { view: 'excluded' }));
    expect(excluded.map((t) => [t.id, t.excludeReason])).toEqual([[interest.id, '예금 이자']]);
    await expectCode(withTenant(app, A.donation, (db) => createReceiptFromBank(db, A.donation, cipher, interest.id, {
      facilityId: SEED.facilityA, fundId: SEED.fundGeneralA })), 'INVALID_STATE_TRANSITION');
    await withTenant(app, A.donation, (db) => reopenBankTransaction(db, A.donation, interest.id));
    const all = await withTenant(app, A.donation, (db) => listBankTransactions(db, A.donation, { view: 'all' }));
    const matched = all.find((t) => t.status === 'MATCHED')!;
    await expectCode(withTenant(app, A.donation, (db) => excludeBankTransaction(db, A.donation, matched.id, '착오')), 'INVALID_STATE_TRANSITION');
  });

  it('반입 거래 자체(금액·일자)와 연결 기록은 앱 계정으로 고치거나 지울 수 없다', async () => {
    await expect(withTenant(app, A.donation, (db) => db.query(`update bank_transactions set amount = 1`))).rejects.toThrow(/permission denied/);
    await expect(withTenant(app, A.donation, (db) => db.query(`delete from bank_allocations`))).rejects.toThrow(/permission denied/);
    await expect(owner.query(`delete from bank_allocations`)).rejects.toThrow(/APPEND_ONLY/);
  });

  it('권한: 물품담당·승인권자는 반입·연결할 수 없다', async () => {
    await expectCode(withTenant(app, A.goods, (db) =>
      importBankStatement(db, A.goods, { fileName: 'x', content: file(october), grid: october, accountLabel: '후원금 통장' })), 'FORBIDDEN');
    await expectCode(withTenant(app, A.goods, (db) => listBankTransactions(db, A.goods)), 'FORBIDDEN');
    const open = await withTenant(app, A.donation, (db) => listBankTransactions(db, A.donation));
    await expectCode(withTenant(app, A.approver, (db) => createReceiptFromBank(db, A.approver, cipher, open[0]!.id, {
      facilityId: SEED.facilityA, fundId: SEED.fundGeneralA })), 'FORBIDDEN');
  });

  it('기관 격리: B기관은 A기관 입금을 보지 못하고 연결·표시할 수 없다', async () => {
    const open = await withTenant(app, A.donation, (db) => listBankTransactions(db, A.donation));
    const target = open[0]!.id;
    const seenByB = await withTenant(app, B.donation, (db) => listBankTransactions(db, B.donation, { view: 'all' }));
    expect(seenByB).toEqual([]);
    expect(await withTenant(app, B.donation, (db) => listImportBatches(db, B.donation))).toEqual([]);
    await expectCode(withTenant(app, B.donation, (db) => createReceiptFromBank(db, B.donation, cipher, target, {
      facilityId: SEED.facilityB, fundId: SEED.fundGeneralB })), 'NOT_FOUND');
    await expectCode(withTenant(app, B.donation, (db) => excludeBankTransaction(db, B.donation, target, '침투')), 'NOT_FOUND');
    // 같은 지문의 거래도 기관이 다르면 각자 들어간다
    const r = await withTenant(app, B.donation, (db) =>
      importBankStatement(db, B.donation, { fileName: '10월.xlsx', content: file(october), grid: october, accountLabel: '후원금 통장' }));
    expect(r.imported).toBe(4);
  });
});

describe('후원금 입력 양식 반입', () => {
  const sheet = (rows: string[][]): Grid => [['수납일', '후원자', '후원자번호', '금액', '수납방법', '기금', '메모'], ...rows];

  it('모든 행이 맞으면 초안을 한꺼번에 만든다(익명 포함). 같은 파일은 두 번 넣지 못한다', async () => {
    const g = sheet([
      ['2026-10-11', '예시기업-A', '', '50,000', '계좌이체', '비지정후원금', '양식 반입(합성)'],
      ['2026-10-12', '', '', '7000', '현금', '지정후원금-결연(가상)', ''],
    ]);
    const r = await withTenant(app, A.donation, (db) => importMoneySheet(db, A.donation, { fileName: '10월 후원금.xlsx', content: file(g), grid: g, facilityId: SEED.facilityA }));
    expect(r).toMatchObject({ created: 2, errors: [] });
    const m = await owner.query(`select amount::text, method, status, donor_id is null as anon from money_receipts where memo = '양식 반입(합성)' or (amount = 7000 and method = 'CASH') order by received_on`);
    expect(m.rows).toEqual([
      { amount: '50000', method: 'BANK_TRANSFER', status: 'DRAFT', anon: false },
      { amount: '7000', method: 'CASH', status: 'DRAFT', anon: true },
    ]);
    await expectCode(withTenant(app, A.donation, (db) => importMoneySheet(db, A.donation, { fileName: '복사본.xlsx', content: file(g), grid: g, facilityId: SEED.facilityA })), 'DUPLICATE_IMPORT');
  });

  it('한 행이라도 틀리면 아무것도 만들지 않고 행별 오류를 돌려준다(없는 후원자·동명이인·없는 기금)', async () => {
    const before = await owner.query(`select count(*)::int as n from money_receipts`);
    const g = sheet([
      ['2026-10-13', '예시기업-A', '', '1000', '', '비지정후원금', ''],
      ['2026-10-13', '없는사람(가상)', '', '1000', '', '비지정후원금', ''],
      ['2026-10-13', '홍길동(가상)', '', '1000', '', '비지정후원금', ''],
      ['2026-10-13', '', '', '1000', '', '없는기금', ''],
      ['2026-10-13', '', '', '-5', '', '비지정후원금', ''],
    ]);
    const r = await withTenant(app, A.donation, (db) => importMoneySheet(db, A.donation, { fileName: '오류.xlsx', content: file(g), grid: g, facilityId: SEED.facilityA }));
    expect(r.created).toBe(0);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5, 6]);
    expect(r.errors[1]!.message).toMatch(/2명/);
    const after = await owner.query(`select count(*)::int as n from money_receipts`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('권한·기관 격리: 물품담당은 거부, B기관은 A기관 기금 이름이 같아도 자기 기금으로만 연결된다', async () => {
    const g = sheet([['2026-10-14', '', '', '3000', '현금', '비지정후원금', 'B양식(합성)']]);
    await expectCode(withTenant(app, A.goods, (db) => importMoneySheet(db, A.goods, { fileName: 'b.xlsx', content: file(g), grid: g, facilityId: SEED.facilityA })), 'FORBIDDEN');
    await withTenant(app, B.donation, (db) => importMoneySheet(db, B.donation, { fileName: 'b.xlsx', content: file(g), grid: g, facilityId: SEED.facilityB }));
    const line = await owner.query(`select l.fund_id, m.tenant_id from receipt_fund_lines l join money_receipts m on m.id = l.receipt_id where m.memo = 'B양식(합성)'`);
    expect(line.rows).toEqual([{ fund_id: SEED.fundGeneralB, tenant_id: SEED.tenantB }]);
    // B기관이 A기관 시설로 넣으려 하면 복합 FK가 막는다
    const g2 = sheet([['2026-10-14', '', '', '3000', '현금', '비지정후원금', '']]);
    await expectCode(withTenant(app, B.donation, (db) => importMoneySheet(db, B.donation, { fileName: 'b2.xlsx', content: file(g2), grid: g2, facilityId: SEED.facilityA })), '23503');
  });
});
