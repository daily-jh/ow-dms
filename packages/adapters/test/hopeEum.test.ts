import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  HOPE_EUM_DESIGNATION_CODES, HOPE_EUM_GOODS_RECEIPT_FIELDS, HOPE_EUM_GOODS_TYPE_CODES, HOPE_EUM_REFERENCE_NOTICE,
  amountMatches, buildGoodsReceiptReviewXlsx, goodsReceiptCandidateRows, hopeEumCapabilities, type GoodsReceiptReviewRow,
} from '../src/index';

const line = (over: Partial<GoodsReceiptReviewRow> = {}): GoodsReceiptReviewRow => ({
  receiptId: 'r1', receivedOn: '2026-10-01', donorName: '합성후원처', lineNo: 1, itemName: '라면', quantity: '10', unit: '박스',
  expiresOn: null, valuationStatus: 'CONFIRMED', unitValue: '15000', totalValue: '150000', lotCode: null, state: 'EXPORTED', ...over,
});

describe('희망이음 후원품 수입 9개 항목', () => {
  it('사례집 항목명 9개를 순서대로 가진다', () => {
    expect(HOPE_EUM_GOODS_RECEIPT_FIELDS.map((f) => f.label)).toEqual([
      '후원품 유형', '후원품 종류', '내역', '품명', '단위', '수량', '단가', '금액', '지정구분',
    ]);
  });

  it('코드는 문자열이며 지정 0, 비지정 1이다(HX-004·005)', () => {
    expect(HOPE_EUM_GOODS_TYPE_CODES.map((c) => c.code)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08']);
    expect(HOPE_EUM_DESIGNATION_CODES.find((c) => c.code === '0')?.label).toBe('지정후원금품');
    expect(HOPE_EUM_DESIGNATION_CODES.find((c) => c.code === '1')?.label).toBe('비지정후원금품');
  });

  it('유형·종류·지정구분·내역을 자동으로 채우지 않는다(HX-006·007)', () => {
    const [c] = goodsReceiptCandidateRows([line()]);
    expect(c!.values).toMatchObject({ goodsType: '', itemKind: '', designation: '', detail: '', itemName: '라면', quantity: '10', amount: '150000' });
    expect(c!.issues).toEqual(['UNMAPPED_GOODS_TYPE', 'UNMAPPED_ITEM_KIND_OR_UNIT', 'UNKNOWN_GIFT_DESIGNATION']);
  });

  it('가액 미확정·금액 불일치·후원자/수입일 혼합을 표시한다(HX-009·026)', () => {
    const rows = goodsReceiptCandidateRows([
      line({ valuationStatus: 'PROPOSED' }),
      line({ receiptId: 'r2', receivedOn: '2026-10-02', totalValue: '149999' }),
    ]);
    expect(rows[0]!.issues).toContain('UNVERIFIED_VALUATION');
    expect(rows[1]!.issues).toContain('AMOUNT_SUM_MISMATCH');
    expect(rows.every((r) => r.issues.includes('MIXED_DONOR_OR_DATE'))).toBe(true);
  });

  it('수량×단가 검산은 정수 연산으로 한다(HX-016)', () => {
    expect(amountMatches('1.5', '3000', '4500')).toBe(true);
    expect(amountMatches('0.333', '1000', '333')).toBe(true);
    expect(amountMatches('0.001', '1', '0')).toBe(false);
    expect(amountMatches('3', '9007199254740993', '27021597764222979')).toBe(true);
    expect(amountMatches('abc', '1', '1')).toBe(false);
  });

  it('공식 파일·전송은 계속 비활성이다(HX-001)', () => {
    const caps = hopeEumCapabilities();
    expect(caps.filter((c) => c.mode !== 'reference').every((c) => !c.enabled)).toBe(true);
  });
});

describe('내부 검토 Excel', () => {
  it('9항목 대조·코드 참고 시트에 경고 문구와 문자열 코드를 둔다', async () => {
    const buf = await buildGoodsReceiptReviewXlsx({ institutionName: '합성기관', batchId: 'b1', generatedAt: '2026-10-30' }, [line({ itemName: '=HYPERLINK("x")' })]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['내부검토', '9항목대조', '코드참고']);
    const fields = wb.getWorksheet('9항목대조')!;
    expect(String(fields.getCell('A1').value)).toContain(HOPE_EUM_REFERENCE_NOTICE);
    expect(fields.getRow(4).getCell(1).value).toBe('1. 후원품 유형');
    expect(fields.getRow(5).getCell(4).value).toBe(`'=HYPERLINK("x")`);
    expect(fields.getRow(5).getCell(6).value).toBe('10');
    const codes = wb.getWorksheet('코드참고')!;
    const first = codes.getRow(4).getCell(2);
    expect(first.value).toBe('01');
    expect(first.numFmt).toBe('@');
  });
});
