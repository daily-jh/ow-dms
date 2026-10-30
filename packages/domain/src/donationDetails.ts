/** 연무 인수인계서의 업무 분류. 세무·회계 계정과목이 아닌 내부 정리용 모금 경로. */
export const DONATION_CHANNELS = {
  DIRECT: '일시·직접 후원', REGULAR: '정기후원', SPONSORSHIP: '결연후원',
  HAPPYBEAN: '해피빈', PIGGY_BANK: '사랑의 저금통', COLLECTION_BOX: '모금함',
  CORPORATION: '법인 연계 후원', BAZAAR: '바자회', EXTERNAL_GRANT: '외부지원', OTHER: '기타·미분류',
} as const;
export type DonationChannel = keyof typeof DONATION_CHANNELS;
