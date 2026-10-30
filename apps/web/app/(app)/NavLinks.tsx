'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '../icons';
import type { NavGroup } from '@/lib/menu';

export function NavLinks({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  const matches = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(href + '/'));
  const best = hrefs.filter(matches).sort((a, b) => b.length - a.length)[0];
  const active = (href: string) => href === best;
  return (
    <div className="nav-links">
      {groups.map((g) => (
        <div key={g.label} className="nav-group">
          <div className="nav-label">{g.label}</div>
          {g.items.map((i) => (
            <Link key={i.href} href={i.href} className={active(i.href) ? 'active' : undefined} aria-current={active(i.href) ? 'page' : undefined}>
              <Icon name={i.icon} />{i.label}
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}
