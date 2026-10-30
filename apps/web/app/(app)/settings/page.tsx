import { api } from '@/lib/api';
import { createMaster, updateMaster } from '@/lib/actions';
import { newKey } from '@/lib/format';
import type { SearchParams } from '../../components';
import { Flash } from '../../components';

interface Row { id: string; name: string; active: boolean }
interface Master {
  legalEntities: (Row & { kind: string })[];
  facilities: (Row & { legalEntityId: string; legalEntityName: string })[];
  warehouses: (Row & { facilityId: string; facilityName: string })[];
  items: (Row & { baseUnit: string; perishable: boolean; inUse: boolean })[];
  funds: (Row & { designated: boolean; purpose: string | null; inUse: boolean })[];
}

/** 이름 바꾸기·사용 중지/다시 사용. 거래에 쓰인 기준정보도 지우지 않고 숨긴다. */
function RowActions({ kind, row }: { kind: string; row: Row }) {
  return (
    <details>
      <summary style={{ cursor: 'pointer' }}>변경</summary>
      <form action={updateMaster} className="row" style={{ marginTop: 6 }}>
        <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={row.id} />
        <input name="name" defaultValue={row.name} aria-label="새 이름" maxLength={80} style={{ width: 180 }} />
        <button type="submit" className="secondary">이름 저장</button>
      </form>
      <form action={updateMaster} style={{ marginTop: 6 }}>
        <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={row.id} />
        <input type="hidden" name="active" value={row.active ? 'false' : 'true'} />
        <button type="submit" className={row.active ? 'danger' : 'secondary'}>{row.active ? '사용 중지' : '다시 사용'}</button>
      </form>
    </details>
  );
}

const state = (active: boolean) => (active ? <span className="badge ok">사용</span> : <span className="badge info">중지</span>);

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const m = await api<Master>('/v1/settings/master');
  const activeLegal = m.legalEntities.filter((x) => x.active);
  const activeFacilities = m.facilities.filter((x) => x.active);
  return (
    <>
      <h1>기준정보</h1>
      <p className="lead">입력 화면에서 고르는 시설·창고·품목·기금을 관리합니다. 거래에 쓰인 항목은 지우지 않고 &quot;사용 중지&quot;로 숨깁니다. 단위·지정 여부를 잘못 정했으면 사용 중지하고 새로 만드십시오.</p>
      <Flash sp={sp} />

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>법인·시설</h2>
        <form action={createMaster} className="row" style={{ marginBottom: 10 }}>
          <input type="hidden" name="kind" value="legal-entities" /><input type="hidden" name="idempotencyKey" value={newKey('le')} />
          <input name="name" placeholder="법인 이름" aria-label="법인 이름" required maxLength={80} style={{ width: 220 }} />
          <select name="entityKind" aria-label="법인 구분" style={{ width: 160 }}><option value="CORPORATION">사회복지법인 등</option><option value="FACILITY">시설 자체</option></select>
          <button type="submit">법인 추가</button>
        </form>
        <form action={createMaster} className="row" style={{ marginBottom: 10 }}>
          <input type="hidden" name="kind" value="facilities" /><input type="hidden" name="idempotencyKey" value={newKey('fac')} />
          <input name="name" placeholder="시설 이름" aria-label="시설 이름" required maxLength={80} style={{ width: 220 }} />
          <select name="legalEntityId" aria-label="소속 법인" required style={{ width: 220 }}>
            {activeLegal.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button type="submit" disabled={!activeLegal.length}>시설 추가</button>
        </form>
        <table>
          <thead><tr><th>시설</th><th>소속 법인</th><th>상태</th><th></th></tr></thead>
          <tbody>{m.facilities.map((f) => <tr key={f.id}><td>{f.name}</td><td>{f.legalEntityName}</td><td>{state(f.active)}</td><td><RowActions kind="facilities" row={f} /></td></tr>)}</tbody>
        </table>
        <details style={{ marginTop: 8 }}>
          <summary className="muted" style={{ cursor: 'pointer' }}>법인 목록</summary>
          <table><tbody>{m.legalEntities.map((l) => <tr key={l.id}><td>{l.name}</td><td>{state(l.active)}</td><td><RowActions kind="legal-entities" row={l} /></td></tr>)}</tbody></table>
        </details>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>창고</h2>
        <form action={createMaster} className="row" style={{ marginBottom: 10 }}>
          <input type="hidden" name="kind" value="warehouses" /><input type="hidden" name="idempotencyKey" value={newKey('wh')} />
          <input name="name" placeholder="창고 이름(예: 1층 식품창고)" aria-label="창고 이름" required maxLength={80} style={{ width: 240 }} />
          <select name="facilityId" aria-label="시설" required style={{ width: 220 }}>
            {activeFacilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <button type="submit" disabled={!activeFacilities.length}>창고 추가</button>
        </form>
        <table>
          <thead><tr><th>창고</th><th>시설</th><th>상태</th><th></th></tr></thead>
          <tbody>{m.warehouses.map((w) => <tr key={w.id}><td>{w.name}</td><td>{w.facilityName}</td><td>{state(w.active)}</td><td><RowActions kind="warehouses" row={w} /></td></tr>)}</tbody>
        </table>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>품목</h2>
        <form action={createMaster} className="row" style={{ marginBottom: 10 }}>
          <input type="hidden" name="kind" value="items" /><input type="hidden" name="idempotencyKey" value={newKey('item')} />
          <input name="name" placeholder="품목 이름(예: 쌀 10kg)" aria-label="품목 이름" required maxLength={80} style={{ width: 220 }} />
          <input name="baseUnit" placeholder="기본 단위(예: 포)" aria-label="기본 단위" required maxLength={10} style={{ width: 140 }} />
          <label className="row" style={{ color: 'var(--text)', margin: 0, width: 'auto' }}><input type="checkbox" name="perishable" style={{ width: 'auto' }} /> 유효기한 관리</label>
          <button type="submit">품목 추가</button>
        </form>
        <table>
          <thead><tr><th>품목</th><th>기본 단위</th><th>유효기한</th><th>상태</th><th></th></tr></thead>
          <tbody>{m.items.map((i) => <tr key={i.id}><td>{i.name}</td><td>{i.baseUnit}</td><td>{i.perishable ? '관리' : '-'}</td><td>{state(i.active)}{i.inUse && <span className="muted"> · 거래 있음</span>}</td><td><RowActions kind="items" row={i} /></td></tr>)}</tbody>
        </table>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>기금(후원금 구분)</h2>
        <form action={createMaster} className="row" style={{ marginBottom: 10 }}>
          <input type="hidden" name="kind" value="funds" /><input type="hidden" name="idempotencyKey" value={newKey('fund')} />
          <input name="name" placeholder="기금 이름(예: 일반후원금)" aria-label="기금 이름" required maxLength={80} style={{ width: 200 }} />
          <label className="row" style={{ color: 'var(--text)', margin: 0, width: 'auto' }}><input type="checkbox" name="designated" style={{ width: 'auto' }} /> 지정후원금</label>
          <input name="purpose" placeholder="사용 목적(지정후원금은 필수)" aria-label="사용 목적" maxLength={200} style={{ width: 240 }} />
          <button type="submit">기금 추가</button>
        </form>
        <table>
          <thead><tr><th>기금</th><th>구분</th><th>목적</th><th>상태</th><th></th></tr></thead>
          <tbody>{m.funds.map((f) => <tr key={f.id}><td>{f.name}</td><td>{f.designated ? '지정' : '비지정'}</td><td>{f.purpose ?? '-'}</td><td>{state(f.active)}{f.inUse && <span className="muted"> · 거래 있음</span>}</td><td><RowActions kind="funds" row={f} /></td></tr>)}</tbody>
        </table>
      </section>
    </>
  );
}
