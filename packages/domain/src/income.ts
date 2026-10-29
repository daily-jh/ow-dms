import { sumWon, type Won } from './money';

/**
 * 약정은 수입이 아니다. 확정수입은 승인된 수납(APPROVED)만 합산한다.
 */
export type MoneyReceiptStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'REVERSED';

export interface IncomeFacts {
  pledgedSchedules: readonly { amount: Won }[];
  receipts: readonly { amount: Won; status: MoneyReceiptStatus }[];
  refunds: readonly { amount: Won }[];
}

export function summarizeIncome(f: IncomeFacts) {
  const pledged = sumWon(f.pledgedSchedules.map((s) => s.amount));
  const confirmedGross = sumWon(f.receipts.filter((r) => r.status === 'APPROVED').map((r) => r.amount));
  const refunded = sumWon(f.refunds.map((r) => r.amount));
  return { pledged, confirmedGross, refunded, confirmedNet: confirmedGross - refunded };
}
