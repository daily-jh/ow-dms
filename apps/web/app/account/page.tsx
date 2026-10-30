import Link from 'next/link';
import { api, type Me } from '@/lib/api';
import { logout } from '@/lib/actions';
import { changePassword } from '@/lib/auth-actions';
import type { SearchParams } from '../components';
import { DemoBanner, Flash } from '../components';
import { TotpSetup } from './TotpSetup';

/** 내 계정: 임시 비밀번호 변경·2단계 인증 등록. 이 두 가지가 끝나기 전에는 업무 화면이 열리지 않는다. */
export default async function AccountPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const me = await api<Me & { totpEnabled?: boolean }>('/v1/auth/me');
  const { mustChangePassword, mfaSetupRequired } = me.setup;
  const blocked = mustChangePassword || mfaSetupRequired;
  return (
    <>
    <DemoBanner />
    <main style={{ maxWidth: 720, margin: '32px auto' }}>
      <h1>내 계정</h1>
      <p className="lead">{me.displayName} · {me.username} · {me.tenantName} · {me.roleLabels.join(', ')}</p>
      <Flash sp={sp} />
      {blocked && (
        <p className="msg warn" role="status">
          업무를 시작하기 전에 {mustChangePassword && '임시 비밀번호 변경'}{mustChangePassword && mfaSetupRequired && '과 '}{mfaSetupRequired && '2단계 인증 등록'}을 마쳐 주십시오.
        </p>
      )}

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>비밀번호 변경{mustChangePassword && <span className="badge warn" style={{ marginLeft: 8 }}>필요</span>}</h2>
        <form action={changePassword} style={{ display: 'grid', gap: 10, maxWidth: 420 }}>
          <label>현재 비밀번호(임시 비밀번호)<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
          <label>새 비밀번호<input name="newPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={128} /></label>
          <label>새 비밀번호 확인<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={128} /></label>
          <p className="muted" style={{ margin: 0 }}>10자 이상. 문장처럼 길게 정하면 기억하기 쉽고 안전합니다. 아이디가 들어가거나 흔한 비밀번호는 쓸 수 없습니다.</p>
          <button type="submit">비밀번호 바꾸기</button>
        </form>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>2단계 인증(OTP){mfaSetupRequired && <span className="badge warn" style={{ marginLeft: 8 }}>필요</span>}</h2>
        {mustChangePassword ? (
          <p className="muted">비밀번호를 먼저 바꾼 뒤 등록할 수 있습니다.</p>
        ) : mfaSetupRequired ? (
          <TotpSetup />
        ) : (
          <p>사용 중이거나 이 기관에서 필수가 아닙니다. 휴대폰을 바꾸거나 잃어버렸으면 기관 관리자에게 초기화를 요청하십시오.</p>
        )}
      </section>

      <div className="row">
        {!blocked && <Link href="/">업무 화면으로</Link>}
        <form action={logout}><button className="secondary" type="submit">로그아웃</button></form>
      </div>
    </main>
    </>
  );
}
