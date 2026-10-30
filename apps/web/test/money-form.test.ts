import { describe, expect, it } from 'vitest';
import { moneyFormInput } from '../lib/money-form';
import { CreateMoneyReceiptRequest } from '../../../packages/contracts/src';

const facility = '11111111-1111-4111-8111-111111111111';
const fund = '22222222-2222-4222-8222-222222222222';
const fund2 = '33333333-3333-4333-8333-333333333333';
function form(values: Record<string, string> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ facilityId: facility, receivedOn: '2026-10-30', amount: '100,000', method: 'BANK_TRANSFER', fundId0: fund, fundAmount0: '100,000', ...values })) f.set(k, v);
  return f;
}
describe('후원금 입력 회귀 검사', () => {
  it('화면의 전액 배분을 API가 받는 금액·시설·기금으로 만든다', () => {
    const { errors, input } = moneyFormInput(form());
    expect(errors).toEqual({});
    expect(CreateMoneyReceiptRequest.parse(input)).toMatchObject({ facilityId: facility, amount: '100000', donorId: null, fundLines: [{ fundId: fund, amount: '100000' }] });
  });
  it('빈 시설·기금은 API 요청 전 이해 가능한 안내를 돌려준다', () => {
    const { errors } = moneyFormInput(form({ facilityId: '', fundId0: '', fundAmount0: '' }));
    expect(errors.facilityId).toContain('기준정보');
    expect(errors.fundId0).toContain('기금 1');
    expect(errors.fundAmount0).toContain('배분액');
  });
  it('기금만/금액만 작성한 추가 행을 버리지 않고 오류로 표시한다', () => {
    expect(moneyFormInput(form({ fundId1: fund2 })).errors.fundAmount1).toBeDefined();
    expect(moneyFormInput(form({ fundAmount1: '10000' })).errors.fundId1).toBeDefined();
  });
  it('두 기금의 합계 불일치와 같은 기금의 중복 행을 거부한다', () => {
    expect(moneyFormInput(form({ fundAmount0: '60000', fundId1: fund2, fundAmount1: '40000' })).errors).toEqual({});
    expect(moneyFormInput(form({ fundAmount0: '60000', fundId1: fund2, fundAmount1: '50000' })).errors.fundLines).toBeDefined();
    expect(moneyFormInput(form({ fundAmount0: '60000', fundId1: fund, fundAmount1: '40000' })).errors.fundId1).toBeDefined();
  });
  it('소수·음수·0·범위를 벗어난 금액은 BigInt 계산 전에 거부한다', () => {
    for (const amount of ['0', '-1', '1.5', '1e4', '9999999999999999']) expect(moneyFormInput(form({ amount })).errors.amount, amount).toBeDefined();
  });
  it('약정 후원자 연결과 수납의 금액은 독립적으로 보존한다', () => {
    const result = moneyFormInput(form({ pledge: `${fund2}|${facility}`, pledgeMonth: '2026-09' }));
    expect(result.input).toMatchObject({ donorId: facility, pledgeId: fund2, pledgeMonth: '2026-09', amount: '100000' });
  });
});
