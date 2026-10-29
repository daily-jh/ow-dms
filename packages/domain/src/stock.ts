import { DomainError } from './errors';
import type { Qty } from './quantity';

/** 재고원장 이동 유형과 부호. 원장이 진실이고 잔고는 원장에서 재구축할 수 있다. */
export const STOCK_MOVEMENT_SIGN = {
  RECEIPT: 1n, // 입고(+)
  DISTRIBUTION: -1n, // 배분/사용(-)
  DISPOSAL: -1n, // 폐기(-)
  ADJUSTMENT_IN: 1n, // 승인조정(+)
  ADJUSTMENT_OUT: -1n, // 승인조정(-)
  DONOR_RETURN: -1n, // 후원자반환(-)
  DISTRIBUTION_RETURN: 1n, // 배분반품(+)
  TRANSFER_OUT: -1n, // 창고이동 출발(-)
  TRANSFER_IN: 1n, // 창고이동 도착(+)
  REVERSAL_IN: 1n, // 출고 역거래(+)
  REVERSAL_OUT: -1n, // 입고 역거래(-)
} as const;

export type StockMovementType = keyof typeof STOCK_MOVEMENT_SIGN;

export interface StockMovement {
  type: StockMovementType;
  /** 항상 양수로 입력하고 부호는 유형에서 결정한다. */
  quantity: Qty;
}

export function signedQuantity(m: StockMovement): Qty {
  if (m.quantity <= 0n) throw new DomainError('INVALID_QUANTITY', '이동 수량은 양수여야 합니다.');
  return STOCK_MOVEMENT_SIGN[m.type] * m.quantity;
}

/** 원장 행으로부터 현재고를 재계산한다. 중간에 음수가 되면 오류(원장 무결성 위반). */
export function replayLedger(movements: readonly StockMovement[]): Qty {
  let balance = 0n;
  for (const m of movements) {
    balance += signedQuantity(m);
    if (balance < 0n) throw new DomainError('INSUFFICIENT_STOCK', '원장 재생 중 음수 재고가 발생했습니다.');
  }
  return balance;
}

/** 가용량 = 현재고 - 유효예약량. 예약은 원장 출고가 아니다. */
export function availableQuantity(onHand: Qty, activeReserved: Qty): Qty {
  return onHand - activeReserved;
}

export function assertCanIssue(params: {
  onHand: Qty;
  activeReserved: Qty;
  requested: Qty;
  expiresOn?: string | null;
  businessDate: string;
  allowExpired?: boolean;
}): void {
  if (params.requested <= 0n) throw new DomainError('INVALID_QUANTITY', '출고 수량은 0보다 커야 합니다.');
  if (params.expiresOn && params.expiresOn < params.businessDate && !params.allowExpired) {
    throw new DomainError('LOT_EXPIRED', '유효기한이 지난 로트는 출고할 수 없습니다.');
  }
  if (availableQuantity(params.onHand, params.activeReserved) < params.requested) {
    throw new DomainError('INSUFFICIENT_STOCK', '가용 재고가 부족합니다.');
  }
}

/** 유효기한 우선(FEFO) 출고 후보 정렬. 기한 없는 로트는 뒤로. */
export function sortLotsFefo<T extends { expiresOn: string | null; receivedOn: string; lotId: string }>(lots: readonly T[]): T[] {
  return [...lots].sort((a, b) => {
    if (a.expiresOn !== b.expiresOn) {
      if (a.expiresOn === null) return 1;
      if (b.expiresOn === null) return -1;
      return a.expiresOn < b.expiresOn ? -1 : 1;
    }
    if (a.receivedOn !== b.receivedOn) return a.receivedOn < b.receivedOn ? -1 : 1;
    return a.lotId < b.lotId ? -1 : a.lotId > b.lotId ? 1 : 0;
  });
}
