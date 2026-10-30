import { describe, expect, it } from 'vitest';
import { summarizeIncome } from '../src/income';
import { addMonths, assertYearMonth, monthRange, pledgeMonthStatus, unpaidMonths } from '../src/pledge';

const p = { amount: 50000n, startMonth: '2026-07', endMonth: null };

describe('정기후원 약정', () => {
  it('월 계산', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthRange('2026-11', '2027-01')).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(() => assertYearMonth('2026-13')).toThrow();
  });

  it('T03: 약정 월 5만원, 입금 없음 → 미납 상태만 있고 확정수입은 0', () => {
    expect(pledgeMonthStatus(p, '2026-09', '2026-10', [])).toBe('UNPAID');
    const income = summarizeIncome({ pledgedSchedules: [{ amount: 50000n }], receipts: [], refunds: [] });
    expect(income.confirmedGross).toBe(0n);
    expect(income.pledged).toBe(50000n);
  });

  it('승인된 수납만 납입으로 본다(초안·승인대기는 대기, 반려·취소는 무시)', () => {
    expect(pledgeMonthStatus(p, '2026-09', '2026-10', [{ month: '2026-09', amount: 50000n, status: 'APPROVED' }])).toBe('PAID');
    expect(pledgeMonthStatus(p, '2026-09', '2026-10', [{ month: '2026-09', amount: 30000n, status: 'APPROVED' }])).toBe('PARTIAL');
    expect(pledgeMonthStatus(p, '2026-09', '2026-10', [{ month: '2026-09', amount: 50000n, status: 'PENDING_APPROVAL' }])).toBe('PENDING');
    expect(pledgeMonthStatus(p, '2026-09', '2026-10', [{ month: '2026-09', amount: 50000n, status: 'REJECTED' }])).toBe('UNPAID');
    expect(pledgeMonthStatus(p, '2026-09', '2026-10', [{ month: '2026-09', amount: 50000n, status: 'REVERSED' }])).toBe('UNPAID');
  });

  it('기간 밖은 해당 없음, 앞으로의 달은 예정', () => {
    expect(pledgeMonthStatus(p, '2026-06', '2026-10', [])).toBe('NOT_DUE');
    expect(pledgeMonthStatus({ ...p, endMonth: '2026-08' }, '2026-09', '2026-10', [])).toBe('NOT_DUE');
    expect(pledgeMonthStatus(p, '2026-12', '2026-10', [])).toBe('UPCOMING');
  });

  it('지난달까지 미납 개월과 이번 달 미납을 나눠 센다', () => {
    const pays = [{ month: '2026-07', amount: 50000n, status: 'APPROVED' as const }, { month: '2026-09', amount: 10000n, status: 'APPROVED' as const }];
    expect(unpaidMonths(p, '2026-10', pays)).toEqual({ past: ['2026-08', '2026-09'], currentMonthOpen: true });
    expect(unpaidMonths({ ...p, endMonth: '2026-07' }, '2026-10', pays)).toEqual({ past: [], currentMonthOpen: false });
  });
});
