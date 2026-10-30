import { requirePage } from '@/lib/nav';
import { api } from '@/lib/api';
import { createDistribution } from '@/lib/actions';
import { newKey } from '@/lib/format';
import { Flash, type SearchParams } from '../../components';

interface Lot { lotId: string; warehouseId: string; lotCode: string; itemName: string; warehouseName: string; unit: string; expiresOn: string | null; onHand: string; reserved: string; available: string }
interface Ref { facilities: { id: string; name: string }[] }

export default async function StockPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePage('/stock');
  const sp = await searchParams;
  const [lots, ref] = await Promise.all([api<Lot[]>('/v1/stock'), api<Ref>('/v1/reference-data')]);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  return (
    <>
      <h1>재고·배분</h1>
      <p className="lead">유효기한이 빠른 로트부터 보여 줍니다. 가용량 = 현재고 − 확정된 예약. 출고는 확정 후 배분 목록에서 반영합니다.</p>
      <Flash sp={sp} />
      <table>
        <thead><tr><th>품목</th><th>로트</th><th>창고</th><th>유효기한</th><th className="num">현재고</th><th className="num">예약</th><th className="num">가용</th><th>배분 초안</th></tr></thead>
        <tbody>
          {lots.map((l) => (
            <tr key={`${l.lotId}:${l.warehouseId}`}>
              <td>{l.itemName}</td><td className="mono">{l.lotCode}</td><td>{l.warehouseName}</td>
              <td>{l.expiresOn ?? '-'}{l.expiresOn && l.expiresOn < today ? ' (기한 경과·출고 차단)' : ''}</td>
              <td className="num">{l.onHand} {l.unit}</td><td className="num">{l.reserved}</td><td className="num"><strong>{l.available}</strong></td>
              <td>
                <form action={createDistribution} className="row">
                  <input type="hidden" name="idempotencyKey" value={newKey('dist')} />
                  <input type="hidden" name="lotId" value={l.lotId} /><input type="hidden" name="warehouseId" value={l.warehouseId} />
                  <select name="facilityId" aria-label="시설" required defaultValue={ref.facilities.length === 1 ? ref.facilities[0]!.id : ''}><option value="">시설 선택</option>{ref.facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select><input type="hidden" name="plannedOn" value={today} />
                  <input name="programName" placeholder="사업명" aria-label="사업명" required style={{ width: 130 }} />
                  <input name="recipientRef" placeholder="대상자ID(선택)" aria-label="대상자 ID" pattern="[A-Za-z0-9-]{1,40}" style={{ width: 120 }} />
                  <input name="quantity" placeholder="수량" aria-label="배분 수량" inputMode="decimal" required style={{ width: 70 }} />
                  <button type="submit" className="secondary">초안</button>
                </form>
              </td>
            </tr>
          ))}
          {lots.length === 0 && <tr><td colSpan={8} className="muted">재고가 없습니다.</td></tr>}
        </tbody>
      </table>
      <p className="muted">수혜자는 실명이 아닌 대상자 ID로만 기록합니다. 사례관리 상담내용은 이 시스템에 입력하지 않습니다.</p>
    </>
  );
}
