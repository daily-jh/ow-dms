import { DomainError, assertFundLinesMatch, parsePositiveWon } from '@owdms/domain';
import type { ActorContext } from '../pool';
import { assertActiveMaster, assertDate, assertPeriodOpen, audit, requireAction, type Db } from './common';

export type MoneyMethod = 'BANK_TRANSFER' | 'CASH' | 'CMS' | 'CARD' | 'OTHER';

export async function createMoneyReceiptDraft(
  db: Db,
  ctx: ActorContext,
  input: {
    facilityId: string;
    donorId?: string | null;
    receivedOn: string;
    amount: string;
    method: MoneyMethod;
    memo?: string | null;
    fundLines: { fundId: string; amount: string }[];
  },
): Promise<{ id: string; version: number }> {
  requireAction(ctx, 'money.draft');
  assertDate(input.receivedOn, 'receivedOn');
  const amount = parsePositiveWon(input.amount);
  const lines = (input.fundLines ?? []).map((l, i) => ({ fundId: l.fundId, amount: parsePositiveWon(l.amount, `fundLines[${i}].amount`) }));
  assertFundLinesMatch(amount, lines);
  await assertPeriodOpen(db, input.receivedOn);
  await assertActiveMaster(db, 'facilities', [input.facilityId]);
  await assertActiveMaster(db, 'funds', lines.map((l) => l.fundId));
  const r = await db.query<{ id: string; version: number }>(
    `insert into money_receipts (tenant_id, facility_id, donor_id, received_on, amount, method, memo, created_by)
     values (app_tenant(), $1, $2, $3, $4, $5, $6, $7) returning id, version`,
    [input.facilityId, input.donorId ?? null, input.receivedOn, amount.toString(), input.method, input.memo ?? null, ctx.userId],
  );
  const { id, version } = r.rows[0]!;
  for (const l of lines) {
    await db.query(`insert into receipt_fund_lines (tenant_id, receipt_id, fund_id, amount) values (app_tenant(), $1, $2, $3)`, [
      id, l.fundId, l.amount.toString(),
    ]);
  }
  await audit(db, ctx, { category: 'LEDGER', action: 'money_receipt.draft', resourceType: 'money_receipt', resourceId: id });
  return { id, version };
}

export async function listMoneyReceipts(db: Db, ctx: ActorContext, q: { limit?: number } = {}) {
  requireAction(ctx, 'money.read');
  const r = await db.query(
    `select m.id, m.received_on, m.amount, m.method, m.status, m.version, d.display_name as donor_name
       from money_receipts m left join donors d on d.id = m.donor_id
      order by m.received_on desc, m.created_at desc, m.id limit $1`,
    [Math.min(Math.max(q.limit ?? 50, 1), 200)],
  );
  return r.rows.map((m) => ({
    id: m.id as string, receivedOn: m.received_on as string, amount: m.amount as string, method: m.method as string,
    status: m.status as string, version: m.version as number, donorName: (m.donor_name ?? null) as string | null,
  }));
}

export async function getMoneyReceiptSnapshot(db: Db, id: string) {
  const h = await db.query(`select * from money_receipts where id = $1`, [id]);
  const m = h.rows[0];
  if (!m) throw new DomainError('NOT_FOUND', '후원금 수입을 찾을 수 없습니다.');
  const lines = await db.query(`select fund_id, amount from receipt_fund_lines where receipt_id = $1 order by fund_id, amount`, [id]);
  return {
    row: m,
    snapshot: {
      type: 'MONEY_RECEIPT', id: m.id, version: m.version, facilityId: m.facility_id, donorId: m.donor_id, receivedOn: m.received_on,
      amount: m.amount, method: m.method, memo: m.memo,
      fundLines: lines.rows.map((l) => ({ fundId: l.fund_id, amount: l.amount })),
    },
  };
}
