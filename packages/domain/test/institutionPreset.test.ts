import { describe, expect, it } from 'vitest';
import { YEONMU_PRESET } from '../src';

describe('연무 설정 후보', () => {
  it('비지정과 결연의 목적을 분리하며 실제 거래·접근정보는 만들지 않는다', () => {
    expect(YEONMU_PRESET.funds.find((f) => f.key === 'GENERAL')).toMatchObject({ designated: false, purpose: null });
    expect(YEONMU_PRESET.funds.find((f) => f.key === 'SPONSORSHIP')).toMatchObject({ designated: true, purpose: '결연대상자 지원' });
    expect(new Set(YEONMU_PRESET.funds.map((f) => f.key)).size).toBe(YEONMU_PRESET.funds.length);
    for (const entry of YEONMU_PRESET.workflows) expect(entry.pages).toBeTruthy();
    expect(JSON.stringify(YEONMU_PRESET)).not.toMatch(/password|accountNumber|donorId|recipientId|otpSecret/i);
  });
});
