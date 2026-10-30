import { requirePage } from '@/lib/nav';
import Link from 'next/link';
import { api } from '@/lib/api';
import { requestApproval } from '@/lib/actions';
import { Flash, Status, type SearchParams } from '../../components';

interface Row { id: string; receivedOn: string; status: string; version: number; donorName: string | null; lineCount: number; unconfirmedValuations: number }

export default async function GoodsPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePage('/goods');
  const sp = await searchParams;
  const rows = await api<Row[]>('/v1/goods-receipts');
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>후원품 수입</h1>
        <Link className="btn" href="/goods/new">새 수입 입력</Link>
      </div>
      <p className="lead">입력은 한 번만 합니다. 승인되면 같은 원거래에서 로트·재고·인수증·연계자료가 만들어집니다.</p>
      <Flash sp={sp} />
      <table>
        <thead><tr><th>수입일</th><th>후원처</th><th className="num">행</th><th>가액</th><th>상태</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/goods/${r.id}`}>{r.receivedOn}</Link></td>
              <td>{r.donorName ?? '익명/미확인'}</td>
              <td className="num">{r.lineCount}</td>
              <td>{r.unconfirmedValuations > 0 ? <Status value="UNCONFIRMED" label={`미확정 ${r.unconfirmedValuations}행`} /> : <Status value="CONFIRMED" label="확정" />}</td>
              <td><Status value={r.status} /></td>
              <td>
                {['DRAFT', 'REJECTED', 'PENDING_APPROVAL'].includes(r.status) && (
                  <form action={requestApproval} className="inline">
                    <input type="hidden" name="targetType" value="GOODS_RECEIPT" />
                    <input type="hidden" name="targetId" value={r.id} />
                    <input type="hidden" name="returnTo" value="/goods" />
                    <button type="submit" className="secondary">확정하기</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="muted">자료가 없습니다.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
