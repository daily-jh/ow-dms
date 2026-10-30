import {
  DomainError, addMonths, assertYearMonth, parsePositiveWon, pledgeMonthStatus, unpaidMonths,
  type PledgeMonthStatus, type PledgePayment, type YearMonth,
} from '@owdms/domain';
import type { ActorContext } from '../pool';
import { assertActiveMaster, audit, requireAction, type Db } from './common';

/**
 * 정기후원 약정. 약정은 수입이 아니다(약정을 수입으로 처리 금지).
 * 납입 여부는 약정에 연결된 후원금 수입의 승인 상태로만 판단한다.
 */
export type PledgeMethod = 'BANK_TRANSFER' | 'CMS' | 'CARD' | 'OTHER';
const METHODS: PledgeMethod[] = ['BANK_TRANSFER', 'CMS', 'CARD', 'OTHER'];

const toDate = (ym: YearMonth) => `${ym}-01`;
const toYm = (d: string) => d.slice(0, 7);

export async function createPledge(
  db: Db,
  ctx: ActorContext,
  input: { donorId: string; fundId: string; facilityId: string; amount: string; startMonth: string; endMonth?: string | null; method: PledgeMethod; memo?: string | null },
): Promise<{ id: string }> {
  requireAction(ctx, 'money.draft');
  const amount = parsePositiveWon(input.amount);
  const start = assertYearMonth(input.startMonth, 'startMonth');
  const end = input.endMonth ? assertYearMonth(input.endMonth, 'endMonth') : null;
  if (end !== null && end < start) throw new DomainError('VALIDATION_FAILED', '종료월은 시작월 이후여야 합니다.', { endMonth: '시작월 이후' });
  if (!METHODS.includes(input.method)) throw new DomainError('VALIDATION_FAILED', '납입 방법을 고르십시오.', { method: '필수' });
  if (!input.donorId) throw new DomainError('VALIDATION_FAILED', '약정은 후원자가 있어야 합니다.', { donorId: '필수' });
  await assertActiveMaster(db, 'facilities', [input.facilityId]);
  await assertActiveMaster(db, 'funds', [input.fundId]);
  const r = await db.query<{ id: string }>(
    `insert into pledges (tenant_id, donor_id, fund_id, facility_id, amount, start_month, end_month, method, memo, created_by)
     values (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [input.donorId, input.fundId, input.facilityId, amount.toString(), toDate(start), end && toDate(end), input.method,
      input.memo?.trim() || null, ctx.userId],
  );
  const id = r.rows[0]!.id;
  await audit(db, ctx, { category: 'LEDGER', action: 'pledge.create', resourceType: 'pledge', resourceId: id });
  return { id };
}

/** 약정 끝내기: 마지막으로 낼 달과 사유를 기록한다. 이미 끝난 약정은 다시 끝내지 않는다. */
export async function endPledge(db: Db, ctx: ActorContext, id: string, input: { endMonth: string; reason: string }) {
  requireAction(ctx, 'money.draft');
  const end = assertYearMonth(input.endMonth, 'endMonth');
  const reason = input.reason.trim();
  if (!reason || reason.length > 200) throw new DomainError('VALIDATION_FAILED', '사유를 1~200자로 적어 주십시오.', { reason: '1~200자' });
  const r = await db.query<{ start_month: string; end_month: string | null; ended_at: string | null }>(
    `select start_month, end_month, ended_at from pledges where id = $1 for update`, [id],
  );
  const p = r.rows[0];
  if (!p) throw new DomainError('NOT_FOUND', '약정을 찾을 수 없습니다.');
  if (p.ended_at) throw new DomainError('INVALID_STATE_TRANSITION', '이미 끝난 약정입니다.');
  if (end < toYm(p.start_month)) {
    throw new DomainError('VALIDATION_FAILED', '종료월은 시작월 이후여야 합니다.', { endMonth: '시작월 이후' });
  }
  // 이미 연결된 수입이 있는 달 이전으로는 끝낼 수 없다(납입 기록이 약정 기간 밖으로 밀려나지 않게).
  const linked = await db.query<{ m: string | null }>(
    `select max(pledge_month) as m from money_receipts where pledge_id = $1 and status not in ('REJECTED', 'REVERSED')`, [id],
  );
  const lastLinked = linked.rows[0]?.m;
  if (lastLinked && end < toYm(lastLinked)) {
    throw new DomainError('VALIDATION_FAILED', `${toYm(lastLinked)}분 수입이 연결돼 있어 그 이전으로 끝낼 수 없습니다.`, { endMonth: `${toYm(lastLinked)} 이후` });
  }
  await db.query(`update pledges set end_month = $2, ended_at = now(), ended_by = $3, end_reason = $4 where id = $1`, [id, toDate(end), ctx.userId, reason]);
  await audit(db, ctx, { category: 'LEDGER', action: 'pledge.end', resourceType: 'pledge', resourceId: id, reason });
  return { id, endMonth: end };
}

export type PledgeView = 'active' | 'ended' | 'all';

/**
 * 약정 목록과 최근 months개월(이번 달 포함)의 납입 상태.
 * current는 기관 업무일 기준 이번 달(YYYY-MM)이다.
 */
export async function listPledges(db: Db, ctx: ActorContext, q: { current: string; view?: PledgeView; months?: number; donorId?: string }) {
  requireAction(ctx, 'money.read');
  const current = assertYearMonth(q.current, 'current');
  const months = Math.min(Math.max(q.months ?? 6, 1), 12);
  const view = q.view ?? 'active';
  // 진행 중: 끝나지 않았거나 종료월이 이번 달 이후
  const cur = toDate(current);
  const where = view === 'active' ? `(p.end_month is null or p.end_month >= $1::date)`
    : view === 'ended' ? `(p.end_month is not null and p.end_month < $1::date)` : '$1::date is not null';
  const r = await db.query(
    `select p.id, p.donor_id, d.display_name as donor_name, p.fund_id, f.name as fund_name, p.facility_id, p.amount, p.method, p.memo,
            p.start_month, p.end_month, p.ended_at, p.end_reason
       from pledges p join donors d on d.id = p.donor_id join funds f on f.id = p.fund_id
      where ${where} and ($2::uuid is null or p.donor_id = $2)
      order by d.display_name, p.start_month, p.id
      limit 500`,
    [cur, q.donorId ?? null],
  );
  const ids = r.rows.map((p) => p.id as string);
  const pay = ids.length
    ? (await db.query<{ pledge_id: string; month: string; amount: string; status: string }>(
      `select pledge_id, to_char(pledge_month, 'YYYY-MM') as month, amount, status from money_receipts where pledge_id = any($1::uuid[])`, [ids],
    )).rows
    : [];
  const byPledge = new Map<string, PledgePayment[]>();
  for (const x of pay) {
    byPledge.set(x.pledge_id, [...(byPledge.get(x.pledge_id) ?? []), { month: x.month, amount: BigInt(x.amount), status: x.status as PledgePayment['status'] }]);
  }
  const window = Array.from({ length: months }, (_, i) => addMonths(current, i - months + 1));
  return {
    current,
    months: window,
    pledges: r.rows.map((p) => {
      const terms = { amount: BigInt(p.amount as string), startMonth: toYm(p.start_month as string), endMonth: p.end_month ? toYm(p.end_month as string) : null };
      const payments = byPledge.get(p.id as string) ?? [];
      const unpaid = unpaidMonths(terms, current, payments);
      return {
        id: p.id as string, donorId: p.donor_id as string, donorName: p.donor_name as string, fundId: p.fund_id as string,
        fundName: p.fund_name as string, facilityId: p.facility_id as string, amount: terms.amount.toString(), method: p.method as PledgeMethod,
        memo: (p.memo ?? null) as string | null, startMonth: terms.startMonth, endMonth: terms.endMonth,
        ended: !!p.ended_at, endReason: (p.end_reason ?? null) as string | null,
        statuses: window.map((m) => ({ month: m, status: pledgeMonthStatus(terms, m, current, payments) as PledgeMonthStatus })),
        unpaidPastMonths: unpaid.past,
        currentMonthOpen: unpaid.currentMonthOpen,
      };
    }),
  };
}

/**
 * 후원금 수입을 약정에 연결할 때의 검사: 약정 후원자와 수입 후원자가 같고, 그 달이 약정 기간 안이어야 한다.
 * 돌려주는 값은 약정 후원자(수입에 후원자를 고르지 않았을 때 채운다).
 */
export async function assertPledgeLink(db: Db, pledgeId: string, donorId: string | null, month: YearMonth): Promise<{ donorId: string }> {
  const r = await db.query<{ donor_id: string; start_month: string; end_month: string | null }>(
    `select donor_id, start_month, end_month from pledges where id = $1 for share`, [pledgeId],
  );
  const p = r.rows[0];
  if (!p) throw new DomainError('NOT_FOUND', '약정을 찾을 수 없습니다.');
  if (donorId && donorId !== p.donor_id) {
    throw new DomainError('VALIDATION_FAILED', '약정의 후원자와 수입의 후원자가 다릅니다.', { pledgeId: '후원자 불일치' });
  }
  if (month < toYm(p.start_month) || (p.end_month && month > toYm(p.end_month))) {
    throw new DomainError('VALIDATION_FAILED', `${month}은 약정 기간이 아닙니다.`, { pledgeMonth: '약정 기간 밖' });
  }
  return { donorId: p.donor_id };
}

/** 진행 중인 약정 중 지난달까지 미납(또는 일부 납입)이 있는 약정 수. 오늘의 업무에 쓴다. */
export async function countPledgesInArrears(db: Db, ctx: ActorContext, current: string): Promise<number> {
  const list = await listPledges(db, ctx, { current, view: 'active', months: 1 });
  return list.pledges.filter((p) => p.unpaidPastMonths.length > 0).length;
}
