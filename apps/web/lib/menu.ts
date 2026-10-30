/**
 * 메뉴와 화면별 필요 권한. 메뉴 숨김·안내용이며 실제 차단은 API(requireAction)·RLS가 한다.
 * need가 없으면 로그인한 누구나 연다.
 */
export interface NavItem { href: string; label: string; icon: string; need?: string }
export interface NavGroup { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { label: '업무', items: [
    { href: '/', label: '오늘의 업무', icon: 'home' },
    { href: '/approvals', label: '확정·정정 이력', icon: 'check', need: 'goods.read' },
  ] },
  { label: '후원', items: [
    { href: '/donors', label: '후원자', icon: 'people', need: 'donor.read' },
    { href: '/money', label: '후원금', icon: 'won', need: 'money.read' },
    { href: '/pledges', label: '정기후원 약정', icon: 'repeat', need: 'money.read' },
    { href: '/money/import', label: '통장·엑셀 가져오기', icon: 'upload', need: 'money.draft' },
  ] },
  { label: '물품', items: [
    { href: '/goods', label: '후원품 수입', icon: 'box', need: 'goods.read' },
    { href: '/stock', label: '재고·배분', icon: 'layers', need: 'goods.read' },
    { href: '/distributions', label: '배분 목록', icon: 'send', need: 'goods.read' },
  ] },
  { label: '문서·마감', items: [
    { href: '/documents', label: '서식·문서', icon: 'doc', need: 'document.read' },
    { href: '/integrations', label: '희망이음 준비', icon: 'link', need: 'integration.read' },
    { href: '/closing', label: '월 마감', icon: 'calendar', need: 'money.read' },
  ] },
  { label: '관리', items: [
    { href: '/audit', label: '감사기록', icon: 'shield', need: 'audit.read' },
    { href: '/setup', label: '기관 설정', icon: 'flag', need: 'settings.write' },
    { href: '/settings', label: '기준정보', icon: 'sliders', need: 'settings.write' },
    { href: '/admin/users', label: '직원 관리', icon: 'key', need: 'user.manage' },
    { href: '/account', label: '내 계정', icon: 'user' },
  ] },
];

/** 하위 화면(예: /goods/new)은 가장 긴 접두 메뉴의 권한을 따르고, 따로 정한 것은 여기서 덮어쓴다. */
const EXTRA_NEED: Record<string, string> = { '/goods/new': 'goods.draft' };

/** 이 동작이 있는 역할(안내 문구용, packages/domain ROLE_ACTIONS와 같은 내용). */
export const ROLES_WITH: Record<string, string[]> = {
  'donor.read': ['후원담당', '물품담당', '회계담당', '승인권자', '영수증담당', '시스템 관리자', '감사/개인정보책임자'],
  'money.read': ['후원담당', '회계담당', '승인권자', '영수증담당', '감사/개인정보책임자'],
  'goods.read': ['후원담당', '물품담당', '회계담당', '승인권자', '감사/개인정보책임자'],
  'goods.draft': ['후원담당', '물품담당'],
  'money.draft': ['후원담당'],
  'document.read': ['후원담당', '물품담당', '회계담당', '승인권자', '영수증담당', '감사/개인정보책임자'],
  'integration.read': ['후원담당', '물품담당', '회계담당', '승인권자', '감사/개인정보책임자'],
  'audit.read': ['시스템 관리자', '감사/개인정보책임자'],
  'settings.write': ['시스템 관리자'],
  'user.manage': ['시스템 관리자'],
};

const ALL_ITEMS = NAV.flatMap((g) => g.items);

export function needFor(path: string): string | undefined {
  if (EXTRA_NEED[path]) return EXTRA_NEED[path];
  const match = ALL_ITEMS.filter((i) => i.href !== '/' && (path === i.href || path.startsWith(i.href + '/')))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.need;
}

export function labelFor(path: string): string {
  return ALL_ITEMS.filter((i) => path === i.href || (i.href !== '/' && path.startsWith(i.href + '/')))
    .sort((a, b) => b.href.length - a.href.length)[0]?.label ?? '이 화면';
}

export function visibleNav(actions: readonly string[]): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.need || actions.includes(i.need)) })).filter((g) => g.items.length > 0);
}
