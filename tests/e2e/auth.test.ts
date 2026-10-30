import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type pg from 'pg';
import { createApp } from '@owdms/api';
import { SEED, createInstitutionAdmin } from '@owdms/db';
import { hashPassword, totpCode, totpStep } from '@owdms/domain';
import { setupTestDb } from '../integration/helpers';

let app: INestApplication;
let base: string;
let owner: pg.Pool;
let appPool: pg.Pool;
const ADMIN_TEMP = 'Temp-Admin-Pass-2026';

beforeAll(async () => {
  const db = await setupTestDb();
  owner = db.owner;
  appPool = db.app;
  const code = (await owner.query<{ code: string }>('select code from tenants where id = $1', [SEED.tenantA])).rows[0]!.code;
  await createInstitutionAdmin(owner, { tenantCode: code, tenantName: 'ignored', username: 'a.realadmin', displayName: '실관리자(가상)' }, await hashPassword(ADMIN_TEMP));
  ({ app } = await createApp({
    databaseUrl: db.appUrl, sessionSecret: 'test-secret-test-secret-test-secret!!', devLoginEnabled: true, demoMode: false,
    requireMfa: true, piiKey: Buffer.alloc(32, 7).toString('base64'), port: 0,
  }));
  await app.listen(0);
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
});
afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await owner?.end();
});

async function call(method: string, path: string, body?: unknown, token?: string) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}
const login = (username: string, password: string) => call('POST', '/v1/auth/login', { username, password });

let adminToken = '';
let adminSecret = '';
const ADMIN_PASS = '봄날 후원 장부 관리 2026';

describe('실제 로그인·2단계 인증', () => {
  it('틀린 비밀번호와 없는 아이디는 같은 문구로 거부한다', async () => {
    const a = await login('a.realadmin', 'wrong-password-123');
    const b = await login('no.such.user', 'wrong-password-123');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.json.safeMessage).toBe(b.json.safeMessage);
  });

  it('임시 비밀번호로 들어오면 비밀번호 변경·OTP 등록 전에는 업무 API가 막힌다', async () => {
    const r = await login('a.realadmin', ADMIN_TEMP);
    expect(r.status).toBe(201);
    expect(r.json.mfaRequired).toBe(false);
    adminToken = r.json.token;
    const me = await call('GET', '/v1/auth/me', undefined, adminToken);
    expect(me.json.setup).toEqual({ mustChangePassword: true, mfaSetupRequired: true });
    expect((await call('GET', '/v1/dashboard', undefined, adminToken)).json.code).toBe('SETUP_REQUIRED');
    expect((await call('GET', '/v1/admin/users', undefined, adminToken)).status).toBe(403);
  });

  it('비밀번호 정책을 지키고, 바꾼 뒤 OTP를 등록하면 업무를 쓸 수 있다', async () => {
    const weak = await call('POST', '/v1/auth/password', { currentPassword: ADMIN_TEMP, newPassword: 'short' }, adminToken);
    expect(weak.status).toBe(422);
    const wrongCurrent = await call('POST', '/v1/auth/password', { currentPassword: 'nope-nope-nope', newPassword: ADMIN_PASS }, adminToken);
    expect(wrongCurrent.status).toBe(422);
    expect((await call('POST', '/v1/auth/password', { currentPassword: ADMIN_TEMP, newPassword: ADMIN_PASS }, adminToken)).status).toBe(201);
    expect((await call('GET', '/v1/auth/me', undefined, adminToken)).json.setup).toEqual({ mustChangePassword: false, mfaSetupRequired: true });

    const setup = await call('POST', '/v1/auth/totp/setup', undefined, adminToken);
    expect(setup.json.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    adminSecret = setup.json.secret;
    expect((await call('POST', '/v1/auth/totp/enable', { code: '000000' }, adminToken)).status).toBe(422);
    expect((await call('POST', '/v1/auth/totp/enable', { code: totpCode(adminSecret, totpStep()) }, adminToken)).status).toBe(201);
    expect((await call('GET', '/v1/admin/users', undefined, adminToken)).status).toBe(200);
  });

  it('OTP 계정은 비밀번호 다음 코드가 필요하고, 같은 코드는 다시 쓸 수 없다', async () => {
    const first = await login('a.realadmin', ADMIN_PASS);
    expect(first.json.mfaRequired).toBe(true);
    expect(first.json.token).toBeUndefined();
    // 중간 토큰으로는 업무 API를 쓸 수 없다
    expect((await call('GET', '/v1/auth/me', undefined, first.json.mfaToken)).status).toBe(401);
    // 등록 때 쓴 코드(같은 시간칸) 재사용 거부
    const reused = await call('POST', '/v1/auth/login/totp', { mfaToken: first.json.mfaToken, code: totpCode(adminSecret, totpStep()) });
    expect(reused.status).toBe(401);
    const ok = await call('POST', '/v1/auth/login/totp', { mfaToken: first.json.mfaToken, code: totpCode(adminSecret, totpStep() + 1) });
    expect(ok.status).toBe(201);
    adminToken = ok.json.token;
    expect((await call('GET', '/v1/admin/users', undefined, adminToken)).status).toBe(200);
  });

  it('로그아웃하면 그 토큰은 즉시 쓸 수 없다', async () => {
    const dev = await call('POST', '/v1/auth/dev-login', { username: 'a.goods' });
    expect((await call('POST', '/v1/auth/logout', undefined, dev.json.token)).status).toBe(201);
    expect((await call('GET', '/v1/auth/me', undefined, dev.json.token)).status).toBe(401);
  });
});

describe('기관관리자의 직원 계정 관리', () => {
  let staffId = '';
  let staffTemp = '';

  it('직원 계정을 만들고 임시 비밀번호를 한 번 받는다. 같은 아이디는 거부한다', async () => {
    const r = await call('POST', '/v1/admin/users', { username: 'A.NewStaff', displayName: '새직원(가상)', roles: ['GOODS_STAFF'] }, adminToken);
    expect(r.status).toBe(201);
    expect(r.json.username).toBe('a.newstaff');
    staffId = r.json.userId;
    staffTemp = r.json.temporaryPassword;
    const dup = await call('POST', '/v1/admin/users', { username: 'a.newstaff', displayName: '중복', roles: ['GOODS_STAFF'] }, adminToken);
    expect(dup.status).toBe(422);
    const badRole = await call('POST', '/v1/admin/users', { username: 'a.worker2', displayName: 'x', roles: ['SYSTEM_WORKER'] }, adminToken);
    expect(badRole.status).toBe(422);
    const list = await call('GET', '/v1/admin/users', undefined, adminToken);
    expect(list.json.find((u: any) => u.username === 'a.newstaff')).toMatchObject({ mustChange: true, totpEnabled: false, active: true });
    // 다른 기관 직원은 목록에 없다
    expect(list.json.some((u: any) => u.username === 'b.goods')).toBe(false);
  });

  it('관리자가 아니면 직원 관리 API가 거부된다', async () => {
    const goods = await call('POST', '/v1/auth/dev-login', { username: 'a.goods' });
    expect((await call('GET', '/v1/admin/users', undefined, goods.json.token)).status).toBe(403);
    expect((await call('POST', '/v1/admin/users', { username: 'a.sneaky', displayName: 'x', roles: ['INSTITUTION_ADMIN'] }, goods.json.token)).status).toBe(403);
  });

  it('다른 기관 직원의 비밀번호·권한은 바꿀 수 없다', async () => {
    expect((await call('POST', `/v1/admin/users/${SEED.users.bGoods}/reset-password`, {}, adminToken)).status).toBe(403);
    expect((await call('POST', `/v1/admin/users/${SEED.users.bGoods}/membership`, { roles: ['APPROVER'] }, adminToken)).status).toBe(403);
  });

  it('5번 틀리면 잠기고, 관리자가 비밀번호를 초기화하면 풀리며 기존 세션은 끊긴다', async () => {
    const staffLogin = await login('a.newstaff', staffTemp);
    expect(staffLogin.status).toBe(201);
    const staffToken = staffLogin.json.token;
    for (let i = 0; i < 5; i++) expect((await login('a.newstaff', 'wrong-password-xx')).status).toBe(401);
    const locked = await login('a.newstaff', staffTemp);
    expect(locked.status).toBe(401);
    expect(locked.json.safeMessage).toMatch(/잠/);

    const reset = await call('POST', `/v1/admin/users/${staffId}/reset-password`, { resetMfa: true }, adminToken);
    expect(reset.status).toBe(201);
    expect((await call('GET', '/v1/auth/me', undefined, staffToken)).status).toBe(401);
    expect((await login('a.newstaff', reset.json.temporaryPassword)).status).toBe(201);

    const audit = await owner.query(`select count(*)::int as n from audit_events where actor_user_id = $1 and action = 'login.password' and result = 'FAILED'`, [staffId]);
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(5);
  });

  it('관리자는 자기 관리자 권한을 스스로 없앨 수 없고, 직원 권한 회수는 즉시 로그인을 막는다', async () => {
    const me = await call('GET', '/v1/auth/me', undefined, adminToken);
    expect((await call('POST', `/v1/admin/users/${me.json.userId}/membership`, { roles: ['APPROVER'] }, adminToken)).status).toBe(403);
    const fresh = await call('POST', `/v1/admin/users/${staffId}/reset-password`, {}, adminToken);
    const staff = await login('a.newstaff', fresh.json.temporaryPassword);
    expect(staff.status).toBe(201);
    expect((await call('POST', `/v1/admin/users/${staffId}/membership`, { roles: ['GOODS_STAFF'], revoke: true }, adminToken)).status).toBe(201);
    expect((await call('GET', '/v1/auth/me', undefined, staff.json.token)).status).toBe(401);
    expect((await login('a.newstaff', fresh.json.temporaryPassword)).status).toBe(401);
  });

  it('앱 계정으로는 인증정보·세션 테이블을 직접 읽을 수 없다', async () => {
    await expect(appPool.query('select * from user_credentials')).rejects.toMatchObject({ code: '42501' });
    await expect(appPool.query('select * from auth_sessions')).rejects.toMatchObject({ code: '42501' });
  });
});
