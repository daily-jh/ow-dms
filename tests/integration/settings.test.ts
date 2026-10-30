import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  SEED, actor, createFacility, createFund, createGoodsReceiptDraft, createItem, createLegalEntity, createWarehouse, listMasterData,
  updateMaster, withTenant, applyYeonmuPreset,
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

describe('연무 업무 기본 항목', () => {
  it('후원담당은 적용할 수 없고 타 기관 소속·검토 누락도 거부한다', async () => {
    const input = { legalEntityId: SEED.legalA, fundKeys: ['GENERAL' as const], reviewed: true };
    await expectCode(withTenant(app, A.donation, (db) => applyYeonmuPreset(db, A.donation, input)), 'FORBIDDEN');
    await expectCode(withTenant(app, adminB, (db) => applyYeonmuPreset(db, adminB, input)), 'VALIDATION_FAILED');
    await expectCode(asA((db) => applyYeonmuPreset(db, adminA, { ...input, reviewed: false })), 'VALIDATION_FAILED');
  });
  it('관리자가 선택한 시설·기금만 추가하고 재적용해도 거래·중복이 생기지 않는다', async () => {
    const input = { legalEntityId: SEED.legalA, fundKeys: ['GENERAL' as const], reviewed: true };
    const before = await owner.query('select count(*)::int as n from money_receipts');
    const first = await asA((db) => applyYeonmuPreset(db, adminA, input));
    const next = await asA((db) => applyYeonmuPreset(db, adminA, input));
    expect(first.created).toBe(1); // 시드의 기존 비지정후원금은 재사용, 시설만 추가
    expect(next).toEqual({ facilityId: first.facilityId, created: 0 });
    const m = await asA((db) => listMasterData(db, adminA));
    expect(m.facilities.filter((f: any) => f.name === '연무사회복지관')).toHaveLength(1);
    expect(m.funds.some((f: any) => f.name === '결연후원금')).toBe(false);
    const other = await withTenant(app, adminB, (db) => listMasterData(db, adminB));
    expect(other.facilities.some((f: any) => f.id === first.facilityId)).toBe(false);
    expect((await owner.query('select count(*)::int as n from money_receipts')).rows).toEqual(before.rows);
  });
  it('기존 기금의 목적이 다르면 앞서 추가한 시설까지 롤백하고 기존 값을 보존한다', async () => {
    const le = await withTenant(app, adminB, (db) => createLegalEntity(db, adminB, { name: '검증용 가상법인', kind: 'CORPORATION' }));
    await withTenant(app, adminB, (db) => createFund(db, adminB, { name: '결연후원금', designated: true, purpose: '기존 약정 목적' }));
    await expectCode(withTenant(app, adminB, (db) => applyYeonmuPreset(db, adminB, { legalEntityId: le.id, fundKeys: ['SPONSORSHIP'], reviewed: true })), 'VALIDATION_FAILED');
    const m = await withTenant(app, adminB, (db) => listMasterData(db, adminB));
    expect(m.facilities.some((f: any) => f.name === '연무사회복지관')).toBe(false);
    expect(m.funds.find((f: any) => f.name === '결연후원금')?.purpose).toBe('기존 약정 목적');
  });
});
