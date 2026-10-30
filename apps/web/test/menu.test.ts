import { describe, expect, it } from 'vitest';
import { ROLE_ACTIONS, ROLE_LABEL, type Role } from '../../../packages/domain/src/permissions';
import { NAV, ROLES_WITH, needFor, visibleNav } from '../lib/menu';

describe('메뉴 권한 표', () => {
  it('안내용 역할 목록이 도메인 권한표와 같다', () => {
    for (const [action, labels] of Object.entries(ROLES_WITH)) {
      const expected = (Object.keys(ROLE_ACTIONS) as Role[])
        .filter((r) => r !== 'SYSTEM_WORKER' && (ROLE_ACTIONS[r] as readonly string[]).includes(action))
        .map((r) => ROLE_LABEL[r]);
      expect(labels.slice().sort(), action).toEqual(expected.sort());
    }
  });

  it('메뉴에 쓰인 권한은 모두 안내 문구가 있다', () => {
    for (const item of NAV.flatMap((g) => g.items)) if (item.need) expect(ROLES_WITH[item.need], item.href).toBeDefined();
  });

  it('하위 화면은 상위 메뉴 권한을 따르고 입력 화면은 입력 권한이 필요하다', () => {
    expect(needFor('/goods/abc')).toBe('goods.read');
    expect(needFor('/goods/new')).toBe('goods.draft');
    expect(needFor('/money/import')).toBe('money.draft');
    expect(needFor('/money')).toBe('money.read');
    expect(needFor('/pledges')).toBe('money.read');
    expect(needFor('/admin/users')).toBe('user.manage');
    expect(needFor('/')).toBeUndefined();
    expect(needFor('/account')).toBeUndefined();
  });

  it('기관관리자에게는 업무 장부 메뉴가 보이지 않는다', () => {
    const hrefs = visibleNav(ROLE_ACTIONS.INSTITUTION_ADMIN).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toEqual(['/', '/donors', '/audit', '/settings', '/admin/users', '/account']);
  });
});
