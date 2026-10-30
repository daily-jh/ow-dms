import { rolesAllow, type Role, DomainError, snapshotHash } from '@owdms/domain';
import { TEMPLATES, renderDocument, type DocumentType } from '@owdms/documents';
import type { ActorContext } from '../pool';
import { audit, requireAction, type Db } from './common';
import { getDistributionSnapshot } from './distributions';
import { getGoodsReceipt } from './goods';

async function institutionName(db: Db): Promise<string> {
  const r = await db.query<{ name: string }>(`select name from tenants where id = app_tenant()`);
  return r.rows[0]?.name ?? '';
}

/** 원장에서 문서용 스냅샷을 만든다. 승인 전이면 초안 표시. */
async function buildSnapshot(db: Db, ctx: ActorContext, type: DocumentType, sourceId: string) {
  requireAction(ctx, type === 'MONEY_RECEIPT_NOTE' ? 'money.read' : 'goods.read');
  if (type === 'GOODS_RECEIPT_CERT') {
    const g = await getGoodsReceipt(db, ctx, sourceId);
    return {
      facilityName: g.facilityName, version: g.version, isDraft: g.status !== 'APPROVED',
      snapshot: {
        id: g.id, version: g.version, receivedOn: g.receivedOn, donorName: g.donorName, memo: g.memo,
        lines: g.lines.map((l) => ({
          lineNo: l.lineNo, itemName: l.itemName, quantity: l.quantity, unit: l.unit, lotCode: l.lotCode, expiresOn: l.expiresOn,
          valuationStatus: l.valuationStatus, totalValue: l.totalValue, warehouseName: l.warehouseName,
        })),
      },
    };
  }
  if (type === 'DISTRIBUTION_LIST') {
    const d = await getDistributionSnapshot(db, sourceId);
    return {
      facilityName: d.snapshot.facilityName, version: d.row.version as number,
      isDraft: !['APPROVED', 'POSTED'].includes(d.row.status),
      snapshot: { ...d.snapshot, status: d.row.status as string },
    };
  }
  const m = await db.query(
    `select m.*, f.name as facility_name, d.display_name as donor_name from money_receipts m
       join facilities f on f.id = m.facility_id left join donors d on d.id = m.donor_id where m.id = $1`,
    [sourceId],
  );
  const row = m.rows[0];
  if (!row) throw new DomainError('NOT_FOUND', '후원금 수입을 찾을 수 없습니다.');
  const lines = await db.query(
    `select f.name as fund_name, l.amount from receipt_fund_lines l join funds f on f.id = l.fund_id where l.receipt_id = $1 order by f.name`,
    [sourceId],
  );
  return {
    facilityName: row.facility_name as string, version: row.version as number, isDraft: row.status !== 'APPROVED',
    snapshot: {
      id: row.id, version: row.version, receivedOn: row.received_on, donorName: row.donor_name, amount: row.amount, method: row.method,
      fundLines: lines.rows.map((l) => ({ fundName: l.fund_name, amount: l.amount })),
    },
  };
}

/**
 * 문서를 생성·저장한다. 저장된 스냅샷과 템플릿 버전으로만 재출력하므로 이후 정보가 바뀌어도
 * '당시 문서'가 그대로 재현된다. generatedByJob이 있으면 worker 자동생성(중복 1회 제한).
 */
export async function generateDocument(
  db: Db,
  ctx: ActorContext,
  input: { documentType: DocumentType; sourceId: string },
  opts: { generatedByJob?: string } = {},
): Promise<{ id: string; isDraft: boolean; outputHash: string }> {
  if (!opts.generatedByJob) requireAction(ctx, 'document.generate');
  const template = TEMPLATES[input.documentType];
  if (!template) throw new DomainError('VALIDATION_FAILED', '지원하지 않는 서식입니다.');
  const built = await buildSnapshot(db, ctx, input.documentType, input.sourceId);
  const header = { institutionName: await institutionName(db), facilityName: built.facilityName };
  const docSnapshot = { header, body: built.snapshot };
  const hash = snapshotHash(docSnapshot);
  const idRow = await db.query<{ id: string; generated_at: Date }>(`select gen_random_uuid() as id, now() as generated_at`);
  const id = idRow.rows[0]!.id;
  const generatedAt = idRow.rows[0]!.generated_at.toISOString();
  const { outputHash } = renderDocument(
    input.documentType,
    { ...header, documentId: id, generatedAt, snapshotHash: hash },
    built.snapshot as never,
    built.isDraft,
  );
  const r = await db.query(
    `insert into generated_documents (id, tenant_id, document_type, template_id, template_version, source_type, source_id, source_version,
       is_draft, snapshot, snapshot_hash, output_hash, generated_by, generated_by_job, generated_at)
     values ($1, app_tenant(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict do nothing returning id`,
    [
      id, input.documentType, template.templateId, template.version, template.sourceType, input.sourceId, built.version, built.isDraft,
      JSON.stringify(docSnapshot), hash, outputHash, opts.generatedByJob ? null : ctx.userId, opts.generatedByJob ?? null, generatedAt,
    ],
  );
  if (!r.rowCount) {
    const existing = await db.query(
      `select id, is_draft, output_hash from generated_documents where document_type = $1 and source_id = $2 and source_version = $3 and generated_by_job is not null`,
      [input.documentType, input.sourceId, built.version],
    );
    const ex = existing.rows[0]!;
    return { id: ex.id, isDraft: ex.is_draft, outputHash: ex.output_hash };
  }
  if (!opts.generatedByJob) {
    await audit(db, ctx, { category: 'ACCESS', action: 'document.generate', resourceType: 'document', resourceId: id });
  }
  return { id, isDraft: built.isDraft, outputHash };
}

/** 당시 문서 재출력: 저장된 스냅샷+템플릿으로 다시 렌더하고 해시가 같은지 확인한다. */
export async function renderStoredDocument(db: Db, ctx: ActorContext, id: string) {
  requireAction(ctx, 'document.read');
  const r = await db.query(`select * from generated_documents where id = $1`, [id]);
  const d = r.rows[0];
  if (!d) throw new DomainError('NOT_FOUND', '문서를 찾을 수 없습니다.');
  requireAction(ctx, d.document_type === 'MONEY_RECEIPT_NOTE' ? 'money.read' : 'goods.read');
  const { html, outputHash } = renderDocument(
    d.document_type as DocumentType,
    { ...d.snapshot.header, documentId: d.id, generatedAt: (d.generated_at as Date).toISOString(), snapshotHash: d.snapshot_hash },
    d.snapshot.body,
    d.is_draft,
  );
  if (outputHash !== d.output_hash) throw new Error('document output hash mismatch: template drift');
  await audit(db, ctx, { category: 'ACCESS', action: 'document.view', resourceType: 'document', resourceId: id });
  return { html, document: { id: d.id as string, documentType: d.document_type as string, isDraft: d.is_draft as boolean, sourceId: d.source_id as string, sourceVersion: d.source_version as number, outputHash } };
}

export async function listDocuments(db: Db, ctx: ActorContext, q: { sourceId?: string } = {}) {
  requireAction(ctx, 'document.read');
  const r = await db.query(
    `select id, document_type, source_type, source_id, source_version, is_draft, generated_at, generated_by_job
       from generated_documents where ($1::uuid is null or source_id = $1)
         and (($2::boolean and document_type = 'MONEY_RECEIPT_NOTE') or ($3::boolean and document_type <> 'MONEY_RECEIPT_NOTE')) order by generated_at desc, id limit 200`,
    [q.sourceId ?? null, rolesAllow(ctx.roles as Role[], 'money.read'), rolesAllow(ctx.roles as Role[], 'goods.read')],
  );
  return r.rows.map((d) => ({
    id: d.id as string, documentType: d.document_type as string, title: TEMPLATES[d.document_type as DocumentType]?.title ?? d.document_type,
    sourceType: d.source_type as string, sourceId: d.source_id as string, sourceVersion: d.source_version as number,
    isDraft: d.is_draft as boolean, generatedAt: (d.generated_at as Date).toISOString(), auto: d.generated_by_job !== null,
  }));
}
