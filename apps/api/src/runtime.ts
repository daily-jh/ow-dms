import type { Request } from 'express';
import type pg from 'pg';
import { activeMemberships, mapPgError, runIdempotent, withTenant, PiiCipher, type ActorContext, type Db } from '@owdms/db';
import { DomainError, requestHash } from '@owdms/domain';
import type { ApiConfig } from './config';
import { Unauthorized, requestId } from './http';
import { verifySession } from './session';

export const RUNTIME = Symbol('RUNTIME');

/** 요청 → 인증 → 기관 멤버십 재확인 → 트랜잭션(기관 컨텍스트) 실행. */
export class Runtime {
  readonly cipher: PiiCipher;
  constructor(readonly pool: pg.Pool, readonly config: ApiConfig) {
    this.cipher = new PiiCipher(config.piiKey);
  }

  async actor(req: Request): Promise<ActorContext & { tenantName: string }> {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const claims = token ? verifySession(token, this.config.sessionSecret) : null;
    if (!claims) throw new Unauthorized();
    // 퇴사·전보·권한회수는 토큰 만료를 기다리지 않고 즉시 반영된다.
    const membership = (await activeMemberships(this.pool, claims.sub)).find((m) => m.tenantId === claims.tid);
    if (!membership) throw new Unauthorized();
    return {
      tenantId: membership.tenantId, tenantName: membership.tenantName, userId: claims.sub, roles: membership.roles,
      selfApprovalException: membership.selfApprovalException, requestId: requestId(req),
    };
  }

  async tx<T>(req: Request, fn: (db: Db, ctx: ActorContext) => Promise<T>): Promise<T> {
    const ctx = await this.actor(req);
    try {
      return await withTenant(this.pool, ctx, (db) => fn(db, ctx));
    } catch (e) {
      throw mapPgError(e);
    }
  }

  /** 변경 요청: Idempotency-Key가 있으면 같은 키 재전송에 같은 결과를 돌려준다. */
  async mutate<T>(req: Request, fn: (db: Db, ctx: ActorContext) => Promise<T>): Promise<T> {
    const key = req.header('idempotency-key') ?? undefined;
    if (key !== undefined && !/^[A-Za-z0-9_.:-]{8,128}$/.test(key)) {
      throw new DomainError('VALIDATION_FAILED', 'Idempotency-Key 형식이 올바르지 않습니다.', { 'Idempotency-Key': '8~128자 영문·숫자' });
    }
    const hash = requestHash(req.method, req.path, req.body ?? null);
    return this.tx(req, async (db, ctx) => {
      const r = await runIdempotent(db, ctx, key, hash, async () => ({ status: 200, body: await fn(db, ctx) }));
      return r.body as T;
    });
  }
}
