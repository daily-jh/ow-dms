import { rolesAllow, type Role, DomainError, formatQty, parseQty, snapshotHash } from '@owdms/domain';
import type { ActorContext } from '../pool';
import { assertDate, assertPeriodOpen, audit, enqueueOutbox, requireAction, type Db } from './common';

export type CorrectionTarget = 'GOODS_RECEIPT' | 'MONEY_RECEIPT' | 'DISTRIBUTION';
export type CorrectionKind = 'REVERSAL' | 'CANCEL' | 'RETURN';

const TABLE: Record<CorrectionTarget, string> = {
  GOODS_RECEIPT: 'goods_receipts',
  MONEY_RECEIPT: 'money_receipts',
  DISTRIBUTION: 'distributions',
};

const DRAFT_ACTION = { GOODS_RECEIPT: 'goods.draft', MONEY_RECEIPT: 'money.draft', DISTRIBUTION: 'distribution.draft' } as const;

/** 대상 상태로 정정 종류를 정한다. 승인 전 거래는 정정이 아니라 초안 수정·반려 대상이다. */
function kindFor(type: CorrectionTarget, status: string): CorrectionKind {
  if (type === 'DISTRIBUTION' && status === 'APPROVED') return 'CANCEL';
  if (type === 'DISTRIBUTION' && status === 'POSTED') return 'RETURN';
  if (type !== 'DISTRIBUTION' && status === 'APPROVED') return 'REVERSAL';
  throw new DomainError('INVALID_STATE_TRANSITION', '승인(또는 출고)된 거래만 정정을 요청할 수 있습니다.');
}

/** 입고 역거래 가능 여부: 해당 입고의 로트가 입고 이후 한 번도 움직이지 않았어야 한다. */
async function assertGoodsReversible(db: Db, receiptId: string, lock: boolean) {
  const lots = await db.query<{ lot_id: string; warehouse_id: string; quantity: string; ledger_id: string }>(
    `select lt.id as lot_id, l.warehouse_id, l.quantity,
            (select id from stock_ledger s where s.lot_id = lt.id and s.ref_id = l.receipt_id and s.movement_type = 'RECEIPT') as ledger_id
       from goods_receipt_lines l join lots lt on lt.receipt_line_id = l.id
      where l.receipt_id = $1 order by lt.id`,
    [receiptId],
  );
  const result = [];
  for (const lot of lots.rows) {
    const b = await db.query<{ on_hand: string; reserved: string }>(
      `select on_hand, reserved from stock_balances where lot_id = $1 and warehouse_id = $2 ${lock ? 'for update' : ''}`,
      [lot.lot_id, lot.warehouse_id],
    );
    const moves = await db.query<{ n: number }>(`select count(*)::int as n from stock_ledger where lot_id = $1`, [lot.lot_id]);
    const bal = b.rows[0];
    if (!bal || moves.rows[0]!.n !== 1 || parseQty(bal.on_hand) !== parseQty(lot.quantity) || parseQty(bal.reserved) !== 0n) {
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        '이미 배분·예약·이동된 로트가 있어 입고 역거래를 할 수 없습니다. 배분 취소·반품 또는 재고조정 절차를 먼저 진행하십시오.',
      );
    }
    result.push({ ...lot, qty: parseQty(lot.quantity) });
  }
  return result;
}

export async function requestCorrection(
  db: Db,
  ctx: ActorContext,
  input: { targetType: CorrectionTarget; targetId: string; reason: string; businessDate: string; inspectionConfirmed?: boolean },
) {
  requireAction(ctx, 'approval.request');
  requireAction(ctx, DRAFT_ACTION[input.targetType]);
  assertDate(input.businessDate, 'businessDate');
  const reason = input.reason?.trim();
  if (!reason) throw new DomainError('VALIDATION_FAILED', '정정 사유를 입력하십시오.', { reason: '필수' });
  const t = await db.query<{ status: string; version: number; snapshot_hash: string | null }>(
    `select status, version, snapshot_hash from ${TABLE[input.targetType]} where id = $1 for update`,
    [input.targetId],
  );
  const target = t.rows[0];
  if (!target) throw new DomainError('NOT_FOUND', '대상을 찾을 수 없습니다.');
  const kind = kindFor(input.targetType, target.status);
  if (kind === 'RETURN' && !input.inspectionConfirmed) {
    throw new DomainError('VALIDATION_FAILED', '반품은 물품 회수와 상태검사 확인이 필요합니다.', { inspectionConfirmed: '확인 필요' });
  }
  if (input.targetType === 'GOODS_RECEIPT') await assertGoodsReversible(db, input.targetId, false);
  // 정정은 정정일(업무일) 기간에 기록한다. 원거래 기간이 마감되어도 이후 열린 기간에 역거래할 수 있다.
  await assertPeriodOpen(db, input.businessDate);
  const open = await db.query(`select 1 from correction_events where target_id = $1 and status = 'PENDING_APPROVAL'`, [input.targetId]);
  if (open.rowCount) throw new DomainError('INVALID_STATE_TRANSITION', '이미 처리 대기 중인 정정 요청이 있습니다.');

  const c = await db.query<{ id: string }>(
    `insert into correction_events (tenant_id, target_type, target_id, target_version, target_snapshot_hash, kind, business_date, reason,
       requested_by, inspection_confirmed)
     values (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [input.targetType, input.targetId, target.version, target.snapshot_hash, kind, input.businessDate, reason, ctx.userId, Boolean(input.inspectionConfirmed)],
  );
  const correctionId = c.rows[0]!.id;
  const snapshot = {
    type: 'CORRECTION', id: correctionId, version: 1, kind, reason, businessDate: input.businessDate,
    inspectionConfirmed: Boolean(input.inspectionConfirmed),
    target: { type: input.targetType, id: input.targetId, version: target.version, status: target.status, snapshotHash: target.snapshot_hash },
  };
  const a = await db.query<{ id: string }>(
    `insert into approvals (tenant_id, target_type, target_id, target_version, snapshot, snapshot_hash, requested_by)
     values (app_tenant(), 'CORRECTION', $1, 1, $2, $3, $4) returning id`,
    [correctionId, JSON.stringify(snapshot), snapshotHash(snapshot), ctx.userId],
  );
  await audit(db, ctx, { category: 'LEDGER', action: 'correction.request', resourceType: input.targetType, resourceId: input.targetId, reason });
  return { correctionId, approvalId: a.rows[0]!.id, kind };
}

/** decideApproval(승인)에서 같은 트랜잭션으로 호출된다. */
export async function applyCorrection(db: Db, ctx: ActorContext, correctionId: string) {
  const c = await db.query(`select * from correction_events where id = $1 for update`, [correctionId]);
  const ce = c.rows[0];
  if (!ce) throw new DomainError('NOT_FOUND', '정정 요청을 찾을 수 없습니다.');
  if (ce.status !== 'PENDING_APPROVAL') throw new DomainError('INVALID_STATE_TRANSITION', '이미 처리된 정정 요청입니다.');
  const type = ce.target_type as CorrectionTarget;
  const t = await db.query<{ status: string; version: number }>(`select status, version from ${TABLE[type]} where id = $1 for update`, [ce.target_id]);
  const target = t.rows[0]!;
  if (target.version !== ce.target_version || kindFor(type, target.status) !== ce.kind) {
    throw new DomainError('STALE_VERSION', '정정 요청 이후 원거래 상태가 바뀌었습니다. 다시 요청하십시오.');
  }
  await assertPeriodOpen(db, ce.business_date);

  let newStatus: string;
  if (type === 'GOODS_RECEIPT') {
    const lots = await assertGoodsReversible(db, ce.target_id, true);
    for (const lot of lots) {
      await db.query(
        `insert into stock_ledger (tenant_id, lot_id, warehouse_id, movement_type, quantity_delta, ref_type, ref_id, reverses_id, created_by)
         values (app_tenant(), $1, $2, 'REVERSAL_OUT', $3, 'CORRECTION', $4, $5, $6)`,
        [lot.lot_id, lot.warehouse_id, formatQty(-lot.qty), correctionId, lot.ledger_id, ctx.userId],
      );
      await db.query(`update stock_balances set on_hand = 0, updated_at = now() where lot_id = $1 and warehouse_id = $2`, [lot.lot_id, lot.warehouse_id]);
    }
    newStatus = 'REVERSED';
  } else if (type === 'MONEY_RECEIPT') {
    newStatus = 'REVERSED';
  } else {
    const lines = await db.query<{ lot_id: string; warehouse_id: string; quantity: string }>(
      `select lot_id, warehouse_id, sum(quantity) as quantity from distribution_lines where distribution_id = $1
        group by lot_id, warehouse_id order by lot_id, warehouse_id`,
      [ce.target_id],
    );
    for (const l of lines.rows) {
      await db.query(`select 1 from stock_balances where lot_id = $1 and warehouse_id = $2 for update`, [l.lot_id, l.warehouse_id]);
      if (ce.kind === 'CANCEL') {
        // 실제 인도 전 취소: 예약만 해제(원장 변화 없음)
        await db.query(`update stock_balances set reserved = reserved - $3, updated_at = now() where lot_id = $1 and warehouse_id = $2`, [
          l.lot_id, l.warehouse_id, l.quantity,
        ]);
      } else {
        // 인도 후 반품: 회수·상태검사 확인 후 배분반품(+), 원 출고 행 참조
        const orig = await db.query<{ id: string }>(
          `select id from stock_ledger where ref_id = $1 and lot_id = $2 and warehouse_id = $3 and movement_type = 'DISTRIBUTION' order by id limit 1`,
          [ce.target_id, l.lot_id, l.warehouse_id],
        );
        await db.query(
          `insert into stock_ledger (tenant_id, lot_id, warehouse_id, movement_type, quantity_delta, ref_type, ref_id, reverses_id, created_by)
           values (app_tenant(), $1, $2, 'DISTRIBUTION_RETURN', $3, 'CORRECTION', $4, $5, $6)`,
          [l.lot_id, l.warehouse_id, formatQty(parseQty(l.quantity)), correctionId, orig.rows[0]?.id ?? null, ctx.userId],
        );
        await db.query(`update stock_balances set on_hand = on_hand + $3, updated_at = now() where lot_id = $1 and warehouse_id = $2`, [
          l.lot_id, l.warehouse_id, l.quantity,
        ]);
      }
    }
    newStatus = ce.kind === 'CANCEL' ? 'CANCELLED' : 'RETURNED';
  }
  await db.query(`update ${TABLE[type]} set status = $2 where id = $1`, [ce.target_id, newStatus]);

  // 외부연계: 이미 등록확인된 행은 공식 정정 필요, 준비·다운로드만 된 행은 무효화
  const flagged = await db.query(
    `update integration_rows set
        state = case when state = 'VERIFIED' then 'CORRECTION_REQUIRED'
                     when state in ('VALIDATED', 'PREPARED', 'EXPORTED') then 'NOT_READY'
                     else state end,
        issues = issues || jsonb_build_array(jsonb_build_object('code', 'SOURCE_CORRECTED', 'correctionId', $2::text)),
        updated_at = now()
      where source_id = $1 and state not in ('NOT_READY', 'REJECTED', 'CORRECTION_REQUIRED')`,
    [ce.target_id, correctionId],
  );
  await db.query(`update correction_events set status = 'APPROVED', applied_at = now() where id = $1`, [correctionId]);
  await enqueueOutbox(db, {
    tenantId: ctx.tenantId, eventType: 'correction.applied', aggregateType: 'CORRECTION', aggregateId: correctionId, aggregateVersion: 1,
    payload: { targetType: type, targetId: ce.target_id, kind: ce.kind },
  });
  await audit(db, ctx, { category: 'LEDGER', action: `correction.apply.${ce.kind.toLowerCase()}`, resourceType: type, resourceId: ce.target_id });
  return { status: newStatus, integrationRowsFlagged: flagged.rowCount ?? 0 };
}

export async function rejectCorrection(db: Db, correctionId: string) {
  await db.query(`update correction_events set status = 'REJECTED' where id = $1 and status = 'PENDING_APPROVAL'`, [correctionId]);
}

export async function listCorrections(db: Db, ctx: ActorContext, q: { targetId?: string } = {}) {
  requireAction(ctx, 'goods.read');
  const r = await db.query(
    `select c.id, c.target_type, c.target_id, c.kind, c.business_date, c.reason, c.status, c.requested_at, c.applied_at, u.display_name
       from correction_events c join users u on u.id = c.requested_by
      where ($1::uuid is null or c.target_id = $1) and ($2::boolean or c.target_type <> 'MONEY_RECEIPT') order by c.requested_at desc, c.id limit 200`,
    [q.targetId ?? null, rolesAllow(ctx.roles as Role[], 'money.read')],
  );
  return r.rows.map((c) => ({
    id: c.id as string, targetType: c.target_type as string, targetId: c.target_id as string, kind: c.kind as CorrectionKind,
    businessDate: c.business_date as string, reason: c.reason as string, status: c.status as string,
    requestedAt: (c.requested_at as Date).toISOString(), appliedAt: (c.applied_at as Date | null)?.toISOString() ?? null,
    requestedByName: c.display_name as string,
  }));
}
