import ExcelJS from 'exceljs';
import { DomainError } from '@owdms/domain';
import type { Capability } from '@owdms/contracts';

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
    { operation: 'moneyReceipt', mode: 'officialFile', enabled: false, label: '후원금 수입 공식 파일 — 규격 미확보' },
    { operation: 'donor', mode: 'officialFile', enabled: false, label: '후원자 등록 공식 파일 — 규격 미확보' },
    { operation: 'goodsUse', mode: 'officialFile', enabled: false, label: '후원품 사용 공식 파일 — 규격 미확보' },
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
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
