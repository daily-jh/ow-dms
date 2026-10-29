import { api, can, type Me } from '@/lib/api';
import { generateDocument, requestApproval } from '@/lib/actions';
import { won, VALUATION_LABEL } from '@/lib/format';
import Link from 'next/link';
import { Flash, Status, type SearchParams } from '../../../components';

interface Receipt {
  id: string; facilityName: string; donorName: string | null; receivedOn: string; status: string; version: number; memo: string | null;
  snapshotHash: string | null; createdByName: string; approvedAt: string | null;
  lines: { lineNo: number; itemName: string; warehouseName: string; quantity: string; unit: string; expiresOn: string | null; valuationStatus: string; totalValue: string | null; lotId: string | null; lotCode: string | null }[];
}
interface Doc { id: string; title: string; isDraft: boolean; generatedAt: string; auto: boolean; sourceVersion: number }

export default async function GoodsDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const [me, r, docs] = await Promise.all([api<Me>('/v1/auth/me'), api<Receipt>(`/v1/goods-receipts/${id}`), api<Doc[]>(`/v1/documents?sourceId=${id}`)]);
  return (
    <>
      <h1>후원품 수입 <Status value={r.status} /></h1>
      <p className="lead">{r.receivedOn} · {r.donorName ?? '익명/미확인'} · {r.facilityName} · 입력 {r.createdByName} · v{r.version}</p>
      <Flash sp={sp} />
      <div className="card">
        <table>
          <thead><tr><th>No</th><th>품목</th><th>수량</th><th>창고</th><th>유효기한</th><th>가액</th><th>로트</th></tr></thead>
          <tbody>
            {r.lines.map((l) => (
              <tr key={l.lineNo}>
                <td className="num">{l.lineNo}</td><td>{l.itemName}</td><td className="num">{l.quantity} {l.unit}</td><td>{l.warehouseName}</td>
                <td>{l.expiresOn ?? '-'}</td><td>{won(l.totalValue)} <Status value={l.valuationStatus} label={VALUATION_LABEL[l.valuationStatus]} /></td>
                <td className="mono">{l.lotCode ?? '승인 시 부여'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.snapshotHash && <p className="muted mono">승인 스냅샷 {r.snapshotHash.slice(0, 16)}… · 승인 후에는 직접 수정할 수 없고 정정 절차를 사용합니다.</p>}
      </div>
      <div className="row">
        {['DRAFT', 'REJECTED'].includes(r.status) && can(me, 'approval.request') && (
          <form action={requestApproval}>
            <input type="hidden" name="targetType" value="GOODS_RECEIPT" /><input type="hidden" name="targetId" value={r.id} />
            <input type="hidden" name="returnTo" value={`/goods/${r.id}`} />
            <button type="submit">승인 요청</button>
          </form>
        )}
        {can(me, 'document.generate') && (
          <form action={generateDocument}>
            <input type="hidden" name="documentType" value="GOODS_RECEIPT_CERT" /><input type="hidden" name="sourceId" value={r.id} />
            <input type="hidden" name="returnTo" value={`/goods/${r.id}`} />
            <button type="submit" className="secondary">인수증 {r.status === 'APPROVED' ? '생성' : '초안 미리보기'}</button>
          </form>
        )}
      </div>
      <h2 style={{ fontSize: 17, marginTop: 24 }}>이 거래에서 만든 문서</h2>
      <ul>
        {docs.map((d) => (
          <li key={d.id}><Link href={`/documents/${d.id}`}>{d.title}</Link> {d.isDraft && <Status value="PENDING" label="초안" />} <span className="muted">v{d.sourceVersion} · {d.auto ? '승인 시 자동' : '수동'} · {d.generatedAt}</span></li>
        ))}
        {docs.length === 0 && <li className="muted">없음</li>}
      </ul>
    </>
  );
}
