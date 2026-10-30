import { describe, expect, it } from 'vitest';
import { detectBankHeader, interpretBankGrid, interpretMoneySheet, nameKey, parseAmountCell, parseBankDate } from '../src/bankImport';

// 합성 자료만 사용한다(실제 계좌·이름 아님).
const bankA = [
  ['가상은행 거래내역 조회', '', '', '', '', ''],
  ['계좌번호', '000-0000-0000(가상)', '', '', '', ''],
  ['거래일시', '적요', '기재내용', '찾으신금액', '맡기신금액', '거래후잔액'],
  ['2026.10.01 09:12:00', '타행이체', '홍길동(가상)', '0', '50,000', '1,050,000'],
  ['2026.10.01 09:30:11', '체크카드', '가상마트', '12,000', '0', '1,038,000'],
  ['2026.10.02 10:00:00', '이자', '결산이자', '', '120', '1,038,120'],
  ['2026.10.03 11:00:00', '타행이체', '홍길동(가상)', '', '50,000', '1,088,120'],
  ['합계', '', '', '12,000', '100,120', ''],
];

describe('은행 거래내역 해석', () => {
  it('안내 줄을 건너뛰고 머리글 행과 열을 찾는다(맡기신금액·찾으신금액·기재내용 형식)', () => {
    const h = detectBankHeader(bankA)!;
    expect(h.headerRow).toBe(2);
    expect(h.columns).toMatchObject({ date: 0, counterparty: 2, withdrawal: 3, deposit: 4, balance: 5 });
  });

  it('입금만 후보로 만들고 출금은 세기만 하며, 합계 줄은 건너뛴다', () => {
    const r = interpretBankGrid(bankA);
    expect(r.rows.map((x) => [x.date, x.time, x.amount, x.counterparty])).toEqual([
      ['2026-10-01', '09:12:00', 50000n, '홍길동(가상)'],
      ['2026-10-02', '10:00:00', 120n, '결산이자'],
      ['2026-10-03', '11:00:00', 50000n, '홍길동(가상)'],
    ]);
    expect(r.withdrawals).toBe(1);
    expect(r.errors).toEqual([]);
  });

  it('다른 머리글 형식(입금액·출금액·입금자명, 날짜와 시간 분리)도 읽는다', () => {
    const r = interpretBankGrid([
      ['거래일자', '거래시간', '입금액(원)', '출금액(원)', '잔액(원)', '입금자명', '메모'],
      ['20261005', '1405', '30000', '', '30000', '가상기업', '후원'],
    ]);
    expect(r.rows[0]).toMatchObject({ date: '2026-10-05', time: '14:05:00', amount: 30000n, counterparty: '가상기업', memo: '후원' });
  });

  it('같은 날 같은 금액·같은 입금자의 정상 거래 2건은 서로 다른 지문을 가진다(T02·T12)', () => {
    const grid = [['거래일자', '입금액', '입금자명'], ['2026-10-07', '10000', '김가상'], ['2026-10-07', '10000', '김가상']];
    const a = interpretBankGrid(grid).rows;
    expect(a).toHaveLength(2);
    expect(a[0]!.fingerprint).not.toBe(a[1]!.fingerprint);
    expect(interpretBankGrid(grid).rows.map((x) => x.fingerprint)).toEqual(a.map((x) => x.fingerprint)); // 재반입 시 같은 지문
  });

  it('머리글을 못 찾으면 추측하지 않고 오류로 알린다', () => {
    expect(() => interpretBankGrid([['a', 'b'], ['1', '2']])).toThrow(/머리글/);
  });

  it('입금액이 있는데 날짜가 깨진 줄은 행 번호와 함께 오류로 남긴다', () => {
    const r = interpretBankGrid([['거래일자', '입금액', '입금자명'], ['2026-13-40', '5000', '가상']]);
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([{ line: 2, message: expect.stringContaining('날짜') }]);
  });

  it('날짜·금액 칸 형식', () => {
    expect(parseBankDate('2026/1/5')).toEqual({ date: '2026-01-05', time: null });
    expect(parseBankDate('2026-02-30')).toBeNull();
    expect(parseAmountCell('1,234원')).toBe(1234n);
    expect(parseAmountCell('1000.00')).toBe(1000n);
    expect(parseAmountCell('-')).toBe(0n);
    expect(() => parseAmountCell('12.5')).toThrow();
    expect(() => parseAmountCell('-500')).toThrow();
  });

  it('이름 비교 키는 (주)·괄호 덧말·공백을 무시한다', () => {
    expect(nameKey('(주)가상 기업')).toBe(nameKey('가상기업'));
    expect(nameKey('홍길동(후원)')).toBe('홍길동');
  });
});

describe('후원금 입력 양식 해석', () => {
  it('정상 행과 오류 행을 나눈다(오류는 행 번호와 확인할 칸)', () => {
    const r = interpretMoneySheet([
      ['수납일', '후원자', '후원자번호', '금액', '수납방법', '기금', '메모'],
      ['2026-10-10', '홍길동(가상)', '', '30,000', '계좌이체', '비지정후원금', ''],
      ['2026-10-11', '', '', '5000', '현금', '비지정후원금', '익명'],
      ['2026-10-12', '김가상', '', '0', '수표', '', ''],
    ]);
    expect(r.rows.map((x) => [x.line, x.donorName, x.amount, x.method])).toEqual([
      [2, '홍길동(가상)', 30000n, 'BANK_TRANSFER'],
      [3, null, 5000n, 'CASH'],
    ]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.line).toBe(4);
    expect(r.errors[0]!.message).toMatch(/금액.*수납방법.*기금/);
  });

  it('필수 머리글이 없으면 오류', () => {
    expect(() => interpretMoneySheet([['날짜', '금액']])).toThrow(/수납일/);
  });
});
