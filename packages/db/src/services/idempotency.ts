import { resolveIdempotency } from '@owdms/domain';
import type { ActorContext } from '../pool';
import type { Db } from './common';

/**
 * 같은 트랜잭션 안에서 멱등키를 선점한다. 동시 재시도는 PK 충돌 대기 후 저장된 결과를 받는다.
 * 같은 키+다른 payload는 IDEMPOTENCY_CONFLICT.
 */
export async function runIdempotent<T>(
  db: Db,
  ctx: ActorContext,
  key: string | undefined,
  hash: string,
  fn: () => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T; replayed: boolean }> {
  if (!key) {
    const r = await fn();
    return { ...r, replayed: false };
  }
  await db.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${ctx.tenantId}:${key}`]);
  const stored = await db.query<{ request_hash: string; status_code: number; response: T }>(
    `select request_hash, status_code, response from idempotency_keys where key = $1`,
    [key],
  );
  const row = stored.rows[0];
  if (resolveIdempotency(row ? { requestHash: row.request_hash } : null, hash) === 'REPLAY') {
    return { status: row!.status_code, body: row!.response, replayed: true };
  }
  const r = await fn();
  await db.query(
    `insert into idempotency_keys (tenant_id, key, user_id, request_hash, status_code, response) values (app_tenant(), $1, $2, $3, $4, $5)`,
    [key, ctx.userId, hash, r.status, JSON.stringify(r.body)],
  );
  return { ...r, replayed: false };
}
