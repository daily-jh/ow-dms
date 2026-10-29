import { DomainError } from '@owdms/domain';
import type { ActorContext } from '../pool';
import { audit, requireAction, type Db } from './common';
import { verifyStockLedger } from './stock';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertPeriod(period: string) {
  if (!PERIOD.test(period)) throw new DomainError('VALIDATION_FAILED', '기간 형식은 YYYY-MM입니다.', { period: 'YYYY-MM' });
}

export interface ChecklistItem { code: string; label: string; count: number; blocking: boolean; href: string }

/**
 * 월말 점검표. blocking 항목이 0이어야 마감할 수 있다.
 * 은행·회계전표 대조는 Phase 2에서 이 목록에 추가한다.
 */
export async function periodChecklist(db: Db, ctx: ActorContext, period: string) {
  requireAction(ctx, 'goods.read');
  assertPeriod(period);
  const r = await db.query(
    `with p as (select to_date($1 || '-01', 'YYYY-MM-DD') as s, (to_date($1 || '-01', 'YYYY-MM-DD') + interval '1 month')::date as e)
     select
       (select count(*) from goods_receipts g, p where g.status = 'PENDING_APPROVAL' and g.received_on >= p.s and g.received_on < p.e)
     + (select count(*) from money_receipts m, p where m.status = 'PENDING_APPROVAL' and m.received_on >= p.s and m.received_on < p.e)
     + (select count(*) from distributions d, p where d.status = 'PENDING_APPROVAL' and d.planned_on >= p.s and d.planned_on < p.e) as pending_approvals,
       (select count(*) from correction_events c, p where c.status = 'PENDING_APPROVAL' and c.business_date >= p.s and c.business_date < p.e) as pending_corrections,
       (select count(*) from distributions d, p where d.status = 'APPROVED' and d.planned_on >= p.s and d.planned_on < p.e) as unposted_distributions,
       (select count(*) from goods_receipts g, p where g.status in ('DRAFT', 'REJECTED') and g.received_on >= p.s and g.received_on < p.e)
     + (select count(*) from money_receipts m, p where m.status in ('DRAFT', 'REJECTED') and m.received_on >= p.s and m.received_on < p.e)
     + (select count(*) from distributions d, p where d.status in ('DRAFT', 'REJECTED') and d.planned_on >= p.s and d.planned_on < p.e) as drafts,
       (select count(*) from goods_receipt_lines l join goods_receipts g on g.id = l.receipt_id, p
         where g.status = 'APPROVED' and l.valuation_status <> 'CONFIRMED' and g.received_on >= p.s and g.received_on < p.e) as unconfirmed_valuations,
       (select count(*) from integration_rows r where r.state in ('EXPORTED', 'SUBMITTED', 'ACKNOWLEDGED', 'UNKNOWN', 'CORRECTION_REQUIRED')) as external_pending,
       (select coalesce(sum(amount), 0) from money_receipts m, p where m.status = 'APPROVED' and m.received_on >= p.s and m.received_on < p.e) as money_confirmed,
       (select count(*) from goods_receipts g, p where g.status = 'APPROVED' and g.received_on >= p.s and g.received_on < p.e) as goods_receipts,
       (select count(*) from distributions d, p where d.status = 'POSTED' and d.planned_on >= p.s and d.planned_on < p.e) as distributions_posted`,
    [period],
  );
  const x = r.rows[0];
  const mismatches = await verifyStockLedger(db);
  const items: ChecklistItem[] = [
    { code: 'PENDING_APPROVALS', label: '승인 대기 거래', count: Number(x.pending_approvals), blocking: true, href: '/approvals' },
    { code: 'PENDING_CORRECTIONS', label: '처리 대기 정정 요청', count: Number(x.pending_corrections), blocking: true, href: '/approvals' },
    { code: 'UNPOSTED_DISTRIBUTIONS', label: '승인됐지만 출고 미반영 배분', count: Number(x.unposted_distributions), blocking: true, href: '/distributions' },
    { code: 'LEDGER_MISMATCH', label: '재고원장과 잔고 불일치', count: mismatches.length, blocking: true, href: '/stock' },
    { code: 'DRAFTS', label: '승인 요청 전 초안·반려', count: Number(x.drafts), blocking: false, href: '/goods' },
    { code: 'UNCONFIRMED_VALUATIONS', label: '가액 미확정 후원품 행', count: Number(x.unconfirmed_valuations), blocking: false, href: '/goods' },
    { code: 'EXTERNAL_PENDING', label: '희망이음 등록확인·정정 대기(전체 기간)', count: Number(x.external_pending), blocking: false, href: '/integrations' },
  ];
  const closure = await db.query(
    `select c.closed_at, u.display_name from period_closures c join users u on u.id = c.closed_by where c.period = $1 and c.reopened_at is null`,
    [period],
  );
  const history = await db.query(
    `select c.closed_at, cu.display_name as closed_by, c.reopened_at, ru.display_name as reopened_by, c.reopen_reason
       from period_closures c join users cu on cu.id = c.closed_by left join users ru on ru.id = c.reopened_by
      where c.period = $1 order by c.closed_at`,
    [period],
  );
  return {
    period,
    status: closure.rowCount ? ('CLOSED' as const) : ('OPEN' as const),
    closedAt: (closure.rows[0]?.closed_at as Date | undefined)?.toISOString() ?? null,
    closedByName: (closure.rows[0]?.display_name as string | undefined) ?? null,
    items,
    canClose: items.every((i) => !i.blocking || i.count === 0),
    totals: { moneyConfirmed: String(x.money_confirmed), goodsReceipts: Number(x.goods_receipts), distributionsPosted: Number(x.distributions_posted) },
    history: history.rows.map((h) => ({
      closedAt: (h.closed_at as Date).toISOString(), closedBy: h.closed_by as string,
      reopenedAt: (h.reopened_at as Date | null)?.toISOString() ?? null, reopenedBy: h.reopened_by as string | null, reopenReason: h.reopen_reason as string | null,
    })),
  };
}

export async function closePeriod(db: Db, ctx: ActorContext, period: string) {
  requireAction(ctx, 'approval.decide');
  assertPeriod(period);
  // 같은 기간 동시 마감 요청 직렬화
  await db.query('select pg_advisory_xact_lock(hashtextextended($1, 1))', [`${ctx.tenantId}:close:${period}`]);
  const c = await periodChecklist(db, ctx, period);
  if (c.status === 'CLOSED') throw new DomainError('INVALID_STATE_TRANSITION', '이미 마감된 기간입니다.');
  if (!c.canClose) {
    const blocking = c.items.filter((i) => i.blocking && i.count > 0).map((i) => `${i.label} ${i.count}건`).join(', ');
    throw new DomainError('CLOSE_BLOCKED', `마감 전에 정리할 항목이 있습니다: ${blocking}`);
  }
  await db.query(`insert into period_closures (tenant_id, period, closed_by) values (app_tenant(), $1, $2)`, [period, ctx.userId]);
  await audit(db, ctx, { category: 'LEDGER', action: 'period.close', resourceType: 'period', resourceId: period });
  return { period, status: 'CLOSED' as const };
}

/** 재개방: 승인권자·사유 필수. 재개방 후에는 다시 점검표를 통과해야 마감할 수 있다. */
export async function reopenPeriod(db: Db, ctx: ActorContext, period: string, reason: string) {
  requireAction(ctx, 'approval.decide');
  assertPeriod(period);
  if (!reason?.trim()) throw new DomainError('VALIDATION_FAILED', '재개방 사유를 입력하십시오.', { reason: '필수' });
  const r = await db.query(
    `update period_closures set reopened_at = now(), reopened_by = $2, reopen_reason = $3 where period = $1 and reopened_at is null`,
    [period, ctx.userId, reason.trim()],
  );
  if (!r.rowCount) throw new DomainError('INVALID_STATE_TRANSITION', '마감되지 않은 기간입니다.');
  await audit(db, ctx, { category: 'LEDGER', action: 'period.reopen', resourceType: 'period', resourceId: period, reason: reason.trim() });
  return { period, status: 'OPEN' as const };
}

export async function listAuditEvents(db: Db, ctx: ActorContext, q: { limit?: number; category?: string } = {}) {
  requireAction(ctx, 'audit.read');
  const r = await db.query(
    `select a.id, a.category, a.action, a.resource_type, a.resource_id, a.result, a.reason, a.request_id, a.created_at, u.display_name
       from audit_events a left join users u on u.id = a.actor_user_id
      where ($1::text is null or a.category = $1)
      order by a.created_at desc, a.id desc limit $2`,
    [q.category ?? null, Math.min(Math.max(q.limit ?? 100, 1), 500)],
  );
  await audit(db, ctx, { category: 'ACCESS', action: 'audit.view' });
  return r.rows.map((a) => ({
    id: String(a.id), category: a.category as string, action: a.action as string, resourceType: a.resource_type as string | null,
    resourceId: a.resource_id as string | null, result: a.result as string, reason: a.reason as string | null,
    requestId: a.request_id as string | null, createdAt: (a.created_at as Date).toISOString(), actorName: (a.display_name ?? null) as string | null,
  }));
}
