import type { ActorContext } from '../pool';
import { requireAction, type Db } from './common';

/** 오늘의 업무: 합계보다 처리할 일(승인대기·가액 미확정·유효기한 임박·외부확인 대기)을 먼저 보여준다. */
export async function todayDashboard(db: Db, ctx: ActorContext, businessDate: string) {
  requireAction(ctx, 'goods.read');
  const r = await db.query(
    `select
       (select count(*) from approvals where status = 'PENDING')::int as pending_approvals,
       (select count(*) from goods_receipts where status in ('DRAFT', 'REJECTED'))::int as goods_drafts,
       (select count(*) from money_receipts where status in ('DRAFT', 'REJECTED'))::int as money_drafts,
       (select count(*) from goods_receipt_lines l join goods_receipts g on g.id = l.receipt_id
         where g.status = 'APPROVED' and l.valuation_status <> 'CONFIRMED')::int as unconfirmed_valuations,
       (select count(*) from stock_balances b join lots lt on lt.id = b.lot_id
         where b.on_hand > 0 and lt.expires_on is not null and lt.expires_on <= $1::date + 30)::int as expiring_lots,
       (select count(*) from distributions where status = 'APPROVED')::int as distributions_to_post,
       (select count(*) from integration_rows where state in ('EXPORTED', 'SUBMITTED', 'ACKNOWLEDGED', 'UNKNOWN'))::int as external_pending,
       (select coalesce(sum(amount), 0) from money_receipts where status = 'APPROVED'
         and date_trunc('month', received_on) = date_trunc('month', $1::date)) as month_confirmed_income,
       (select count(*) from goods_receipts where status = 'APPROVED'
         and date_trunc('month', received_on) = date_trunc('month', $1::date))::int as month_goods_receipts`,
    [businessDate],
  );
  const x = r.rows[0];
  return {
    businessDate,
    pendingApprovals: x.pending_approvals as number,
    goodsDrafts: x.goods_drafts as number,
    moneyDrafts: x.money_drafts as number,
    unconfirmedValuations: x.unconfirmed_valuations as number,
    expiringLots: x.expiring_lots as number,
    distributionsToPost: x.distributions_to_post as number,
    externalPending: x.external_pending as number,
    // 집계 기준: 승인된 수납, 실제 수납일(received_on) 기준
    monthConfirmedIncome: x.month_confirmed_income as string,
    monthGoodsReceipts: x.month_goods_receipts as number,
  };
}
