import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api, type Me } from '@/lib/api';
import { logout } from '@/lib/actions';
import { DemoBanner } from '../components';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await api<Me>('/v1/auth/me');
  if (me.setup.mustChangePassword || me.setup.mfaSetupRequired) redirect('/account');
  return (
    <>
    <DemoBanner />
    <div className="shell">
      <nav className="nav" aria-label="주 메뉴">
        <div className="brand">OW-DMS<small>{me.tenantName}</small></div>
        <Link href="/">오늘의 업무</Link>
        <Link href="/donors">후원자</Link>
        <Link href="/money">후원금</Link>
        <Link href="/goods">후원품 수입</Link>
        <Link href="/stock">재고·배분</Link>
        <Link href="/distributions">배분 목록</Link>
        <Link href="/approvals">승인함</Link>
        <Link href="/documents">서식·문서</Link>
        <Link href="/integrations">희망이음 준비</Link>
        <Link href="/closing">월 마감</Link>
        {me.actions.includes('audit.read') && <Link href="/audit">감사기록</Link>}
        {me.actions.includes('settings.write') && <Link href="/settings">기준정보</Link>}
        {me.actions.includes('user.manage') && <Link href="/admin/users">직원 관리</Link>}
        <Link href="/account">내 계정</Link>
        <div className="who">
          {me.displayName}<br />{me.roleLabels.join(', ')}
          <form action={logout} style={{ marginTop: 8 }}><button className="secondary" type="submit">로그아웃</button></form>
        </div>
      </nav>
      <main>{children}</main>
    </div>
    </>
  );
}
