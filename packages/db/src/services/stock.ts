import { formatQty, parseQty } from '@owdms/domain';
import type { ActorContext } from '../pool';
import { requireAction, type Db } from './common';

export async function listStock(db: Db, ctx: ActorContext, q: { includeEmpty?: boolean } = {}) {
  requireAction(ctx, 'goods.read');
  const r = await db.query(
    `select b.lot_id, b.warehouse_id, b.on_hand, b.reserved, lt.lot_code, lt.unit, lt.expires_on, lt.received_on,
            i.name as item_name, w.name as warehouse_name, gl.receipt_id
       from stock_balances b
       join lots lt on lt.id = b.lot_id
       join items i on i.id = lt.item_id
       join warehouses w on w.id = b.warehouse_id
       join goods_receipt_lines gl on gl.id = lt.receipt_line_id
      where ($1::boolean or b.on_hand > 0)
      order by lt.expires_on nulls last, lt.received_on, lt.lot_code`,
    [q.includeEmpty ?? false],
  );
  return r.rows.map((b) => {
    const onHand = parseQty(b.on_hand);
    const reserved = parseQty(b.reserved);
    return {
      lotId: b.lot_id as string, warehouseId: b.warehouse_id as string, lotCode: b.lot_code as string, itemName: b.item_name as string,
      warehouseName: b.warehouse_name as string, unit: b.unit as string, expiresOn: b.expires_on as string | null,
      receivedOn: b.received_on as string, receiptId: b.receipt_id as string,
      onHand: formatQty(onHand), reserved: formatQty(reserved), available: formatQty(onHand - reserved),
    };
  });
}

/** 원장 재생 합계와 잔고 테이블이 일치하는지 검사(월말·장애 복구 점검용). */
export async function verifyStockLedger(db: Db) {
  const r = await db.query<{ lot_id: string; warehouse_id: string; ledger: string; on_hand: string | null }>(
    `select l.lot_id, l.warehouse_id, sum(l.quantity_delta) as ledger, b.on_hand
       from stock_ledger l left join stock_balances b on b.lot_id = l.lot_id and b.warehouse_id = l.warehouse_id
      group by l.lot_id, l.warehouse_id, b.on_hand`,
  );
  return r.rows.filter((x) => x.on_hand === null || parseQty(x.ledger) !== parseQty(x.on_hand));
}

export async function getLedger(db: Db, ctx: ActorContext, lotId: string) {
  requireAction(ctx, 'goods.read');
  const r = await db.query(
    `select id, movement_type, quantity_delta, ref_type, ref_id, created_at from stock_ledger where lot_id = $1 order by id`,
    [lotId],
  );
  return r.rows.map((x) => ({
    id: String(x.id), movementType: x.movement_type as string, quantityDelta: formatQty(parseQty(x.quantity_delta)),
    refType: x.ref_type as string, refId: x.ref_id as string, createdAt: (x.created_at as Date).toISOString(),
  }));
}
