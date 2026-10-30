'use client';

import { useActionState, useState } from 'react';
import { uploadImport, type ImportState } from '@/lib/import-actions';

function Result({ state }: { state: ImportState }) {
  if (!state) return null;
  if ('error' in state) return <p className="msg err" role="alert">{state.error}</p>;
  const errors = state.errors.length > 0 && (
    <details open={state.kind === 'sheet'} style={{ marginTop: 6 }}>
      <summary>확인이 필요한 행 {state.errors.length}건</summary>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {state.errors.slice(0, 50).map((e, i) => <li key={i}>{e.line > 0 ? `${e.line}행: ` : ''}{e.message}</li>)}
      </ul>
    </details>
  );
  if (state.kind === 'bank') {
    return (
      <div className={`msg ${state.errors.length ? 'warn' : 'ok'}`} role="status">
        입금 <strong>{state.imported}건</strong>을 새로 가져왔습니다. 이미 있던 거래 {state.duplicates}건, 출금 {state.withdrawals}건은 건너뛰었습니다.
        아래 미대조 입금에서 후원자·기금을 골라 초안을 만드십시오.
        {errors}
      </div>
    );
  }
  return state.created > 0 ? (
    <p className="msg ok" role="status">후원금 초안 <strong>{state.created}건</strong>을 만들었습니다. 후원금 화면에서 확인 후 담당자가 확정하십시오.</p>
  ) : (
    <div className="msg err" role="alert">하나도 만들지 않았습니다. 아래 행을 고쳐 파일 전체를 다시 올리십시오(일부만 들어가 중복되지 않게 막았습니다).{errors}</div>
  );
}

export function ImportForm({ facilities, accountLabels }: { facilities: { id: string; name: string }[]; accountLabels: string[] }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(uploadImport, null);
  const [kind, setKind] = useState<'bank' | 'sheet'>('bank');
  return (
    <form action={action} style={{ display: 'grid', gap: 14 }}>
      <Result state={state} />
      <div className="row" role="radiogroup" aria-label="파일 종류">
        <label className="chip"><input type="radio" name="kind" value="bank" checked={kind === 'bank'} onChange={() => setKind('bank')} /> 통장 거래내역(은행에서 내려받은 파일)</label>
        <label className="chip"><input type="radio" name="kind" value="sheet" checked={kind === 'sheet'} onChange={() => setKind('sheet')} /> 후원금 입력 양식(엑셀로 정리한 파일)</label>
      </div>
      <div className="fields" style={{ marginBottom: 0 }}>
        {kind === 'bank' ? (
          <div>
            <label htmlFor="accountLabel">통장 이름(계좌번호 말고 구분용 이름)</label>
            <input id="accountLabel" name="accountLabel" list="accountLabels" required maxLength={40} placeholder="예: 후원금 통장" defaultValue={accountLabels[0] ?? '후원금 통장'} />
            <datalist id="accountLabels">{accountLabels.map((l) => <option key={l} value={l} />)}</datalist>
          </div>
        ) : (
          <div>
            <label htmlFor="facilityId">시설</label>
            <select id="facilityId" name="facilityId" required defaultValue={facilities.length === 1 ? facilities[0]!.id : ""}><option value="">시설 선택</option>{facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          </div>
        )}
        <div style={{ gridColumn: 'span 2' }}>
          <label htmlFor="file">파일(xlsx·csv, 은행 엑셀 저장 파일, 5MB 이하)</label>
          <input id="file" name="file" type="file" required accept=".xlsx,.xls,.csv,.txt,.htm,.html" />
        </div>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {kind === 'bank'
          ? '입금 줄만 "미대조 입금"으로 들어오고 바로 수입이 되지 않습니다. 같은 파일이나 기간이 겹친 파일을 다시 올려도 이미 들어온 거래는 건너뜁니다. 올린 파일 자체는 저장하지 않습니다.'
          : <>첫 줄 머리글: 수납일, 후원자, 후원자번호, 금액, 수납방법, 기금, 메모. 모든 행이 맞을 때만 초안이 만들어집니다. <a href="/templates/money-sheet">양식 내려받기(CSV)</a></>}
      </p>
      <div><button type="submit" disabled={pending}>{pending ? '읽는 중…' : '가져오기'}</button></div>
    </form>
  );
}
