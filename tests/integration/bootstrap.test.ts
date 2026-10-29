import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { bootstrap, createPool } from '@owdms/db';

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres@localhost:5432/postgres';
const APP_URL = process.env.TEST_APP_DATABASE_URL ?? 'postgres://owdms_app:owdms_app_dev@localhost:5432/postgres';
const DB = 'owdms_bootstrap_test';

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

let owner: pg.Pool;
const appPool = () => createPool(withDb(APP_URL, DB), 2);

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.query(`create database ${DB}`);
  await admin.end();
  owner = createPool(withDb(ADMIN_URL, DB), 2);
});
afterAll(async () => {
  await owner?.end();
});

describe('배포 bootstrap', () => {
  it('운영에서는 앱 계정 비밀번호가 없거나 개발 기본값이면 시작하지 않는다', async () => {
    await expect(bootstrap(owner, appPool, { production: true, seedDemo: true })).rejects.toThrow(/APP_DB_PASSWORD/);
    await expect(bootstrap(owner, appPool, { production: true, seedDemo: true, appPassword: 'owdms_app_dev' })).rejects.toThrow(/APP_DB_PASSWORD/);
    const { rows } = await owner.query(`select to_regclass('public.tenants') as t`);
    expect(rows[0].t).toBeNull(); // 검증 실패 시 migration도 하지 않는다
  });

  it('시연 모드가 아니면 migration만 하고 자료를 넣지 않는다', async () => {
    expect(await bootstrap(owner, appPool, { production: false, seedDemo: false })).toEqual({ seeded: false });
    const { rows } = await owner.query<{ n: string }>('select count(*)::text as n from tenants');
    expect(rows[0]!.n).toBe('0');
  });

  it('빈 DB에만 합성 시연자료를 넣고, 다시 실행해도 덮어쓰거나 중복 생성하지 않는다', async () => {
    expect(await bootstrap(owner, appPool, { production: false, seedDemo: true })).toEqual({ seeded: true });
    const count = async () => (await owner.query<{ n: string }>('select count(*)::text as n from goods_receipts')).rows[0]!.n;
    const before = await count();
    expect(before).not.toBe('0');
    expect(await bootstrap(owner, appPool, { production: false, seedDemo: true })).toEqual({ seeded: false });
    expect(await count()).toBe(before);
  });

  it('앱 계정 비밀번호를 지정하면 교체한다(시험에서는 같은 값으로 교체해 다른 시험에 영향 없음)', async () => {
    await bootstrap(owner, appPool, { production: false, seedDemo: false, appPassword: 'owdms_app_dev' });
    const p = appPool();
    try {
      const { rows } = await p.query<{ u: string; su: boolean; bypass: boolean }>(
        'select current_user as u, rolsuper as su, rolbypassrls as bypass from pg_roles where rolname = current_user');
      expect(rows[0]).toEqual({ u: 'owdms_app', su: false, bypass: false });
    } finally {
      await p.end();
    }
  });
});
