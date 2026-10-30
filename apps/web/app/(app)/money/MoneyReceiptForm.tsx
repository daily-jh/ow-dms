'use client';

import { DONATION_CHANNELS } from '@/lib/donation-details';
import { startTransition, useActionState, useState, type ChangeEvent } from 'react';
import { saveMoneyReceipt } from '@/lib/money-actions';
import type { MoneyFormState } from '@/lib/money-form';

interface Props {
  facilities: { id: string; name: string }[];
  funds: { id: string; name: string }[];
  donors: { id: string; displayName: string }[];
  pledges: { id: string; donorId: string; donorName: string; fundName: string; amount: string }[];
  today: string; idempotencyKey: string;
}
const METHODS = { BANK_TRANSFER: '계좌이체', CASH: '현금', CMS: 'CMS', CARD: '카드', OTHER: '기타' };

export default function MoneyReceiptForm({ facilities, funds, donors, pledges, today, idempotencyKey }: Props) {
  const [state, action, pending] = useActionState(saveMoneyReceipt, {} as MoneyFormState);
  const [amount, setAmount] = useState('');
  const [split, setSplit] = useState(false);
  const [firstAmount, setFirstAmount] = useState('');
  // 서버 검증 오류에서도 React의 form reset으로 입력을 잃지 않도록 업무 입력값을 제어한다.
  const [values, setValues] = useState<Record<string, string>>({ facilityId: facilities.length === 1 ? facilities[0]!.id : '', receivedOn: today, method: 'BANK_TRANSFER', sourceChannel: 'DIRECT', fundId0: funds.length === 1 ? funds[0]!.id : '' });
  const control = (field: string) => ({ value: values[field] ?? '', onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [field]: e.target.value })) });
  const error = (field: string) => state.fieldErrors?.[field]
    ? <p id={`${field}-error`} className="msg err" role="alert">{state.fieldErrors[field]}</p> : null;
  const attrs = (field: string) => ({ 'aria-invalid': !!state.fieldErrors?.[field], 'aria-describedby': state.fieldErrors?.[field] ? `${field}-error` : undefined });
  return <form action={action} className="card" onSubmit={(event) => {
    // React의 성공 액션 자동 reset은 오류 결과를 반환해도 select를 초기화한다.
    // 폼 자동 reset 대신 액션을 직접 dispatch하며 성공 때만 서버 redirect로 이동한다.
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(() => action(form));
  }}>
    <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
    {state.error && <p className="msg err" role="alert">{state.error}</p>}
    <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="fields">
        <div><label htmlFor="facilityId">시설 *</label><select id="facilityId" name="facilityId" required {...control('facilityId')} {...attrs('facilityId')}>
          <option value="">시설 선택</option>{facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>{error('facilityId')}</div>
        <div><label htmlFor="donorId">후원자</label><select id="donorId" name="donorId" {...control('donorId')}><option value="">익명/미확인</option>{donors.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}</select></div>
        <div><label htmlFor="receivedOn">수납일 *</label><input id="receivedOn" name="receivedOn" type="date" {...control('receivedOn')} required /></div>
        <div><label htmlFor="amount">수납액(원) *</label><input id="amount" name="amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} required {...attrs('amount')} />{error('amount')}</div>
        <div><label htmlFor="method">수납방법</label><select id="method" name="method" {...control('method')}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      </div>
      <div className="fields">
        <div><label htmlFor="sourceChannel">모금 경로</label><select id="sourceChannel" name="sourceChannel" {...control('sourceChannel')}>{Object.entries(DONATION_CHANNELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label htmlFor="projectName">사업·모금명</label><input id="projectName" name="projectName" maxLength={100} placeholder="예: 겨울나기 모금" {...control('projectName')} /></div>
        <div><label htmlFor="evidenceRef">입금·증빙 관리번호</label><input id="evidenceRef" name="evidenceRef" maxLength={100} placeholder="내부 증빙번호 (계좌번호 제외)" {...control('evidenceRef')} /></div>
        <div><label htmlFor="memo">업무 메모</label><textarea id="memo" name="memo" maxLength={500} placeholder="지정 조건·확인 사항 (민감정보 제외)" {...control('memo')} /></div>
      </div>
      <p className="muted">모금 경로와 기금의 사용 목적은 별개입니다. 바자회·외부지원은 후원금으로 분류가 확인된 수납만 입력하세요.</p>
      {!!pledges.length && <div className="fields">
        <div style={{ gridColumn: 'span 2' }}><label htmlFor="pledge">정기후원 약정(선택)</label><select id="pledge" name="pledge" {...control('pledge')}><option value="">연결 안 함</option>{pledges.map((p) => <option key={p.id} value={`${p.id}|${p.donorId}`}>{p.donorName} · 월 {p.amount}원 · {p.fundName}</option>)}</select></div>
        <div><label htmlFor="pledgeMonth">몇 월분</label><input id="pledgeMonth" name="pledgeMonth" type="month" {...control('pledgeMonth')} /></div>
        <p className="muted">비우면 수납일의 달. 후원자를 비우면 약정 후원자로 채웁니다.</p>
      </div>}
      <p className="muted">기금은 후원금의 사용 목적 구분입니다. 한 기금에 전액 배분하면 수납액이 자동으로 입력됩니다.</p>
      <label className="row" style={{ marginBottom: 12 }}><input type="checkbox" checked={split} onChange={(e) => { setSplit(e.target.checked); setFirstAmount(amount); }} style={{ width: 'auto' }} />두 기금으로 나누어 배분</label>
      <div className="fields">
        <div><label htmlFor="fundId0">기금 1 *</label><select id="fundId0" name="fundId0" required {...control('fundId0')} {...attrs('fundId0')}><option value="">기금 선택</option>{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>{error('fundId0')}</div>
        <div><label htmlFor="fundAmount0">배분액(원) *</label><input id="fundAmount0" name="fundAmount0" inputMode="numeric" required readOnly={!split} value={split ? firstAmount : amount} onChange={(e) => setFirstAmount(e.target.value)} {...attrs('fundAmount0')} />{error('fundAmount0')}</div>
        {split && <>
          <div><label htmlFor="fundId1">기금 2 *</label><select id="fundId1" name="fundId1" required {...control('fundId1')} {...attrs('fundId1')}><option value="">기금 선택</option>{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>{error('fundId1')}</div>
          <div><label htmlFor="fundAmount1">배분액(원) *</label><input id="fundAmount1" name="fundAmount1" inputMode="numeric" required {...control('fundAmount1')} {...attrs('fundAmount1')} />{error('fundAmount1')}</div>
        </>}
      </div>
      {error('fundLines')}
      <p className="muted">저장하면 담당자 확인으로 확정되며, 별도 결재 없이 수입 실적에 반영됩니다. 잘못 입력한 확정 건은 사유를 남겨 취소한 뒤 다시 입력하세요.</p>
      <button type="submit">{pending ? '저장 중…' : '저장·확정'}</button>
    </fieldset>
  </form>;
}
