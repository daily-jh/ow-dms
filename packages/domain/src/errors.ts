/** 안정적인 업무오류코드. 화면·API·로그가 같은 코드를 사용한다. */
export type DomainErrorCode =
  | 'INVALID_AMOUNT'
  | 'INVALID_QUANTITY'
  | 'ALLOCATION_EXCEEDS_REMAINING'
  | 'ALLOCATION_SUM_MISMATCH'
  | 'INSUFFICIENT_STOCK'
  | 'LOT_EXPIRED'
  | 'SELF_APPROVAL_FORBIDDEN'
  | 'STALE_VERSION'
  | 'APPROVED_IMMUTABLE'
  | 'PERIOD_CLOSED'
  | 'INVALID_STATE_TRANSITION'
  | 'CAPABILITY_DISABLED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALUATION_UNCONFIRMED'
  | 'CLOSE_BLOCKED'
  | 'AUTH_FAILED'
  | 'SETUP_REQUIRED'
  | 'VALIDATION_FAILED';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    readonly safeMessage: string,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(`${code}: ${safeMessage}`);
    this.name = 'DomainError';
  }
}
