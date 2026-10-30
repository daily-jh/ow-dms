import { getMe, requirePage } from '@/lib/nav';
import { api, can, type Me } from '@/lib/api';
import { requestApproval, confirmPendingCorrection } from '@/lib/actions';
import { CORRECTION_LABEL, TARGET_LABEL, won } from '@/lib/format';
import { Flash, Status, type SearchParams } from '../../components';

interface Approval {
  id: string; targetType: string; targetId: string; targetVersion: number; status: string; snapshot: any; snapshotHash: string;
  requestedAt: string; requestedBy: string; requestedByName: string; decidedByName: string | null; reason: string | null;
}

function Summary({ a }: { a: Approval }) {
  const s = a.snapshot;
  if (a.targetType === 'CORRECTION') return <>{TARGET_LABEL[s.target.type]} {CORRECTION_LABEL[s.kind]} · 사유: {s.reason} · 정정일 {s.businessDate}{s.inspectionConfirmed ? ' · 회수·상태검사 확인' : ''}</>;
  if (a.targetType === 'MONEY_RECEIPT') return <>{s.receivedOn} · {won(s.amount)} · 기금 {s.fundLines.length}건</>;
  if (a.targetType === 'DISTRIBUTION') return <>{s.plannedOn} · {s.programName} · {s.lines.map((l: any) => `${l.itemName} ${l.quantity}${l.unit}`).join(', ')}</>;
  return <>{s.receivedOn} · {s.lines.map((l: any) => `${l.quantity}${l.unit}`).join(', ')} · {s.memo ?? ''}</>;
}

export default async function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePage('/approvals');
  const sp = await searchParams;
  const [me, pending, recent] = await Promise.all([
    getMe(), api<Approval[]>('/v1/approvals?status=PENDING'), api<Approval[]>('/v1/approvals'),
  ]);
  const canConfirm = (a: Approval) => can(me, (a.targetType === 'CORRECTION' ? a.snapshot.target.type : a.targetType) === 'MONEY_RECEIPT' ? 'money.draft' : (a.targetType === 'CORRECTION' ? a.snapshot.target.type : a.targetType) === 'DISTRIBUTION' ? 'distribution.draft' : 'goods.draft');
  return (
    <>
      <h1>확정·정정 이력</h1>
      <p className="lead">별도 결재권자 없이 후원담당자가 직접 확정합니다. 이전에 남아 있던 미확정 내역도 여기에서 처리할 수 있습니다.</p>
      <Flash sp={sp} />
      <table>
        <thead><tr><th>구분</th><th>내용</th><th>요청</th><th>상태</th><th>결정</th></tr></thead>
        <tbody>
          {pending.map((a) => (
            <tr key={a.id}>
              <td>{TARGET_LABEL[a.targetType]}</td>
              <td><Summary a={a} /><div className="muted mono">스냅샷 {a.snapshotHash.slice(0, 12)} · v{a.targetVersion}</div></td>
              <td>{a.requestedByName}<div className="muted">{new Date(a.requestedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</div></td>
              <td><Status value={a.status} /></td>
              <td>
                {canConfirm(a) ? <form action={a.targetType === 'CORRECTION' ? confirmPendingCorrection : requestApproval}>
                  <input type="hidden" name="approvalId" value={a.id} />
                  <input type="hidden" name="targetType" value={a.targetType} />
                  <input type="hidden" name="targetId" value={a.targetId} />
                  <input type="hidden" name="returnTo" value="/approvals" />
                  <button type="submit">{a.targetType === 'CORRECTION' ? '정정 확정' : '확정하기'}</button>
                </form> : <span className="muted">조회 전용</span>}
              </td>
            </tr>
          ))}
          {pending.length === 0 && <tr><td colSpan={5} className="muted">미확정 건이 없습니다.</td></tr>}
        </tbody>
      </table>
      <h2 style={{ fontSize: 17, marginTop: 24 }}>최근 처리</h2>
      <table>
        <thead><tr><th>구분</th><th>내용</th><th>상태</th><th>처리자</th><th>사유</th></tr></thead>
        <tbody>
          {recent.filter((a) => a.status !== 'PENDING').slice(0, 20).map((a) => (
            <tr key={a.id}><td>{TARGET_LABEL[a.targetType]}</td><td><Summary a={a} /></td><td><Status value={a.status} /></td><td>{a.decidedByName ?? '-'}</td><td>{a.reason ?? ''}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
