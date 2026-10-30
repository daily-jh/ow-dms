// 브라우저 점검(실제 로그인): 첫 관리자 임시 비밀번호 → 비밀번호 변경 → OTP 등록 → 직원 계정 생성 → 직원 첫 로그인 → 관리자 OTP 로그인
// 준비: create-admin으로 관리자를 만들고, API를 REQUIRE_MFA=true로 실행한다.
// 실행: WEB_URL=http://localhost:3000 ADMIN_USER=t.admin ADMIN_TEMP_PASSWORD=... SHOTS=./shots node tests/browser/auth-smoke.mjs
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS;
const ADMIN = process.env.ADMIN_USER ?? 't.admin';
const TEMP = process.env.ADMIN_TEMP_PASSWORD;
if (!TEMP) throw new Error('ADMIN_TEMP_PASSWORD is required');
const NEW_PASS = '봄날 후원 장부 점검용 2026';

function totp(secret, offset = 0) {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
  const bytes = [];
  for (const ch of secret.replace(/\s/g, '')) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const mac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const o = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const step = (m) => console.log('✓', m);

async function passwordLogin(user, pass) {
  await page.goto(`${WEB}/login`);
  await page.getByLabel('아이디').fill(user);
  await page.getByLabel('비밀번호').fill(pass);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
}

await passwordLogin(ADMIN, 'wrong-password-123');
await page.waitForURL(/\/login\?error=/);
step('틀린 비밀번호 거부');

await passwordLogin(ADMIN, TEMP);
await page.waitForURL(`${WEB}/account`);
await shot('a1-account-required');
step('임시 비밀번호 로그인 → 내 계정으로 이동(업무 화면 잠김)');

await page.goto(`${WEB}/goods`);
await page.waitForURL(`${WEB}/account`);
step('설정 전에는 업무 화면 접근 시 내 계정으로 되돌림');

await page.getByLabel('현재 비밀번호(임시 비밀번호)').fill(TEMP);
await page.getByLabel('새 비밀번호', { exact: true }).fill(NEW_PASS);
await page.getByLabel('새 비밀번호 확인').fill(NEW_PASS);
await page.getByRole('button', { name: '비밀번호 바꾸기' }).click();
await page.waitForURL(/\/account\?ok=/);
step('비밀번호 변경');

await page.getByRole('button', { name: 'OTP 등록 시작' }).click();
const keyText = await page.locator('code').first().textContent();
const secret = keyText.replace(/\s/g, '');
if (!(await page.getByLabel('OTP 등록 QR 코드').locator('svg').count())) throw new Error('QR missing');
await shot('a2-otp-setup');
await page.getByLabel('앱에 표시된 6자리 코드').fill(totp(secret));
await page.getByRole('button', { name: '확인하고 켜기' }).click();
await page.waitForURL(/\/account\?ok=/);
step('OTP 등록(QR·설정 키 표시, 코드 확인)');

await page.getByRole('link', { name: '업무 화면으로' }).click();
await page.getByRole('link', { name: '직원 관리' }).first().click();
await page.waitForURL(`${WEB}/admin/users`);
await page.getByLabel('아이디(영문 소문자·숫자·._- 3~32자)').fill('t.staff1');
await page.getByLabel('이름', { exact: true }).fill('새물품(가상)');
await page.getByLabel('물품담당').first().check();
await page.getByRole('button', { name: '계정 만들기' }).click();
const tempCode = page.locator('.msg.ok code');
await tempCode.waitFor();
const staffTemp = (await tempCode.textContent()).trim();
await shot('a3-admin-users');
step('직원 계정 생성·임시 비밀번호 1회 표시');

await page.getByRole('button', { name: '로그아웃' }).click();
await page.waitForURL(`${WEB}/login`);
await passwordLogin('t.staff1', staffTemp);
await page.waitForURL(`${WEB}/account`);
step('직원 첫 로그인 → 내 계정(비밀번호 변경 요구)');
await page.getByRole('button', { name: '로그아웃' }).click();
await page.waitForURL(`${WEB}/login`);

await passwordLogin(ADMIN, NEW_PASS);
await page.waitForURL(`${WEB}/login/otp`);
await page.getByLabel('인증 코드').fill('000000');
await page.getByRole('button', { name: '확인' }).click();
await page.waitForURL(/\/login\/otp\?error=/);
await page.getByLabel('인증 코드').fill(totp(secret, 1));
await page.getByRole('button', { name: '확인' }).click();
await page.waitForURL(`${WEB}/`);
await shot('a4-admin-home');
step('관리자 재로그인: 비밀번호 → OTP(틀린 코드 거부, 맞는 코드 통과)');

await browser.close();
if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
console.log('auth browser smoke passed');
