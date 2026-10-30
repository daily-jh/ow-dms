import { requirePage } from '@/lib/nav';
import Link from 'next/link';
import { api, apiIfAllowed, can } from '@/lib/api';
import { requestApproval, requestCorrection } from '@/lib/actions';
import MoneyReceiptForm from './MoneyReceiptForm';
import { newKey, won } from '@/lib/format';
import { CorrectionForm, Flash, Status, type SearchParams } from '../../components';

interface Row { id: string; receivedOn: string; amount: string; method: string; status: string; donorName: string | null; pledgeMonth: string | null }
interface Pledges { pledges: { id: string; donorId: string; donorName: string; fundName: string; amount: string }[] }
interface Ref { facilities: { id: string; name: string }[]; funds: { id: string; name: string; designated: boolean }[] }
interface Donor { id: string; displayName: string }

const METHODS = { BANK_TRANSFER: '계좌이체', CASH: '현금', CMS: 'CMS', CARD: '카드', OTHER: '기타' } as const;

export default async function MoneyPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await requirePage('/money');
  const sp = await searchParams;
  const [rows, ref, donors, pledges] = await Promise.all([
    apiIfAllowed<Row[]>('/v1/money-receipts'), api<Ref>('/v1/reference-data'), apiIfAllowed<Donor[]>('/v1/donors'),
    can(me, 'money.draft') ? apiIfAllowed<Pledges>('/v1/pledges?months=1') : Promise.resolve(null),
  ]);
  if (rows === null) return <><h1>후원금 수입</h1><p className="msg warn">현재 계정에는 후원금 조회 권한이 없습니다.</p></>;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>후원금 수입</h1>
          <p className="lead">약정은 수입이 아닙니다. 실제 수납 근거가 있는 건만 입력하고, 기금배분 합계는 수납액과 같아야 합니다.</p>
        </div>
        {can(me, 'money.draft') && <Link className="btn secondary" href="/money/import">통장·엑셀 가져오기</Link>}
      </div>
      <Flash sp={sp} />
      {can(me, 'money.draft') && (ref.facilities.length && ref.funds.length ? (
        <MoneyReceiptForm key={newKey('money-form')} facilities={ref.facilities} funds={ref.funds} donors={donors ?? []}
          pledges={pledges?.pledges ?? []} today={today} idempotencyKey={newKey('money')} />
      ) : (
        <section className="card" aria-label="후원금 입력 준비">
          <h2>입력 전에 기준정보를 등록해 주세요</h2>
          <p className="msg warn">{!ref.facilities.length && '사용 중인 시설이 없습니다. '}{!ref.funds.length && '사용 중인 기금이 없습니다. '}
            기관관리자가 기준정보에서 법인·시설과 기금을 등록해야 후원금을 저장할 수 있습니다.</p>
          {can(me, 'settings.write') ? <Link className="btn" href="/settings">기준정보 설정하기</Link>
            : <p className="muted">기관관리자에게 시설과 기금 등록을 요청해 주세요.</p>}
        </section>
      ))}
      <table>
        <thead><tr><th>수납일</th><th>후원자</th><th className="num">금액</th><th>방법</th><th>상태</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.receivedOn}</td><td>{r.donorName ?? '익명/미확인'}{r.pledgeMonth && <><br /><span className="muted">약정 {r.pledgeMonth}분</span></>}</td><td className="num">{won(r.amount)}</td><td>{METHODS[r.method as keyof typeof METHODS] ?? r.method}</td><td><Status value={r.status} /></td>
              <td>{can(me, 'approval.request') && ['DRAFT', 'REJECTED'].includes(r.status) && (
                <form action={requestApproval} className="inline">
                  <input type="hidden" name="targetType" value="MONEY_RECEIPT" /><input type="hidden" name="targetId" value={r.id} /><input type="hidden" name="returnTo" value="/money" />
                  <button type="submit" className="secondary">승인 요청</button>
                </form>
              )}
              {can(me, 'money.draft') && r.status === 'APPROVED' && <CorrectionForm action={requestCorrection} targetType="MONEY_RECEIPT" targetId={r.id} returnTo="/money" label="수납 취소·환불 요청" />}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={6} className="muted">등록된 후원금 수입이 없습니다.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
