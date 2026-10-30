import {
  DomainError, YEONMU_PRESET, YEONMU_TENANT_CODE, rolesAllow, presetCodesValid,
  type CatalogKind, type PresetFundKey, type Role,
} from '@owdms/domain';
import type { ActorContext } from '../pool';
import { audit, requireAction, type Db } from './common';
import { createFacility, createFund, createLegalEntity } from './settings';

/**
 * 기관 초기 설정: 준비 상태 진단, 연무 기본자료 미리보기·한 번에 적용, 업무 분류표 관리.
 * 후보는 관리자가 확인해야만 기준정보가 된다. 법인·후원자·수혜자·계좌·거래는 만들지 않는다
 * (법인은 관리자가 직접 입력한 이름으로만 만든다).
 */

export type CatalogDbKind = 'MANAGEMENT_TYPE' | 'PROGRAM' | 'PARTNER' | 'SCHEDULE';
const DB_KIND: Record<CatalogKind, CatalogDbKind> = {
  managementTypes: 'MANAGEMENT_TYPE', programs: 'PROGRAM', partners: 'PARTNER', schedules: 'SCHEDULE',
};

/** ACTIVE: 이미 사용 중 / MISSING: 없음(추가 후보) / INACTIVE: 사용 중지됨(자동으로 다시 켜지 않음) / CONFLICT: 같은 이름이 다른 조건으로 있음 */
export type PresetStatus = 'ACTIVE' | 'MISSING' | 'INACTIVE' | 'CONFLICT';

async function currentTenantCode(db: Db): Promise<string> {
  const r = await db.query<{ code: string }>('select code from tenants where id = app_tenant()');
  return r.rows[0]?.code ?? '';
}

async function requireYeonmu(db: Db) {
  if ((await currentTenantCode(db)) !== YEONMU_TENANT_CODE) {
    throw new DomainError('NOT_FOUND', '이 기관에 맞는 기본 설정 후보가 없습니다. 기준정보를 직접 등록해 주세요.');
  }
}

function requireAny(ctx: ActorContext, actions: Parameters<typeof rolesAllow>[1][]) {
  if (!actions.some((a) => rolesAllow(ctx.roles as Role[], a))) throw new DomainError('FORBIDDEN', '이 작업을 수행할 권한이 없습니다.');
}

const count = async (db: Db, sql: string) => (await db.query<{ n: number }>(sql)).rows[0]!.n;

/** 업무 시작 전 필요한 기준정보가 갖춰졌는지. 담당자도 볼 수 있다(무엇이 비었는지만, 개인정보 없음). */
export async function onboardingReadiness(db: Db, ctx: ActorContext) {
  requireAny(ctx, ['settings.write', 'money.read', 'goods.read']);
  const code = await currentTenantCode(db);
  const legalEntities = await count(db, 'select count(*)::int as n from legal_entities where active');
  const facilities = await count(db, 'select count(*)::int as n from facilities where active');
  const funds = await count(db, 'select count(*)::int as n from funds where active');
  const inactiveFunds = await count(db, 'select count(*)::int as n from funds where not active');
  const warehouses = await count(db, 'select count(*)::int as n from warehouses where active');
  const items = await count(db, 'select count(*)::int as n from items where active');
  const donationStaff = await count(db, `select count(*)::int as n from memberships
    where 'DONATION_STAFF' = any(roles) and revoked_at is null and valid_from <= current_date and (valid_to is null or valid_to >= current_date)`);
  const catalog = await db.query<{ kind: CatalogDbKind; n: number }>('select kind, count(*)::int as n from donation_catalog where active group by kind');
  const byKind = Object.fromEntries(catalog.rows.map((r) => [r.kind, r.n])) as Partial<Record<CatalogDbKind, number>>;
  const last = await db.query<{ appliedAt: string; presetVersion: string }>(
    'select applied_at as "appliedAt", preset_version as "presetVersion" from master_preset_applications order by applied_at desc limit 1',
  );
  const step = (n: number) => (n > 0 ? 'DONE' : 'MISSING');
  return {
    presetAvailable: code === YEONMU_TENANT_CODE,
    steps: {
      legalEntity: { status: step(legalEntities), count: legalEntities },
      facility: { status: step(facilities), count: facilities },
      fund: { status: step(funds), count: funds, inactive: inactiveFunds },
      donationStaff: { status: step(donationStaff), count: donationStaff },
      warehouse: { status: step(warehouses), count: warehouses },
      item: { status: step(items), count: items },
    },
    catalog: {
      managementTypes: byKind.MANAGEMENT_TYPE ?? 0, programs: byKind.PROGRAM ?? 0, partners: byKind.PARTNER ?? 0, schedules: byKind.SCHEDULE ?? 0,
    },
    canEnterMoney: facilities > 0 && funds > 0,
    canEnterGoods: warehouses > 0 && items > 0,
    lastPresetApplication: last.rows[0] ?? null,
  };
}

/** 연무 기본자료를 현재 기준정보와 대조해 항목별 상태를 보여준다. 아무것도 바꾸지 않는다. */
export async function yeonmuPresetPreview(db: Db, ctx: ActorContext) {
  requireAction(ctx, 'settings.write');
  await requireYeonmu(db);
  const legalEntities = await db.query<{ id: string; name: string; kind: string }>('select id, name, kind from legal_entities where active order by name');
  const fac = await db.query<{ id: string; active: boolean; legalEntityId: string; legalEntityName: string }>(
    `select f.id, f.active, f.legal_entity_id as "legalEntityId", l.name as "legalEntityName"
     from facilities f join legal_entities l on l.id = f.legal_entity_id where f.name = $1`, [YEONMU_PRESET.name]);
  const facilityStatus: PresetStatus = !fac.rowCount ? 'MISSING' : fac.rows.some((f) => !f.active) ? 'INACTIVE' : 'ACTIVE';
  const funds = [];
  for (const f of YEONMU_PRESET.funds) {
    const r = await db.query<{ designated: boolean; purpose: string | null; active: boolean }>('select designated, purpose, active from funds where name = $1', [f.name]);
    const status: PresetStatus = !r.rowCount ? 'MISSING'
      : r.rows.some((x) => x.designated !== f.designated || x.purpose !== f.purpose) ? 'CONFLICT'
      : r.rows.some((x) => !x.active) ? 'INACTIVE' : 'ACTIVE';
    funds.push({ ...f, status });
  }
  const existing = await db.query<{ kind: CatalogDbKind; code: string; active: boolean }>('select kind, code, active from donation_catalog');
  const state = new Map(existing.rows.map((r) => [`${r.kind}:${r.code}`, r.active]));
  const withStatus = <T extends { code: string }>(kind: CatalogKind, list: readonly T[]) => list.map((x) => {
    const a = state.get(`${DB_KIND[kind]}:${x.code}`);
    return { ...x, status: (a === undefined ? 'MISSING' : a ? 'ACTIVE' : 'INACTIVE') as PresetStatus };
  });
  const last = await db.query('select applied_at as "appliedAt", preset_version as "presetVersion", created_count as "createdCount", reused_count as "reusedCount" from master_preset_applications order by applied_at desc limit 1');
  return {
    preset: { code: YEONMU_PRESET.code, version: YEONMU_PRESET.version, name: YEONMU_PRESET.name, source: YEONMU_PRESET.source },
    legalEntities: legalEntities.rows,
    facility: { name: YEONMU_PRESET.name, status: facilityStatus, legalEntityId: fac.rows[0]?.legalEntityId ?? null, legalEntityName: fac.rows[0]?.legalEntityName ?? null },
    funds,
    managementTypes: withStatus('managementTypes', YEONMU_PRESET.managementTypes),
    programs: withStatus('programs', YEONMU_PRESET.programs),
    partners: withStatus('partners', YEONMU_PRESET.partners),
    schedules: withStatus('schedules', YEONMU_PRESET.schedules),
    itemSuggestions: YEONMU_PRESET.itemSuggestions,
    workflows: YEONMU_PRESET.workflows,
    lastApplication: last.rows[0] ?? null,
  };
}

export interface ApplyYeonmuInput {
  legalEntityId?: string | null;
  /** 관리자가 직접 확인해 입력한 실제 운영 법인·시설. 시스템이 이름을 지어내지 않는다. */
  newLegalEntity?: { name: string; kind: 'CORPORATION' | 'FACILITY' } | null;
  fundKeys: PresetFundKey[];
  managementTypeCodes?: string[];
  programCodes?: string[];
  partnerCodes?: string[];
  scheduleCodes?: string[];
  reviewed: boolean;
}

/**
 * 관리자 확인 후 고른 항목을 한 트랜잭션에서 추가한다. 하나라도 충돌하면 전체를 되돌린다.
 * 기존 설정·귀속·지정조건은 덮어쓰거나 재활성화하지 않으며, 다시 적용해도 중복이 생기지 않는다.
 */
export async function applyYeonmuPreset(db: Db, ctx: ActorContext, input: ApplyYeonmuInput) {
  requireAction(ctx, 'settings.write');
  await requireYeonmu(db);
  if (!input.reviewed) throw new DomainError('VALIDATION_FAILED', '소속과 기금 목적을 검토한 뒤 적용해 주세요.');
  if (!!input.legalEntityId === !!input.newLegalEntity) throw new DomainError('VALIDATION_FAILED', '소속 법인·시설을 고르거나 새로 입력해 주세요(둘 중 하나).');
  if (new Set(input.fundKeys).size !== input.fundKeys.length || input.fundKeys.some((k) => !YEONMU_PRESET.funds.some((f) => f.key === k))) {
    throw new DomainError('VALIDATION_FAILED', '적용할 기금을 확인해 주세요.');
  }
  const selection: Record<CatalogKind, string[]> = {
    managementTypes: input.managementTypeCodes ?? [], programs: input.programCodes ?? [],
    partners: input.partnerCodes ?? [], schedules: input.scheduleCodes ?? [],
  };
  for (const [kind, codes] of Object.entries(selection) as [CatalogKind, string[]][]) {
    if (!presetCodesValid(kind, codes)) throw new DomainError('VALIDATION_FAILED', '고른 항목에 알 수 없거나 중복된 코드가 있습니다.');
  }
  // 같은 기관에서 두 관리자가 함께 적용해도 중복 생성하지 않는다.
  await db.query(`select pg_advisory_xact_lock(hashtextextended(app_tenant()::text || ':yeonmu-preset', 0))`);
  let created = 0;
  let reused = 0;
  let legalEntityId = input.legalEntityId ?? '';
  if (input.newLegalEntity) {
    legalEntityId = (await createLegalEntity(db, ctx, input.newLegalEntity)).id;
    created++;
  } else {
    const legal = await db.query('select id from legal_entities where id = $1 and active for share', [legalEntityId]);
    if (!legal.rowCount) throw new DomainError('VALIDATION_FAILED', '이 기관에서 사용 중인 소속 법인·시설을 선택해 주세요.');
  }
  const facility = await db.query<{ id: string; legal_entity_id: string; active: boolean }>('select id, legal_entity_id, active from facilities where name = $1 for update', [YEONMU_PRESET.name]);
  if (facility.rows.some((f) => !f.active || f.legal_entity_id !== legalEntityId)) {
    throw new DomainError('VALIDATION_FAILED', '같은 이름의 시설이 다른 소속이거나 사용 중지 상태입니다. 기준정보에서 먼저 확인해 주세요.');
  }
  let facilityId = facility.rows[0]?.id;
  if (facilityId) reused++;
  else {
    facilityId = (await createFacility(db, ctx, { name: YEONMU_PRESET.name, legalEntityId })).id;
    created++;
  }
  for (const key of input.fundKeys) {
    const f = YEONMU_PRESET.funds.find((x) => x.key === key)!;
    const existing = await db.query<{ designated: boolean; purpose: string | null; active: boolean }>('select designated, purpose, active from funds where name = $1 for update', [f.name]);
    if (existing.rows.some((r) => !r.active || r.designated !== f.designated || r.purpose !== f.purpose)) {
      throw new DomainError('VALIDATION_FAILED', `${f.name}의 기존 지정조건 또는 사용 상태가 다릅니다. 기존 설정을 확인해 주세요.`);
    }
    if (existing.rowCount) reused++;
    else { await createFund(db, ctx, f); created++; }
  }
  for (const [kind, codes] of Object.entries(selection) as [CatalogKind, string[]][]) {
    for (const code of codes) {
      const x = (YEONMU_PRESET[kind] as readonly { code: string; name: string; detail?: string; sourcePages: string; category?: string; kind?: string }[]).find((i) => i.code === code)!;
      const r = await db.query(
        `insert into donation_catalog (tenant_id, kind, code, name, category, detail, source_pages, preset_code, created_by)
         values (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8) on conflict (tenant_id, kind, code) do nothing returning id`,
        [DB_KIND[kind], x.code, x.name, x.category ?? x.kind ?? null, x.detail ?? null, x.sourcePages, YEONMU_PRESET.code, ctx.userId],
      );
      if (r.rowCount) created++;
      else reused++; // 이름을 바꿨거나 사용 중지한 항목은 그대로 둔다
    }
  }
  const app = await db.query<{ id: string }>(
    `insert into master_preset_applications (tenant_id, preset_code, preset_version, facility_id, selection, created_count, reused_count, applied_by)
     values (app_tenant(), $1, $2, $3, $4, $5, $6, $7) returning id`,
    [YEONMU_PRESET.code, YEONMU_PRESET.version, facilityId, JSON.stringify({ funds: input.fundKeys, ...selection }), created, reused, ctx.userId],
  );
  await audit(db, ctx, { category: 'ADMIN', action: 'master.preset.apply', resourceType: 'institution_preset', resourceId: app.rows[0]!.id, reason: `${YEONMU_PRESET.code}:${YEONMU_PRESET.version}` });
  return { facilityId, legalEntityId, created, reused, applicationId: app.rows[0]!.id };
}

/** 업무 분류표(관리유형·사업·협력처·일정). 업무 화면에서 읽을 수 있고, 관리자는 사용 중지 항목도 본다. */
export async function listCatalog(db: Db, ctx: ActorContext) {
  requireAny(ctx, ['settings.write', 'money.read', 'goods.read']);
  const all = rolesAllow(ctx.roles as Role[], 'settings.write');
  const r = await db.query(
    `select id, kind, code, name, category, detail, source_pages as "sourcePages", active
     from donation_catalog ${all ? '' : 'where active'} order by kind, active desc, code`,
  );
  return r.rows;
}

/** 이름·설명·사용 여부만 고친다. 코드·종류는 과거 기록의 뜻을 바꾸므로 바꾸지 않는다. */
export async function updateCatalogItem(db: Db, ctx: ActorContext, id: string, input: { name?: string; detail?: string | null; active?: boolean }) {
  requireAction(ctx, 'settings.write');
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n || n.length > 80) throw new DomainError('VALIDATION_FAILED', '이름은 1~80자로 입력하십시오.', { name: '1~80자' });
    params.push(n); sets.push(`name = $${params.length}`);
  }
  if (input.detail !== undefined && (input.detail?.trim().length ?? 0) > 300) throw new DomainError('VALIDATION_FAILED', '설명은 300자 이내로 입력하십시오.', { detail: '300자 이내' });
  if (input.detail !== undefined) { params.push(input.detail?.trim() || null); sets.push(`detail = $${params.length}`); }
  if (input.active !== undefined) { params.push(input.active); sets.push(`active = $${params.length}`); }
  if (!sets.length) throw new DomainError('VALIDATION_FAILED', '바꿀 내용이 없습니다.');
  params.push(id);
  const r = await db.query(`update donation_catalog set ${sets.join(', ')} where id = $${params.length}`, params);
  if (!r.rowCount) throw new DomainError('NOT_FOUND', '대상을 찾을 수 없습니다.');
  await audit(db, ctx, {
    category: 'ADMIN', action: 'master.catalog.update', resourceType: 'donation_catalog', resourceId: id,
    reason: input.active === undefined ? undefined : input.active ? 'activate' : 'deactivate',
  });
  return { ok: true };
}
