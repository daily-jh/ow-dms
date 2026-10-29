import { DomainError } from './errors';

/**
 * 외부연계(희망이음 등) 행 상태. 업무 승인·회계·영수증 상태와 별개의 enum이다.
 * EXPORTED=다운로드 사실, SUBMITTED=송신 사실, ACKNOWLEDGED=접수 사실, VERIFIED=대상 등록 확인.
 */
export type ExternalRowState =
  | 'NOT_READY'
  | 'VALIDATED'
  | 'PREPARED'
  | 'EXPORTED'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'UNKNOWN'
  | 'CORRECTION_REQUIRED';

const TRANSITIONS: Record<ExternalRowState, readonly ExternalRowState[]> = {
  NOT_READY: ['VALIDATED'],
  VALIDATED: ['PREPARED', 'NOT_READY'],
  PREPARED: ['EXPORTED', 'SUBMITTED', 'NOT_READY'],
  // 파일 다운로드 후에는 담당자 업로드 기록(SUBMITTED)이 있어야 다음 단계로 간다.
  EXPORTED: ['SUBMITTED', 'NOT_READY'],
  SUBMITTED: ['ACKNOWLEDGED', 'REJECTED', 'UNKNOWN'],
  ACKNOWLEDGED: ['VERIFIED', 'REJECTED', 'UNKNOWN'],
  // 응답 유실은 대상조회/대조 후에만 결론을 낸다(맹목 재전송 금지).
  UNKNOWN: ['VERIFIED', 'REJECTED'],
  VERIFIED: ['CORRECTION_REQUIRED'],
  REJECTED: ['CORRECTION_REQUIRED', 'NOT_READY'],
  CORRECTION_REQUIRED: ['VALIDATED'],
};

export function transitionExternalRow(from: ExternalRowState, to: ExternalRowState): ExternalRowState {
  if (!TRANSITIONS[from].includes(to)) {
    throw new DomainError('INVALID_STATE_TRANSITION', `외부연계 상태를 ${from}에서 ${to}로 바꿀 수 없습니다.`);
  }
  return to;
}

/** 수동 등록확인은 외부번호(또는 식별근거)·확인자·일시·증빙이 모두 있어야 한다. */
export function assertManualVerification(e: {
  externalRef?: string | null;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  evidenceId?: string | null;
}): void {
  if (!e.externalRef || !e.verifiedBy || !e.verifiedAt || !e.evidenceId) {
    throw new DomainError('VALIDATION_FAILED', '등록확인에는 외부번호·확인자·일시·증빙이 필요합니다.');
  }
}

/** 행별 결과 요약. 파일 생성 건수와 등록확인 건수를 합산하지 않는다. */
export function summarizeRows(states: readonly ExternalRowState[]) {
  const count = (s: ExternalRowState) => states.filter((x) => x === s).length;
  return {
    total: states.length,
    exported: count('EXPORTED'),
    verified: count('VERIFIED'),
    rejected: count('REJECTED'),
    unknown: count('UNKNOWN'),
    pending: states.length - count('VERIFIED') - count('REJECTED') - count('UNKNOWN'),
  };
}

/** 재전송 대상: 실패(REJECTED→정정)만. VERIFIED·ACKNOWLEDGED·UNKNOWN 행은 재전송하지 않는다. */
export function rowsEligibleForResend<T extends { state: ExternalRowState }>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.state === 'NOT_READY' || r.state === 'VALIDATED' || r.state === 'PREPARED');
}
