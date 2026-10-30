import { redirect } from 'next/navigation';
import { logout } from '@/lib/actions';
import { visibleNav } from '@/lib/menu';
import { getMe } from '@/lib/nav';
import { DemoBanner } from '../components';
import { NavLinks } from './NavLinks';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (me.setup.mustChangePassword || me.setup.mfaSetupRequired) redirect('/account');
  return (
    <>
    <DemoBanner />
    <div className="shell">
      <nav className="nav" aria-label="주 메뉴">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">O</span>
          <span>OW-DMS<small>{me.tenantName}</small></span>
        </div>
        <NavLinks groups={visibleNav(me.actions)} />
        <div className="who">
          <span className="avatar" aria-hidden="true">{me.displayName.slice(0, 1)}</span>
          <span className="who-text">{me.displayName}<small>{me.roleLabels.join(', ')}</small></span>
          <form action={logout}><button className="ghost" type="submit">로그아웃</button></form>
        </div>
      </nav>
      <main>{children}</main>
    </div>
    </>
  );
}
