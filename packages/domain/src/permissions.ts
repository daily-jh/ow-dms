import { DomainError } from './errors';
/**
 * 역할별 기본 허용 동작(제안). 실제 판정은 서버에서 기관+시설+자원+동작+필드로 수행하며
 * 이 표는 그중 '동작' 축이다. 화면 숨김만으로 권한을 구현하지 않는다.
 */
export type Role =
  | 'DONATION_STAFF' // 후원담당
  | 'GOODS_STAFF' // 물품담당
  | 'ACCOUNTING' // 회계담당
  | 'APPROVER' // 승인권자
  | 'RECEIPT_STAFF' // 영수증담당
  | 'INSTITUTION_ADMIN' // 기관관리자
  | 'AUDITOR' // 감사/개인정보책임자
  | 'SYSTEM_WORKER'; // 비동기 작업(사람 계정 아님, 로그인 불가)

export type Action =
  | 'donor.read'
  | 'donor.write'
  | 'donor.private.read'
  | 'donor.tax.read'
  | 'money.draft'
  | 'money.read'
  | 'goods.draft'
  | 'goods.read'
  | 'distribution.draft'
  | 'period.close'
  | 'approval.request'
  | 'approval.decide'
  | 'document.generate'
  | 'document.read'
  | 'integration.prepare'
  | 'integration.read'
  | 'audit.read'
  | 'settings.write'
  | 'user.manage';

export const ROLE_LABEL: Record<Role, string> = {
  DONATION_STAFF: '후원담당',
  GOODS_STAFF: '물품담당',
  ACCOUNTING: '회계담당',
  APPROVER: '승인권자',
  RECEIPT_STAFF: '영수증담당',
  INSTITUTION_ADMIN: '시스템 관리자',
  AUDITOR: '감사/개인정보책임자',
  SYSTEM_WORKER: '시스템 작업',
};

export const ROLE_ACTIONS: Record<Role, readonly Action[]> = {
  DONATION_STAFF: [
    'donor.read', 'donor.write', 'donor.private.read', 'money.draft', 'money.read', 'goods.draft', 'goods.read',
    'distribution.draft', 'period.close', 'approval.request', 'document.generate', 'document.read', 'integration.prepare', 'integration.read',
  ],
  // 물품담당은 후원자 세무식별정보·연락처를 보지 않는다.
  GOODS_STAFF: [
    'donor.read', 'goods.draft', 'goods.read', 'distribution.draft', 'approval.request', 'document.generate',
    'document.read', 'integration.read',
  ],
  ACCOUNTING: ['donor.read', 'money.read', 'goods.read', 'document.read', 'integration.read'],
  APPROVER: ['period.close', 'donor.read', 'money.read', 'goods.read', 'approval.decide', 'document.read', 'integration.read'],
  RECEIPT_STAFF: ['donor.read', 'donor.tax.read', 'money.read', 'document.read'],
  // 관리자라는 이유로 개인정보 전체 열람을 허용하지 않는다.
  INSTITUTION_ADMIN: ['donor.read', 'settings.write', 'audit.read', 'user.manage'],
  AUDITOR: ['audit.read', 'donor.read', 'money.read', 'goods.read', 'document.read', 'integration.read'],
  SYSTEM_WORKER: ['goods.read', 'money.read', 'document.generate', 'document.read'],
};

export function rolesAllow(roles: readonly Role[], action: Action): boolean {
  return roles.some((r) => ROLE_ACTIONS[r]?.includes(action));
}

/** 사람에게 줄 수 있는 역할(시스템 작업 계정 제외). 1개 이상, 중복 없이. */
export const ASSIGNABLE_ROLES: readonly Role[] = [
  'DONATION_STAFF', 'GOODS_STAFF', 'ACCOUNTING', 'APPROVER', 'RECEIPT_STAFF', 'INSTITUTION_ADMIN', 'AUDITOR',
];

export function requireRoleList(roles: readonly string[]): void {
  const ok = roles.length > 0 && new Set(roles).size === roles.length && roles.every((r) => (ASSIGNABLE_ROLES as readonly string[]).includes(r));
  if (!ok) throw new DomainError('VALIDATION_FAILED', '역할을 1개 이상 올바르게 고르십시오.', { roles: '역할 선택 필요' });
}
