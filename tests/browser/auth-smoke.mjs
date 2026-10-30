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
await page.getByRole('link', { name: '기준정보' }).first().click();
await page.waitForURL(`${WEB}/settings`);
const addMaster = async (button, fill) => {
  const form = page.locator('form', { has: page.getByRole('button', { name: button }) });
  await fill(form);
  const before = page.url();
  await form.getByRole('button', { name: button }).click();
  await page.waitForURL((u) => u.toString() !== before && /\/settings\?(ok|error)=/.test(u.toString()));
  if (page.url().includes('error=')) throw new Error(`${button}: ${decodeURIComponent(page.url())}`);
};
await addMaster('법인 추가', (f) => f.getByLabel('법인 이름').fill('점검법인(가상)'));
await addMaster('시설 추가', (f) => f.getByLabel('시설 이름').fill('점검복지관(가상)'));
await addMaster('창고 추가', (f) => f.getByLabel('창고 이름').fill('1층 창고'));
await addMaster('품목 추가', async (f) => { await f.getByLabel('품목 이름').fill('라면 5입'); await f.getByLabel('기본 단위').fill('봉'); });
await addMaster('기금 추가', (f) => f.getByLabel('기금 이름').fill('일반후원금'));
for (const t of ['점검복지관(가상)', '1층 창고', '라면 5입', '일반후원금']) await page.getByRole('cell', { name: t, exact: true }).first().waitFor();
await shot('a3a-settings');
step('기준정보: 법인·시설·창고·품목·기금 입력');

await page.getByRole('link', { name: '직원 관리' }).first().click();
await page.waitForURL(`${WEB}/admin/users`);
await page.getByLabel('아이디(영문 소문자·숫자·._- 3~32자)').fill('t.staff1');
await page.getByLabel('이름', { exact: true }).fill('새물품(가상)');
await page.getByLabel('물품담당').first().check();
await page.getByLabel('후원담당').first().check();
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
const STAFF_PASS = '물품 담당 새 비밀번호 2026';
await page.getByLabel('현재 비밀번호(임시 비밀번호)').fill(staffTemp);
await page.getByLabel('새 비밀번호', { exact: true }).fill(STAFF_PASS);
await page.getByLabel('새 비밀번호 확인').fill(STAFF_PASS);
await page.getByRole('button', { name: '비밀번호 바꾸기' }).click();
await page.waitForURL(/\/account\?ok=/);
await page.getByRole('button', { name: 'OTP 등록 시작' }).click();
const staffSecret = (await page.locator('code').first().textContent()).replace(/\s/g, '');
await page.getByLabel('앱에 표시된 6자리 코드').fill(totp(staffSecret));
await page.getByRole('button', { name: '확인하고 켜기' }).click();
await page.waitForURL(/\/account\?ok=/);
await page.goto(`${WEB}/goods/new`);
await page.selectOption('#itemId0', { label: '라면 5입 (봉)' });
await page.fill('#quantity0', '12');
await page.getByRole('button', { name: '초안 저장' }).click();
await page.waitForURL(/\/goods\?ok=/);
await shot('a3b-staff-goods');
step('직원 설정 완료 후 새 기준정보로 후원품 초안 저장');
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
