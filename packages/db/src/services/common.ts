import { DomainError, rolesAllow, type Action, type Role } from '@owdms/domain';
import type pg from 'pg';
import type { ActorContext } from '../pool';

export type Db = pg.PoolClient;

export function requireAction(ctx: ActorContext, action: Action): void {
  if (!rolesAllow(ctx.roles as Role[], action)) {
    throw new DomainError('FORBIDDEN', '이 작업을 수행할 권한이 없습니다.');
  }
}

export async function audit(
  db: Db,
  ctx: ActorContext,
  e: { category: 'LEDGER' | 'ACCESS' | 'AUTH' | 'ADMIN'; action: string; resourceType?: string; resourceId?: string; result?: 'SUCCESS' | 'DENIED' | 'FAILED'; reason?: string },
): Promise<void> {
  await db.query(
    `insert into audit_events (tenant_id, actor_user_id, category, action, resource_type, resource_id, result, reason, request_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [ctx.tenantId, ctx.userId, e.category, e.action, e.resourceType ?? null, e.resourceId ?? null, e.result ?? 'SUCCESS', e.reason ?? null, ctx.requestId],
  );
}

/** PostgreSQL 오류를 안정적인 업무오류로 변환한다. SQL·내부값은 노출하지 않는다. */
export function mapPgError(err: unknown): unknown {
  const e = err as { code?: string; message?: string; constraint?: string };
  if (!e || typeof e.code !== 'string') return err;
  if (e.code === 'P0001' && e.message?.startsWith('APPROVED_IMMUTABLE')) {
    return new DomainError('APPROVED_IMMUTABLE', '승인된 거래는 직접 수정할 수 없습니다. 정정 절차를 사용하십시오.');
  }
  if (e.code === 'P0001' && e.message?.startsWith('APPEND_ONLY')) {
    return new DomainError('APPROVED_IMMUTABLE', '원장 기록은 수정·삭제할 수 없습니다.');
  }
  if (e.code === '23514' && (e.constraint?.includes('stock_balances') || e.message?.includes('stock_balances'))) {
    return new DomainError('INSUFFICIENT_STOCK', '가용 재고가 부족합니다.');
  }
  if (e.code === '23503') return new DomainError('NOT_FOUND', '참조한 자료를 찾을 수 없습니다.');
  if (e.code === '42501') return new DomainError('FORBIDDEN', '접근이 거부되었습니다.');
  if (e.code === '22P02') return new DomainError('VALIDATION_FAILED', '입력 형식이 올바르지 않습니다.');
  return err;
}

export async function assertPeriodOpen(db: Db, businessDate: string): Promise<void> {
  const period = businessDate.slice(0, 7);
  const r = await db.query('select 1 from period_closures where period = $1 and reopened_at is null', [period]);
  if (r.rowCount) throw new DomainError('PERIOD_CLOSED', `${period}은 마감된 기간입니다. 재개방 승인이 필요합니다.`);
}

export async function enqueueOutbox(
  db: Db,
  e: { tenantId: string; eventType: string; aggregateType: string; aggregateId: string; aggregateVersion: number; payload: unknown },
): Promise<void> {
  await db.query(
    `insert into outbox (tenant_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload)
     values ($1, $2, $3, $4, $5, $6)`,
    [e.tenantId, e.eventType, e.aggregateType, e.aggregateId, e.aggregateVersion, JSON.stringify(e.payload)],
  );
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function assertDate(value: string, field: string): void {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new DomainError('VALIDATION_FAILED', '날짜 형식은 YYYY-MM-DD입니다.', { [field]: 'YYYY-MM-DD' });
  }
}

/** 새 거래에는 사용 중지된 기준정보(시설·창고·품목·기금)를 쓸 수 없다. 없는 id는 FK가 따로 막는다. */
export async function assertActiveMaster(db: Db, table: 'facilities' | 'warehouses' | 'items' | 'funds', ids: (string | null | undefined)[]): Promise<void> {
  const list = [...new Set(ids.filter((v): v is string => !!v))];
  if (!list.length) return;
  const r = await db.query<{ name: string }>(`select name from ${table} where id = any($1::uuid[]) and not active`, [list]);
  if (r.rowCount) {
    throw new DomainError('VALIDATION_FAILED', `사용 중지된 기준정보입니다: ${r.rows.map((x) => x.name).join(', ')}`);
  }
}
