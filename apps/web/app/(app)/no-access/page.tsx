import Link from 'next/link';
import { labelFor, needFor, ROLES_WITH } from '@/lib/menu';
import { getMe } from '@/lib/nav';
import { Icon } from '../../icons';
import type { SearchParams } from '../../components';

export default async function NoAccessPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const page = typeof sp.page === 'string' && sp.page.startsWith('/') ? sp.page : '/';
  const me = await getMe();
  const need = needFor(page);
  const roles = (need ? ROLES_WITH[need] ?? [] : []).filter(r => ['후원담당', '시스템 관리자'].includes(r));
  const isAdmin = me.actions.includes('user.manage');
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon name="lock" size={28} /></span>
      <h1>{labelFor(page)} 화면을 열 권한이 없습니다</h1>
      <p className="lead">
        지금 역할({me.roleLabels.join(', ')})로는 이 화면을 볼 수 없습니다.
        {roles.length > 0 && <> 이 화면은 <strong>{roles.join(', ')}</strong> 역할이 있어야 열립니다.</>}
      </p>
      {isAdmin ? (
        <p className="muted">
          시스템 관리자는 <Link href="/admin/users">직원 관리</Link>에서 본인 줄의 <strong>관리</strong>를 열어 필요한 역할을 추가할 수 있습니다.
          후원담당자는 입력·확정·취소를 직접 처리합니다. 별도 결재권자 계정은 필요하지 않습니다.
        </p>
      ) : (
        <p className="muted">필요하면 시스템 관리자에게 역할 추가를 요청하십시오.</p>
      )}
      <div className="row" style={{ justifyContent: 'center' }}>
        <Link className="btn" href="/">오늘의 업무로</Link>
        {isAdmin && <Link className="btn secondary" href="/admin/users">직원 관리 열기</Link>}
      </div>
    </div>
  );
}
