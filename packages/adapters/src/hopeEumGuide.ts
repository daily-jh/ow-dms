import { DomainError, parsePositiveQty, parseWon } from '@owdms/domain';

/**
 * 희망이음 Excel 연계 근거 정리(2026-10-30 근거분석·개발명세 기준).
 * 공개 Q&A 사례집 인쇄 19쪽(Q8)에서 확인한 것은 후원품 수입 Excel의 "논리 작성항목 9개"와 코드 예시뿐이다.
 * 실제 원본 XLSX의 시트명·열 순서·데이터 시작행·기관별 기초코드는 미확보(V04, HV-01~03)이므로
 * 여기에는 열 주소를 두지 않고, 어떤 코드도 자동으로 정하지 않는다.
 */

export const HOPE_EUM_EVIDENCE = {
  id: 'B-01',
  title: '비영리 실무자를 위한 Q&A 사례집(톡톡톡) 인쇄 19쪽 Q8',
  url: 'https://www.acrc.go.kr/boardDownload.es?bid=99&list_no=84266&seq=1',
  limit: '사례집 화면 안내이며 2026 현행 원본 Excel 규격이 아님',
} as const;

export const HOPE_EUM_WARNING =
  '현재 자료는 내부 검토용이며 희망이음 공식 업로드 호환성이 확인되지 않았습니다. 희망이음에서 다운로드한 실제 양식과 기관별 코드 매핑을 등록하고 테스트를 완료한 뒤 공식 파일 생성을 사용할 수 있습니다.';
export const HOPE_EUM_EXPORT_NOTICE = '파일이 생성되었습니다. 희망이음 등록은 완료되지 않았습니다.';

/** 사례집 Q8 안내 순서. 후원자·수입일자는 업로드 화면에서 지정한다고 설명된다. */
export const HOPE_EUM_GOODS_UPLOAD_STEPS = [
  '희망이음 > 후원관리 > 후원품 관리 > 후원품 수입관리',
  '화면에서 후원자 성명·수입일자 지정',
  '[양식다운로드]로 빈 Excel 받기',
  'Excel 지정 열에 후원품 정보 작성',
  '파일 선택 후 [업로드] → 업로드 내역 확인 → [저장]',
] as const;

export type GoodsFieldKey = 'goodsType' | 'itemKind' | 'detail' | 'itemName' | 'unit' | 'quantity' | 'unitValue' | 'amount' | 'designation';

export interface HopeEumField {
  no: number;
  key: GoodsFieldKey;
  /** 사례집 표기 그대로 */
  label: string;
  /** OW-DMS에서 채울 수 있는 값 */
  source: string;
  /** auto: OW-DMS 값으로 후보 작성 / mapping: 기관 코드 매핑 필요 / manual: 담당자 작성 */
  fill: 'auto' | 'mapping' | 'manual';
  rule: string;
}

/** 후원품 수입 Excel 작성항목 9개(논리 목록). 물리적 열 순서·셀 주소는 미확인이다. */
export const HOPE_EUM_GOODS_RECEIPT_FIELDS: readonly HopeEumField[] = [
  { no: 1, key: 'goodsType', label: '후원품 유형', source: '후원처·기탁 성격', fill: 'mapping', rule: '코드 01~08 중 담당자가 기탁서로 확인해 선택. 자동 추정 금지' },
  { no: 2, key: 'itemKind', label: '후원품 종류', source: '품목', fill: 'mapping', rule: '희망이음에 기관이 등록한 물품 종류 기초코드와 연결' },
  { no: 3, key: 'detail', label: '내역', source: '담당자 작성', fill: 'manual', rule: '개인정보·민감정보 없이 작성(메모는 옮기지 않음)' },
  { no: 4, key: 'itemName', label: '품명', source: '확정된 입고 행의 품목명', fill: 'auto', rule: '길이·표기 확인' },
  { no: 5, key: 'unit', label: '단위', source: '입고 행 단위', fill: 'auto', rule: '희망이음에 기관이 등록한 단위와 같아야 함' },
  { no: 6, key: 'quantity', label: '수량', source: '입고 행 수량', fill: 'auto', rule: '양수, 문자열로 보존(부동소수 변환 금지)' },
  { no: 7, key: 'unitValue', label: '단가', source: '입고 행 단가', fill: 'auto', rule: '가액 확정 전에는 확인 필요로 표시' },
  { no: 8, key: 'amount', label: '금액', source: '입고 행 가액', fill: 'auto', rule: '수량×단가와 일치해야 함' },
  { no: 9, key: 'designation', label: '지정구분', source: '기탁 조건', fill: 'mapping', rule: '0 지정 / 1 비지정. 확인 안 되면 비움' },
];

export interface HopeEumCode { code: string; label: string; note: string }

/** 후원품 유형 코드(사례집 Q8). 코드는 문자열로 보존하고, 어떤 거래에도 자동 배정하지 않는다. */
export const HOPE_EUM_GOODS_TYPE_CODES: readonly HopeEumCode[] = [
  { code: '01', label: '민간단체 보조금품', note: '국내 민간단체 보조금품' },
  { code: '02', label: '외원단체 보조금품', note: '외국 민간원조단체 보조금품' },
  { code: '03', label: '결연후원금품', note: '아동·노인 시설거주자 결연. 지역 학생 결연에 일괄 적용 금지' },
  { code: '04', label: '법인임원 후원금품', note: '법인임원 출연. 법인 귀속 후원과 다름' },
  { code: '05', label: '지역사회 후원금품', note: '지역사회 위문금품·후원금품' },
  { code: '06', label: '후원회 지급금품', note: '법인의 후원회로부터 받은 지원금품' },
  { code: '07', label: '자선모금품', note: '자선바자회 등 수입금품. 판매 수입과 구분' },
  { code: '08', label: '기타 후원금품', note: '행정기관 시설위문금 등. 기본값으로 쓰지 않음' },
];

export const HOPE_EUM_DESIGNATION_CODES: readonly HopeEumCode[] = [
  { code: '0', label: '지정후원금품', note: '사용 목적이 지정된 기탁' },
  { code: '1', label: '비지정후원금품', note: '목적 지정 없는 기탁' },
];

export interface HopeEumOperationStatus {
  operation: string;
  evidence: string;
  template: string;
  now: string;
  status: string;
}

/** 업무별 확인 수준(명세 0절). 원본 양식은 모든 업무에서 미확보. */
export const HOPE_EUM_OPERATION_STATUS: readonly HopeEumOperationStatus[] = [
  { operation: '후원품 수입', evidence: '양식다운로드→작성→업로드→저장 절차와 작성항목 9개 확인(사례집 19쪽)', template: '미확보', now: '9개 항목 대조표를 내부 검토 Excel에 포함', status: '후원품 수입 매핑 준비·내부 검토' },
  { operation: '후원금 정기입금', evidence: '정기입금·회계반영 업무 존재만 확인', template: '미확보', now: 'Excel 일괄 업로드 지원 여부부터 확인 필요', status: '정기입금 파일 연계 미검증' },
  { operation: '후원금 비정기입금', evidence: '비정기입금 업무 존재만 확인', template: '미확보', now: '위와 같음', status: '비정기입금 파일 연계 미검증' },
  { operation: '후원품 사용', evidence: '사용관리 화면의 "수입내역 가져오기" 확인(Excel 업로드 근거 아님)', template: '미확보', now: '수입 등록 후 화면에 직접 입력', status: '사용내역 파일 연계 미검증' },
  { operation: '후원자·결연자', evidence: '등록·결연연계 화면 확인, 일괄 업로드는 미확인', template: '미확보', now: '희망이음 화면에 직접 등록', status: '후원자 매핑 관리 전' },
  { operation: 'CMS 정산', evidence: '효성CMS 정산과 약속사항 업무 확인', template: '해당 없음', now: '희망이음 파일과 별도 업무', status: 'CMS 정산 대조(별도)' },
  { operation: '희망이음 자동 전송', evidence: '공식 외부 연계 여부·권한 불확실', template: '해당 없음', now: '자동 로그인·전송 하지 않음', status: '자동 전송 미지원' },
];

/** 공식 파일을 만들기 전에 기관이 확보해야 할 자료(명세 15절). */
export const HOPE_EUM_PENDING_EVIDENCE: readonly { id: string; need: string; until: string }[] = [
  { id: 'HV-01', need: '후원품 수입 빈 원본 Excel(후원품 수입관리 → 양식다운로드)', until: '공식 출력 차단' },
  { id: 'HV-02', need: '기관의 후원품 종류·단위 기초코드 목록', until: '종류·단위 미매핑 행 차단' },
  { id: 'HV-03', need: '후원품 유형·지정구분의 현행 선택값', until: '사례집 코드만으로 확정 금지' },
  { id: 'HV-04', need: '후원금 정기입금 Excel 업로드 지원 여부·원본', until: '미검증 표시' },
  { id: 'HV-05', need: '후원금 비정기입금 Excel 업로드 지원 여부·원본', until: '미검증 표시' },
  { id: 'HV-06', need: '후원품 사용관리 Excel 지원 여부·원본', until: '내부 대조만' },
  { id: 'HV-07', need: '후원자·결연자 일괄등록 Excel 지원 여부', until: '외부 번호 매핑만' },
  { id: 'HV-08', need: '희망이음 후원자·결연자 번호, 계정·연도 코드(마스킹)', until: '거래별 공식 출력 차단' },
  { id: 'HV-09', need: '법인·시설 실제 회계 귀속', until: '귀속 자동 선택 금지' },
  { id: 'HV-10', need: 'CMS 정산 파일 열·수수료 구분(비식별 샘플)', until: 'CMS·은행 대조만' },
  { id: 'HV-11', need: '등록 결과를 확인할 화면·내보내기', until: '자동 등록확인 금지' },
  { id: 'HV-12', need: '원본 양식 변경 주기·담당자', until: '수동 갱신' },
];

export function hopeEumGuide() {
  return {
    warning: HOPE_EUM_WARNING,
    exportNotice: HOPE_EUM_EXPORT_NOTICE,
    evidence: HOPE_EUM_EVIDENCE,
    uploadSteps: HOPE_EUM_GOODS_UPLOAD_STEPS,
    goodsReceiptFields: HOPE_EUM_GOODS_RECEIPT_FIELDS,
    goodsTypeCodes: HOPE_EUM_GOODS_TYPE_CODES,
    designationCodes: HOPE_EUM_DESIGNATION_CODES,
    operations: HOPE_EUM_OPERATION_STATUS,
    pendingEvidence: HOPE_EUM_PENDING_EVIDENCE,
  };
}

export type HopeEumIssueCode =
  | 'UNMAPPED_GOODS_TYPE'
  | 'UNMAPPED_ITEM_KIND_OR_UNIT'
  | 'UNKNOWN_GIFT_DESIGNATION'
  | 'UNVERIFIED_VALUATION'
  | 'AMOUNT_SUM_MISMATCH'
  | 'MIXED_DONOR_OR_DATE';

export const HOPE_EUM_ISSUE_LABELS: Record<HopeEumIssueCode, string> = {
  UNMAPPED_GOODS_TYPE: '후원품 유형 코드 미선택',
  UNMAPPED_ITEM_KIND_OR_UNIT: '종류·단위 기초코드 미매핑',
  UNKNOWN_GIFT_DESIGNATION: '지정구분 미확인',
  UNVERIFIED_VALUATION: '가액 미확정',
  AMOUNT_SUM_MISMATCH: '수량×단가≠금액',
  MIXED_DONOR_OR_DATE: '후원자·수입일이 다른 건이 섞임',
};

export interface GoodsLineForHopeEum {
  receiptId: string;
  receivedOn: string;
  donorName: string | null;
  lineNo: number;
  itemName: string;
  quantity: string;
  unit: string;
  valuationStatus: string;
  unitValue: string | null;
  totalValue: string | null;
}

export interface HopeEumGoodsCandidateRow {
  receiptId: string;
  lineNo: number;
  /** 9개 항목 후보값. 코드 항목은 매핑 기능이 생기기 전까지 항상 빈 값 */
  values: Record<GoodsFieldKey, string>;
  issues: HopeEumIssueCode[];
}

/**
 * 확정된 입고 행을 9개 항목 후보로 옮긴다. 코드 항목(유형·종류·지정구분)과 내역은 비워 두고
 * 확인 필요 항목을 행마다 기록한다. 금액 검산은 bigint로만 한다.
 */
export function goodsReceiptCandidateRows(lines: GoodsLineForHopeEum[]): HopeEumGoodsCandidateRow[] {
  const groups = new Set(lines.map((l) => `${l.donorName ?? ''}|${l.receivedOn}`));
  return lines.map((l) => {
    const issues: HopeEumIssueCode[] = ['UNMAPPED_GOODS_TYPE', 'UNMAPPED_ITEM_KIND_OR_UNIT', 'UNKNOWN_GIFT_DESIGNATION'];
    if (l.valuationStatus !== 'CONFIRMED' || l.unitValue === null || l.totalValue === null) issues.push('UNVERIFIED_VALUATION');
    if (l.unitValue !== null && l.totalValue !== null && !amountMatches(l.quantity, l.unitValue, l.totalValue)) issues.push('AMOUNT_SUM_MISMATCH');
    if (groups.size > 1) issues.push('MIXED_DONOR_OR_DATE');
    return {
      receiptId: l.receiptId,
      lineNo: l.lineNo,
      values: {
        goodsType: '', itemKind: '', detail: '', designation: '',
        itemName: l.itemName, unit: l.unit, quantity: l.quantity,
        unitValue: l.unitValue ?? '', amount: l.totalValue ?? '',
      },
      issues,
    };
  });
}

/** 수량(소수 3자리 고정소수)×단가(원) = 금액(원). 원 미만이 생기면 불일치로 본다. */
export function amountMatches(quantity: string, unitValue: string, totalValue: string): boolean {
  try {
    const milli = parsePositiveQty(quantity);
    const product = milli * parseWon(unitValue);
    return product % 1000n === 0n && product / 1000n === parseWon(totalValue);
  } catch (e) {
    if (e instanceof DomainError) return false;
    throw e;
  }
}
