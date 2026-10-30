import { devLogin } from '@/lib/actions';
import { passwordLogin } from '@/lib/auth-actions';
import { DEV_LOGIN } from '@/lib/api';
import type { SearchParams } from '../components';
import { DEMO_MODE, DemoBanner, Flash } from '../components';

const ACCOUNTS = [
  ['a.donation', '김후원', 'A기관 · 후원담당'],
  ['a.admin', '한관리', 'A기관 · 시스템 관리자'],
  ['b.donation', '윤후원', 'B기관 · 후원담당'],
] as const;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return (
    <>
    <DemoBanner />
    <main className="auth-page">
      <div className="auth-box" style={DEV_LOGIN ? { maxWidth: 620 } : undefined}>
      <div className="brand-mark" aria-hidden="true">OW</div>
      <h1>OW-DMS</h1>
      <p className="lead">복지기관 후원금·후원품 관리</p>
      {sp.expired && <p className="msg warn">세션이 만료되었거나 권한이 회수되었습니다. 다시 로그인하십시오.</p>}
      <Flash sp={sp} />
      <form action={passwordLogin} className="card">
        <label>아이디<input name="username" autoComplete="username" required maxLength={64} autoCapitalize="none" /></label>
        <label>비밀번호<input name="password" type="password" autoComplete="current-password" required maxLength={256} /></label>
        <button type="submit">로그인</button>
        <p className="muted" style={{ margin: 0, textAlign: 'center' }}>계정은 기관 관리자가 만들어 줍니다. 비밀번호를 잊었거나 잠겼으면 기관 관리자에게 초기화를 요청하십시오.</p>
      </form>
      {DEV_LOGIN && (
        <>
          <h2 style={{ marginTop: 32 }}>{DEMO_MODE ? '시연용' : '개발용'} 합성 계정</h2>
          <p className="lead" style={{ textAlign: "left" }}>합성(가상) 기관·계정입니다. 실제 개인정보를 입력하지 마십시오.</p>
          <div className="card">
            {ACCOUNTS.map(([username, name, desc]) => (
              <form key={username} action={devLogin} className="row" style={{ justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <input type="hidden" name="username" value={username} />
                <span><strong>{name}(가상)</strong> <span className="muted">{desc} · {username}</span></span>
                <button type="submit" className="secondary">이 계정으로 로그인</button>
              </form>
            ))}
          </div>
        </>
      )}
      </div>
    </main>
    </>
  );
}
