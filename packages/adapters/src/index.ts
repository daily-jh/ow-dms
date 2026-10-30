import ExcelJS from 'exceljs';
import { DomainError } from '@owdms/domain';
import type { Capability } from '@owdms/contracts';
import {
  HOPE_EUM_DESIGNATION_CODES, HOPE_EUM_EVIDENCE, HOPE_EUM_GOODS_RECEIPT_FIELDS, HOPE_EUM_GOODS_TYPE_CODES, HOPE_EUM_ISSUE_LABELS,
  goodsReceiptCandidateRows,
} from './hopeEumGuide';

export * from './hopeEumGuide';

/**
 * 희망이음 reference 어댑터.
 * 공식 업로드 원본·규격·코드표가 확보되지 않았으므로(V04/V05) 내부 검토용 자료만 만든다.
 * officialFile/approvedModule/officialApi는 비활성이며 submit()은 항상 명시적 오류를 반환한다.
 */
export const HOPE_EUM_REFERENCE_NOTICE = '내부 검토용·희망이음 호환 미검증';

export const FEATURE_FLAGS = {
  officialFileEnabled: false,
  approvedModuleEnabled: false,
  taxIssueEnabled: false,
  aiExtractionEnabled: false,
} as const;

export function hopeEumCapabilities(): Capability[] {
  return [
    { operation: 'goodsReceipt', mode: 'reference', enabled: true, label: '후원품 수입 내부 검토 Excel(희망이음 호환 미검증)' },
    { operation: 'goodsReceipt', mode: 'officialFile', enabled: FEATURE_FLAGS.officialFileEnabled, label: '후원품 수입 공식 업로드 파일 — 현행 원본 미확보(V04)' },
    { operation: 'moneyReceipt', mode: 'officialFile', enabled: false, label: '후원금 정기·비정기입금 파일 — Excel 업로드 지원 여부 미확인(HV-04·05)' },
    { operation: 'donor', mode: 'officialFile', enabled: false, label: '후원자·결연자 일괄등록 — 지원 여부 미확인(HV-07)' },
    { operation: 'goodsUse', mode: 'officialFile', enabled: false, label: '후원품 사용 파일 — 지원 여부 미확인(HV-06)' },
    { operation: 'report', mode: 'approvedModule', enabled: FEATURE_FLAGS.approvedModuleEnabled, label: '표준연계모듈 — 자격·지원업무 회신 대기(V05)' },
  ];
}

export function assertSubmitSupported(mode: Capability['mode']): never {
  throw new DomainError(
    'CAPABILITY_DISABLED',
    mode === 'reference'
      ? '내부 검토용 자료는 전송할 수 없습니다. 희망이음 등록은 담당자가 직접 수행하고 결과를 대조하십시오.'
      : '공식 연계 규격이 검증되지 않아 전송 기능이 비활성화되어 있습니다.',
  );
}

export interface GoodsReceiptReviewRow {
  receiptId: string;
  receivedOn: string;
  donorName: string | null;
  lineNo: number;
  itemName: string;
  quantity: string;
  unit: string;
  expiresOn: string | null;
  valuationStatus: string;
  unitValue: string | null;
  totalValue: string | null;
  lotCode: string | null;
  state: string;
}

/** 스프레드시트 수식 주입 방지: = + - @ 탭/CR로 시작하는 텍스트 앞에 ' 를 붙인다. */
export function safeCellText(value: string | null | undefined): string {
  const v = value ?? '';
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export async function buildGoodsReceiptReviewXlsx(meta: { institutionName: string; batchId: string; generatedAt: string }, rows: GoodsReceiptReviewRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OW-DMS';
  const ws = wb.addWorksheet('내부검토');
  ws.mergeCells('A1:K1');
  ws.getCell('A1').value = `[${HOPE_EUM_REFERENCE_NOTICE}] 이 파일은 희망이음 업로드 파일이 아닙니다. 공식 양식 확보 전 내부 대조용입니다.`;
  ws.getCell('A1').font = { bold: true, color: { argb: 'FFB45309' } };
  ws.getCell('A2').value = `기관: ${meta.institutionName} · 배치: ${meta.batchId} · 생성: ${meta.generatedAt}`;
  const header = ['수입ID', '수입일', '후원처', '행', '품목', '수량', '단위', '유효기한', '가액상태', '가액(원)', '로트'];
  ws.addRow([]);
  ws.addRow(header).font = { bold: true };
  for (const r of rows) {
    ws.addRow([
      r.receiptId, r.receivedOn, safeCellText(r.donorName ?? '익명/미확인'), r.lineNo, safeCellText(r.itemName),
      r.quantity, // 수량은 문자열로 보존(부동소수점 변환 금지)
      safeCellText(r.unit), r.expiresOn ?? '', r.valuationStatus, r.totalValue ?? '', r.lotCode ?? '',
    ]);
  }
  ws.columns.forEach((c) => { c.width = 16; });
  addHopeEumFieldSheet(wb, rows);
  addHopeEumCodeSheet(wb);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

const TEXT = '@';

/** 사례집 9개 작성항목 순서로 후보값을 정리한 대조표. 희망이음 원본의 열 순서·시작행이 아니다. */
function addHopeEumFieldSheet(wb: ExcelJS.Workbook, rows: GoodsReceiptReviewRow[]) {
  const ws = wb.addWorksheet('9항목대조');
  const width = HOPE_EUM_GOODS_RECEIPT_FIELDS.length + 3;
  ws.mergeCells(1, 1, 1, width);
  ws.getCell('A1').value = `[${HOPE_EUM_REFERENCE_NOTICE}] 희망이음 원본 양식이 아닙니다. 사례집에서 확인한 작성항목 9개 기준의 내부 대조표입니다.`;
  ws.getCell('A1').font = { bold: true, color: { argb: 'FFB45309' } };
  ws.mergeCells(2, 1, 2, width);
  ws.getCell('A2').value = `근거: ${HOPE_EUM_EVIDENCE.title} (${HOPE_EUM_EVIDENCE.limit}). 유형·종류·지정구분은 담당자가 확인해 채웁니다.`;
  ws.addRow([]);
  ws.addRow([...HOPE_EUM_GOODS_RECEIPT_FIELDS.map((f) => `${f.no}. ${f.label}`), '수입ID', '행', '확인 필요']).font = { bold: true };
  const candidates = goodsReceiptCandidateRows(rows);
  for (const c of candidates) {
    const row = ws.addRow([
      ...HOPE_EUM_GOODS_RECEIPT_FIELDS.map((f) => safeCellText(c.values[f.key])),
      c.receiptId, c.lineNo, c.issues.map((i) => HOPE_EUM_ISSUE_LABELS[i]).join(', '),
    ]);
    // 코드·숫자는 문자열 셀로 보존한다(01 → 1 변환 방지, 수량·금액 부동소수 변환 방지).
    HOPE_EUM_GOODS_RECEIPT_FIELDS.forEach((_, i) => { row.getCell(i + 1).numFmt = TEXT; });
  }
  ws.columns.forEach((c) => { c.width = 14; });
  ws.getColumn(width).width = 48;
}

function addHopeEumCodeSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet('코드참고');
  ws.getCell('A1').value = `[${HOPE_EUM_REFERENCE_NOTICE}] 사례집 기준 코드입니다. 현행 희망이음 선택값으로 다시 확인하십시오(HV-03).`;
  ws.getCell('A1').font = { bold: true, color: { argb: 'FFB45309' } };
  ws.addRow([]);
  ws.addRow(['후원품 유형', '코드', '설명']).font = { bold: true };
  for (const c of HOPE_EUM_GOODS_TYPE_CODES) {
    const row = ws.addRow([c.label, c.code, c.note]);
    row.getCell(2).numFmt = TEXT;
  }
  ws.addRow([]);
  ws.addRow(['지정구분', '코드', '설명']).font = { bold: true };
  for (const c of HOPE_EUM_DESIGNATION_CODES) {
    const row = ws.addRow([c.label, c.code, c.note]);
    row.getCell(2).numFmt = TEXT;
  }
  ws.getColumn(1).width = 20;
  ws.getColumn(2).width = 8;
  ws.getColumn(3).width = 56;
}
