import { DomainError, snapshotHash, transitionExternalRow, type ExternalRowState } from '@owdms/domain';
import { assertSubmitSupported, buildGoodsReceiptReviewXlsx, hopeEumCapabilities } from '@owdms/adapters';
import type { ActorContext } from '../pool';
import { audit, requireAction, type Db } from './common';
import { getGoodsReceipt } from './goods';

export function capabilities(ctx: ActorContext) {
  requireAction(ctx, 'integration.read');
  return hopeEumCapabilities();
}

/** 승인된 후원품 수입으로 내부 검토 배치를 준비한다(PREPARED). 전송·등록 상태는 바꾸지 않는다. */
export async function createGoodsReceiptBatch(db: Db, ctx: ActorContext, input: { sourceIds: string[]; idempotencyKey: string }) {
  requireAction(ctx, 'integration.prepare');
  const cap = hopeEumCapabilities().find((c) => c.operation === 'goodsReceipt' && c.mode === 'reference');
  if (!cap?.enabled) throw new DomainError('CAPABILITY_DISABLED', '내부 검토 자료 생성이 비활성화되어 있습니다.');
  const existing = await db.query<{ id: string }>(`select id from integration_batches where idempotency_key = $1`, [input.idempotencyKey]);
  if (existing.rows[0]) return { batchId: existing.rows[0].id, replayed: true };
  const b = await db.query<{ id: string }>(
    `insert into integration_batches (tenant_id, target_system, operation, mode, spec_version, idempotency_key, created_by)
     values (app_tenant(), 'HOPE_EUM', 'goodsReceipt', 'reference', null, $1, $2) returning id`,
    [input.idempotencyKey, ctx.userId],
  );
  const batchId = b.rows[0]!.id;
  for (const sourceId of [...new Set(input.sourceIds)]) {
    const g = await db.query<{ status: string; version: number; snapshot_hash: string | null }>(
      `select status, version, snapshot_hash from goods_receipts where id = $1`,
      [sourceId],
    );
    const row = g.rows[0];
    if (!row) throw new DomainError('NOT_FOUND', '후원품 수입을 찾을 수 없습니다.');
    const issues = row.status === 'APPROVED' ? [] : [{ code: 'NOT_APPROVED', message: '승인되지 않은 거래' }];
    let state: ExternalRowState = 'NOT_READY';
    if (!issues.length) state = transitionExternalRow(transitionExternalRow(state, 'VALIDATED'), 'PREPARED');
    await db.query(
      `insert into integration_rows (tenant_id, batch_id, source_type, source_id, source_version, source_snapshot_hash, state, issues)
       values (app_tenant(), $1, 'GOODS_RECEIPT', $2, $3, $4, $5, $6)`,
      [batchId, sourceId, row.version, row.snapshot_hash ?? '', state, JSON.stringify(issues)],
    );
  }
  await audit(db, ctx, { category: 'LEDGER', action: 'integration.prepare', resourceType: 'integration_batch', resourceId: batchId });
  return { batchId, replayed: false };
}

/** 내부 검토 Excel 다운로드. 행 상태는 EXPORTED(다운로드 사실)까지만 바뀐다. */
export async function exportGoodsReceiptBatch(db: Db, ctx: ActorContext, batchId: string) {
  requireAction(ctx, 'integration.prepare');
  const rows = await db.query(`select * from integration_rows where batch_id = $1 order by source_id for update`, [batchId]);
  if (!rows.rowCount) throw new DomainError('NOT_FOUND', '연계 배치를 찾을 수 없습니다.');
  const out = [];
  for (const r of rows.rows) {
    if (!['PREPARED', 'EXPORTED'].includes(r.state)) continue;
    const g = await getGoodsReceipt(db, ctx, r.source_id);
    // 승인 이후 버전이 바뀐 자료는 오래된 준비자료로 내보내지 않는다(T24).
    if (g.version !== r.source_version || (g.snapshotHash ?? '') !== r.source_snapshot_hash) {
      throw new DomainError('STALE_VERSION', '준비 이후 원거래가 변경되었습니다. 배치를 다시 만드십시오.');
    }
    for (const l of g.lines) {
      out.push({
        receiptId: g.id, receivedOn: g.receivedOn, donorName: g.donorName, lineNo: l.lineNo, itemName: l.itemName, quantity: l.quantity,
        unit: l.unit, expiresOn: l.expiresOn, valuationStatus: l.valuationStatus, totalValue: l.totalValue, lotCode: l.lotCode, state: 'EXPORTED',
      });
    }
    if (r.state === 'PREPARED') {
      await db.query(`update integration_rows set state = $2, updated_at = now() where id = $1`, [r.id, transitionExternalRow('PREPARED', 'EXPORTED')]);
    }
  }
  const t = await db.query<{ name: string }>(`select name from tenants where id = app_tenant()`);
  const buffer = await buildGoodsReceiptReviewXlsx({ institutionName: t.rows[0]?.name ?? '', batchId, generatedAt: new Date().toISOString() }, out);
  await audit(db, ctx, { category: 'ACCESS', action: 'integration.export', resourceType: 'integration_batch', resourceId: batchId });
  return { buffer, fileName: `hope-eum-internal-review-${batchId.slice(0, 8)}.xlsx`, contentHash: snapshotHash(out) };
}

export async function submitBatch(db: Db, ctx: ActorContext, batchId: string): Promise<never> {
  requireAction(ctx, 'integration.prepare');
  const b = await db.query<{ mode: 'reference' }>(`select mode from integration_batches where id = $1`, [batchId]);
  if (!b.rows[0]) throw new DomainError('NOT_FOUND', '연계 배치를 찾을 수 없습니다.');
  await audit(db, ctx, { category: 'LEDGER', action: 'integration.submit', resourceType: 'integration_batch', resourceId: batchId, result: 'DENIED', reason: 'capability disabled' });
  return assertSubmitSupported(b.rows[0].mode);
}

export async function listBatches(db: Db, ctx: ActorContext) {
  requireAction(ctx, 'integration.read');
  const r = await db.query(
    `select b.id, b.operation, b.mode, b.created_at,
            count(r.*)::int as total,
            count(r.*) filter (where r.state = 'EXPORTED')::int as exported,
            count(r.*) filter (where r.state = 'VERIFIED')::int as verified,
            count(r.*) filter (where r.state = 'NOT_READY')::int as not_ready
       from integration_batches b left join integration_rows r on r.batch_id = b.id
      group by b.id order by b.created_at desc limit 100`,
  );
  return r.rows.map((b) => ({
    id: b.id as string, operation: b.operation as string, mode: b.mode as string, createdAt: (b.created_at as Date).toISOString(),
    total: b.total as number, exported: b.exported as number, verified: b.verified as number, notReady: b.not_ready as number,
  }));
}
