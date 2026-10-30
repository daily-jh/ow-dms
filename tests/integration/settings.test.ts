import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  SEED, actor, createFacility, createFund, createGoodsReceiptDraft, createItem, createLegalEntity, createWarehouse, listMasterData,
  updateMaster, withTenant,
} from '@owdms/db';
import { A, expectCode, setupTestDb } from './helpers';

let owner: pg.Pool;
let app: pg.Pool;
const adminA = actor(SEED.users.aAdmin, SEED.tenantA, ['INSTITUTION_ADMIN']);
// B기관에는 시드 관리자가 없으므로, B기관 소속 사용자에 관리자 역할을 준 맥락으로 격리를 확인한다.
const adminB = actor(SEED.users.bGoods, SEED.tenantB, ['INSTITUTION_ADMIN']);

beforeAll(async () => {
  ({ owner, app } = await setupTestDb());
});
afterAll(async () => {
  await app?.end();
  await owner?.end();
});

const asA = <T>(fn: (db: pg.PoolClient) => Promise<T>) => withTenant(app, adminA, fn);

describe('기준정보 관리', () => {
  let itemId = '';
  let warehouseId = '';

  it('기관관리자가 법인·시설·창고·품목·기금을 만든다. 같은 이름은 거부한다', async () => {
    const le = await asA((db) => createLegalEntity(db, adminA, { name: '새법인(가상)', kind: 'CORPORATION' }));
    const fac = await asA((db) => createFacility(db, adminA, { name: '새복지관(가상)', legalEntityId: le.id }));
    warehouseId = (await asA((db) => createWarehouse(db, adminA, { name: '1층 창고', facilityId: fac.id }))).id;
    itemId = (await asA((db) => createItem(db, adminA, { name: '라면 5입', baseUnit: '봉', perishable: false }))).id;
    await asA((db) => createFund(db, adminA, { name: '일반후원금(새)', designated: false }));
    await expectCode(asA((db) => createItem(db, adminA, { name: ' 라면 5입 ', baseUnit: '봉', perishable: false })), 'VALIDATION_FAILED');
    await expectCode(asA((db) => createFund(db, adminA, { name: '장학', designated: true })), 'VALIDATION_FAILED');
    const m = await asA((db) => listMasterData(db, adminA));
    expect(m.items.find((i: any) => i.id === itemId)).toMatchObject({ baseUnit: '봉', active: true, inUse: false });
    const audit = await owner.query(`select count(*)::int as n from audit_events where action like 'master.%' and tenant_id = $1`, [SEED.tenantA]);
    expect(audit.rows[0].n).toBe(5);
  });

  it('관리자가 아니면 거부한다', async () => {
    await expectCode(withTenant(app, A.goods, (db) => createItem(db, A.goods, { name: 'x', baseUnit: '개', perishable: false })), 'FORBIDDEN');
    await expectCode(withTenant(app, A.goods, (db) => listMasterData(db, A.goods)), 'FORBIDDEN');
  });

  it('다른 기관의 기준정보는 보이지 않고, 참조·변경할 수 없다', async () => {
    const mB = await withTenant(app, adminB, (db) => listMasterData(db, adminB));
    expect(mB.items.some((i: any) => i.id === itemId)).toBe(false);
    await expectCode(withTenant(app, adminB, (db) => updateMaster(db, adminB, 'items', itemId, { name: '탈취' })), 'NOT_FOUND');
    // B기관 관리자가 A기관 법인으로 시설을 만들려 하면 복합 FK가 막는다
    await expectCode(withTenant(app, adminB, (db) => createFacility(db, adminB, { name: '침투', legalEntityId: SEED.legalA })), '23503');
  });

  it('사용 중지한 품목은 새 거래에 쓸 수 없고, 다시 켜면 쓸 수 있다', async () => {
    await asA((db) => updateMaster(db, adminA, 'items', itemId, { active: false }));
    const draft = () =>
      withTenant(app, A.goods, (db) =>
        createGoodsReceiptDraft(db, A.goods, {
          facilityId: SEED.facilityA, receivedOn: '2026-10-29',
          lines: [{ itemId, warehouseId, quantity: '3', unit: '봉' }],
        }),
      );
    await expectCode(draft(), 'VALIDATION_FAILED');
    await asA((db) => updateMaster(db, adminA, 'items', itemId, { active: true, name: '라면 5입(새 이름)' }));
    await expect(draft()).resolves.toMatchObject({ version: 1 });
  });
});
