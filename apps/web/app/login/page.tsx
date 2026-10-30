import { devLogin } from '@/lib/actions';
import type { SearchParams } from '../components';
import { DEMO_MODE, DemoBanner, Flash } from '../components';

const ACCOUNTS = [
  ['a.goods', '이물품', 'A기관 · 물품담당'],
  ['a.donation', '김후원', 'A기관 · 후원담당'],
  ['a.approver', '박승인', 'A기관 · 승인권자'],
  ['a.accounting', '최회계', 'A기관 · 회계담당'],
  ['a.auditor', '오감사', 'A기관 · 감사'],
  ['b.goods', '윤물품', 'B기관 · 물품담당'],
  ['b.approver', '임승인', 'B기관 · 승인권자'],
] as const;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return (
    <>
    <DemoBanner />
    <main style={{ maxWidth: 640, margin: '40px auto' }}>
      <h1>OW-DMS {DEMO_MODE ? '시연용' : '개발용'} 로그인</h1>
      <p className="lead">합성(가상) 기관·계정입니다. 실제 개인정보를 입력하지 마십시오. 운영에서는 기관 IdP(OIDC) 로그인으로 대체됩니다.</p>
      {sp.expired && <p className="msg warn">세션이 만료되었거나 권한이 회수되었습니다.</p>}
      <Flash sp={sp} />
      <div className="card">
        {ACCOUNTS.map(([username, name, desc]) => (
          <form key={username} action={devLogin} className="row" style={{ justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <input type="hidden" name="username" value={username} />
            <span><strong>{name}(가상)</strong> <span className="muted">{desc} · {username}</span></span>
            <button type="submit">이 계정으로 로그인</button>
          </form>
        ))}
      </div>
    </main>
    </>
  );
}
