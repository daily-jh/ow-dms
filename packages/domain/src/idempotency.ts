import { DomainError } from './errors';
import { snapshotHash } from './approval';

export function requestHash(method: string, path: string, body: unknown): string {
  return snapshotHash({ method: method.toUpperCase(), path, body: body ?? null });
}

/** 동일 키 + 동일 payload → 저장된 결과 재사용, 동일 키 + 다른 payload → 충돌. */
export function resolveIdempotency(
  stored: { requestHash: string } | null,
  incomingHash: string,
): 'NEW' | 'REPLAY' {
  if (!stored) return 'NEW';
  if (stored.requestHash !== incomingHash) {
    throw new DomainError('IDEMPOTENCY_CONFLICT', '같은 요청키로 다른 내용을 보낼 수 없습니다.');
  }
  return 'REPLAY';
}
