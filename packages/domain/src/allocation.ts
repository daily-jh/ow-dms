import { DomainError } from './errors';
import { sumWon, type Won } from './money';

/** 수납 1건의 기금배분 합계는 수납액과 같아야 한다. */
export function assertFundLinesMatch(receiptAmount: Won, fundLines: readonly { amount: Won }[]): void {
  if (fundLines.length === 0) throw new DomainError('ALLOCATION_SUM_MISMATCH', '기금배분이 없습니다.');
  for (const line of fundLines) {
    if (line.amount <= 0n) throw new DomainError('INVALID_AMOUNT', '기금배분 금액은 0보다 커야 합니다.');
  }
  const total = sumWon(fundLines.map((l) => l.amount));
  if (total !== receiptAmount) {
    throw new DomainError('ALLOCATION_SUM_MISMATCH', '기금배분 합계가 수납액과 다릅니다.');
  }
}

/** 은행거래·수납 양측 잔여를 넘는 배분을 차단한다(다대다 연결표). */
export function assertAllocationWithinRemaining(params: {
  bankAmount: Won;
  bankAllocated: Won;
  receiptAmount: Won;
  receiptAllocated: Won;
  requested: Won;
}): void {
  if (params.requested <= 0n) throw new DomainError('INVALID_AMOUNT', '배분액은 0보다 커야 합니다.');
  if (params.bankAllocated + params.requested > params.bankAmount) {
    throw new DomainError('ALLOCATION_EXCEEDS_REMAINING', '은행거래 잔여액을 초과합니다.');
  }
  if (params.receiptAllocated + params.requested > params.receiptAmount) {
    throw new DomainError('ALLOCATION_EXCEEDS_REMAINING', '수납 잔여액을 초과합니다.');
  }
}

/** CMS/PG 정산: 총기부액·수수료·순입금은 각각 보존한다. 순입금을 기부액으로 오인하지 않는다. */
export interface Settlement {
  gross: Won;
  fee: Won;
  net: Won;
}

export function buildSettlement(gross: Won, fee: Won): Settlement {
  if (gross <= 0n || fee < 0n || fee > gross) throw new DomainError('INVALID_AMOUNT', '정산 금액이 올바르지 않습니다.');
  return { gross, fee, net: gross - fee };
}

/** 가용잔액 = 기초이월 + 확정수입 - 환불 - 확정집행 - 집행예약. 장부잔액과 분리한다. */
export function fundBalances(p: {
  openingCarryover: Won;
  confirmedIncome: Won;
  refunds: Won;
  confirmedExpenditure: Won;
  reservedExpenditure: Won;
}): { bookBalance: Won; availableBalance: Won } {
  const bookBalance = p.openingCarryover + p.confirmedIncome - p.refunds - p.confirmedExpenditure;
  return { bookBalance, availableBalance: bookBalance - p.reservedExpenditure };
}
