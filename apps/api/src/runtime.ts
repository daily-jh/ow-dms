import type { Request } from 'express';
import type pg from 'pg';
import { activeMemberships, checkSession, mapPgError, runIdempotent, withTenant, PiiCipher, type ActorContext, type Db } from '@owdms/db';
import { DomainError, requestHash } from '@owdms/domain';
import type { ApiConfig } from './config';
import { Unauthorized, requestId } from './http';
import { verifySession } from './session';

export const RUNTIME = Symbol('RUNTIME');

export interface Actor extends ActorContext {
  tenantName: string;
  sessionId: string;
  /** 비밀번호 변경 또는 2단계 인증 등록이 끝나기 전에는 계정 설정 화면만 쓸 수 있다. */
  setup: { mustChangePassword: boolean; mfaSetupRequired: boolean };
}

/** 요청 → 인증(서버 세션) → 기관 멤버십 재확인 → 트랜잭션(기관 컨텍스트) 실행. */
export class Runtime {
  readonly cipher: PiiCipher;
  constructor(readonly pool: pg.Pool, readonly config: ApiConfig) {
    this.cipher = new PiiCipher(config.piiKey);
  }

  async actor(req: Request, opts: { allowSetup?: boolean } = {}): Promise<Actor> {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const claims = token ? verifySession(token, this.config.sessionSecret) : null;
    if (!claims || claims.typ !== 'session' || !claims.sid) throw new Unauthorized();
    // 로그아웃·비밀번호 초기화·계정 비활성화는 토큰 만료를 기다리지 않고 즉시 반영된다.
    const session = await checkSession(this.pool, claims.sid);
    if (!session || session.userId !== claims.sub || session.tenantId !== claims.tid) throw new Unauthorized();
    // 퇴사·전보·권한회수도 즉시 반영된다.
    const membership = (await activeMemberships(this.pool, claims.sub)).find((m) => m.tenantId === claims.tid);
    if (!membership) throw new Unauthorized();
    // 비밀번호 계정만 대상(개발·시연 합성 계정은 비밀번호가 없다).
    const setup = {
      mustChangePassword: session.hasPassword && session.mustChange,
      mfaSetupRequired: session.hasPassword && this.config.requireMfa && !session.totpEnabled,
    };
    if (!opts.allowSetup && (setup.mustChangePassword || setup.mfaSetupRequired)) {
      throw new DomainError('SETUP_REQUIRED', '먼저 내 계정에서 비밀번호 변경과 2단계 인증 등록을 마치십시오.');
    }
    return {
      tenantId: membership.tenantId, tenantName: membership.tenantName, userId: claims.sub, roles: membership.roles,
      selfApprovalException: membership.selfApprovalException, requestId: requestId(req), sessionId: claims.sid, setup,
    };
  }

  async tx<T>(req: Request, fn: (db: Db, ctx: Actor) => Promise<T>, opts: { allowSetup?: boolean } = {}): Promise<T> {
    const ctx = await this.actor(req, opts);
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
