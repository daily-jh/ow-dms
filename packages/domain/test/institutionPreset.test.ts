import { describe, expect, it } from 'vitest';
import { CATALOG_KINDS, YEONMU_PRESET, presetCodesValid } from '../src';

describe('연무 설정 후보', () => {
  it('비지정과 결연의 목적을 분리하며 실제 거래·접근정보는 만들지 않는다', () => {
    expect(YEONMU_PRESET.funds.find((f) => f.key === 'GENERAL')).toMatchObject({ designated: false, purpose: null });
    expect(YEONMU_PRESET.funds.find((f) => f.key === 'SPONSORSHIP')).toMatchObject({ designated: true, purpose: '결연대상자 지원' });
    expect(new Set(YEONMU_PRESET.funds.map((f) => f.key)).size).toBe(YEONMU_PRESET.funds.length);
    for (const entry of YEONMU_PRESET.workflows) expect(entry.pages).toBeTruthy();
    expect(JSON.stringify(YEONMU_PRESET)).not.toMatch(/password|accountNumber|donorId|recipientId|otpSecret/i);
  });
});

describe('연무 자동 초기입력 후보(v2)', () => {
  it('관리유형 7·사업 14·협력처 25(어린이집 8·모금함 10·기관 7)·업무일정을 모두 이름까지 채운다', () => {
    expect(YEONMU_PRESET.managementTypes).toHaveLength(7);
    expect(YEONMU_PRESET.programs).toHaveLength(14);
    const byKind = (k: string) => YEONMU_PRESET.partners.filter((p) => p.kind === k).length;
    expect([byKind('CHILDCARE'), byKind('COLLECTION_BOX'), byKind('EXTERNAL')]).toEqual([8, 10, 7]);
    expect(YEONMU_PRESET.schedules.length).toBeGreaterThanOrEqual(10);
    for (const list of CATALOG_KINDS.map((k) => YEONMU_PRESET[k])) {
      const codes = list.map((x) => x.code);
      expect(new Set(codes).size).toBe(codes.length);
      for (const x of list) expect(x.name.trim()).not.toBe('');
    }
  });

  it('확인이 안 된 법인결연·운영법인 후원·어린이집·상가 비치처는 기본 선택하지 않는다', () => {
    expect(YEONMU_PRESET.managementTypes.find((t) => t.code === 'CORPORATE_SPONSOR')!.defaultSelected).toBe(false);
    expect(YEONMU_PRESET.programs.find((p) => p.code === 'YM-LEGAL-CORPORATE')!.defaultSelected).toBe(false);
    expect(YEONMU_PRESET.partners.filter((p) => p.kind !== 'EXTERNAL').every((p) => !p.defaultSelected)).toBe(true);
  });

  it('연락처·계좌처럼 보이는 숫자열이 없다', () => {
    expect(JSON.stringify(YEONMU_PRESET)).not.toMatch(/\d{2,4}-\d{3,4}-\d{4}|\d{9,}/);
  });

  it('코드 검사는 모르는 코드와 중복을 거부한다', () => {
    expect(presetCodesValid('programs', ['YM-SP-GENERAL', 'YM-SP-KDB'])).toBe(true);
    expect(presetCodesValid('programs', ['YM-SP-GENERAL', 'YM-SP-GENERAL'])).toBe(false);
    expect(presetCodesValid('partners', ['YM-X99'])).toBe(false);
  });
});
