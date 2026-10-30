'use client';

import { useActionState } from 'react';
import { enableTotp, startTotp, type TotpSetupState } from '@/lib/auth-actions';

/** OTP 등록: 시작하면 QR·설정 키를 이 화면에만 보여 주고, 앱에 나온 코드로 확인한다. */
export function TotpSetup() {
  const [state, start, pending] = useActionState<TotpSetupState>(startTotp, null);
  if (!state || 'error' in state) {
    return (
      <form action={start}>
        {state && 'error' in state && <p className="msg err" role="alert">{state.error}</p>}
        <button type="submit" disabled={pending}>OTP 등록 시작</button>
      </form>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <ol style={{ margin: 0, paddingLeft: 18 }}>
        <li>휴대폰에 OTP 앱(Google Authenticator, Microsoft Authenticator 등)을 설치합니다.</li>
        <li>앱에서 + → QR 코드 스캔으로 아래 그림을 찍습니다. 찍을 수 없으면 &quot;설정 키 입력&quot;에 아래 키를 넣습니다.</li>
        <li>앱에 나온 6자리 숫자를 입력해 확인합니다.</li>
      </ol>
      <div aria-label="OTP 등록 QR 코드" style={{ background: '#fff', width: 200, padding: 4 }} dangerouslySetInnerHTML={{ __html: state.qrSvg }} />
      <p style={{ margin: 0 }}>설정 키: <code style={{ userSelect: 'all', wordBreak: 'break-all' }}>{state.secret.match(/.{1,4}/g)?.join(' ')}</code></p>
      <p className="muted" style={{ margin: 0 }}>이 키는 화면을 벗어나면 다시 볼 수 없습니다. 사진으로 찍거나 다른 곳에 적어 두지 마십시오.</p>
      <form action={enableTotp} className="row">
        <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" required placeholder="6자리 코드" aria-label="앱에 표시된 6자리 코드" style={{ width: 160 }} />
        <button type="submit">확인하고 켜기</button>
      </form>
    </div>
  );
}
