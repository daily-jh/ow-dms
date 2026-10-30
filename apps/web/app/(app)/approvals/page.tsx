import { getMe, requirePage } from '@/lib/nav';
import { api, can, type Me } from '@/lib/api';
import { decideApproval } from '@/lib/actions';
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
  const canDecide = can(me, 'approval.decide');
  return (
    <>
      <h1>승인함</h1>
      <p className="lead">요청 당시 스냅샷을 승인합니다. 본인이 요청한 건은 승인할 수 없습니다. 승인은 원장·재고 반영과 한 트랜잭션으로 처리됩니다.</p>
      <Flash sp={sp} />
      {!canDecide && <p className="msg warn">현재 계정에는 승인 권한이 없습니다. 승인권자 계정(a.approver)으로 로그인하십시오.</p>}
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
                {canDecide && a.requestedBy !== me.userId ? (
                  <div className="row">
                    <form action={decideApproval} className="inline">
                      <input type="hidden" name="approvalId" value={a.id} /><input type="hidden" name="decision" value="APPROVE" />
                      <button type="submit">승인</button>
                    </form>
                    <form action={decideApproval} className="row">
                      <input type="hidden" name="approvalId" value={a.id} /><input type="hidden" name="decision" value="REJECT" />
                      <input name="reason" placeholder="반려 사유" aria-label="반려 사유" required style={{ width: 140 }} />
                      <button type="submit" className="danger">반려</button>
                    </form>
                  </div>
                ) : <span className="muted">{a.requestedBy === me.userId ? '본인 요청' : '권한 없음'}</span>}
              </td>
            </tr>
          ))}
          {pending.length === 0 && <tr><td colSpan={5} className="muted">승인 대기 건이 없습니다.</td></tr>}
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
