import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  ChangePasswordRequest, CreateUserRequest, DevLoginRequest, PasswordLoginRequest, ResetPasswordRequest, SetMembershipRequest,
  TotpEnableRequest, TotpLoginRequest,
} from '@owdms/contracts';
import {
  LOGIN_POLICY, activeMemberships, adminCreateUser, adminListUsers, adminResetPassword, adminSetMembership, findUser, loginInfo,
  openDevSession, recordLoginFailure, recordLoginSuccess, revokeSession, selfCredentials, selfSetPassword, selfTotpBegin,
  selfTotpEnable, withTenant,
} from '@owdms/db';
import {
  DUMMY_PASSWORD_HASH, DomainError, ROLE_ACTIONS, ROLE_LABEL, assertPasswordAcceptable, hashPassword, newTotpSecret, temporaryPassword,
  totpUri, verifyPassword, verifyTotp, type Role,
} from '@owdms/domain';
import { id } from './controllers';
import { requestId } from './http';
import { RUNTIME, Runtime } from './runtime';
import { signSession, verifySession } from './session';

// 시도 횟수 제한(프로세스 메모리). 계정 잠금(5회 실패 → 15분)은 DB에서 따로 강제한다.
// web 서버가 대신 호출하므로 IP가 아니라 아이디별·전체로 센다.
const attempts = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, max: number, windowMs = 60_000) {
  const now = Date.now();
  const e = attempts.get(key);
  if (!e || e.resetAt < now) return void attempts.set(key, { count: 1, resetAt: now + windowMs });
  e.count += 1;
  if (e.count > max) throw new DomainError('FORBIDDEN', '시도가 너무 많습니다. 잠시 후 다시 시도하십시오.');
}

const BAD_LOGIN = '아이디 또는 비밀번호가 올바르지 않습니다.';

@Controller('v1/auth')
export class AuthController {
  constructor(@Inject(RUNTIME) private readonly rt: Runtime) {}

  private issue(userId: string, tenantId: string, sid: string) {
    const exp = Math.floor(Date.now() / 1000) + LOGIN_POLICY.sessionHours * 3600;
    return { token: signSession({ typ: 'session', sid, sub: userId, tid: tenantId, exp }, this.rt.config.sessionSecret), expiresAt: new Date(exp * 1000).toISOString() };
  }

  /** 아이디·비밀번호 로그인. OTP를 켠 계정은 5분짜리 중간 토큰을 받고 /login/totp로 이어간다. */
  @Post('login')
  async login(@Req() req: Request, @Body() body: unknown) {
    const input = PasswordLoginRequest.parse(body);
    const username = input.username.toLowerCase();
    rateLimit('all', 300);
    rateLimit(`u:${username}`, 10);
    const info = await loginInfo(this.rt.pool, username);
    // 없는 아이디도 같은 시간이 걸리게 비교한다(계정 존재 여부 노출 방지).
    const ok = await verifyPassword(input.password, info?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!info) throw new DomainError('AUTH_FAILED', BAD_LOGIN);
    if (info.lockedUntil && info.lockedUntil > new Date()) {
      throw new DomainError('AUTH_FAILED', '여러 번 틀려 잠시 잠겼습니다. 15분 뒤 다시 시도하거나 기관 관리자에게 요청하십시오.');
    }
    if (!ok) {
      await recordLoginFailure(this.rt.pool, info.userId, requestId(req));
      throw new DomainError('AUTH_FAILED', BAD_LOGIN);
    }
    const tenant = (await activeMemberships(this.rt.pool, info.userId))[0];
    if (!tenant) throw new DomainError('AUTH_FAILED', BAD_LOGIN);
    if (info.totpEnabled) {
      const exp = Math.floor(Date.now() / 1000) + 300;
      return { mfaRequired: true, mfaToken: signSession({ typ: 'mfa', sub: info.userId, tid: tenant.tenantId, exp }, this.rt.config.sessionSecret) };
    }
    const sid = await recordLoginSuccess(this.rt.pool, info.userId, tenant.tenantId, null, requestId(req));
    return { mfaRequired: false, ...this.issue(info.userId, tenant.tenantId, sid) };
  }

  @Post('login/totp')
  async loginTotp(@Req() req: Request, @Body() body: unknown) {
    const input = TotpLoginRequest.parse(body);
    const claims = verifySession(input.mfaToken, this.rt.config.sessionSecret);
    if (!claims || claims.typ !== 'mfa') throw new DomainError('AUTH_FAILED', '시간이 지났습니다. 처음부터 다시 로그인하십시오.');
    rateLimit(`t:${claims.sub}`, 10);
    const info = await withTenant(this.rt.pool, { tenantId: claims.tid, userId: claims.sub }, (db) => selfCredentials(db));
    const secret = info?.totpEnabled && info.totpSecretEnc ? this.rt.cipher.decrypt<{ s: string }>(Buffer.from(info.totpSecretEnc, 'base64')).s : null;
    const step = secret ? verifyTotp(secret, input.code) : null;
    if (step === null) {
      await recordLoginFailure(this.rt.pool, claims.sub, requestId(req));
      throw new DomainError('AUTH_FAILED', '인증 코드가 올바르지 않습니다.');
    }
    const sid = await recordLoginSuccess(this.rt.pool, claims.sub, claims.tid, step, requestId(req));
    return this.issue(claims.sub, claims.tid, sid);
  }

  /** 합성 계정 개발·시연 로그인. 운영(DEV_LOGIN_ENABLED=false)에서는 404와 동일하게 거부. */
  @Post('dev-login')
  async devLogin(@Req() req: Request, @Body() body: unknown) {
    if (!this.rt.config.devLoginEnabled) throw new DomainError('NOT_FOUND', '경로를 찾을 수 없습니다.');
    rateLimit('dev', 120);
    const input = DevLoginRequest.parse(body);
    const user = await findUser(this.rt.pool, input.username);
    const m = user ? (await activeMemberships(this.rt.pool, user.userId))[0] : undefined;
    if (!user || !m) throw new DomainError('FORBIDDEN', '로그인할 수 없는 계정입니다.');
    const sid = await openDevSession(this.rt.pool, user.userId, m.tenantId);
    await withTenant(this.rt.pool, { tenantId: m.tenantId, userId: user.userId }, (db) =>
      db.query(`insert into audit_events (tenant_id, actor_user_id, category, action, result, request_id) values (app_tenant(), app_user(), 'AUTH', 'login.dev', 'SUCCESS', $1)`, [
        requestId(req),
      ]),
    );
    return this.issue(user.userId, m.tenantId, sid);
  }

  @Post('logout')
  async logout(@Req() req: Request) {
    const ctx = await this.rt.actor(req, { allowSetup: true });
    await revokeSession(this.rt.pool, ctx.sessionId);
    return { ok: true };
  }

  @Get('me')
  async me(@Req() req: Request) {
    return this.rt.tx(req, async (db, ctx) => {
      const name = (await db.query<{ display_name: string; username: string }>('select display_name, username from users where id = app_user()')).rows[0];
      return {
        userId: ctx.userId, username: name?.username, displayName: name?.display_name, tenantId: ctx.tenantId, tenantName: ctx.tenantName, roles: ctx.roles,
        roleLabels: ctx.roles.map((r) => ROLE_LABEL[r as Role] ?? r),
        actions: [...new Set(ctx.roles.flatMap((r) => ROLE_ACTIONS[r as Role] ?? []))],
        setup: ctx.setup,
      };
    }, { allowSetup: true });
  }

  /** 본인 비밀번호 변경. 다른 기기의 세션은 모두 끊긴다. */
  @Post('password')
  async changePassword(@Req() req: Request, @Body() body: unknown) {
    const input = ChangePasswordRequest.parse(body);
    return this.rt.tx(req, async (db, ctx) => {
      rateLimit(`p:${ctx.userId}`, 10);
      const cred = await selfCredentials(db);
      if (!cred) throw new DomainError('FORBIDDEN', '비밀번호를 쓰지 않는 계정입니다.');
      if (!(await verifyPassword(input.currentPassword, cred.passwordHash))) {
        throw new DomainError('VALIDATION_FAILED', '현재 비밀번호가 올바르지 않습니다.', { currentPassword: '현재 비밀번호 확인' });
      }
      const username = (await db.query<{ username: string }>('select username from users where id = app_user()')).rows[0]!.username;
      assertPasswordAcceptable(input.newPassword, username);
      if (input.newPassword === input.currentPassword) {
        throw new DomainError('VALIDATION_FAILED', '지금과 다른 비밀번호로 정하십시오.', { newPassword: '다른 비밀번호' });
      }
      await selfSetPassword(db, await hashPassword(input.newPassword), ctx.sessionId);
      return { ok: true };
    }, { allowSetup: true });
  }

  /** OTP 앱 등록 시작: 비밀키를 만들어 저장(대기)하고, 앱에 넣을 키·주소를 돌려준다. */
  @Post('totp/setup')
  async totpSetup(@Req() req: Request) {
    return this.rt.tx(req, async (db, ctx) => {
      const cred = await selfCredentials(db);
      if (!cred) throw new DomainError('FORBIDDEN', '비밀번호를 쓰지 않는 계정입니다.');
      if (cred.totpEnabled) throw new DomainError('INVALID_STATE_TRANSITION', '이미 2단계 인증을 쓰고 있습니다.');
      const secret = newTotpSecret();
      await selfTotpBegin(db, this.rt.cipher.encrypt({ s: secret }).toString('base64'));
      const username = (await db.query<{ username: string }>('select username from users where id = app_user()')).rows[0]!.username;
      return { secret, otpauthUri: totpUri(secret, `${username}@${ctx.tenantName}`) };
    }, { allowSetup: true });
  }

  @Post('totp/enable')
  async totpEnable(@Req() req: Request, @Body() body: unknown) {
    const input = TotpEnableRequest.parse(body);
    return this.rt.tx(req, async (db, ctx) => {
      rateLimit(`te:${ctx.userId}`, 10);
      const cred = await selfCredentials(db);
      if (!cred?.totpSecretEnc || cred.totpEnabled) throw new DomainError('INVALID_STATE_TRANSITION', '먼저 OTP 등록을 시작하십시오.');
      const secret = this.rt.cipher.decrypt<{ s: string }>(Buffer.from(cred.totpSecretEnc, 'base64')).s;
      const step = verifyTotp(secret, input.code);
      if (step === null) throw new DomainError('VALIDATION_FAILED', '인증 코드가 올바르지 않습니다. 휴대폰 시간을 확인하십시오.', { code: '코드 확인' });
      await selfTotpEnable(db, step);
      return { ok: true };
    }, { allowSetup: true });
  }
}

/** 기관관리자: 자기 기관 직원 계정만 관리한다(다른 기관은 DB 함수에서도 거부). */
@Controller('v1/admin')
export class AdminController {
  constructor(@Inject(RUNTIME) private readonly rt: Runtime) {}

  @Get('users')
  users(@Req() req: Request) {
    return this.rt.tx(req, (db, ctx) => adminListUsers(db, ctx));
  }

  /** 계정 생성: 임시 비밀번호는 이 응답에서 한 번만 보여 준다(저장하지 않음). */
  @Post('users')
  async createUser(@Req() req: Request, @Body() body: unknown) {
    const input = CreateUserRequest.parse(body);
    const temp = temporaryPassword();
    const hash = await hashPassword(temp);
    const r = await this.rt.tx(req, (db, ctx) => adminCreateUser(db, ctx, input, hash));
    return { ...r, username: input.username, temporaryPassword: temp };
  }

  @Post('users/:id/reset-password')
  async resetPassword(@Req() req: Request, @Param('id') uid: string, @Body() body: unknown) {
    const input = ResetPasswordRequest.parse(body ?? {});
    const temp = temporaryPassword();
    const hash = await hashPassword(temp);
    await this.rt.tx(req, (db, ctx) => adminResetPassword(db, ctx, id(uid), hash, input.resetMfa));
    return { temporaryPassword: temp };
  }

  @Post('users/:id/membership')
  setMembership(@Req() req: Request, @Param('id') uid: string, @Body() body: unknown) {
    const input = SetMembershipRequest.parse(body);
    return this.rt.tx(req, async (db, ctx) => {
      await adminSetMembership(db, ctx, id(uid), input.roles, input.revoke);
      return { ok: true };
    });
  }
}
