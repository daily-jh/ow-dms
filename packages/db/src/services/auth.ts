import type pg from 'pg';

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
