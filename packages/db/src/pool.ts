import pg from 'pg';

// numeric은 문자열 그대로, bigint(int8)도 문자열로 받는다(JS number 변환 금지).
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => v);
// DATE는 업무일자 문자열(YYYY-MM-DD) 그대로 — 시간대 변환 금지
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max });
}

/** 업무 요청의 행위자 컨텍스트. 모든 변경 서비스는 이것을 필수로 받는다. */
export interface ActorContext {
  tenantId: string;
  userId: string;
  roles: readonly string[];
  requestId: string;
  selfApprovalException?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 기관 컨텍스트를 트랜잭션 범위(set_config(..., true))로만 설정한다.
 * 커밋/롤백과 함께 사라지므로 연결풀의 다음 요청에 남지 않는다.
 */
export async function withTenant<T>(
  pool: pg.Pool,
  ctx: Pick<ActorContext, 'tenantId' | 'userId'>,
  fn: (client: pg.PoolClient) => Promise<T>,
  opts: { isolation?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE' } = {},
): Promise<T> {
  if (!UUID.test(ctx.tenantId) || !UUID.test(ctx.userId)) throw new Error('invalid actor context');
  const client = await pool.connect();
  try {
    await client.query(`begin isolation level ${opts.isolation ?? 'READ COMMITTED'}`);
    await client.query(`select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`, [
      ctx.tenantId,
      ctx.userId,
    ]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
