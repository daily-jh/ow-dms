import { api, type Me } from '@/lib/api';
import { setMembership } from '@/lib/auth-actions';
import type { SearchParams } from '../../../components';
import { Flash } from '../../../components';
import { ROLE_OPTIONS } from '@/lib/format';
import { CreateUserForm, ResetPasswordForm } from './forms';

interface UserRow {
  userId: string; username: string; displayName: string; roles: string[]; roleLabels: string[]; active: boolean;
  hasPassword: boolean; mustChange: boolean; totpEnabled: boolean; lockedUntil: string | null; lastLoginAt: string | null;
}

const when = (v: string | null) => (v ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(v)) : '-');

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const me = await api<Me>('/v1/auth/me');
  const users = await api<UserRow[]>('/v1/admin/users');
  return (
    <>
      <h1>직원 관리</h1>
      <p className="lead">{me.tenantName} 직원 계정만 보입니다. 퇴사·전보 때는 바로 권한을 회수하십시오. 회수하면 즉시 로그인할 수 없습니다.</p>
      <Flash sp={sp} />

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>새 직원 계정</h2>
        <CreateUserForm />
      </section>

      <table>
        <thead><tr><th>이름·아이디</th><th>역할</th><th>상태</th><th>최근 로그인</th><th>관리</th></tr></thead>
        <tbody>
          {users.map((u) => {
            const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
            return (
              <tr key={u.userId}>
                <td>{u.displayName}<br /><span className="muted">{u.username}</span></td>
                <td>{u.roleLabels.join(', ')}</td>
                <td>
                  {!u.active ? <span className="badge err">권한 회수됨</span>
                    : !u.hasPassword ? <span className="badge info">합성 계정(비밀번호 없음)</span>
                    : <>
                        {u.mustChange && <span className="badge warn">첫 로그인 전</span>}{' '}
                        {u.totpEnabled ? <span className="badge ok">OTP 사용</span> : <span className="badge warn">OTP 미등록</span>}{' '}
                        {locked && <span className="badge err">잠김</span>}
                      </>}
                </td>
                <td>{when(u.lastLoginAt)}</td>
                <td>
                  <details>
                    <summary style={{ cursor: 'pointer' }}>관리</summary>
                    <div style={{ display: 'grid', gap: 10, marginTop: 8, minWidth: 280 }}>
                      <ResetPasswordForm userId={u.userId} username={u.username} />
                      <form action={setMembership} style={{ display: 'grid', gap: 6 }}>
                        <input type="hidden" name="userId" value={u.userId} />
                        <div className="row" style={{ flexWrap: 'wrap' }}>
                          {ROLE_OPTIONS.map(([v, l]) => (
                            <label key={v} className="row" style={{ color: 'var(--text)', margin: 0, width: 'auto' }}>
                              <input type="checkbox" name="roles" value={v} defaultChecked={u.roles.includes(v)} style={{ width: 'auto' }} /> {l}
                            </label>
                          ))}
                        </div>
                        <div className="row">
                          <button type="submit" name="revoke" value="false" className="secondary">{u.active ? '역할 저장' : '역할 저장·권한 되살리기'}</button>
                          {u.active && u.userId !== me.userId && <button type="submit" name="revoke" value="true" className="danger">권한 회수</button>}
                        </div>
                      </form>
                    </div>
                  </details>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
