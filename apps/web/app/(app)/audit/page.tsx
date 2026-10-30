import { requirePage } from '@/lib/nav';
import { apiIfAllowed } from '@/lib/api';
import type { SearchParams } from '../../components';
import { Status } from '../../components';

interface Event { id: string; category: string; action: string; resourceType: string | null; resourceId: string | null; result: string; reason: string | null; requestId: string | null; createdAt: string; actorName: string | null }

const CATEGORIES = { '': '전체', LEDGER: '원장·업무', ACCESS: '조회·출력', AUTH: '로그인', ADMIN: '관리' } as const;

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePage('/audit');
  const sp = await searchParams;
  const category = typeof sp.category === 'string' && sp.category in CATEGORIES ? sp.category : '';
  const events = await apiIfAllowed<Event[]>(`/v1/audit-events${category ? `?category=${category}` : ''}`);
  if (events === null) return <><h1>감사기록</h1><p className="msg warn">감사기록 조회 권한이 없습니다.</p></>;
  return (
    <>
      <h1>감사기록</h1>
      <p className="lead">누가 언제 무엇을 했는지 기록합니다. 개인정보 원문은 남기지 않고 대상 ID만 기록합니다. 이 화면을 연 것도 기록됩니다.</p>
      <form className="row" style={{ marginBottom: 12 }}>
        <select name="category" defaultValue={category} aria-label="분류" style={{ width: 160 }}>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button type="submit" className="secondary">보기</button>
      </form>
      <table>
        <thead><tr><th>시각</th><th>사용자</th><th>분류</th><th>작업</th><th>대상</th><th>결과</th><th>사유</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="muted">{new Date(e.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td>
              <td>{e.actorName ?? '-'}</td><td>{CATEGORIES[e.category as keyof typeof CATEGORIES] ?? e.category}</td>
              <td className="mono">{e.action}</td><td className="mono">{e.resourceType ?? ''} {e.resourceId?.slice(0, 8) ?? ''}</td>
              <td><Status value={e.result === 'SUCCESS' ? 'APPROVED' : 'REJECTED'} label={e.result === 'SUCCESS' ? '성공' : e.result === 'DENIED' ? '거부' : '실패'} /></td>
              <td>{e.reason ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
