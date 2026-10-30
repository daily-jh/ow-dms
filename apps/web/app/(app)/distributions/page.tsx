import { requirePage } from '@/lib/nav';
import { api } from '@/lib/api';
import { generateDocument, postDistribution, requestApproval, requestCorrection } from '@/lib/actions';
import { CorrectionForm, Flash, Status, type SearchParams } from '../../components';

interface Dist { id: string; programName: string; plannedOn: string; status: string; version: number; recipientRef: string | null; totalQuantity: string }

export default async function DistributionsPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePage('/distributions');
  const sp = await searchParams;
  const rows = await api<Dist[]>('/v1/distributions');
  return (
    <>
      <h1>배분 목록</h1>
      <p className="lead">초안 → 담당자 확정(예약 확보) → 출고 반영(원장 차감) 순서입니다. 전달확인은 별도 증빙으로 관리합니다.</p>
      <Flash sp={sp} />
      <table>
        <thead><tr><th>예정일</th><th>사업</th><th>대상자 ID</th><th className="num">수량</th><th>상태</th><th>작업</th></tr></thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td>{d.plannedOn}</td><td>{d.programName}</td><td>{d.recipientRef ?? '-'}</td><td className="num">{d.totalQuantity}</td><td><Status value={d.status} /></td>
              <td className="row">
                {['DRAFT', 'REJECTED', 'PENDING_APPROVAL'].includes(d.status) && (
                  <form action={requestApproval} className="inline">
                    <input type="hidden" name="targetType" value="DISTRIBUTION" /><input type="hidden" name="targetId" value={d.id} /><input type="hidden" name="returnTo" value="/distributions" />
                    <button type="submit" className="secondary">확정하기</button>
                  </form>
                )}
                {d.status === 'APPROVED' && (
                  <form action={postDistribution} className="inline">
                    <input type="hidden" name="distributionId" value={d.id} />
                    <button type="submit">출고 반영</button>
                  </form>
                )}
                {d.status === 'APPROVED' && <CorrectionForm action={requestCorrection} targetType="DISTRIBUTION" targetId={d.id} returnTo="/distributions" label="출고 전 취소" />}
                {d.status === 'POSTED' && <CorrectionForm action={requestCorrection} targetType="DISTRIBUTION" targetId={d.id} returnTo="/distributions" label="반품(회수 후)" needsInspection />}
                <form action={generateDocument} className="inline">
                  <input type="hidden" name="documentType" value="DISTRIBUTION_LIST" /><input type="hidden" name="sourceId" value={d.id} /><input type="hidden" name="returnTo" value="/distributions" />
                  <button type="submit" className="secondary">배분명부</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
