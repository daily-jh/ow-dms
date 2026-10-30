import { getMe, requirePage } from '@/lib/nav';
import { api, apiIfAllowed, can, type Me } from '@/lib/api';
import { createBatch } from '@/lib/actions';
import { newKey } from '@/lib/format';
import { Flash, Status, type SearchParams } from '../../components';

interface Cap { operation: string; mode: string; enabled: boolean; label: string }
interface Batch { id: string; operation: string; mode: string; createdAt: string; total: number; exported: number; verified: number; notReady: number }
interface Receipt { id: string; receivedOn: string; status: string; donorName: string | null; lineCount: number }

export default async function IntegrationsPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePage('/integrations');
  const sp = await searchParams;
  const [me, caps, batches, receipts] = await Promise.all([
    getMe(), api<Cap[]>('/v1/integrations/capabilities'), api<Batch[]>('/v1/integration-batches'),
    apiIfAllowed<Receipt[]>('/v1/goods-receipts?status=APPROVED'),
  ]);
  return (
    <>
      <h1>희망이음 준비</h1>
      <p className="msg warn">희망이음 공식 업로드 원본·연계 규격이 아직 확보되지 않았습니다. 이 화면의 Excel은 <strong>내부 검토용·희망이음 호환 미검증</strong> 자료이며, 전송 기능은 비활성입니다. 등록은 담당자가 희망이음에서 직접 수행하고 결과를 대조합니다.</p>
      <Flash sp={sp} />
      <div className="card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>업무별 지원 상태</h2>
        <table>
          <thead><tr><th>업무</th><th>방식</th><th>상태</th><th>설명</th></tr></thead>
          <tbody>{caps.map((c) => <tr key={`${c.operation}-${c.mode}`}><td>{c.operation}</td><td>{c.mode}</td><td>{c.enabled ? <Status value="APPROVED" label="사용 가능" /> : <Status value="NOT_READY" label="비활성" />}</td><td>{c.label}</td></tr>)}</tbody>
        </table>
      </div>
      {receipts && can(me, 'integration.prepare') && (
        <form action={createBatch} className="card">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>승인된 후원품 수입으로 내부 검토 배치 만들기</h2>
          <input type="hidden" name="idempotencyKey" value={newKey('batch')} />
          {receipts.map((r) => (
            <label key={r.id} className="row" style={{ color: 'var(--text)' }}>
              <input type="checkbox" name="sourceIds" value={r.id} style={{ width: 'auto' }} /> {r.receivedOn} · {r.donorName ?? '익명/미확인'} · {r.lineCount}행
            </label>
          ))}
          <button type="submit" style={{ marginTop: 8 }}>배치 만들기</button>
        </form>
      )}
      <table>
        <thead><tr><th>생성</th><th>업무·방식</th><th>행</th><th>다운로드됨(미등록)</th><th>등록확인</th><th></th></tr></thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id}>
              <td className="muted">{new Date(b.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td><td>{b.operation} · {b.mode}</td>
              <td className="num">{b.total}{b.notReady ? ` (준비불가 ${b.notReady})` : ''}</td><td className="num">{b.exported}</td><td className="num">{b.verified}</td>
              <td>{can(me, 'integration.prepare') && <a className="btn secondary" href={`/integrations/${b.id}/export`}>내부 검토 Excel</a>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
