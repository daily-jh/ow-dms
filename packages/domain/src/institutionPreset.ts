/**
 * 연무사회복지관(기관 코드 yeonmu) 초기 설정 후보.
 * 인수인계서의 비개인 업무 항목만 반영한다. 비밀번호·계좌·연락처·후원자/수혜자·실적 수치는 넣지 않는다.
 * 후보는 관리자가 화면에서 고르고 확인해야만 기준정보가 되며, 자동으로 거래·후원자·재고를 만들지 않는다.
 */
export const YEONMU_TENANT_CODE = 'yeonmu';

export type ProgramCategory = 'SPONSORSHIP' | 'EXTERNAL_SPONSORSHIP' | 'SCHOLARSHIP' | 'ONLINE' | 'CAMPAIGN' | 'COLLECTION_BOX' | 'EVENT' | 'GRANT' | 'GOODS' | 'CORPORATE';
export type PartnerKind = 'CHILDCARE' | 'COLLECTION_BOX' | 'EXTERNAL';

export const PROGRAM_CATEGORY_LABEL: Record<ProgramCategory, string> = {
  SPONSORSHIP: '결연', EXTERNAL_SPONSORSHIP: '외부기관 결연', SCHOLARSHIP: '장학·외부지원', ONLINE: '온라인모금',
  CAMPAIGN: '캠페인', COLLECTION_BOX: '모금함', EVENT: '행사', GRANT: '외부지원사업', GOODS: '후원품', CORPORATE: '법인후원',
};
export const PARTNER_KIND_LABEL: Record<PartnerKind, string> = {
  CHILDCARE: '사랑의 저금통 참여 어린이집', COLLECTION_BOX: '모금함 비치처', EXTERNAL: '외부 협력기관',
};

export interface PresetCatalogItem { code: string; name: string; detail?: string; sourcePages: string; defaultSelected: boolean; note?: string }

export const YEONMU_PRESET = {
  code: 'YEONMU_2026',
  name: '연무사회복지관',
  source: '2026-09-23 후원·봉사 업무인수인계서',
  version: '2026-10-30.v2',
  funds: [
    { key: 'GENERAL', name: '비지정후원금', designated: false, purpose: null, sourcePages: '5, 8' },
    { key: 'SPONSORSHIP', name: '결연후원금', designated: true, purpose: '결연대상자 지원', sourcePages: '5~7' },
  ],
  /** 후원 관리유형: 검색·표시용 분류. 후원자 신분(개인·법인·단체·익명)이나 회계 기금이 아니다. */
  managementTypes: [
    { code: 'FACILITY_GENERAL', name: '일반후원', detail: '복지관이 관리하는 일반후원', sourcePages: '4~5', defaultSelected: true },
    { code: 'FACILITY_SPONSOR', name: '일반결연', detail: '복지관 직접 결연', sourcePages: '6~7', defaultSelected: true },
    { code: 'CORPORATE_GENERAL', name: '법인일반', detail: '운영법인이 관리하는 일반후원. 회계 귀속 확인 필요', sourcePages: '2, 5, 8', defaultSelected: true },
    { code: 'CORPORATE_SPONSOR', name: '법인결연', detail: '운영법인 관리 결연. 실제 운영 여부 미확인', sourcePages: '-', defaultSelected: false, note: '운영 여부 확인 전 선택하지 않음' },
    { code: 'FACILITY_DESIGNATED', name: '지정후원', detail: '복지관 지정사업 후원. 기탁 목적별 기금 확인 필요', sourcePages: '5', defaultSelected: true },
    { code: 'EXTERNAL_SUPPORT', name: '외부기관 결연·장학', detail: '외부기관이 운영하는 결연·장학', sourcePages: '6~7', defaultSelected: true },
    { code: 'GOODS_CONTRIBUTION', name: '정기 후원품', detail: '후원품 기탁 관계', sourcePages: '7, 9~10', defaultSelected: true },
  ] satisfies PresetCatalogItem[],
  /** 후원사업: 사업코드는 개발 제안값이며 별도 기금이 아니다. 실제 수입·대상자를 만들지 않는다. */
  programs: [
    { code: 'YM-SP-GENERAL', name: '복지관 일반결연', category: 'SPONSORSHIP', detail: '전월 수납분을 익월 25일경 지급, 지급 전 계획·품의, 이체확인·결과기안', sourcePages: '6~7', defaultSelected: true },
    { code: 'YM-SP-DETENTION', name: '수원구치소 결연', category: 'SPONSORSHIP', detail: '직원 여럿이 개인별로 참여해 학생 여럿을 지원. 졸업예정 학생은 10월경 신규 추천 요청', sourcePages: '6~7', defaultSelected: true },
    { code: 'YM-SP-CHILD-FUND', name: '초록우산 어린이재단 결연', category: 'EXTERNAL_SPONSORSHIP', detail: '당월 수납분을 당월 10~15일경 지급, 공문·명단·입금확인·결과 회신', sourcePages: '6', defaultSelected: true },
    { code: 'YM-SP-HUMAN', name: '수원시휴먼서비스센터 결연', category: 'EXTERNAL_SPONSORSHIP', detail: '담당자 개별 관리, 매월 이체확인증·영수증 등 제출', sourcePages: '7', defaultSelected: true },
    { code: 'YM-SP-KDB', name: 'KDB 장학금(한국사회복지관협회)', category: 'SCHOLARSHIP', detail: '협회 명의 외부 장학금, 일반 CMS 결연과 구분해 별도 관리', sourcePages: '5, 7', defaultSelected: true },
    { code: 'YM-ONLINE-HAPPYBEAN', name: '해피빈', category: 'ONLINE', detail: '정기 비지정 모금과 지정 모금함 구분, 정산·결과보고·기부후기', sourcePages: '5, 8', defaultSelected: true },
    { code: 'YM-CAMPAIGN-PIGGY', name: '어린이집 사랑의 저금통', category: 'CAMPAIGN', detail: '11월~다음해 1월 배부·회수·입금, 후원증서·감사', sourcePages: '8', defaultSelected: true },
    { code: 'YM-CAMPAIGN-BOX', name: '지역 상가 모금함', category: 'COLLECTION_BOX', detail: '비치처 방문·회수·통장 입금. 비치처는 기부자가 아님', sourcePages: '10', defaultSelected: true },
    { code: 'YM-EVENT-BAZAAR', name: '바자회·아나바다 장터', category: 'EVENT', detail: '판매수입과 기부수입 구분, 현금 정산·다음날 입금', sourcePages: '10', defaultSelected: true },
    { code: 'YM-GRANT-EXTERNAL', name: '외부지원사업', category: 'GRANT', detail: '신청 공문→선정→계획·결과보고, 팀별 신청·선정 취합', sourcePages: '2, 10', defaultSelected: true },
    { code: 'YM-GOODS-REGULAR', name: '일반·정기 후원품', category: 'GOODS', detail: '월별 수급·지급대장, 사진·공문·명단 등 근거', sourcePages: '7, 9~10', defaultSelected: true },
    { code: 'YM-LEGAL-CORPORATE', name: '운영법인 후원', category: 'CORPORATE', detail: '법인 CMS·법인 후원금대장·법인 측 영수증 처리. 회계 귀속 확인 필요', sourcePages: '2, 5, 8', defaultSelected: false, note: '법인/시설 귀속 확인 후 선택' },
    { code: 'YM-GOODS-HYGIENE', name: '보훈교육연구원 위생용품 지원', category: 'GOODS', detail: '분기별 지원', sourcePages: '9~10', defaultSelected: true },
    { code: 'YM-GOODS-MEAL', name: '아주대학교병원 연계 반찬지원', category: 'GOODS', detail: '매월 넷째 주 화요일 지원', sourcePages: '9~10', defaultSelected: true },
  ] satisfies (PresetCatalogItem & { category: ProgramCategory })[],
  /** 협력처: 이름만. 주소·연락처·담당자·실적은 넣지 않는다. 최신 참여 여부는 미확인. */
  partners: [
    ...['중앙어린이집', '산돌어린이집', '에덴어린이집', '동그라미어린이집', '동광어린이집', '근로복지공단 수원어린이집', '시립하늘꿈어린이집', '시립수원어린이집']
      .map((name, i) => ({ code: `YM-C${String(i + 1).padStart(2, '0')}`, name, kind: 'CHILDCARE' as const, sourcePages: '8', defaultSelected: false, note: '과거 참여처, 올해 참여 확인 필요' })),
    ...['복지관 사무실', '관장실', '연무그린약국', '광교약국', '화홍문갈비', '밀각시베이커리', '장강', '다정약국', '은혜온누리약국', '금터민물매운탕']
      .map((name, i) => ({ code: `YM-B${String(i + 1).padStart(2, '0')}`, name, kind: 'COLLECTION_BOX' as const, sourcePages: '10', defaultSelected: false, note: i < 2 ? '내부 비치처' : '지역 상가 비치처, 현재 비치 확인 필요' })),
    ...['수원구치소', '동성중학교', '초록우산 어린이재단', '수원시휴먼서비스센터', '한국사회복지관협회', '보훈교육연구원', '아주대학교병원']
      .map((name, i) => ({ code: `YM-P${String(i + 1).padStart(2, '0')}`, name, kind: 'EXTERNAL' as const, sourcePages: '6~10', defaultSelected: true })),
  ] satisfies (PresetCatalogItem & { kind: PartnerKind })[],
  /** 업무일정 예시: 기관 내부 관행이며 법정 기한이 아니다. 고른 것만 등록한다. */
  schedules: [
    { code: 'YM-S-MONTHLY-REPORT', name: '월별 후원금 수입·지출 내부보고', detail: '매월, 익월 5일 이내(내부 규정 확인)', sourcePages: '5~6', defaultSelected: true },
    { code: 'YM-S-SP-GENERAL-PAY', name: '일반결연 지급', detail: '매월 25일경, 전월 입금 기준', sourcePages: '6~7', defaultSelected: true },
    { code: 'YM-S-SP-CHILD-PAY', name: '초록우산 결연 지급', detail: '매월 10~15일경, 당월 입금 기준', sourcePages: '6', defaultSelected: true },
    { code: 'YM-S-RECIPIENT-UPDATE', name: '결연대상자 정보 갱신', detail: '분기별 담당자 확인', sourcePages: '6~7', defaultSelected: true },
    { code: 'YM-S-DETENTION-REFERRAL', name: '구치소 결연 졸업예정자 추천 요청', detail: '매년 10월경 학교 협의', sourcePages: '6~7', defaultSelected: true },
    { code: 'YM-S-ARREARS', name: '장기 미납 관리', detail: '매월, 3개월 이상 미납 연락·정리 검토(자동 해지 없음)', sourcePages: '5', defaultSelected: true },
    { code: 'YM-S-GOODS-LEDGER', name: '후원품 월별 수급대장', detail: '매월, 익월 초 정리', sourcePages: '7', defaultSelected: true },
    { code: 'YM-S-NEWSLETTER', name: '후원자 소식지', detail: '연 2회, 1월·7월', sourcePages: '3, 15', defaultSelected: true },
    { code: 'YM-S-PIGGY', name: '어린이집 사랑의 저금통', detail: '11월~다음해 1월 배부·회수', sourcePages: '8', defaultSelected: true },
    { code: 'YM-S-CERTIFICATE', name: '신규 후원자 증서·감사편지', detail: '신규 등록 후 약 1주일 이내', sourcePages: '2', defaultSelected: true },
    { code: 'YM-S-PUBLIC-LIST', name: '후원자 명단 공개용 정리', detail: '매월 초, 이름 마스킹', sourcePages: '2, 4', defaultSelected: true },
    { code: 'YM-S-TAX-RECEIPT', name: '기부금영수증·연말정산 자료', detail: '연말·연초. 발급 주체·기한은 별도 검증', sourcePages: '3~4', defaultSelected: true },
  ] satisfies PresetCatalogItem[],
  /** 화면 안내용 품목 예시. 단위·수량·가액이 정해지지 않아 자동으로 품목을 만들지 않는다. */
  itemSuggestions: ['여성청소년 위생용품', '반찬·식품류', '컵라면', '도서·교재', '기타 현물'],
  workflows: [
    { name: '후원 전반', pages: '2~4', detail: '신청서·증서 발급대장·기부금영수증 현황·내부기안·수입 및 사용명세서' },
    { name: '결연금 지급', pages: '6', detail: '지급대장·지급 계획 및 결과·지급확인. 실제 지급·송금 기능은 추가 개발 필요' },
    { name: '후원물품', pages: '7', detail: '수급·지급대장·나눔명단을 입고·출고·수령확인에 연결' },
    { name: '사랑의 저금통·해피빈·법인 후원', pages: '8', detail: '출처별 대조·사업계획 및 결과·법인/시설 귀속 구분. 개별 채널 자동연동은 미지원' },
    { name: '모금함·바자회·외부지원', pages: '10', detail: '회수·입금·행사 정산·신청 및 실적 관리. 사업수입 여부는 회계담당자 확인' },
    { name: '후원 실적·소식지', pages: '13, 15', detail: '증서·영수증·금품 수급관리 실적과 소식지 제작 계획·결과. 소식지 제작 기능은 미지원' },
  ],
} as const;

export type PresetFundKey = typeof YEONMU_PRESET.funds[number]['key'];
export type CatalogKind = 'managementTypes' | 'programs' | 'partners' | 'schedules';
export const CATALOG_KINDS: CatalogKind[] = ['managementTypes', 'programs', 'partners', 'schedules'];

/** 고른 코드가 이 프리셋에 있는지, 중복이 없는지 확인한다. */
export function presetCodesValid(kind: CatalogKind, codes: readonly string[]): boolean {
  const known = new Set<string>(YEONMU_PRESET[kind].map((x) => x.code));
  return new Set(codes).size === codes.length && codes.every((c) => known.has(c));
}
