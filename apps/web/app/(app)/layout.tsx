import { redirect } from 'next/navigation';
import { logout } from '@/lib/actions';
import { visibleNav } from '@/lib/menu';
import { getMe } from '@/lib/nav';
import { DemoBanner } from '../components';
import { NavLinks } from './NavLinks';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (me.setup.mustChangePassword || me.setup.mfaSetupRequired) redirect('/account');
  const now = new Date();
  const kst = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ...o }).format(now);
  const today = `${kst({ year: 'numeric', month: 'long', day: 'numeric' })} (${kst({ weekday: 'short' })})`;
  return (
    <>
    <DemoBanner />
    <div className="shell">
      <nav className="nav" aria-label="주 메뉴">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">OW</span>
          <span>OW-DMS<small>후원금·후원품 관리</small></span>
        </div>
        <NavLinks groups={visibleNav(me.actions)} />
        <div className="nav-foot">OW-DMS · 오픈소스(MIT)</div>
      </nav>
      <div className="workspace">
        <header className="topbar">
          <div className="org"><strong>{me.tenantName}</strong><span>업무 시스템</span></div>
          <div className="spacer" />
          <span className="date">{today}</span>
          <div className="who">
            <span className="avatar" aria-hidden="true">{me.displayName.slice(0, 1)}</span>
            <span className="who-text">{me.displayName}<small>{me.roleLabels.join(', ')}</small></span>
            <form action={logout}><button className="ghost" type="submit">로그아웃</button></form>
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
    </>
  );
}
