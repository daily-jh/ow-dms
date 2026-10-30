import type pg from 'pg';

/**
 * 운영 첫 설정: 기관과 그 기관의 첫 관리자 계정을 만든다(migration 계정으로 실행).
 * 비밀번호 해시는 호출하는 쪽에서 만든다. 첫 로그인 때 비밀번호 변경·2단계 인증 등록을 요구한다.
 * 같은 아이디가 이미 있으면 거부한다(자동 병합 없음).
 */
export async function createInstitutionAdmin(
  owner: pg.Pool,
  input: { tenantCode: string; tenantName: string; username: string; displayName: string },
  passwordHash: string,
): Promise<{ tenantId: string; userId: string; tenantCreated: boolean }> {
  const client = await owner.connect();
  try {
    await client.query('begin');
    const existing = await client.query<{ id: string; name: string }>('select id, name from tenants where code = $1', [input.tenantCode]);
    let tenantId = existing.rows[0]?.id;
    const tenantCreated = !tenantId;
    if (!tenantId) {
      tenantId = (await client.query<{ id: string }>('insert into tenants (code, name) values ($1, $2) returning id', [input.tenantCode, input.tenantName])).rows[0]!.id;
    }
    const dup = await client.query('select 1 from users where username = $1', [input.username]);
    if (dup.rowCount) throw new Error(`username already exists: ${input.username}`);
    const userId = (await client.query<{ id: string }>('insert into users (username, display_name) values ($1, $2) returning id', [input.username, input.displayName])).rows[0]!.id;
    await client.query('insert into user_credentials (user_id, password_hash, must_change) values ($1, $2, true)', [userId, passwordHash]);
    await client.query(`insert into memberships (tenant_id, user_id, roles) values ($1, $2, array['INSTITUTION_ADMIN'])`, [tenantId, userId]);
    await client.query(
      `insert into audit_events (tenant_id, actor_user_id, category, action, resource_type, resource_id, result, reason)
       values ($1, null, 'ADMIN', 'user.create', 'USER', $2, 'SUCCESS', 'cli:create-admin')`,
      [tenantId, userId],
    );
    await client.query('commit');
    return { tenantId, userId, tenantCreated };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
