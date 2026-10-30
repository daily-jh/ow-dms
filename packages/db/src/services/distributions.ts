import { DomainError, assertCanIssue, formatQty, parsePositiveQty, parseQty, type Qty } from '@owdms/domain';
import type { ActorContext } from '../pool';
import { assertActiveMaster, assertDate, assertPeriodOpen, audit, enqueueOutbox, requireAction, type Db } from './common';

export async function createDistributionDraft(
  db: Db,
  ctx: ActorContext,
  input: {
    facilityId: string;
    programName: string;
    recipientRef?: string | null;
    plannedOn: string;
    lines: { lotId: string; warehouseId: string; quantity: string }[];
  },
): Promise<{ id: string; version: number }> {
  requireAction(ctx, 'distribution.draft');
  assertDate(input.plannedOn, 'plannedOn');
  const program = input.programName?.trim();
  if (!program) throw new DomainError('VALIDATION_FAILED', '사업명을 입력하십시오.', { programName: '필수' });
  if (input.recipientRef && !/^[A-Za-z0-9-]{1,40}$/.test(input.recipientRef)) {
    // 수혜자 실명·연락처 대신 제한된 대상자 ID만 받는다.
    throw new DomainError('VALIDATION_FAILED', '수혜자는 대상자 ID(영문·숫자)로만 입력합니다.', { recipientRef: '대상자 ID' });
  }
  if (!input.lines?.length) throw new DomainError('VALIDATION_FAILED', '배분 품목을 입력하십시오.', { lines: '1행 이상' });
  await assertPeriodOpen(db, input.plannedOn);
  await assertActiveMaster(db, 'facilities', [input.facilityId]);
  await assertActiveMaster(db, 'warehouses', input.lines.map(l => l.warehouseId));
  for (const l of input.lines) {
    if (!(await db.query('select 1 from lots where id = $1', [l.lotId])).rowCount) throw new DomainError('NOT_FOUND', '재고를 찾을 수 없습니다.');
    const match = await db.query(`select 1 from warehouses w join stock_balances b on b.warehouse_id = w.id where w.id = $1 and w.facility_id = $2 and b.lot_id = $3`, [l.warehouseId, input.facilityId, l.lotId]);
    if (!match.rowCount) throw new DomainError('VALIDATION_FAILED', '선택한 시설의 창고·재고를 선택해 주세요.');
  }
  const r = await db.query<{ id: string; version: number }>(
    `insert into distributions (tenant_id, facility_id, program_name, recipient_ref, planned_on, created_by)
     values (app_tenant(), $1, $2, $3, $4, $5) returning id, version`,
    [input.facilityId, program, input.recipientRef ?? null, input.plannedOn, ctx.userId],
  );
  const { id, version } = r.rows[0]!;
  let n = 0;
  for (const l of input.lines) {
    n += 1;
    const qty = parsePositiveQty(l.quantity, `lines[${n - 1}].quantity`);
    await db.query(
      `insert into distribution_lines (tenant_id, distribution_id, line_no, lot_id, warehouse_id, quantity)
       values (app_tenant(), $1, $2, $3, $4, $5)`,
      [id, n, l.lotId, l.warehouseId, formatQty(qty)],
    );
  }
  await audit(db, ctx, { category: 'LEDGER', action: 'distribution.draft', resourceType: 'distribution', resourceId: id });
  return { id, version };
}

type LineKey = { lotId: string; warehouseId: string; quantity: Qty };

async function loadLines(db: Db, distributionId: string): Promise<LineKey[]> {
  const r = await db.query<{ lot_id: string; warehouse_id: string; quantity: string }>(
    `select lot_id, warehouse_id, sum(quantity) as quantity from distribution_lines
      where distribution_id = $1 group by lot_id, warehouse_id order by lot_id, warehouse_id`,
    [distributionId],
  );
  return r.rows.map((l) => ({ lotId: l.lot_id, warehouseId: l.warehouse_id, quantity: parseQty(l.quantity) }));
}

/**
 * 잔고 행을 (lot_id, warehouse_id) 순서로 잠근다. 교착을 피하려 항상 같은 순서를 쓴다.
 * 캐시 잔고가 아니라 잠긴 행의 값으로 판정한다.
 */
async function lockBalances(db: Db, lines: LineKey[]) {
  const locked = new Map<string, { onHand: Qty; reserved: Qty; expiresOn: string | null }>();
  for (const l of lines) {
    const r = await db.query<{ on_hand: string; reserved: string; expires_on: string | null }>(
      `select b.on_hand, b.reserved, lt.expires_on
         from stock_balances b join lots lt on lt.id = b.lot_id
        where b.lot_id = $1 and b.warehouse_id = $2
        for update of b`,
      [l.lotId, l.warehouseId],
    );
    const row = r.rows[0];
    if (!row) throw new DomainError('INSUFFICIENT_STOCK', '해당 로트·창고에 재고가 없습니다.');
    locked.set(`${l.lotId}:${l.warehouseId}`, { onHand: parseQty(row.on_hand), reserved: parseQty(row.reserved), expiresOn: row.expires_on });
  }
  return locked;
}

/** 승인 시: 예약 확보(원장 출고 아님). 가용량 = 현재고 - 유효예약량. */
export async function reserveForDistribution(db: Db, distributionId: string, plannedOn: string): Promise<void> {
  const lines = await loadLines(db, distributionId);
  const locked = await lockBalances(db, lines);
  for (const l of lines) {
    const b = locked.get(`${l.lotId}:${l.warehouseId}`)!;
    assertCanIssue({ onHand: b.onHand, activeReserved: b.reserved, requested: l.quantity, expiresOn: b.expiresOn, businessDate: plannedOn });
    await db.query(
      `update stock_balances set reserved = reserved + $3, updated_at = now() where lot_id = $1 and warehouse_id = $2`,
      [l.lotId, l.warehouseId, formatQty(l.quantity)],
    );
  }
}

/** 승인된 배분의 실제 출고 반영: 예약 해제 + 원장(-) + 잔고 감소를 한 트랜잭션에서. */
export async function postDistribution(db: Db, ctx: ActorContext, distributionId: string): Promise<{ status: 'POSTED'; alreadyPosted: boolean }> {
  requireAction(ctx, 'distribution.draft');
  const h = await db.query<{ status: string; planned_on: string; version: number }>(
    `select status, planned_on, version from distributions where id = $1 for update`,
    [distributionId],
  );
  const d = h.rows[0];
  if (!d) throw new DomainError('NOT_FOUND', '배분을 찾을 수 없습니다.');
  if (d.status === 'POSTED') return { status: 'POSTED', alreadyPosted: true };
  if (d.status !== 'APPROVED') throw new DomainError('INVALID_STATE_TRANSITION', '승인된 배분만 출고할 수 있습니다.');
  await assertPeriodOpen(db, d.planned_on);
  const lines = await loadLines(db, distributionId);
  const locked = await lockBalances(db, lines);
  for (const l of lines) {
    const b = locked.get(`${l.lotId}:${l.warehouseId}`)!;
    if (b.reserved < l.quantity || b.onHand < l.quantity) throw new DomainError('INSUFFICIENT_STOCK', '예약 또는 재고가 부족합니다.');
    await db.query(
      `update stock_balances set reserved = reserved - $3, on_hand = on_hand - $3, updated_at = now()
        where lot_id = $1 and warehouse_id = $2`,
      [l.lotId, l.warehouseId, formatQty(l.quantity)],
    );
    await db.query(
      `insert into stock_ledger (tenant_id, lot_id, warehouse_id, movement_type, quantity_delta, ref_type, ref_id, created_by)
       values (app_tenant(), $1, $2, 'DISTRIBUTION', $3, 'DISTRIBUTION', $4, $5)`,
      [l.lotId, l.warehouseId, formatQty(-l.quantity), distributionId, ctx.userId],
    );
  }
  await db.query(`update distributions set status = 'POSTED', posted_at = now(), posted_by = $2 where id = $1`, [distributionId, ctx.userId]);
  await enqueueOutbox(db, {
    tenantId: ctx.tenantId, eventType: 'distribution.posted', aggregateType: 'DISTRIBUTION', aggregateId: distributionId,
    aggregateVersion: d.version, payload: { distributionId },
  });
  await audit(db, ctx, { category: 'LEDGER', action: 'distribution.post', resourceType: 'distribution', resourceId: distributionId });
  return { status: 'POSTED', alreadyPosted: false };
}

export async function getDistributionSnapshot(db: Db, id: string) {
  const h = await db.query(
    `select d.*, f.name as facility_name from distributions d join facilities f on f.id = d.facility_id where d.id = $1`,
    [id],
  );
  const d = h.rows[0];
  if (!d) throw new DomainError('NOT_FOUND', '배분을 찾을 수 없습니다.');
  const lines = await db.query(
    `select dl.line_no, dl.lot_id, dl.warehouse_id, dl.quantity, lt.lot_code, lt.unit, i.name as item_name, w.name as warehouse_name,
            gl.receipt_id as source_receipt_id
       from distribution_lines dl
       join lots lt on lt.id = dl.lot_id
       join items i on i.id = lt.item_id
       join warehouses w on w.id = dl.warehouse_id
       join goods_receipt_lines gl on gl.id = lt.receipt_line_id
      where dl.distribution_id = $1 order by dl.line_no`,
    [id],
  );
  return {
    row: d,
    snapshot: {
      type: 'DISTRIBUTION', id: d.id, version: d.version, facilityId: d.facility_id, facilityName: d.facility_name,
      programName: d.program_name, recipientRef: d.recipient_ref, plannedOn: d.planned_on,
      lines: lines.rows.map((l) => ({
        lineNo: l.line_no, lotId: l.lot_id, lotCode: l.lot_code, itemName: l.item_name, warehouseId: l.warehouse_id,
        warehouseName: l.warehouse_name, quantity: formatQty(parseQty(l.quantity)), unit: l.unit, sourceReceiptId: l.source_receipt_id,
      })),
    },
  };
}

export async function listDistributions(db: Db, ctx: ActorContext) {
  requireAction(ctx, 'goods.read');
  const r = await db.query(
    `select d.id, d.program_name, d.planned_on, d.status, d.version, d.recipient_ref,
            (select coalesce(sum(quantity), 0) from distribution_lines l where l.distribution_id = d.id) as total_quantity
       from distributions d order by d.planned_on desc, d.created_at desc, d.id limit 200`,
  );
  return r.rows.map((d) => ({
    id: d.id as string, programName: d.program_name as string, plannedOn: d.planned_on as string, status: d.status as string,
    version: d.version as number, recipientRef: d.recipient_ref as string | null, totalQuantity: formatQty(parseQty(d.total_quantity)),
  }));
}
