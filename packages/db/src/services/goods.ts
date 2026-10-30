import { DomainError, formatQty, parsePositiveQty, parseWon } from '@owdms/domain';
import type { ActorContext } from '../pool';
import { assertActiveMaster, assertDate, assertPeriodOpen, audit, requireAction, type Db } from './common';

export interface GoodsLineInput {
  itemId: string;
  warehouseId: string;
  quantity: string;
  unit: string;
  unitConversion?: { unit: string; baseUnit: string; factor: string } | null;
  expiresOn?: string | null;
  /** 예시 평가. 확정 전에는 PROPOSED, 근거 없으면 UNCONFIRMED */
  unitValue?: string | null;
  valuationBasis?: string | null;
}

export interface GoodsReceiptInput {
  facilityId: string;
  donorId?: string | null;
  receivedOn: string;
  memo?: string | null;
  lines: GoodsLineInput[];
}

export async function createGoodsReceiptDraft(db: Db, ctx: ActorContext, input: GoodsReceiptInput): Promise<{ id: string; version: number }> {
  requireAction(ctx, 'goods.draft');
  assertDate(input.receivedOn, 'receivedOn');
  if (!input.lines?.length || input.lines.length > 200) {
    throw new DomainError('VALIDATION_FAILED', '품목행은 1~200개입니다.', { lines: '1~200행' });
  }
  await assertPeriodOpen(db, input.receivedOn);
  await assertActiveMaster(db, 'facilities', [input.facilityId]);
  await assertActiveMaster(db, 'items', input.lines.map((l) => l.itemId));
  await assertActiveMaster(db, 'warehouses', input.lines.map((l) => l.warehouseId));
  const header = await db.query<{ id: string; version: number }>(
    `insert into goods_receipts (tenant_id, facility_id, donor_id, received_on, memo, created_by)
     values (app_tenant(), $1, $2, $3, $4, $5) returning id, version`,
    [input.facilityId, input.donorId ?? null, input.receivedOn, input.memo ?? null, ctx.userId],
  );
  const { id, version } = header.rows[0]!;
  let lineNo = 0;
  for (const line of input.lines) {
    lineNo += 1;
    const qty = parsePositiveQty(line.quantity, `lines[${lineNo - 1}].quantity`);
    if (line.expiresOn) assertDate(line.expiresOn, `lines[${lineNo - 1}].expiresOn`);
    const unitValue = line.unitValue ? parseWon(line.unitValue, `lines[${lineNo - 1}].unitValue`) : null;
    if (unitValue !== null && unitValue < 0n) throw new DomainError('INVALID_AMOUNT', '단가는 0 이상입니다.');
    // 총액 = 단가 × 수량. 정수 수량일 때만 자동 계산(소수 수량 가액은 평가정책 확정 후)
    const totalValue = unitValue !== null && qty % 1000n === 0n ? unitValue * (qty / 1000n) : null;
    await db.query(
      `insert into goods_receipt_lines (tenant_id, receipt_id, line_no, item_id, warehouse_id, quantity, unit, unit_conversion,
         expires_on, valuation_status, unit_value, total_value, valuation_basis)
       values (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id, lineNo, line.itemId, line.warehouseId, formatQty(qty), line.unit,
        line.unitConversion ? JSON.stringify(line.unitConversion) : null, line.expiresOn ?? null,
        unitValue === null ? 'UNCONFIRMED' : 'PROPOSED', unitValue?.toString() ?? null, totalValue?.toString() ?? null,
        line.valuationBasis ?? null,
      ],
    );
  }
  await audit(db, ctx, { category: 'LEDGER', action: 'goods_receipt.draft', resourceType: 'goods_receipt', resourceId: id });
  return { id, version };
}

export interface GoodsReceiptView {
  id: string;
  facilityId: string;
  facilityName: string;
  donorId: string | null;
  donorName: string | null;
  receivedOn: string;
  status: string;
  version: number;
  memo: string | null;
  snapshotHash: string | null;
  createdBy: string;
  createdByName: string;
  approvedAt: string | null;
  lines: {
    lineNo: number; itemId: string; itemName: string; warehouseId: string; warehouseName: string; quantity: string; unit: string;
    unitConversion: unknown; expiresOn: string | null; valuationStatus: string; unitValue: string | null; totalValue: string | null;
    valuationBasis: string | null; lotId: string | null; lotCode: string | null;
  }[];
}

export async function getGoodsReceipt(db: Db, ctx: ActorContext, id: string): Promise<GoodsReceiptView> {
  requireAction(ctx, 'goods.read');
  const h = await db.query(
    `select g.*, f.name as facility_name, d.display_name as donor_name, u.display_name as created_by_name
       from goods_receipts g
       join facilities f on f.id = g.facility_id
       join users u on u.id = g.created_by
       left join donors d on d.id = g.donor_id
      where g.id = $1`,
    [id],
  );
  const g = h.rows[0];
  if (!g) throw new DomainError('NOT_FOUND', '후원품 수입을 찾을 수 없습니다.');
  const lines = await db.query(
    `select l.*, i.name as item_name, w.name as warehouse_name, lt.id as lot_id, lt.lot_code
       from goods_receipt_lines l
       join items i on i.id = l.item_id
       join warehouses w on w.id = l.warehouse_id
       left join lots lt on lt.receipt_line_id = l.id
      where l.receipt_id = $1 order by l.line_no`,
    [id],
  );
  return {
    id: g.id, facilityId: g.facility_id, facilityName: g.facility_name, donorId: g.donor_id, donorName: g.donor_name,
    receivedOn: g.received_on, status: g.status, version: g.version, memo: g.memo, snapshotHash: g.snapshot_hash,
    createdBy: g.created_by, createdByName: g.created_by_name, approvedAt: g.approved_at?.toISOString() ?? null,
    lines: lines.rows.map((l) => ({
      lineNo: l.line_no, itemId: l.item_id, itemName: l.item_name, warehouseId: l.warehouse_id, warehouseName: l.warehouse_name,
      quantity: formatQty(parsePositiveQty(l.quantity)), unit: l.unit, unitConversion: l.unit_conversion, expiresOn: l.expires_on,
      valuationStatus: l.valuation_status, unitValue: l.unit_value, totalValue: l.total_value, valuationBasis: l.valuation_basis,
      lotId: l.lot_id, lotCode: l.lot_code,
    })),
  };
}

export async function listGoodsReceipts(db: Db, ctx: ActorContext, q: { status?: string; limit?: number } = {}) {
  requireAction(ctx, 'goods.read');
  const r = await db.query(
    `select g.id, g.received_on, g.status, g.version, d.display_name as donor_name,
            (select count(*) from goods_receipt_lines l where l.receipt_id = g.id)::int as line_count,
            (select count(*) from goods_receipt_lines l where l.receipt_id = g.id and l.valuation_status <> 'CONFIRMED')::int as unconfirmed_valuations
       from goods_receipts g left join donors d on d.id = g.donor_id
      where ($1::text is null or g.status = $1)
      order by g.received_on desc, g.created_at desc, g.id
      limit $2`,
    [q.status ?? null, Math.min(Math.max(q.limit ?? 50, 1), 200)],
  );
  return r.rows.map((g) => ({
    id: g.id as string, receivedOn: g.received_on as string, status: g.status as string, version: g.version as number,
    donorName: (g.donor_name ?? null) as string | null, lineCount: g.line_count as number, unconfirmedValuations: g.unconfirmed_valuations as number,
  }));
}
