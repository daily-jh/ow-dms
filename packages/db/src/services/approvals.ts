import { DomainError, assertCanDecide, assertFundLinesMatch, formatQty, parseQty, parseWon, snapshotHash } from '@owdms/domain';
import type { ActorContext } from '../pool';
import { assertPeriodOpen, audit, enqueueOutbox, requireAction, type Db } from './common';
import { getDistributionSnapshot, reserveForDistribution } from './distributions';
import { getMoneyReceiptSnapshot } from './money';

export type ApprovalTarget = 'GOODS_RECEIPT' | 'MONEY_RECEIPT' | 'DISTRIBUTION';

const TABLE: Record<ApprovalTarget, string> = {
  GOODS_RECEIPT: 'goods_receipts',
  MONEY_RECEIPT: 'money_receipts',
  DISTRIBUTION: 'distributions',
};

async function goodsReceiptSnapshot(db: Db, id: string) {
  const h = await db.query(`select * from goods_receipts where id = $1`, [id]);
  const g = h.rows[0];
  if (!g) throw new DomainError('NOT_FOUND', '후원품 수입을 찾을 수 없습니다.');
  const lines = await db.query(`select * from goods_receipt_lines where receipt_id = $1 order by line_no`, [id]);
  return {
    row: g,
    lines: lines.rows,
    snapshot: {
      type: 'GOODS_RECEIPT', id: g.id, version: g.version, facilityId: g.facility_id, donorId: g.donor_id, receivedOn: g.received_on,
      memo: g.memo,
      lines: lines.rows.map((l) => ({
        lineNo: l.line_no, itemId: l.item_id, warehouseId: l.warehouse_id, quantity: formatQty(parseQty(l.quantity)), unit: l.unit,
        unitConversion: l.unit_conversion, expiresOn: l.expires_on, valuationStatus: l.valuation_status, unitValue: l.unit_value,
        totalValue: l.total_value, valuationBasis: l.valuation_basis,
      })),
    },
  };
}

async function loadTarget(db: Db, type: ApprovalTarget, id: string) {
  if (type === 'GOODS_RECEIPT') return goodsReceiptSnapshot(db, id);
  if (type === 'MONEY_RECEIPT') return getMoneyReceiptSnapshot(db, id);
  return getDistributionSnapshot(db, id);
}

function businessDate(type: ApprovalTarget, row: Record<string, string>): string {
  return type === 'DISTRIBUTION' ? row.planned_on! : row.received_on!;
}

/** 초안을 승인 요청한다. 스냅샷 해시를 고정해 승인·문서·연계가 같은 버전을 쓰게 한다. */
export async function requestApproval(db: Db, ctx: ActorContext, type: ApprovalTarget, targetId: string) {
  requireAction(ctx, 'approval.request');
  const lockRow = await db.query(`select status, version from ${TABLE[type]} where id = $1 for update`, [targetId]);
  const row = lockRow.rows[0];
  if (!row) throw new DomainError('NOT_FOUND', '대상을 찾을 수 없습니다.');
  if (!['DRAFT', 'REJECTED'].includes(row.status)) throw new DomainError('INVALID_STATE_TRANSITION', '초안 또는 반려 상태만 승인 요청할 수 있습니다.');
  const t = await loadTarget(db, type, targetId);
  await assertPeriodOpen(db, businessDate(type, t.row));
  const hash = snapshotHash(t.snapshot);
  const r = await db.query<{ id: string }>(
    `insert into approvals (tenant_id, target_type, target_id, target_version, snapshot, snapshot_hash, requested_by)
     values (app_tenant(), $1, $2, $3, $4, $5, $6) returning id`,
    [type, targetId, row.version, JSON.stringify(t.snapshot), hash, ctx.userId],
  );
  await db.query(`update ${TABLE[type]} set status = 'PENDING_APPROVAL' where id = $1`, [targetId]);
  await audit(db, ctx, { category: 'LEDGER', action: 'approval.request', resourceType: type, resourceId: targetId });
  return { approvalId: r.rows[0]!.id, snapshotHash: hash };
}

/**
 * 승인/반려. 승인과 원장·잔고·outbox 반영을 같은 트랜잭션에서 수행한다(호출자가 withTenant로 감쌈).
 */
export async function decideApproval(
  db: Db,
  ctx: ActorContext,
  approvalId: string,
  decision: { decision: 'APPROVE' | 'REJECT'; reason?: string | null },
) {
  requireAction(ctx, 'approval.decide');
  const a = await db.query(`select * from approvals where id = $1 for update`, [approvalId]);
  const ap = a.rows[0];
  if (!ap) throw new DomainError('NOT_FOUND', '승인 요청을 찾을 수 없습니다.');
  const type = ap.target_type as ApprovalTarget;
  const target = await db.query(`select status, version from ${TABLE[type]} where id = $1 for update`, [ap.target_id]);
  const tr = target.rows[0];
  if (!tr) throw new DomainError('NOT_FOUND', '대상을 찾을 수 없습니다.');
  assertCanDecide({
    approvalStatus: ap.status, requestedBy: ap.requested_by, decidedBy: ctx.userId, approvalTargetVersion: ap.target_version,
    currentTargetVersion: tr.version, selfApprovalException: ctx.selfApprovalException,
  });

  if (decision.decision === 'REJECT') {
    if (!decision.reason?.trim()) throw new DomainError('VALIDATION_FAILED', '반려 사유를 입력하십시오.', { reason: '필수' });
    await db.query(`update approvals set status = 'REJECTED', decided_by = $2, decided_at = now(), reason = $3 where id = $1`, [
      approvalId, ctx.userId, decision.reason,
    ]);
    await db.query(`update ${TABLE[type]} set status = 'REJECTED' where id = $1`, [ap.target_id]);
    await audit(db, ctx, { category: 'LEDGER', action: 'approval.reject', resourceType: type, resourceId: ap.target_id });
    return { status: 'REJECTED' as const };
  }

  // 요청 당시 스냅샷과 현재 내용이 같은지 재확인(T24 계열: 오래된 스냅샷 승인 차단)
  const current = await loadTarget(db, type, ap.target_id);
  if (snapshotHash(current.snapshot) !== ap.snapshot_hash) {
    throw new DomainError('STALE_VERSION', '승인 요청 이후 내용이 바뀌었습니다. 다시 요청하십시오.');
  }
  await assertPeriodOpen(db, businessDate(type, current.row));

  if (type === 'GOODS_RECEIPT') await applyGoodsReceipt(db, ctx, ap.target_id, current as Awaited<ReturnType<typeof goodsReceiptSnapshot>>);
  if (type === 'MONEY_RECEIPT') {
    const s = current.snapshot as { amount: string; fundLines: { amount: string }[] };
    assertFundLinesMatch(parseWon(s.amount), s.fundLines.map((l) => ({ amount: parseWon(l.amount) })));
  }
  if (type === 'DISTRIBUTION') await reserveForDistribution(db, ap.target_id, current.row.planned_on);

  await db.query(`update ${TABLE[type]} set status = 'APPROVED', approved_at = now(), snapshot_hash = $2 where id = $1`, [
    ap.target_id, ap.snapshot_hash,
  ]);
  await db.query(`update approvals set status = 'APPROVED', decided_by = $2, decided_at = now(), reason = $3 where id = $1`, [
    approvalId, ctx.userId, decision.reason ?? null,
  ]);
  await enqueueOutbox(db, {
    tenantId: ctx.tenantId, eventType: `${type.toLowerCase()}.approved`, aggregateType: type, aggregateId: ap.target_id,
    aggregateVersion: tr.version, payload: { targetId: ap.target_id, snapshotHash: ap.snapshot_hash },
  });
  await audit(db, ctx, { category: 'LEDGER', action: 'approval.approve', resourceType: type, resourceId: ap.target_id });
  return { status: 'APPROVED' as const };
}

async function applyGoodsReceipt(db: Db, ctx: ActorContext, receiptId: string, t: Awaited<ReturnType<typeof goodsReceiptSnapshot>>) {
  const datePart = String(t.row.received_on).replaceAll('-', '');
  for (const l of t.lines) {
    const lotCode = `L${datePart}-${receiptId.slice(0, 8)}-${l.line_no}`;
    const lot = await db.query<{ id: string }>(
      `insert into lots (tenant_id, item_id, receipt_line_id, lot_code, unit, received_on, expires_on)
       values (app_tenant(), $1, $2, $3, $4, $5, $6) returning id`,
      [l.item_id, l.id, lotCode, l.unit, t.row.received_on, l.expires_on],
    );
    const lotId = lot.rows[0]!.id;
    await db.query(
      `insert into stock_ledger (tenant_id, lot_id, warehouse_id, movement_type, quantity_delta, ref_type, ref_id, created_by)
       values (app_tenant(), $1, $2, 'RECEIPT', $3, 'GOODS_RECEIPT', $4, $5)`,
      [lotId, l.warehouse_id, l.quantity, receiptId, ctx.userId],
    );
    await db.query(
      `insert into stock_balances (tenant_id, lot_id, warehouse_id, on_hand) values (app_tenant(), $1, $2, $3)`,
      [lotId, l.warehouse_id, l.quantity],
    );
  }
}

export async function listApprovals(db: Db, ctx: ActorContext, q: { status?: string } = {}) {
  requireAction(ctx, 'goods.read');
  const r = await db.query(
    `select a.id, a.target_type, a.target_id, a.target_version, a.status, a.snapshot, a.snapshot_hash, a.requested_at, a.decided_at,
            a.reason, a.requested_by, ru.display_name as requested_by_name, du.display_name as decided_by_name
       from approvals a join users ru on ru.id = a.requested_by left join users du on du.id = a.decided_by
      where ($1::text is null or a.status = $1)
      order by a.requested_at desc, a.id limit 200`,
    [q.status ?? null],
  );
  return r.rows.map((a) => ({
    id: a.id as string, targetType: a.target_type as ApprovalTarget, targetId: a.target_id as string, targetVersion: a.target_version as number,
    status: a.status as string, snapshot: a.snapshot as Record<string, unknown>, snapshotHash: a.snapshot_hash as string,
    requestedAt: (a.requested_at as Date).toISOString(), decidedAt: (a.decided_at as Date | null)?.toISOString() ?? null,
    reason: a.reason as string | null, requestedBy: a.requested_by as string, requestedByName: a.requested_by_name as string,
    decidedByName: (a.decided_by_name ?? null) as string | null,
  }));
}
