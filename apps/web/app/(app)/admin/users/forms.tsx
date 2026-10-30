'use client';

import { useActionState } from 'react';
import { createUser, resetUserPassword, type TempPasswordState } from '@/lib/auth-actions';
import { ROLE_OPTIONS } from '@/lib/format';


/** 임시 비밀번호는 이 화면에서 한 번만 보인다. 직원에게 직접(구두·대면) 전달하고 메신저·메일로 보내지 않는다. */
function TempPassword({ state }: { state: TempPasswordState }) {
  if (!state) return null;
  if ('error' in state) return <p className="msg err" role="alert">{state.error}</p>;
  return (
    <div className="msg ok" role="status">
      <strong>{state.username}</strong> 임시 비밀번호: <code style={{ userSelect: 'all', fontSize: 16 }}>{state.temporaryPassword}</code>
      <br />이 화면을 벗어나면 다시 볼 수 없습니다. 직원에게 직접 전달하십시오. 첫 로그인 때 비밀번호 변경과 2단계 인증 등록을 하게 됩니다.
    </div>
  );
}

export function CreateUserForm() {
  const [state, action, pending] = useActionState<TempPasswordState, FormData>(createUser, null);
  return (
    <form action={action} style={{ display: 'grid', gap: 10 }}>
      <TempPassword state={state} />
      <div className="row">
        <label style={{ flex: 1 }}>아이디(영문 소문자·숫자·._- 3~32자)<input name="username" required pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,31}" autoCapitalize="none" /></label>
        <label style={{ flex: 1 }}>이름<input name="displayName" required maxLength={40} /></label>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0, background: 'transparent' }}>
        <legend className="muted" style={{ fontSize: 13 }}>역할(1개 이상)</legend>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {ROLE_OPTIONS.map(([v, l]) => (
            <label key={v} className="chip">
              <input type="checkbox" name="roles" value={v} style={{ width: 'auto' }} /> {l}
            </label>
          ))}
        </div>
      </fieldset>
      <button type="submit" disabled={pending} style={{ justifySelf: 'start' }}>계정 만들기</button>
    </form>
  );
}

export function ResetPasswordForm({ userId, username }: { userId: string; username: string }) {
  const [state, action, pending] = useActionState<TempPasswordState, FormData>(resetUserPassword, null);
  return (
    <form action={action} style={{ display: 'grid', gap: 6 }}>
      <TempPassword state={state} />
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="username" value={username} />
      <label className="row" style={{ color: 'var(--text)', margin: 0 }}>
        <input type="checkbox" name="resetMfa" style={{ width: 'auto' }} /> 2단계 인증도 초기화(휴대폰 분실·교체)
      </label>
      <button type="submit" className="secondary" disabled={pending} style={{ justifySelf: 'start' }}>임시 비밀번호 발급</button>
    </form>
  );
}
