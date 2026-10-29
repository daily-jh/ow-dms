import pg from 'pg';
import { createPool, migrate, seedMasterData, seedScenario, actor, SEED, type ActorContext } from '@owdms/db';

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres@localhost:5432/postgres';
const DB_NAME = process.env.TEST_DATABASE_NAME ?? 'owdms_test';

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

/** 실제 PostgreSQL에 시험 DB를 새로 만들고 migration·합성 seed를 적용한다. */
export async function setupTestDb() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${DB_NAME} with (force)`);
  await admin.query(`create database ${DB_NAME}`);
  await admin.end();
  const owner = createPool(withDb(ADMIN_URL, DB_NAME), 2);
  await migrate(owner);
  await seedMasterData(owner);
  const appUrl = withDb(process.env.TEST_APP_DATABASE_URL ?? 'postgres://owdms_app:owdms_app_dev@localhost:5432/postgres', DB_NAME);
  const app = createPool(appUrl, 10);
  const scenario = await seedScenario(app);
  return { owner, app, scenario, appUrl };
}

export const A = {
  donation: actor(SEED.users.aDonation, SEED.tenantA, ['DONATION_STAFF']),
  goods: actor(SEED.users.aGoods, SEED.tenantA, ['GOODS_STAFF']),
  approver: actor(SEED.users.aApprover, SEED.tenantA, ['APPROVER']),
  admin: actor(SEED.users.aAdmin, SEED.tenantA, ['INSTITUTION_ADMIN']),
};
export const B = {
  donation: actor(SEED.users.bDonation, SEED.tenantB, ['DONATION_STAFF']),
  goods: actor(SEED.users.bGoods, SEED.tenantB, ['GOODS_STAFF']),
  approver: actor(SEED.users.bApprover, SEED.tenantB, ['APPROVER']),
};

export async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    const got = (e as { code?: string }).code;
    if (got !== code) throw new Error(`expected ${code}, got ${got}: ${(e as Error).message}`);
    return;
  }
  throw new Error(`expected ${code}, but succeeded`);
}

export type { ActorContext };
