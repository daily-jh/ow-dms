// 브라우저 수직 기능 점검: 로그인 → 후원품 초안 → 승인요청 → (승인권자) 승인 → 재고 → 인수증
// 실행: WEB_URL=http://localhost:3000 SHOTS=./shots node tests/browser/smoke.mjs  (Playwright·Chromium 필요)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS;
const browser = await chromium.launch(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {});
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

// 승인 후 정정: 입고 역거래 요청 → 승인 → 재고 0
await page.goto(`${WEB}/goods`);
await page.locator('tr', { hasText: '승인됨' }).first().getByRole('link').click();
await page.waitForURL(/\/goods\/[0-9a-f-]{36}$/);
const receiptUrl = page.url();
await page.getByText('입고 역거래 요청').click();
await page.fill('input[name="reason"]', '브라우저 점검 정정(합성)');
await page.getByRole('button', { name: '정정 요청' }).click();
await page.waitForURL(/ok=/);
step('정정(역거래) 요청');
await page.getByRole('button', { name: '로그아웃' }).click();
await login('a.approver');
await page.goto(`${WEB}/approvals`);
await page.locator('tr', { hasText: '브라우저 점검 정정' }).getByRole('button', { name: '승인', exact: true }).click();
await page.waitForURL(/ok=/);
await page.goto(receiptUrl);
if (!(await page.locator('h1').innerText()).includes('역거래')) throw new Error('역거래 상태가 표시되지 않습니다');
await shot('08-reversed');
step('정정 승인 → 역거래 반영');
await page.goto(`${WEB}/closing?period=2026-10`);
await shot('09-closing');
if (!(await page.locator('table').innerText()).includes('승인 대기 거래')) throw new Error('마감 점검표 누락');
step('월 마감 점검표');
await page.getByRole('button', { name: '로그아웃' }).click();
await login('a.auditor');
await page.goto(`${WEB}/audit`);
await shot('10-audit');
if (!(await page.locator('table').innerText()).includes('correction.apply.reversal')) throw new Error('감사기록에 정정이 없습니다');
step('감사기록에서 정정 확인');

// 통장 거래내역 가져오기 → 미대조 입금 → 초안(합성 CSV)
await page.getByRole('button', { name: '로그아웃' }).click();
await login('a.donation');
await page.goto(`${WEB}/money/import`);
const bankCsv = fileURLToPath(new URL('./fixtures/bank-synthetic.csv', import.meta.url));
await page.setInputFiles('#file', bankCsv);
await page.getByRole('button', { name: '가져오기' }).click();
await page.getByText('입금 3건을 새로 가져왔습니다').waitFor();
await page.setInputFiles('#file', bankCsv);
await page.getByRole('button', { name: '가져오기' }).click();
await page.getByText('입금 0건을 새로 가져왔습니다. 이미 있던 거래 3건').waitFor();
await page.goto(`${WEB}/money/import`);
const companyRow = page.locator('tbody tr').filter({ has: page.locator('td:nth-child(2)', { hasText: '(주)예시기업-A' }) });
if ((await companyRow.locator('select[name="donor"]').inputValue()) === '') throw new Error('이름이 같은 후원자 1명이 미리 골라지지 않음');
const hongRow = page.locator('tbody tr').filter({ has: page.locator('td:nth-child(2)', { hasText: '홍길동(가상)' }) });
if ((await hongRow.locator('select[name="donor"]').inputValue()) !== '') throw new Error('동명이인인데 자동으로 골라짐');
await companyRow.getByRole('button', { name: '초안 만들기' }).click();
await page.waitForURL(/ok=/);
const interestRow = page.locator('tbody tr').filter({ has: page.locator('td:nth-child(2)', { hasText: '결산이자' }) });
await interestRow.locator('summary').click();
await interestRow.getByRole('button', { name: '후원금 아님으로 표시' }).click();
await page.getByText('후원금 아님으로 표시했습니다').waitFor();
await shot('11-bank-import');
const left = (await page.locator('tbody').first().locator('tr > td:nth-child(2)').allInnerTexts()).join('\n');
if (left.includes('예시기업') || left.includes('결산이자') || !left.includes('홍길동')) throw new Error('미대조 목록이 맞지 않음');
step('통장 거래내역 가져오기: 중복 재반입 0건, 동명이인 자동선택 없음, 입금→초안, 이자 제외');

// 정기후원 약정: 등록만으로는 수입 아님 → 후원금 입력에서 약정 연결 → '승인 대기'
await page.goto(`${WEB}/pledges`);
await page.locator('#donorId').selectOption({ label: '예시기업-A' });
await page.locator('#amount').fill('50000');
await page.getByRole('button', { name: '약정 등록' }).click();
await page.getByText('약정을 등록했습니다').waitFor();
const pledgeRow = page.locator('tbody tr').filter({ hasText: '예시기업-A' });
if (!(await pledgeRow.innerText()).includes('미납')) throw new Error('이번 달 약정이 미납으로 보이지 않음');
await page.goto(`${WEB}/money`);
await page.locator('#pledge').selectOption({ index: 1 });
await page.locator('#amount').fill('50000');
await page.locator('#fundId0').selectOption({ index: 1 });
if ((await page.locator('#fundAmount0').inputValue()) !== '50000') throw new Error('한 기금 전액 배분액이 자동으로 채워지지 않음');
await page.getByRole('button', { name: '초안 저장' }).click();
await page.getByText('후원금 초안을 저장했습니다').waitFor();
if (!(await page.locator('table').innerText()).includes('약정 ')) throw new Error('후원금 목록에 약정 연결이 보이지 않음');
await page.goto(`${WEB}/pledges`);
if (!(await page.locator('tbody tr').filter({ hasText: '예시기업-A' }).innerText()).includes('승인 대기')) throw new Error('약정 달이 승인 대기로 바뀌지 않음');
await shot('12-pledges');
step('정기후원 약정: 등록 → 후원금 입력에서 약정 연결 → 그 달이 승인 대기');

await page.getByRole('button', { name: '로그아웃' }).click();
await login('b.goods');
await page.goto(`${WEB}/stock`);
const bStock = await page.locator('table').innerText();
if (bStock.includes('쌀 10kg') && !bStock.includes('재고가 없습니다')) throw new Error('B기관에 A기관 재고가 보입니다');
step('B기관 계정에는 A기관 재고가 보이지 않음');

await browser.close();
if (errors.length) throw new Error('page errors: ' + errors.join('; '));
console.log('browser smoke passed');
