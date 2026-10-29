import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { processOutboxOnce } from '@owdms/worker';
import { listDocuments, withTenant } from '@owdms/db';
import { A, B, setupTestDb } from './helpers';

let owner: pg.Pool;
let app: pg.Pool;
let scenario: Record<string, string>;

beforeAll(async () => {
  ({ owner, app, scenario } = await setupTestDb());
});
afterAll(async () => {
  await app?.end();
  await owner?.end();
});

describe('worker outbox', () => {
  it('승인 이벤트마다 기본 문서를 1회 생성하고, 동시 실행해도 중복 소비하지 않는다', async () => {
    const [n1, n2] = await Promise.all([processOutboxOnce(app), processOutboxOnce(app)]);
    // seed: 입고 승인 1 + 배분 승인 3 + 배분 출고 3 + 후원금 승인 1 = 8
    expect(n1 + n2).toBe(8);
    expect(await processOutboxOnce(app)).toBe(0);
    const docs = await withTenant(app, A.goods, (db) => listDocuments(db, A.goods));
    expect(docs.filter((d) => d.auto && d.sourceId === scenario.rice100Receipt)).toHaveLength(1);
    expect(docs.filter((d) => d.auto && d.documentType === 'DISTRIBUTION_LIST')).toHaveLength(3);
    const runs = await owner.query('select count(*)::int as n, count(distinct event_id)::int as d from job_runs');
    expect(runs.rows[0]).toEqual({ n: 8, d: 8 });
  });
  it('T19 worker가 만든 문서도 기관 경계를 지킨다', async () => {
    const docs = await withTenant(app, B.goods, (db) => listDocuments(db, B.goods));
    expect(docs).toHaveLength(0);
  });
});
