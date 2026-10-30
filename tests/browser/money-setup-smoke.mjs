// 합성자료 전용 신규 기관(코드 yeonmu): 빈 기준정보 → 기관 설정에서 미리 채운 연무 후보 검토·한 번에 적용 → 전액/분할 저장·오류 입력 보존.
// 실행 전 새로 초기화한 DB에 migration·seed·시험 API/web 실행(코드 yeonmu 기관이 이미 있으면 중단). TEST_SETUP_DATABASE_URL은 loopback의 *_browser DB만 허용.
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const pg = require('pg');
const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:3100';
const API = process.env.API_BASE_URL ?? 'http://127.0.0.1:4100';
const setupUrl = new URL(process.env.TEST_SETUP_DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1'].includes(setupUrl.hostname) || !setupUrl.pathname.endsWith('_browser')) throw new Error('합성 브라우저 시험 DB만 허용합니다.');
const tenant = randomUUID(), user = randomUUID(), username = `setup.${Date.now()}`;
const db = new pg.Client({ connectionString: setupUrl.toString() });
await db.connect();
await db.query('begin');
try {
  if ((await db.query("select 1 from tenants where code = 'yeonmu'")).rowCount) throw new Error('시험 DB에 yeonmu 기관이 이미 있습니다. DB를 새로 초기화한 뒤 실행해 주세요.');
  await db.query('insert into tenants (id, code, name) values ($1, $2, $3)', [tenant, 'yeonmu', '설정검수 가상기관']);
  await db.query('insert into users (id, username, display_name) values ($1, $2, $3)', [user, username, '설정검수 가상담당자']);
  await db.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [tenant, user, ['INSTITUTION_ADMIN', 'DONATION_STAFF']]);
  await db.query('commit');
} catch (e) { await db.query('rollback'); throw e; } finally { await db.end(); }
const browser = await chromium.launch(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR',
  ...(process.env.DEMO_VIDEO_DIR ? { recordVideo: { dir: process.env.DEMO_VIDEO_DIR, size: { width: 1366, height: 900 } } } : {}),
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = async (name) => process.env.SHOTS && page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true });
async function login(name) {
  const r = await fetch(`${API}/v1/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name }) });
  if (!r.ok) throw new Error('가상 로그인 실패');
  const { token } = await r.json();
  await page.context().addCookies([{ name: 'owdms_session', value: token, url: WEB, httpOnly: true, sameSite: 'Strict' }]);
}
try {
  await login(username);
  await page.goto(`${WEB}/money`);
  await page.getByText('입력 전에 기준정보를 등록해 주세요').waitFor();
  if (await page.getByRole('button', { name: '저장·확정' }).count()) throw new Error('빈 기관에서 저장폼이 열림');
  await shot('money-empty-setup');
  await page.getByRole('link', { name: '기관 설정하기' }).click();
  await page.getByText('업무 준비 상태').waitFor();
  // 연무 후보는 미리 선택돼 있다(관리유형·사업 등). 법인 이름은 관리자가 직접 입력한다.
  if (!(await page.locator('input[name="programs"][value="YM-SP-GENERAL"]').isChecked())) throw new Error('사업 후보 미리 선택 누락');
  if (await page.locator('input[name="programs"][value="YM-LEGAL-CORPORATE"]').isChecked()) throw new Error('귀속 미확인 사업이 미리 선택됨');
  if (await page.locator('input[name="partners"][value="YM-C01"]').isChecked()) throw new Error('참여 미확인 어린이집이 미리 선택됨');
  await page.selectOption('#presetLegalEntity', 'new');
  await page.getByLabel('새 법인·시설 명칭').fill('설정검수 가상운영주체');
  if (!(await page.locator('input[name="fundKeys"][value="SPONSORSHIP"]').isChecked())) await page.locator('input[name="fundKeys"][value="SPONSORSHIP"]').check();
  await page.locator('input[name="reviewed"]').check();
  await shot('yeonmu-setup');
  await page.getByRole('button', { name: '선택한 기본 항목 한 번에 추가' }).click();
  await page.getByText('연무 기본 항목을 확인·추가했습니다.').waitFor();
  if ((await page.locator('input[name="programs"]:not([disabled])').count()) !== 1) throw new Error('적용 후 상태 표시 오류');
  await shot('yeonmu-settings');
  await page.goto(`${WEB}/money`);
  if (!(await page.locator('#facilityId').inputValue())) throw new Error('시설 선택값 누락');
  await page.fill('#amount', '100000');
  if (await page.locator('#fundId0').evaluate((e) => e.checkValidity())) throw new Error('기금 미선택을 허용함');
  await page.selectOption('#fundId0', { label: '비지정후원금' });
  await page.selectOption('#sourceChannel', 'HAPPYBEAN');
  await page.fill('#projectName', '가상 겨울나기');
  await page.fill('#evidenceRef', 'TEST-2026-001');
  if ((await page.locator('#fundAmount0').inputValue()) !== '100000') throw new Error('전액배분 자동입력 누락');
  await page.getByRole('button', { name: '저장·확정' }).click();
  await page.getByText('후원금을 저장·확정했습니다. 실적에 반영되었습니다.').waitFor();
  await page.waitForFunction(() => document.querySelector('#amount')?.value === '');
  if (!(await page.locator('table').innerText()).includes('100,000원')) throw new Error('후원금 목록 저장 실패');
  await page.fill('#amount', '100000');
  await page.selectOption('#fundId0', { label: '비지정후원금' });
  await page.getByLabel('두 기금으로 나누어 배분').check();
  await page.fill('#fundAmount0', '60000');
  await page.selectOption('#fundId1', { label: '결연후원금' });
  await page.fill('#fundAmount1', '50000');
  await page.getByRole('button', { name: '저장·확정' }).click();
  await page.getByText('기금 배분액의 합계가 수납액과 같아야 합니다.').waitFor();
  await shot('money-validation-preserved');
  const preserved = await page.locator('#amount, #fundAmount1, #fundId1').evaluateAll((elements) => elements.map((el) => ({ id: el.id, value: el.value })));
  if ((await page.locator('#amount').inputValue()) !== '100000' || (await page.locator('#fundAmount1').inputValue()) !== '50000' || !(await page.locator('#fundId1').inputValue())) throw new Error('오류 후 입력값 소실: ' + JSON.stringify(preserved));
  await page.fill('#fundAmount1', '40000');
  await page.getByRole('button', { name: '저장·확정' }).click();
  await page.getByText('후원금을 저장·확정했습니다. 실적에 반영되었습니다.').waitFor();
  await page.waitForFunction(() => document.querySelector('#amount')?.value === '');
  if (await page.locator('p[role="alert"]').count()) throw new Error('저장 완료 후 이전 오류가 남음');
  if ((await page.locator('tbody tr').count()) !== 2) throw new Error('전액/분할 수납이 각각 한 번 저장되지 않음');
  if ((await page.locator('tbody tr').filter({ hasText: '확정됨' }).count()) !== 2) throw new Error('담당자 직접 확정 실패');
  if (!(await page.locator('table').innerText()).includes('가상 겨울나기')) throw new Error('연무 항목 누락');
  await shot('money-saved');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot('money-mobile');
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(WEB);
  if (!(await page.locator('main').innerText()).includes('200,000원')) throw new Error('저장 후 실적 합계 미반영');
  await shot('staff-dashboard');
  await page.goto(`${WEB}/money`);
  const first = page.locator('tbody tr').first();
  await first.getByText('수납 취소 기록', { exact: true }).click();
  await first.getByLabel('정정 사유').fill('가상 중복입력 취소');
  await first.getByRole('button', { name: '정정 확정', exact: true }).click();
  await page.getByText('담당자 확인으로 정정했습니다. 사유와 역거래 이력이 기록되었습니다.').waitFor();
  if ((await page.locator('tbody tr').filter({ hasText: '역거래' }).count()) !== 1) throw new Error('담당자 취소 미반영');
  await shot('staff-correction');
  await page.goto(WEB);
  if (!(await page.locator('main').innerText()).includes('100,000원')) throw new Error('취소 후 실적 합계 오류');
  await login('a.accounting');
  await page.goto(`${WEB}/money`);
  if (await page.getByRole('button', { name: '저장·확정' }).count()) throw new Error('조회 역할에 입력폼 노출');
  if (errors.length) throw new Error(errors.join('; '));
  console.log('money setup smoke passed: empty setup, prefilled yeonmu setup applied once, full/split save, preserved values, direct confirmation, dashboard totals, direct correction, read-only role');
} finally { await browser.close(); }
