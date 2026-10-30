import type pg from 'pg';
import { DomainError, ROLE_LABEL, requireRoleList, type Role } from '@owdms/domain';
import type { ActorContext } from '../pool';
import { requireAction, type Db } from './common';

export interface MembershipInfo {
  tenantId: string;
  tenantName: string;
  roles: string[];
  selfApprovalException: boolean;
}

/** 로그인용: 비활성 계정 제외. 기관 컨텍스트 이전 단계라 SECURITY DEFINER 함수만 사용한다. */
export async function findUser(pool: pg.Pool, username: string) {
  const r = await pool.query<{ user_id: string; display_name: string }>('select * from auth_find_user($1)', [username]);
  return r.rows[0] ? { userId: r.rows[0].user_id, displayName: r.rows[0].display_name } : null;
}

/** 요청마다 호출: 회수·만료된 권한은 즉시 반영된다. */
export async function activeMemberships(pool: pg.Pool, userId: string): Promise<MembershipInfo[]> {
  const r = await pool.query<{ tenant_id: string; tenant_name: string; roles: string[]; self_approval_exception: boolean }>(
    'select * from auth_memberships($1)',
    [userId],
  );
  return r.rows.map((m) => ({ tenantId: m.tenant_id, tenantName: m.tenant_name, roles: m.roles, selfApprovalException: m.self_approval_exception }));
}

// ───────────── 로그인·세션 ─────────────
export interface LoginInfo {
  userId: string;
  displayName: string;
  passwordHash: string;
  mustChange: boolean;
  totpSecretEnc: string | null;
  totpEnabled: boolean;
  lockedUntil: Date | null;
}

export async function loginInfo(pool: pg.Pool, username: string): Promise<LoginInfo | null> {
  const r = await pool.query('select * from auth_login_info($1)', [username]);
  const row = r.rows[0];
  if (!row) return null;
  return {
    userId: row.user_id, displayName: row.display_name, passwordHash: row.password_hash, mustChange: row.must_change,
    totpSecretEnc: row.totp_secret_enc, totpEnabled: row.totp_enabled, lockedUntil: row.locked_until,
  };
}

export const LOGIN_POLICY = { maxFailures: 5, lockMinutes: 15, sessionHours: 8 } as const;

export async function recordLoginFailure(pool: pg.Pool, userId: string, requestId: string): Promise<void> {
  await pool.query(`select auth_login_failed($1, $2, make_interval(mins => $3), $4)`, [userId, LOGIN_POLICY.maxFailures, LOGIN_POLICY.lockMinutes, requestId]);
}

/** 세션을 만든다. OTP를 썼다면 그 시간칸을 기록해 같은 코드 재사용을 막는다. */
export async function recordLoginSuccess(pool: pg.Pool, userId: string, tenantId: string, totpStep: number | null, requestId: string): Promise<string> {
  try {
    const r = await pool.query<{ sid: string }>(`select auth_login_succeeded($1, $2, $3, make_interval(hours => $4), $5) as sid`, [
      userId, tenantId, totpStep, LOGIN_POLICY.sessionHours, requestId,
    ]);
    return r.rows[0]!.sid;
  } catch (e) {
    if ((e as { code?: string }).code === '42501') throw new DomainError('AUTH_FAILED', '로그인할 수 없습니다. 다시 시도하십시오.');
    throw e;
  }
}

/** 개발·시연 로그인 전용(비밀번호 없음). */
export async function openDevSession(pool: pg.Pool, userId: string, tenantId: string): Promise<string> {
  const r = await pool.query<{ sid: string }>(`select auth_session_open($1, $2, make_interval(hours => $3)) as sid`, [userId, tenantId, LOGIN_POLICY.sessionHours]);
  return r.rows[0]!.sid;
}

export interface SessionState { userId: string; tenantId: string; mustChange: boolean; totpEnabled: boolean; hasPassword: boolean }

export async function checkSession(pool: pg.Pool, sessionId: string): Promise<SessionState | null> {
  const r = await pool.query('select * from auth_session_check($1)', [sessionId]);
  const row = r.rows[0];
  return row ? { userId: row.user_id, tenantId: row.tenant_id, mustChange: row.must_change, totpEnabled: row.totp_enabled, hasPassword: row.has_password } : null;
}

export async function revokeSession(pool: pg.Pool, sessionId: string): Promise<void> {
  await pool.query('select auth_session_revoke($1)', [sessionId]);
}

// ───────────── 본인 계정 ─────────────
export async function selfCredentials(db: Db) {
  const r = await db.query('select * from auth_self_credentials()');
  const row = r.rows[0];
  return row ? { passwordHash: row.password_hash as string, totpSecretEnc: row.totp_secret_enc as string | null, totpEnabled: row.totp_enabled as boolean } : null;
}

export async function selfSetPassword(db: Db, hash: string, keepSessionId: string): Promise<void> {
  await db.query('select auth_self_set_password($1, $2)', [hash, keepSessionId]);
}

export async function selfTotpBegin(db: Db, secretEnc: string): Promise<void> {
  await db.query('select auth_self_totp_begin($1)', [secretEnc]);
}

export async function selfTotpEnable(db: Db, step: number): Promise<void> {
  await db.query('select auth_self_totp_enable($1)', [step]);
}

// ───────────── 기관관리자: 직원 계정 ─────────────
export async function adminListUsers(db: Db, ctx: ActorContext) {
  requireAction(ctx, 'user.manage');
  const r = await db.query('select * from auth_admin_users()');
  return r.rows.map((u) => ({
    userId: u.user_id as string, username: u.username as string, displayName: u.display_name as string,
    roles: u.roles as string[], roleLabels: (u.roles as string[]).map((x) => ROLE_LABEL[x as Role] ?? x),
    active: u.revoked_at === null, hasPassword: u.has_password as boolean, mustChange: u.must_change as boolean,
    totpEnabled: u.totp_enabled as boolean, lockedUntil: u.locked_until, lastLoginAt: u.last_login_at,
  }));
}

export async function adminCreateUser(db: Db, ctx: ActorContext, input: { username: string; displayName: string; roles: string[] }, passwordHash: string) {
  requireAction(ctx, 'user.manage');
  requireRoleList(input.roles);
  try {
    const r = await db.query<{ id: string }>('select auth_admin_create_user($1, $2, $3, $4) as id', [input.username, input.displayName, passwordHash, input.roles]);
    return { userId: r.rows[0]!.id };
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      throw new DomainError('VALIDATION_FAILED', '이미 쓰이는 아이디입니다. 다른 아이디를 정하십시오.', { username: '이미 쓰이는 아이디' });
    }
    throw e;
  }
}

export async function adminResetPassword(db: Db, ctx: ActorContext, userId: string, passwordHash: string, resetTotp: boolean) {
  requireAction(ctx, 'user.manage');
  await db.query('select auth_admin_reset_password($1, $2, $3)', [userId, passwordHash, resetTotp]);
}

export async function adminSetMembership(db: Db, ctx: ActorContext, userId: string, roles: string[], revoke: boolean) {
  requireAction(ctx, 'user.manage');
  requireRoleList(roles);
  if (userId === ctx.userId && (revoke || !roles.includes('INSTITUTION_ADMIN'))) {
    throw new DomainError('FORBIDDEN', '자신의 관리자 권한은 스스로 없앨 수 없습니다. 다른 관리자에게 요청하십시오.');
  }
  await db.query('select auth_admin_set_membership($1, $2, $3)', [userId, roles, revoke]);
}
