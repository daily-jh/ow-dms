import { describe, expect, it } from 'vitest';
import {
  DomainError,
  assertAllocationWithinRemaining,
  assertCanDecide,
  assertCanIssue,
  assertFundLinesMatch,
  assertManualVerification,
  buildSettlement,
  canonicalJson,
  formatQty,
  formatWon,
  fundBalances,
  parseQty,
  parseWon,
  replayLedger,
  requestHash,
  resolveIdempotency,
  rolesAllow,
  rowsEligibleForResend,
  sortLotsFefo,
  summarizeIncome,
  summarizeRows,
  transitionExternalRow,
} from '../src';

const q = (n: number | string) => parseQty(String(n));
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return 'NO_ERROR';
};

describe('금액·수량 표현', () => {
  it('원 단위 정수만 허용하고 부동소수점을 쓰지 않는다', () => {
    expect(parseWon('1,000,000')).toBe(1_000_000n);
    expect(code(() => parseWon('100.5'))).toBe('INVALID_AMOUNT');
    expect(formatWon(600000n)).toBe('600,000원');
  });
  it('수량은 1/1000 고정소수로 저장한다', () => {
    expect(parseQty('7.5')).toBe(7500n);
    expect(formatQty(parseQty('0.125') + parseQty('0.875'))).toBe('1');
    expect(code(() => parseQty('1.2345'))).toBe('INVALID_QUANTITY');
  });
});

describe('T03 약정은 수입이 아니다', () => {
  it('입금 없는 월 5만원 약정은 확정수입 0', () => {
    const s = summarizeIncome({ pledgedSchedules: [{ amount: 50000n }], receipts: [], refunds: [] });
    expect(s.pledged).toBe(50000n);
    expect(s.confirmedGross).toBe(0n);
  });
  it('승인 전 수납은 확정수입에 포함하지 않는다', () => {
    const s = summarizeIncome({
      pledgedSchedules: [],
      receipts: [
        { amount: 30000n, status: 'PENDING_APPROVAL' },
        { amount: 20000n, status: 'APPROVED' },
      ],
      refunds: [{ amount: 5000n }],
    });
    expect(s.confirmedGross).toBe(20000n);
    expect(s.confirmedNet).toBe(15000n);
  });
});

describe('T04 기금배분', () => {
  it('10만원을 6만+4만으로 분할하면 통과', () => {
    expect(() => assertFundLinesMatch(100000n, [{ amount: 60000n }, { amount: 40000n }])).not.toThrow();
  });
  it('1만원 추가배분은 합계 불일치로 차단', () => {
    expect(code(() => assertFundLinesMatch(100000n, [{ amount: 60000n }, { amount: 40000n }, { amount: 10000n }]))).toBe(
      'ALLOCATION_SUM_MISMATCH',
    );
  });
  it('은행·수납 양측 잔여 초과 금지', () => {
    const base = { bankAmount: 100000n, bankAllocated: 90000n, receiptAmount: 50000n, receiptAllocated: 0n };
    expect(() => assertAllocationWithinRemaining({ ...base, requested: 10000n })).not.toThrow();
    expect(code(() => assertAllocationWithinRemaining({ ...base, requested: 10001n }))).toBe('ALLOCATION_EXCEEDS_REMAINING');
  });
  it('가용잔액은 집행예약을 차감하고 장부잔액과 분리한다', () => {
    const b = fundBalances({
      openingCarryover: 10000n,
      confirmedIncome: 100000n,
      refunds: 5000n,
      confirmedExpenditure: 30000n,
      reservedExpenditure: 20000n,
    });
    expect(b).toEqual({ bookBalance: 75000n, availableBalance: 55000n });
  });
});

describe('T05 CMS 정산', () => {
  it('총액 10만·수수료 1천·순입금 9만9천을 각각 보존', () => {
    expect(buildSettlement(100000n, 1000n)).toEqual({ gross: 100000n, fee: 1000n, net: 99000n });
  });
});

describe('T06 재고원장 재생', () => {
  it('100포 입고→30+20+15 배분→5 폐기→2 반품 = 32포', () => {
    const balance = replayLedger([
      { type: 'RECEIPT', quantity: q(100) },
      { type: 'DISTRIBUTION', quantity: q(30) },
      { type: 'DISTRIBUTION', quantity: q(20) },
      { type: 'DISTRIBUTION', quantity: q(15) },
      { type: 'DISPOSAL', quantity: q(5) },
      { type: 'DISTRIBUTION_RETURN', quantity: q(2) },
    ]);
    expect(formatQty(balance)).toBe('32');
  });
  it('창고이동은 기관 전체 수량을 바꾸지 않는다', () => {
    const balance = replayLedger([
      { type: 'RECEIPT', quantity: q(20) },
      { type: 'TRANSFER_OUT', quantity: q(5) },
      { type: 'TRANSFER_IN', quantity: q(5) },
    ]);
    expect(formatQty(balance)).toBe('20');
  });
  it('음수 재고가 되는 원장은 거부', () => {
    expect(code(() => replayLedger([{ type: 'RECEIPT', quantity: q(1) }, { type: 'DISTRIBUTION', quantity: q(2) }]))).toBe(
      'INSUFFICIENT_STOCK',
    );
  });
  it('예약은 가용량에서 빠지고 유효기한 초과 로트는 출고 차단', () => {
    expect(code(() => assertCanIssue({ onHand: q(10), activeReserved: q(4), requested: q(7), businessDate: '2026-10-29' }))).toBe(
      'INSUFFICIENT_STOCK',
    );
    expect(
      code(() =>
        assertCanIssue({ onHand: q(10), activeReserved: 0n, requested: q(1), expiresOn: '2026-10-01', businessDate: '2026-10-29' }),
      ),
    ).toBe('LOT_EXPIRED');
  });
  it('FEFO: 유효기한 빠른 로트부터, 기한 없는 로트는 뒤로', () => {
    const lots = sortLotsFefo([
      { lotId: 'c', expiresOn: null, receivedOn: '2026-01-01' },
      { lotId: 'b', expiresOn: '2026-12-01', receivedOn: '2026-01-01' },
      { lotId: 'a', expiresOn: '2026-11-01', receivedOn: '2026-02-01' },
    ]);
    expect(lots.map((l) => l.lotId)).toEqual(['a', 'b', 'c']);
  });
});

describe('승인 규칙(T20 일부)', () => {
  const base = { approvalStatus: 'PENDING' as const, approvalTargetVersion: 1, currentTargetVersion: 1 };
  it('자기승인 금지', () => {
    expect(code(() => assertCanDecide({ ...base, requestedBy: 'u1', decidedBy: 'u1' }))).toBe('SELF_APPROVAL_FORBIDDEN');
  });
  it('요청 이후 변경된 거래는 승인 불가', () => {
    expect(code(() => assertCanDecide({ ...base, requestedBy: 'u1', decidedBy: 'u2', currentTargetVersion: 2 }))).toBe(
      'STALE_VERSION',
    );
  });
  it('물품담당은 세무식별정보·승인 권한이 없다', () => {
    expect(rolesAllow(['GOODS_STAFF'], 'donor.tax.read')).toBe(false);
    expect(rolesAllow(['GOODS_STAFF'], 'approval.decide')).toBe(false);
    expect(rolesAllow(['INSTITUTION_ADMIN'], 'donor.private.read')).toBe(false);
  });
});

describe('T11 멱등성', () => {
  it('키 순서가 달라도 같은 payload는 같은 해시', () => {
    expect(canonicalJson({ b: 1, a: { d: 2n, c: 3 } })).toBe('{"a":{"c":3,"d":"2"},"b":1}');
    expect(requestHash('post', '/v1/x', { a: 1, b: 2 })).toBe(requestHash('POST', '/v1/x', { b: 2, a: 1 }));
  });
  it('같은 키 다른 payload는 충돌', () => {
    const h1 = requestHash('POST', '/v1/x', { a: 1 });
    const h2 = requestHash('POST', '/v1/x', { a: 2 });
    expect(resolveIdempotency(null, h1)).toBe('NEW');
    expect(resolveIdempotency({ requestHash: h1 }, h1)).toBe('REPLAY');
    expect(code(() => resolveIdempotency({ requestHash: h1 }, h2))).toBe('IDEMPOTENCY_CONFLICT');
  });
});

describe('T13~T16 외부연계 상태', () => {
  it('T14 파일 다운로드(EXPORTED)에서 바로 등록확인(VERIFIED)으로 갈 수 없다', () => {
    expect(code(() => transitionExternalRow('EXPORTED', 'VERIFIED'))).toBe('INVALID_STATE_TRANSITION');
  });
  it('T16 응답 유실(UNKNOWN)은 재전송(SUBMITTED)으로 돌아가지 않는다', () => {
    expect(code(() => transitionExternalRow('UNKNOWN', 'SUBMITTED'))).toBe('INVALID_STATE_TRANSITION');
    expect(transitionExternalRow('UNKNOWN', 'VERIFIED')).toBe('VERIFIED');
  });
  it('T15 10행 중 7 성공·3 실패 → 실패행만 후속처리, 성공행은 재전송 대상 아님', () => {
    const rows = [
      ...Array.from({ length: 7 }, () => ({ state: 'VERIFIED' as const })),
      ...Array.from({ length: 3 }, () => ({ state: 'REJECTED' as const })),
    ];
    expect(summarizeRows(rows.map((r) => r.state))).toMatchObject({ total: 10, verified: 7, rejected: 3 });
    expect(rowsEligibleForResend(rows)).toHaveLength(0);
    const corrected = rows.map((r) => ({
      state: r.state === 'REJECTED' ? transitionExternalRow(transitionExternalRow(r.state, 'CORRECTION_REQUIRED'), 'VALIDATED') : r.state,
    }));
    expect(rowsEligibleForResend(corrected)).toHaveLength(3);
  });
  it('수동 등록확인은 외부번호·확인자·일시·증빙 필수', () => {
    expect(code(() => assertManualVerification({ externalRef: 'X1', verifiedBy: 'u', verifiedAt: '2026-10-29' }))).toBe(
      'VALIDATION_FAILED',
    );
  });
});
