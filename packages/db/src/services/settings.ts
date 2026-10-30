import { DomainError } from '@owdms/domain';
import type { ActorContext } from '../pool';
import { audit, requireAction, type Db } from './common';

/** 기준정보 종류. 화면·API·감사기록이 같은 이름을 쓴다. */
export type MasterKind = 'legal-entities' | 'facilities' | 'warehouses' | 'items' | 'funds';

const TABLE: Record<MasterKind, string> = {
  'legal-entities': 'legal_entities', facilities: 'facilities', warehouses: 'warehouses', items: 'items', funds: 'funds',
};

/** 전체 기준정보(사용 중지 포함). 업무 화면의 선택 목록은 reference-data(사용 중인 것만)를 쓴다. */
export async function listMasterData(db: Db, ctx: ActorContext) {
  requireAction(ctx, 'settings.write');
  const legalEntities = await db.query('select id, name, kind, active from legal_entities order by active desc, name');
  const facilities = await db.query(
    'select f.id, f.name, f.active, f.legal_entity_id as "legalEntityId", l.name as "legalEntityName" from facilities f join legal_entities l on l.id = f.legal_entity_id order by f.active desc, f.name',
  );
  const warehouses = await db.query(
    'select w.id, w.name, w.active, w.facility_id as "facilityId", f.name as "facilityName" from warehouses w join facilities f on f.id = w.facility_id order by w.active desc, f.name, w.name',
  );
  const items = await db.query(
    `select i.id, i.name, i.base_unit as "baseUnit", i.perishable, i.active,
            exists (select 1 from lots l where l.item_id = i.id) as "inUse"
     from items i order by i.active desc, i.name`,
  );
  const funds = await db.query(
    `select f.id, f.name, f.designated, f.purpose, f.active,
            exists (select 1 from receipt_fund_lines r where r.fund_id = f.id) as "inUse"
     from funds f order by f.active desc, f.designated, f.name`,
  );
  return { legalEntities: legalEntities.rows, facilities: facilities.rows, warehouses: warehouses.rows, items: items.rows, funds: funds.rows };
}

const name = (v: string) => {
  const n = v.trim();
  if (!n || n.length > 80) throw new DomainError('VALIDATION_FAILED', '이름은 1~80자로 입력하십시오.', { name: '1~80자' });
  return n;
};

async function insert(db: Db, ctx: ActorContext, kind: MasterKind, sql: string, params: unknown[]): Promise<{ id: string }> {
  try {
    const r = await db.query<{ id: string }>(sql, params);
    await audit(db, ctx, { category: 'ADMIN', action: `master.${kind}.create`, resourceType: kind, resourceId: r.rows[0]!.id });
    return { id: r.rows[0]!.id };
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new DomainError('VALIDATION_FAILED', '같은 이름이 이미 있습니다.', { name: '이름 중복' });
    throw e;
  }
}

export async function createLegalEntity(db: Db, ctx: ActorContext, input: { name: string; kind: 'CORPORATION' | 'FACILITY' }) {
  requireAction(ctx, 'settings.write');
  return insert(db, ctx, 'legal-entities', 'insert into legal_entities (tenant_id, name, kind) values (app_tenant(), $1, $2) returning id', [name(input.name), input.kind]);
}

export async function createFacility(db: Db, ctx: ActorContext, input: { name: string; legalEntityId: string }) {
  requireAction(ctx, 'settings.write');
  // 복합 FK(tenant_id, legal_entity_id)가 다른 기관 법인 참조를 막는다.
  return insert(db, ctx, 'facilities', 'insert into facilities (tenant_id, legal_entity_id, name) values (app_tenant(), $1, $2) returning id', [input.legalEntityId, name(input.name)]);
}

export async function createWarehouse(db: Db, ctx: ActorContext, input: { name: string; facilityId: string }) {
  requireAction(ctx, 'settings.write');
  return insert(db, ctx, 'warehouses', 'insert into warehouses (tenant_id, facility_id, name) values (app_tenant(), $1, $2) returning id', [input.facilityId, name(input.name)]);
}

export async function createItem(db: Db, ctx: ActorContext, input: { name: string; baseUnit: string; perishable: boolean }) {
  requireAction(ctx, 'settings.write');
  const unit = input.baseUnit.trim();
  if (!unit || unit.length > 10) throw new DomainError('VALIDATION_FAILED', '기본 단위는 1~10자로 입력하십시오(예: 개, 포, 박스).', { baseUnit: '1~10자' });
  return insert(db, ctx, 'items', 'insert into items (tenant_id, name, base_unit, perishable) values (app_tenant(), $1, $2, $3) returning id', [name(input.name), unit, input.perishable]);
}

export async function createFund(db: Db, ctx: ActorContext, input: { name: string; designated: boolean; purpose?: string | null }) {
  requireAction(ctx, 'settings.write');
  const purpose = input.purpose?.trim() || null;
  if (input.designated && !purpose) throw new DomainError('VALIDATION_FAILED', '지정후원금은 사용 목적을 적어 주십시오.', { purpose: '목적 필요' });
  return insert(db, ctx, 'funds', 'insert into funds (tenant_id, name, designated, purpose) values (app_tenant(), $1, $2, $3) returning id', [name(input.name), input.designated, purpose]);
}

/**
 * 이름 변경·사용 중지/재사용. 단위·지정 여부처럼 과거 거래의 뜻을 바꾸는 값은 바꾸지 않는다
 * (잘못 만들었으면 사용 중지하고 새로 만든다).
 */
export async function updateMaster(db: Db, ctx: ActorContext, kind: MasterKind, id: string, input: { name?: string; active?: boolean; purpose?: string | null }) {
  requireAction(ctx, 'settings.write');
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) {
    params.push(name(input.name));
    sets.push(`name = $${params.length}`);
  }
  if (input.active !== undefined) {
    params.push(input.active);
    sets.push(`active = $${params.length}`);
  }
  if (input.purpose !== undefined && kind === 'funds') {
    params.push(input.purpose?.trim() || null);
    sets.push(`purpose = $${params.length}`);
  }
  if (!sets.length) throw new DomainError('VALIDATION_FAILED', '바꿀 내용이 없습니다.');
  params.push(id);
  try {
    const r = await db.query(`update ${TABLE[kind]} set ${sets.join(', ')} where id = $${params.length}`, params);
    if (!r.rowCount) throw new DomainError('NOT_FOUND', '대상을 찾을 수 없습니다.');
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new DomainError('VALIDATION_FAILED', '같은 이름이 이미 있습니다.', { name: '이름 중복' });
    throw e;
  }
  await audit(db, ctx, {
    category: 'ADMIN', action: `master.${kind}.update`, resourceType: kind, resourceId: id,
    reason: input.active === undefined ? undefined : input.active ? 'activate' : 'deactivate',
  });
  return { ok: true };
}
