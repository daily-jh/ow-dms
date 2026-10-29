import type pg from 'pg';
import { withTenant, type ActorContext } from './pool';
import { PiiCipher } from './services/pii';
import { createDonor } from './services/donors';
import { createGoodsReceiptDraft } from './services/goods';
import { createMoneyReceiptDraft } from './services/money';
import { createDistributionDraft, postDistribution } from './services/distributions';
import { decideApproval, requestApproval } from './services/approvals';

/**
 * 합성(가상) 자료만 사용한다. 실제 기관·후원자·수혜자 정보를 넣지 않는다.
 * ID를 고정해 시험이 같은 자료를 참조할 수 있게 한다.
 */
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

export const SEED = {
  tenantA: id(1),
  tenantB: id(2),
  legalA: id(11),
  legalB: id(12),
  facilityA: id(21),
  facilityB: id(22),
  warehouseA1: id(31),
  warehouseA2: id(32),
  warehouseB1: id(33),
  itemRiceA: id(41),
  itemRamenA: id(42),
  itemWaterA: id(43),
  itemRiceB: id(44),
  fundGeneralA: id(51),
  fundDesignatedA: id(52),
  fundGeneralB: id(53),
  users: {
    aDonation: id(101), aGoods: id(102), aApprover: id(103), aAccounting: id(104), aReceipt: id(105), aAdmin: id(106), aAuditor: id(107),
    bDonation: id(201), bGoods: id(202), bApprover: id(203),
  },
} as const;

export const SEED_ACCOUNTS: { id: string; username: string; name: string; tenant: string; roles: string[] }[] = [
  { id: SEED.users.aDonation, username: 'a.donation', name: '김후원(가상)', tenant: SEED.tenantA, roles: ['DONATION_STAFF'] },
  { id: SEED.users.aGoods, username: 'a.goods', name: '이물품(가상)', tenant: SEED.tenantA, roles: ['GOODS_STAFF'] },
  { id: SEED.users.aApprover, username: 'a.approver', name: '박승인(가상)', tenant: SEED.tenantA, roles: ['APPROVER'] },
  { id: SEED.users.aAccounting, username: 'a.accounting', name: '최회계(가상)', tenant: SEED.tenantA, roles: ['ACCOUNTING'] },
  { id: SEED.users.aReceipt, username: 'a.receipt', name: '정영수(가상)', tenant: SEED.tenantA, roles: ['RECEIPT_STAFF'] },
  { id: SEED.users.aAdmin, username: 'a.admin', name: '한관리(가상)', tenant: SEED.tenantA, roles: ['INSTITUTION_ADMIN'] },
  { id: SEED.users.aAuditor, username: 'a.auditor', name: '오감사(가상)', tenant: SEED.tenantA, roles: ['AUDITOR'] },
  { id: SEED.users.bDonation, username: 'b.donation', name: '강후원(가상)', tenant: SEED.tenantB, roles: ['DONATION_STAFF'] },
  { id: SEED.users.bGoods, username: 'b.goods', name: '윤물품(가상)', tenant: SEED.tenantB, roles: ['GOODS_STAFF'] },
  { id: SEED.users.bApprover, username: 'b.approver', name: '임승인(가상)', tenant: SEED.tenantB, roles: ['APPROVER'] },
];

/** 개발용 고정 키(합성자료 전용). 운영에서는 KMS/비밀저장소에서 주입한다. */
export const DEV_PII_KEY = Buffer.alloc(32, 7).toString('base64');

export function actor(userId: string, tenantId: string, roles: string[], requestId = 'seed'): ActorContext {
  return { userId, tenantId, roles, requestId };
}

/** 기준정보(마스터) 삽입: migration 계정으로 수행 */
export async function seedMasterData(owner: pg.Pool): Promise<void> {
  const q = (sql: string, params: unknown[]) => owner.query(sql, params);
  await q(`insert into tenants (id, code, name) values ($1, 'A', '가상복지관 A'), ($2, 'B', '가상복지관 B') on conflict do nothing`, [SEED.tenantA, SEED.tenantB]);
  for (const a of SEED_ACCOUNTS) {
    await q(`insert into users (id, username, display_name) values ($1, $2, $3) on conflict do nothing`, [a.id, a.username, a.name]);
    await q(`insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3) on conflict do nothing`, [a.tenant, a.id, a.roles]);
  }
  await q(
    `insert into legal_entities (id, tenant_id, name, kind) values ($1, $2, '가상사회복지법인 A', 'CORPORATION'), ($3, $4, '가상사회복지법인 B', 'CORPORATION') on conflict do nothing`,
    [SEED.legalA, SEED.tenantA, SEED.legalB, SEED.tenantB],
  );
  await q(
    `insert into facilities (id, tenant_id, legal_entity_id, name) values ($1, $2, $3, '가상종합사회복지관 A'), ($4, $5, $6, '가상종합사회복지관 B') on conflict do nothing`,
    [SEED.facilityA, SEED.tenantA, SEED.legalA, SEED.facilityB, SEED.tenantB, SEED.legalB],
  );
  await q(
    `insert into warehouses (id, tenant_id, facility_id, name) values
       ($1, $4, $5, '본관 1층 창고'), ($2, $4, $5, '푸드마켓 창고'), ($3, $6, $7, 'B 창고') on conflict do nothing`,
    [SEED.warehouseA1, SEED.warehouseA2, SEED.warehouseB1, SEED.tenantA, SEED.facilityA, SEED.tenantB, SEED.facilityB],
  );
  await q(
    `insert into items (id, tenant_id, name, base_unit, perishable) values
       ($1, $5, '쌀 10kg', '포', false), ($2, $5, '라면', '개', true), ($3, $5, '생수 2L', '병', false), ($4, $6, '쌀 10kg', '포', false)
     on conflict do nothing`,
    [SEED.itemRiceA, SEED.itemRamenA, SEED.itemWaterA, SEED.itemRiceB, SEED.tenantA, SEED.tenantB],
  );
  await q(
    `insert into funds (id, tenant_id, name, designated, purpose) values
       ($1, $4, '비지정후원금', false, null), ($2, $4, '지정후원금-결연(가상)', true, '가상 결연사업'), ($3, $5, '비지정후원금', false, null)
     on conflict do nothing`,
    [SEED.fundGeneralA, SEED.fundDesignatedA, SEED.fundGeneralB, SEED.tenantA, SEED.tenantB],
  );
}

/** 업무 시나리오: 실제 서비스(권한·승인·원장)를 거쳐 만든다. */
export async function seedScenario(app: pg.Pool, piiKey = DEV_PII_KEY): Promise<Record<string, string>> {
  const cipher = new PiiCipher(piiKey);
  const donA = actor(SEED.users.aDonation, SEED.tenantA, ['DONATION_STAFF']);
  const goodsA = actor(SEED.users.aGoods, SEED.tenantA, ['GOODS_STAFF']);
  const apprA = actor(SEED.users.aApprover, SEED.tenantA, ['APPROVER']);
  const donB = actor(SEED.users.bDonation, SEED.tenantB, ['DONATION_STAFF']);
  const out: Record<string, string> = {};

  const company = await withTenant(app, donA, (db) =>
    createDonor(db, donA, cipher, { donorType: 'CORPORATION', displayName: '예시기업-A', contact: { phone: '010-0000-0001' } }),
  );
  await withTenant(app, donA, (db) => createDonor(db, donA, cipher, { donorType: 'INDIVIDUAL', displayName: '홍길동(가상)', contact: { phone: '010-0000-0002' } }));
  await withTenant(app, donA, (db) => createDonor(db, donA, cipher, { donorType: 'INDIVIDUAL', displayName: '홍길동(가상)' }));
  await withTenant(app, donB, (db) => createDonor(db, donB, cipher, { donorType: 'INDIVIDUAL', displayName: 'B기관 후원자(가상)' }));
  out.donorCompany = company.id;

  // 쌀 100포 입고 → 승인 → 30+20+15포 배분 → 출고 (현재고 35포)
  const rice100 = await withTenant(app, goodsA, (db) =>
    createGoodsReceiptDraft(db, goodsA, {
      facilityId: SEED.facilityA, donorId: company.id, receivedOn: '2026-10-01', memo: '합성 시나리오: 쌀 100포',
      lines: [{ itemId: SEED.itemRiceA, warehouseId: SEED.warehouseA1, quantity: '100', unit: '포' }],
    }),
  );
  const req = await withTenant(app, goodsA, (db) => requestApproval(db, goodsA, 'GOODS_RECEIPT', rice100.id));
  await withTenant(app, apprA, (db) => decideApproval(db, apprA, req.approvalId, { decision: 'APPROVE' }));
  out.rice100Receipt = rice100.id;
  const lot = await withTenant(app, goodsA, async (db) =>
    (await db.query<{ id: string }>(`select lt.id from lots lt join goods_receipt_lines l on l.id = lt.receipt_line_id where l.receipt_id = $1`, [rice100.id])).rows[0]!.id,
  );
  out.rice100Lot = lot;
  for (const [program, quantity] of [['가상 사례관리사업', '30'], ['가상 지역사회보호사업', '20'], ['가상 경로식당', '15']] as const) {
    const d = await withTenant(app, goodsA, (db) =>
      createDistributionDraft(db, goodsA, {
        facilityId: SEED.facilityA, programName: program, plannedOn: '2026-10-15',
        lines: [{ lotId: lot, warehouseId: SEED.warehouseA1, quantity }],
      }),
    );
    const r = await withTenant(app, goodsA, (db) => requestApproval(db, goodsA, 'DISTRIBUTION', d.id));
    await withTenant(app, apprA, (db) => decideApproval(db, apprA, r.approvalId, { decision: 'APPROVE' }));
    await withTenant(app, goodsA, (db) => postDistribution(db, goodsA, d.id));
  }

  // 22.2 예시: 쌀 10kg 20포(예시 평가 단가 30,000원) — 승인 대기 상태로 남겨 화면에서 승인해 볼 수 있게 한다.
  const rice20 = await withTenant(app, goodsA, (db) =>
    createGoodsReceiptDraft(db, goodsA, {
      facilityId: SEED.facilityA, donorId: company.id, receivedOn: '2026-10-29', memo: '22.2 예시: 쌀 20포(합성)',
      lines: [{ itemId: SEED.itemRiceA, warehouseId: SEED.warehouseA1, quantity: '20', unit: '포', unitValue: '30000', valuationBasis: '예시 평가(합성)' }],
    }),
  );
  await withTenant(app, goodsA, (db) => requestApproval(db, goodsA, 'GOODS_RECEIPT', rice20.id));
  out.rice20Receipt = rice20.id;

  // 후원금 10만원 → 비지정 6만 + 지정 4만
  const money = await withTenant(app, donA, (db) =>
    createMoneyReceiptDraft(db, donA, {
      facilityId: SEED.facilityA, donorId: company.id, receivedOn: '2026-10-10', amount: '100000', method: 'BANK_TRANSFER',
      fundLines: [{ fundId: SEED.fundGeneralA, amount: '60000' }, { fundId: SEED.fundDesignatedA, amount: '40000' }],
    }),
  );
  const mr = await withTenant(app, donA, (db) => requestApproval(db, donA, 'MONEY_RECEIPT', money.id));
  await withTenant(app, apprA, (db) => decideApproval(db, apprA, mr.approvalId, { decision: 'APPROVE' }));
  out.moneyReceipt = money.id;
  return out;
}

/** 개발 전용: public 스키마를 지우고 다시 만든다. 운영 환경에서는 실행 거부. */
export async function resetDatabase(owner: pg.Pool): Promise<void> {
  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DB_RESET !== 'true') {
    throw new Error('DB reset is allowed only with ALLOW_DB_RESET=true outside production');
  }
  await owner.query('drop schema public cascade; create schema public;');
}
