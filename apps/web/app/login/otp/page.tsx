import Link from 'next/link';
import { totpLogin } from '@/lib/auth-actions';
import type { SearchParams } from '../../components';
import { Flash } from '../../components';

export default async function OtpPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return (
    <main className="auth-page">
      <div className="auth-box">
      <div className="brand-mark" aria-hidden="true">OW</div>
      <h1>2단계 인증</h1>
      <p className="lead">휴대폰 OTP 앱(Google Authenticator, Microsoft Authenticator 등)에 표시된 6자리 숫자를 입력하십시오.</p>
      <Flash sp={sp} />
      <form action={totpLogin} className="card">
        <label>인증 코드<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" required autoFocus
          style={{ fontSize: 22, letterSpacing: '0.3em', textAlign: 'center' }} /></label>
        <button type="submit">확인</button>
      </form>
      <p className="muted auth-foot">휴대폰을 잃어버렸으면 기관 관리자에게 2단계 인증 초기화를 요청하십시오. <Link href="/login">처음으로</Link></p>
      </div>
    </main>
  );
}
