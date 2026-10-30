/** 인수인계서의 비개인 업무 항목만 반영. 비밀번호·계좌·후원자/수혜자 원문은 포함하지 않는다. */
export const YEONMU_PRESET = {
  code: 'YEONMU_2026',
  name: '연무사회복지관',
  source: '2026-09-23 후원·봉사 업무인수인계서',
  version: '2026-10-30',
  funds: [
    { key: 'GENERAL', name: '비지정후원금', designated: false, purpose: null, sourcePages: '8' },
    { key: 'SPONSORSHIP', name: '결연후원금', designated: true, purpose: '결연대상자 지원', sourcePages: '6' },
  ],
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
