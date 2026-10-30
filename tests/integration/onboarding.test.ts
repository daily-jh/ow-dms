import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { YEONMU_PRESET } from '@owdms/domain';
import {
  SEED, actor, applyYeonmuPreset, createFund, listCatalog, listMasterData, onboardingReadiness, updateCatalogItem, withTenant, yeonmuPresetPreview,
} from '@owdms/db';
import { A, expectCode, setupTestDb } from './helpers';

let owner: pg.Pool;
let app: pg.Pool;
// 합성 연무 기관(코드 yeonmu). 실제 기관 자료·직원은 쓰지 않는다.
const Y = { tenant: '00000000-0000-4000-8000-000000000901', admin: '00000000-0000-4000-8000-000000000911', staff: '00000000-0000-4000-8000-000000000912' };
const yAdmin = actor(Y.admin, Y.tenant, ['INSTITUTION_ADMIN']);
const yStaff = actor(Y.staff, Y.tenant, ['DONATION_STAFF']);
const adminA = actor(SEED.users.aAdmin, SEED.tenantA, ['INSTITUTION_ADMIN']);
const asY = <T>(fn: (db: pg.PoolClient) => Promise<T>) => withTenant(app, yAdmin, fn);

const defaults = (k: 'managementTypes' | 'programs' | 'partners' | 'schedules') =>
  (YEONMU_PRESET[k] as readonly { code: string; defaultSelected: boolean }[]).filter((x) => x.defaultSelected).map((x) => x.code);
const fullInput = {
  fundKeys: ['GENERAL' as const, 'SPONSORSHIP' as const],
  managementTypeCodes: defaults('managementTypes'), programCodes: defaults('programs'),
  partnerCodes: defaults('partners'), scheduleCodes: defaults('schedules'), reviewed: true,
};
const counts = async () => (await owner.query(
  `select (select count(*) from donors)::int as donors, (select count(*) from money_receipts)::int as receipts,
          (select count(*) from pledges)::int as pledges, (select count(*) from goods_receipts)::int as goods`)).rows[0];

beforeAll(async () => {
  ({ owner, app } = await setupTestDb());
  await owner.query(`insert into tenants (id, code, name) values ($1, 'yeonmu', '연무 시험용 가상기관')`, [Y.tenant]);
  await owner.query(`insert into users (id, username, display_name) values ($1, 'y.admin', '연무관리(가상)'), ($2, 'y.staff', '연무후원(가상)')`, [Y.admin, Y.staff]);
  await owner.query(`insert into memberships (tenant_id, user_id, roles) values ($1, $2, '{INSTITUTION_ADMIN}'), ($1, $3, '{DONATION_STAFF}')`, [Y.tenant, Y.admin, Y.staff]);
});
afterAll(async () => {
  await app?.end();
  await owner?.end();
});

describe('기관 준비 상태', () => {
  it('빈 기관은 시설·기금이 없어 후원금 입력 불가로 진단하고, 담당자도 볼 수 있다', async () => {
    const r = await withTenant(app, yStaff, (db) => onboardingReadiness(db, yStaff));
    expect(r.presetAvailable).toBe(true);
    expect(r.canEnterMoney).toBe(false);
    expect(r.steps.facility.status).toBe('MISSING');
    expect(r.steps.donationStaff.count).toBe(1);
    expect(r.lastPresetApplication).toBeNull();
    const a = await withTenant(app, A.donation, (db) => onboardingReadiness(db, A.donation));
    expect(a.presetAvailable).toBe(false);
    expect(a.canEnterMoney).toBe(true);
  });
});

describe('연무 기본 항목 미리보기·적용', () => {
  it('다른 기관에는 연무 후보를 보이거나 적용하지 않는다(AUTO-05)', async () => {
    await expectCode(withTenant(app, adminA, (db) => yeonmuPresetPreview(db, adminA)), 'NOT_FOUND');
    await expectCode(withTenant(app, adminA, (db) => applyYeonmuPreset(db, adminA, { ...fullInput, legalEntityId: SEED.legalA })), 'NOT_FOUND');
  });

  it('관리자만 미리보기·적용할 수 있다', async () => {
    await expectCode(withTenant(app, yStaff, (db) => yeonmuPresetPreview(db, yStaff)), 'FORBIDDEN');
    await expectCode(withTenant(app, yStaff, (db) => applyYeonmuPreset(db, yStaff, { ...fullInput, newLegalEntity: { name: '가상 운영법인', kind: 'CORPORATION' } })), 'FORBIDDEN');
  });

  it('빈 기관에서 모든 후보를 미리 채워 추가 후보로 보여 준다', async () => {
    const p = await asY((db) => yeonmuPresetPreview(db, yAdmin));
    expect(p.legalEntities).toEqual([]);
    expect(p.facility.status).toBe('MISSING');
    expect(p.funds.map((f) => f.status)).toEqual(['MISSING', 'MISSING']);
    expect([p.managementTypes.length, p.programs.length, p.partners.length]).toEqual([7, 14, 25]);
    expect([...p.managementTypes, ...p.programs, ...p.partners, ...p.schedules].every((x) => x.status === 'MISSING')).toBe(true);
  });

  it('소속 선택·입력은 하나만, 알 수 없는 코드·검토 누락은 거부한다', async () => {
    await expectCode(asY((db) => applyYeonmuPreset(db, yAdmin, { ...fullInput })), 'VALIDATION_FAILED');
    await expectCode(asY((db) => applyYeonmuPreset(db, yAdmin, { ...fullInput, newLegalEntity: { name: '가상 운영법인', kind: 'CORPORATION' }, programCodes: ['YM-NOPE'] })), 'VALIDATION_FAILED');
    await expectCode(asY((db) => applyYeonmuPreset(db, yAdmin, { ...fullInput, newLegalEntity: { name: '가상 운영법인', kind: 'CORPORATION' }, reviewed: false })), 'VALIDATION_FAILED');
  });

  it('기존 기금과 조건이 다르면 법인·시설·분류까지 전부 되돌린다', async () => {
    await asY((db) => createFund(db, yAdmin, { name: '결연후원금', designated: true, purpose: '기존 다른 목적' }));
    await expectCode(asY((db) => applyYeonmuPreset(db, yAdmin, { ...fullInput, newLegalEntity: { name: '가상 운영법인', kind: 'CORPORATION' } })), 'VALIDATION_FAILED');
    const m = await asY((db) => listMasterData(db, yAdmin));
    expect(m.legalEntities).toEqual([]);
    expect(m.facilities).toEqual([]);
    expect(m.funds.find((f: any) => f.name === '결연후원금')?.purpose).toBe('기존 다른 목적');
    expect(await asY((db) => listCatalog(db, yAdmin))).toEqual([]);
    expect((await owner.query('select count(*)::int as n from master_preset_applications')).rows[0].n).toBe(0);
    const p = await asY((db) => yeonmuPresetPreview(db, yAdmin));
    expect(p.funds.find((f) => f.key === 'SPONSORSHIP')?.status).toBe('CONFLICT');
  });

  it('관리자가 입력한 법인으로 한 번에 추가하고, 후원자·거래·약정은 만들지 않는다', async () => {
    const before = await counts();
    const r = await asY((db) => applyYeonmuPreset(db, yAdmin, { ...fullInput, fundKeys: ['GENERAL'], newLegalEntity: { name: '가상 운영법인', kind: 'CORPORATION' } }));
    const nCatalog = [defaults('managementTypes'), defaults('programs'), defaults('partners'), defaults('schedules')].flat().length;
    expect(r.created).toBe(1 + 1 + 1 + nCatalog); // 법인·시설·비지정기금·분류
    expect(r.reused).toBe(0);
    const rd = await withTenant(app, yStaff, (db) => onboardingReadiness(db, yStaff));
    expect(rd.canEnterMoney).toBe(true);
    expect(rd.catalog).toEqual({ managementTypes: 6, programs: 13, partners: 7, schedules: 12 });
    expect(rd.lastPresetApplication?.presetVersion).toBe(YEONMU_PRESET.version);
    expect(await counts()).toEqual(before);
    const audit = await owner.query(`select count(*)::int as n from audit_events where tenant_id = $1 and action = 'master.preset.apply'`, [Y.tenant]);
    expect(audit.rows[0].n).toBe(1);
  });

  it('다시 적용해도 중복이 없고, 사용 중지한 분류는 다시 켜지 않는다', async () => {
    const cat = await asY((db) => listCatalog(db, yAdmin));
    const bazaar = cat.find((c: any) => c.code === 'YM-EVENT-BAZAAR')!;
    await asY((db) => updateCatalogItem(db, yAdmin, bazaar.id, { active: false, name: '바자회(올해 미운영)' }));
    const p = await asY((db) => yeonmuPresetPreview(db, yAdmin));
    expect(p.programs.find((x) => x.code === 'YM-EVENT-BAZAAR')?.status).toBe('INACTIVE');
    expect(p.facility.status).toBe('ACTIVE');
    const le = p.facility.legalEntityId!;
    const again = await asY((db) => applyYeonmuPreset(db, yAdmin, { ...fullInput, fundKeys: ['GENERAL'], legalEntityId: le }));
    expect(again.created).toBe(0);
    const after = await asY((db) => listCatalog(db, yAdmin));
    expect(after).toHaveLength(cat.length);
    expect(after.find((c: any) => c.code === 'YM-EVENT-BAZAAR')).toMatchObject({ active: false, name: '바자회(올해 미운영)' });
    // 담당자는 사용 중인 분류만 본다
    const staffView = await withTenant(app, yStaff, (db) => listCatalog(db, yStaff));
    expect(staffView.some((c: any) => c.code === 'YM-EVENT-BAZAAR')).toBe(false);
  });

  it('분류 변경은 관리자만, 다른 기관 분류는 보이지도 바뀌지도 않는다', async () => {
    const [first] = await asY((db) => listCatalog(db, yAdmin));
    await expectCode(withTenant(app, yStaff, (db) => updateCatalogItem(db, yStaff, first.id, { active: false })), 'FORBIDDEN');
    await expectCode(withTenant(app, adminA, (db) => updateCatalogItem(db, adminA, first.id, { active: false })), 'NOT_FOUND');
    expect(await withTenant(app, adminA, (db) => listCatalog(db, adminA))).toEqual([]);
    await expectCode(withTenant(app, adminA, (db) => db.query('insert into donation_catalog (tenant_id, kind, code, name, created_by) values ($1, $2, $3, $4, $5)',
      [Y.tenant, 'PROGRAM', 'YM-X', '침범', SEED.users.aAdmin])), '42501');
  });

  it('적용 기록은 고치거나 지울 수 없다', async () => {
    await expect(asY((db) => db.query('update master_preset_applications set created_count = 0'))).rejects.toThrow();
    await expect(owner.query('delete from master_preset_applications')).rejects.toThrow(/APPEND_ONLY/);
  });
});
