import { createHash } from 'node:crypto';
import { DomainError } from './errors';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'INVALIDATED';

/** 자기승인 금지(기본값) + 확정버전 일치 + 대기 상태만 결정 가능. */
export function assertCanDecide(p: {
  approvalStatus: ApprovalStatus;
  requestedBy: string;
  decidedBy: string;
  approvalTargetVersion: number;
  currentTargetVersion: number;
  selfApprovalException?: boolean;
}): void {
  if (p.approvalStatus !== 'PENDING') {
    throw new DomainError('INVALID_STATE_TRANSITION', '이미 처리된 승인 요청입니다.');
  }
  if (p.requestedBy === p.decidedBy && !p.selfApprovalException) {
    throw new DomainError('SELF_APPROVAL_FORBIDDEN', '본인이 요청한 거래는 승인할 수 없습니다.');
  }
  if (p.approvalTargetVersion !== p.currentTargetVersion) {
    throw new DomainError('STALE_VERSION', '승인 요청 이후 거래가 변경되었습니다. 다시 요청하십시오.');
  }
}

/** 키 순서를 고정한 JSON 직렬화. 스냅샷 해시·멱등 payload 비교에 사용한다. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function snapshotHash(snapshot: unknown): string {
  return sha256Hex(canonicalJson(snapshot));
}
