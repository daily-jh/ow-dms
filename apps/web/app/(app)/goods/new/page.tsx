import { requirePage } from '@/lib/nav';
import { api } from '@/lib/api';
import { createGoodsReceipt } from '@/lib/actions';
import { newKey } from '@/lib/format';
import { Flash, type SearchParams } from '../../../components';

interface Ref { facilities: { id: string; name: string }[]; warehouses: { id: string; name: string }[]; items: { id: string; name: string; baseUnit: string }[] }
interface Donor { id: string; displayName: string; donorType: string }

export default async function NewGoodsPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePage('/goods/new');
  const sp = await searchParams;
  const [ref, donors] = await Promise.all([api<Ref>('/v1/reference-data'), api<Donor[]>('/v1/donors')]);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  return (
    <>
      <h1>후원품 수입 입력</h1>
      <p className="lead">임시저장(초안) 후 확정하기합니다. 단가는 예시 평가로 저장되며 가액 확정과는 별개입니다.</p>
      <Flash sp={sp} />
      <form action={createGoodsReceipt} className="card">
        <input type="hidden" name="idempotencyKey" value={newKey('goods')} />
        <div className="fields">
          <div><label htmlFor="facilityId">시설</label>
            <select id="facilityId" name="facilityId" required>{ref.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
          <div><label htmlFor="donorId">후원처</label>
            <select id="donorId" name="donorId"><option value="">익명/미확인</option>{donors.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}</select></div>
          <div><label htmlFor="receivedOn">수입일</label><input id="receivedOn" name="receivedOn" type="date" defaultValue={today} required /></div>
          <div><label htmlFor="memo">적요(개인정보 기재 금지)</label><input id="memo" name="memo" maxLength={500} /></div>
        </div>
        {[0, 1, 2].map((i) => (
          <fieldset key={i}>
            <legend>품목 {i + 1}{i > 0 ? ' (선택)' : ''}</legend>
            <div className="fields">
              <div><label htmlFor={`itemId${i}`}>품목</label>
                <select id={`itemId${i}`} name={`itemId${i}`} required={i === 0}><option value="">선택</option>{ref.items.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.baseUnit})</option>)}</select></div>
              <div><label htmlFor={`warehouseId${i}`}>보관 창고</label>
                <select id={`warehouseId${i}`} name={`warehouseId${i}`}>{ref.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
              <div><label htmlFor={`quantity${i}`}>수량</label><input id={`quantity${i}`} name={`quantity${i}`} inputMode="decimal" pattern="\d+(\.\d{1,3})?" required={i === 0} /></div>
              <div><label htmlFor={`unit${i}`}>단위</label><input id={`unit${i}`} name={`unit${i}`} defaultValue="포" /></div>
              <div><label htmlFor={`expiresOn${i}`}>유효기한</label><input id={`expiresOn${i}`} name={`expiresOn${i}`} type="date" /></div>
              <div><label htmlFor={`unitValue${i}`}>예시 평가 단가(원)</label><input id={`unitValue${i}`} name={`unitValue${i}`} inputMode="numeric" /></div>
              <div><label htmlFor={`valuationBasis${i}`}>평가 근거</label><input id={`valuationBasis${i}`} name={`valuationBasis${i}`} /></div>
            </div>
          </fieldset>
        ))}
        <button type="submit">초안 저장</button>
      </form>
    </>
  );
}
