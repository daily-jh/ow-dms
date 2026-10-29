import type pg from 'pg';
import { generateDocument, withTenant, type ActorContext, type Db } from '@owdms/db';

export const SYSTEM_WORKER_USER = '00000000-0000-4000-8000-000000000000';

type Handler = (db: Db, ctx: ActorContext, event: OutboxEvent) => Promise<void>;
interface OutboxEvent { id: string; event_type: string; aggregate_id: string; aggregate_version: number; payload: Record<string, unknown> }

/** 승인 이벤트에서 기본 문서를 자동 생성한다(같은 원거래·버전에는 1회만). */
const HANDLERS: Record<string, Handler> = {
  'goods_receipt.approved': async (db, ctx, e) => {
    await generateDocument(db, ctx, { documentType: 'GOODS_RECEIPT_CERT', sourceId: e.aggregate_id }, { generatedByJob: 'auto:goods_receipt.approved' });
  },
  'distribution.posted': async (db, ctx, e) => {
    await generateDocument(db, ctx, { documentType: 'DISTRIBUTION_LIST', sourceId: e.aggregate_id }, { generatedByJob: 'auto:distribution.posted' });
  },
  'money_receipt.approved': async (db, ctx, e) => {
    await generateDocument(db, ctx, { documentType: 'MONEY_RECEIPT_NOTE', sourceId: e.aggregate_id }, { generatedByJob: 'auto:money_receipt.approved' });
  },
};

/**
 * outbox 1회 처리. 기관별로 컨텍스트를 설정해 RLS 아래에서 읽고,
 * 이벤트 처리·job_runs 기록·processed 표시를 한 트랜잭션에서 수행한다(중복 소비 차단).
 */
export async function processOutboxOnce(pool: pg.Pool, opts: { batchSize?: number; log?: (m: string) => void } = {}): Promise<number> {
  const tenants = await pool.query<{ tenant_id: string }>('select tenant_id from worker_pending_tenants()');
  let processed = 0;
  for (const { tenant_id } of tenants.rows) {
    const ctx: ActorContext = { tenantId: tenant_id, userId: SYSTEM_WORKER_USER, roles: ['SYSTEM_WORKER'], requestId: `worker-${Date.now()}` };
    const ids = await withTenant(pool, ctx, async (db) =>
      (await db.query<{ id: string }>(`select id from outbox where processed_at is null and attempts < 10 order by created_at limit $1`, [opts.batchSize ?? 50])).rows.map((r) => r.id),
    );
    for (const id of ids) {
      try {
        const done = await withTenant(pool, ctx, async (db) => {
          const r = await db.query<OutboxEvent>(`select * from outbox where id = $1 and processed_at is null for update skip locked`, [id]);
          const e = r.rows[0];
          if (!e) return false; // 다른 worker가 처리 중이거나 완료
          const handler = HANDLERS[e.event_type];
          if (handler) await handler(db, ctx, e);
          await db.query(`insert into job_runs (tenant_id, event_id, handler) values (app_tenant(), $1, $2)`, [e.id, handler ? e.event_type : 'noop']);
          await db.query(`update outbox set processed_at = now(), attempts = attempts + 1 where id = $1`, [e.id]);
          return true;
        });
        if (done) processed += 1;
      } catch (err) {
        // 실패는 시도횟수와 안전한 메시지만 기록(개인정보 금지). 10회 초과 시 운영 확인 대상.
        await withTenant(pool, ctx, (db) =>
          db.query(`update outbox set attempts = attempts + 1, last_error = $2 where id = $1`, [id, String((err as Error).message).slice(0, 200)]),
        );
        opts.log?.(`outbox ${id} failed: ${(err as Error).message}`);
      }
    }
  }
  return processed;
}
