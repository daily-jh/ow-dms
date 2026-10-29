import { api, apiIfAllowed } from '@/lib/api';
import { createMoneyReceipt, requestApproval } from '@/lib/actions';
import { newKey, won } from '@/lib/format';
import { Flash, Status, type SearchParams } from '../../components';

interface Row { id: string; receivedOn: string; amount: string; method: string; status: string; donorName: string | null }
interface Ref { facilities: { id: string; name: string }[]; funds: { id: string; name: string; designated: boolean }[] }
interface Donor { id: string; displayName: string }

const METHODS = { BANK_TRANSFER: '계좌이체', CASH: '현금', CMS: 'CMS', CARD: '카드', OTHER: '기타' } as const;

export default async function MoneyPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const [rows, ref, donors] = await Promise.all([apiIfAllowed<Row[]>('/v1/money-receipts'), api<Ref>('/v1/reference-data'), apiIfAllowed<Donor[]>('/v1/donors')]);
  if (rows === null) return <><h1>후원금 수입</h1><p className="msg warn">현재 계정에는 후원금 조회 권한이 없습니다.</p></>;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  return (
    <>
      <h1>후원금 수입</h1>
      <p className="lead">약정은 수입이 아닙니다. 실제 수납 근거가 있는 건만 입력하고, 기금배분 합계는 수납액과 같아야 합니다.</p>
      <Flash sp={sp} />
      <form action={createMoneyReceipt} className="card">
        <input type="hidden" name="idempotencyKey" value={newKey('money')} />
        <input type="hidden" name="facilityId" value={ref.facilities[0]?.id} />
        <div className="fields">
          <div><label htmlFor="donorId">후원자</label><select id="donorId" name="donorId"><option value="">익명/미확인</option>{(donors ?? []).map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}</select></div>
          <div><label htmlFor="receivedOn">수납일</label><input id="receivedOn" name="receivedOn" type="date" defaultValue={today} required /></div>
          <div><label htmlFor="amount">수납액(원)</label><input id="amount" name="amount" inputMode="numeric" required /></div>
          <div><label htmlFor="method">수납방법</label><select id="method" name="method">{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        </div>
        <div className="fields">
          {[0, 1].map((i) => (
            <div key={i} className="row" style={{ alignItems: 'end' }}>
              <div style={{ flex: 1 }}><label htmlFor={`fundId${i}`}>기금 {i + 1}</label><select id={`fundId${i}`} name={`fundId${i}`}><option value="">선택</option>{ref.funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
              <div style={{ width: 120 }}><label htmlFor={`fundAmount${i}`}>배분액</label><input id={`fundAmount${i}`} name={`fundAmount${i}`} inputMode="numeric" /></div>
            </div>
          ))}
        </div>
        <button type="submit">초안 저장</button>
      </form>
      <table>
        <thead><tr><th>수납일</th><th>후원자</th><th>금액</th><th>방법</th><th>상태</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.receivedOn}</td><td>{r.donorName ?? '익명/미확인'}</td><td className="num">{won(r.amount)}</td><td>{METHODS[r.method as keyof typeof METHODS] ?? r.method}</td><td><Status value={r.status} /></td>
              <td>{['DRAFT', 'REJECTED'].includes(r.status) && (
                <form action={requestApproval} className="inline">
                  <input type="hidden" name="targetType" value="MONEY_RECEIPT" /><input type="hidden" name="targetId" value={r.id} /><input type="hidden" name="returnTo" value="/money" />
                  <button type="submit" className="secondary">승인 요청</button>
                </form>
              )}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
