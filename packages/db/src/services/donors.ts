import { DomainError, rolesAllow, type Role } from '@owdms/domain';
import type { ActorContext } from '../pool';
import { audit, requireAction, type Db } from './common';
import { maskPhone, type PiiCipher } from './pii';

export type DonorType = 'INDIVIDUAL' | 'CORPORATION' | 'GROUP' | 'ANONYMOUS';
const DONOR_TYPES: readonly DonorType[] = ['INDIVIDUAL', 'CORPORATION', 'GROUP', 'ANONYMOUS'];

export interface DonorContact {
  phone?: string;
  email?: string;
  address?: string;
}

export interface DonorView {
  id: string;
  donorType: DonorType;
  displayName: string;
  facilityId: string | null;
  createdAt: string;
  /** 연락처는 권한이 있을 때만, 마스킹된 형태로 */
  maskedPhone?: string | null;
}

export async function createDonor(
  db: Db,
  ctx: ActorContext,
  cipher: PiiCipher,
  input: { donorType: DonorType; displayName: string; facilityId?: string | null; contact?: DonorContact },
): Promise<{ id: string; duplicateCandidates: { id: string; displayName: string; reason: string }[] }> {
  requireAction(ctx, 'donor.write');
  if (!DONOR_TYPES.includes(input.donorType)) throw new DomainError('VALIDATION_FAILED', '후원자 유형이 올바르지 않습니다.', { donorType: '유형' });
  const name = input.displayName.trim();
  if (!name || name.length > 100) throw new DomainError('VALIDATION_FAILED', '표시명은 1~100자입니다.', { displayName: '1~100자' });

  // 동명이인 허용: 후보만 제시하고 자동 병합하지 않는다.
  const candidates = await db.query<{ id: string; display_name: string }>(
    `select id, display_name from donors where display_name = $1 order by created_at limit 10`,
    [name],
  );
  const r = await db.query<{ id: string }>(
    `insert into donors (tenant_id, facility_id, donor_type, display_name, created_by)
     values (app_tenant(), $1, $2, $3, $4) returning id`,
    [input.facilityId ?? null, input.donorType, name, ctx.userId],
  );
  const id = r.rows[0]!.id;
  if (input.contact && Object.values(input.contact).some(Boolean)) {
    await db.query(
      `insert into donor_private (donor_id, tenant_id, contact_ciphertext, key_version) values ($1, app_tenant(), $2, $3)`,
      [id, cipher.encrypt(input.contact), cipher.keyVersion],
    );
  }
  await audit(db, ctx, { category: 'LEDGER', action: 'donor.create', resourceType: 'donor', resourceId: id });
  return {
    id,
    duplicateCandidates: candidates.rows.map((c) => ({ id: c.id, displayName: c.display_name, reason: '표시명 동일' })),
  };
}

export async function listDonors(
  db: Db,
  ctx: ActorContext,
  cipher: PiiCipher,
  q: { search?: string; limit?: number } = {},
): Promise<DonorView[]> {
  requireAction(ctx, 'donor.read');
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const rows = await db.query<{
    id: string; donor_type: DonorType; display_name: string; facility_id: string | null; created_at: Date; contact_ciphertext: Buffer | null;
  }>(
    `select d.id, d.donor_type, d.display_name, d.facility_id, d.created_at, p.contact_ciphertext
       from donors d left join donor_private p on p.donor_id = d.id
      where ($1::text is null or d.display_name ilike '%' || $1 || '%')
      order by d.display_name, d.id
      limit $2`,
    [q.search?.trim() || null, limit],
  );
  const canSeeContact = rolesAllow(ctx.roles as Role[], 'donor.private.read');
  return rows.rows.map((d) => ({
    id: d.id,
    donorType: d.donor_type,
    displayName: d.display_name,
    facilityId: d.facility_id,
    createdAt: d.created_at.toISOString(),
    ...(canSeeContact
      ? { maskedPhone: d.contact_ciphertext ? maskPhone(cipher.decrypt<DonorContact>(d.contact_ciphertext).phone) : null }
      : {}),
  }));
}
