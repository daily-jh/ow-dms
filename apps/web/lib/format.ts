/** 금액 문자열(원 단위 정수)을 부동소수점 변환 없이 천 단위 구분해 표시한다. */
export function won(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const neg = value.startsWith('-');
  const digits = (neg ? value.slice(1) : value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${digits}원`;
}

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: '초안',
  PENDING_APPROVAL: '승인대기',
  PENDING: '승인대기',
  APPROVED: '승인됨',
  POSTED: '출고완료',
  REJECTED: '반려',
  REVERSED: '역거래',
  CANCELLED: '취소',
  INVALIDATED: '무효',
  NOT_READY: '준비불가',
  PREPARED: '준비됨',
  EXPORTED: '파일 다운로드됨(미등록)',
  VERIFIED: '등록확인',
  UNKNOWN: '확인필요',
  RETURNED: '반품됨',
  CORRECTION_REQUIRED: '정정 필요',
  OPEN: '열림',
  CLOSED: '마감',
};

export const VALUATION_LABEL: Record<string, string> = { UNCONFIRMED: '가액 미확정', PROPOSED: '평가안(미승인)', CONFIRMED: '가액 확정' };

export const TARGET_LABEL: Record<string, string> = { GOODS_RECEIPT: '후원품 수입', MONEY_RECEIPT: '후원금 수입', DISTRIBUTION: '후원품 배분', CORRECTION: '정정 요청' };

export const CORRECTION_LABEL: Record<string, string> = { REVERSAL: '역거래(취소)', CANCEL: '배분 취소(출고 전)', RETURN: '반품(출고 후)' };

export function newKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
