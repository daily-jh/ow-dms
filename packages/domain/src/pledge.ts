import { DomainError } from './errors';
import { sumWon, type Won } from './money';
import type { MoneyReceiptStatus } from './income';

/**
 * 정기후원 약정. 약정은 수입이 아니며 '예정'만 만든다.
 * 실제 수납(후원금 수입)이 승인돼야 그 달이 '납입'이 된다.
 */
export type YearMonth = string; // YYYY-MM

const YM = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function assertYearMonth(v: string, field = 'month'): YearMonth {
  if (!YM.test(v)) throw new DomainError('VALIDATION_FAILED', '월은 YYYY-MM 형식입니다.', { [field]: 'YYYY-MM' });
  return v;
}

export function addMonths(ym: YearMonth, n: number): YearMonth {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** from부터 to까지(양끝 포함) 월 목록. */
export function monthRange(from: YearMonth, to: YearMonth): YearMonth[] {
  const out: YearMonth[] = [];
  for (let m = from; m <= to && out.length < 600; m = addMonths(m, 1)) out.push(m);
  return out;
}

export type PledgeMonthStatus = 'NOT_DUE' | 'UPCOMING' | 'PAID' | 'PARTIAL' | 'PENDING' | 'UNPAID';

export interface PledgeTerms { amount: Won; startMonth: YearMonth; endMonth: YearMonth | null }
export interface PledgePayment { month: YearMonth; amount: Won; status: MoneyReceiptStatus }

/**
 * 한 달의 상태: 약정 기간 밖이면 NOT_DUE, 이번 달 이후면 UPCOMING(아직 아님).
 * 승인된 수납 합계가 약정액 이상이면 PAID, 일부면 PARTIAL, 승인 전 수납만 있으면 PENDING, 없으면 UNPAID.
 * 반려·취소(REJECTED·REVERSED)된 수납은 세지 않는다.
 */
export function pledgeMonthStatus(p: PledgeTerms, month: YearMonth, current: YearMonth, payments: readonly PledgePayment[]): PledgeMonthStatus {
  if (month < p.startMonth || (p.endMonth !== null && month > p.endMonth)) return 'NOT_DUE';
  const mine = payments.filter((x) => x.month === month);
  const approved = sumWon(mine.filter((x) => x.status === 'APPROVED').map((x) => x.amount));
  if (approved >= p.amount) return 'PAID';
  if (approved > 0n) return 'PARTIAL';
  if (mine.some((x) => x.status === 'DRAFT' || x.status === 'PENDING_APPROVAL')) return 'PENDING';
  return month > current ? 'UPCOMING' : 'UNPAID';
}

/** 시작월부터 이번 달까지 미납(UNPAID·PARTIAL) 개월 수. 이번 달은 아직 기한 전일 수 있어 따로 센다. */
export function unpaidMonths(p: PledgeTerms, current: YearMonth, payments: readonly PledgePayment[]): { past: YearMonth[]; currentMonthOpen: boolean } {
  const last = p.endMonth !== null && p.endMonth < current ? p.endMonth : addMonths(current, -1);
  const past = p.startMonth <= last
    ? monthRange(p.startMonth, last).filter((m) => ['UNPAID', 'PARTIAL'].includes(pledgeMonthStatus(p, m, current, payments)))
    : [];
  const cur = pledgeMonthStatus(p, current, current, payments);
  return { past, currentMonthOpen: cur === 'UNPAID' || cur === 'PARTIAL' };
}
