// 브라우저 수직 기능 점검: 로그인 → 후원품 초안 → 승인요청 → (승인권자) 승인 → 재고 → 인수증
// 실행: WEB_URL=http://localhost:3000 SHOTS=./shots node tests/browser/smoke.mjs  (Playwright·Chromium 필요)
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const step = (m) => console.log('✓', m);

async function login(username) {
  await page.goto(`${WEB}/login`);
  await page.locator('form', { has: page.locator(`input[value="${username}"]`) }).getByRole('button').click();
  await page.waitForURL(`${WEB}/`);
}

await login('a.goods');
await shot('01-dashboard');
step('물품담당 로그인·오늘의 업무');

await page.goto(`${WEB}/goods/new`);
await page.selectOption('#itemId0', { label: '쌀 10kg (포)' });
await page.fill('#quantity0', '20');
await page.fill('#unitValue0', '30000');
await page.fill('#memo', '브라우저 점검(합성)');
await shot('02-goods-new');
await page.getByRole('button', { name: '초안 저장' }).click();
await page.waitForURL(/\/goods\?ok=/);
step('후원품 초안 저장');

const row = page.locator('tr', { hasText: '초안' }).first();
await row.getByRole('button', { name: '승인 요청' }).click();
await page.waitForURL(/ok=/);
await shot('03-goods-list');
step('승인 요청');

await page.getByRole('button', { name: '로그아웃' }).click();
await login('a.approver');
await page.goto(`${WEB}/approvals`);
await shot('04-approvals');
await page.locator('tr', { hasText: '브라우저 점검' }).getByRole('button', { name: '승인', exact: true }).click();
await page.waitForURL(/ok=/);
step('승인권자 승인');

await page.goto(`${WEB}/stock`);
await shot('05-stock');
const stockText = await page.locator('table').innerText();
if (!stockText.includes('20 포')) throw new Error('승인 후 재고 20포가 보이지 않습니다');
step('재고 20포 반영');

await page.getByRole('button', { name: '로그아웃' }).click();
await login('a.goods');
await page.goto(`${WEB}/goods`);
await page.locator('tr', { hasText: '승인됨' }).first().getByRole('link').click();
await page.getByRole('button', { name: /인수증/ }).click();
await page.waitForURL(/\/documents\//);
await page.waitForTimeout(500);
await shot('06-document');
const frame = page.frameLocator('iframe.doc');
const docText = await frame.locator('body').innerText();
if (!docText.includes('후원품 인수증') || !docText.includes('600,000원')) throw new Error('인수증 내용 불일치');
step('인수증 미리보기(600,000원·공통 예시 표기)');

await page.goto(`${WEB}/integrations`);
await shot('07-integrations');
step('희망이음 준비 화면(내부 검토용·전송 비활성)');

await page.getByRole('button', { name: '로그아웃' }).click();
await login('b.goods');
await page.goto(`${WEB}/stock`);
const bStock = await page.locator('table').innerText();
if (bStock.includes('쌀 10kg') && !bStock.includes('재고가 없습니다')) throw new Error('B기관에 A기관 재고가 보입니다');
step('B기관 계정에는 A기관 재고가 보이지 않음');

await browser.close();
if (errors.length) throw new Error('page errors: ' + errors.join('; '));
console.log('browser smoke passed');
