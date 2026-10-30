import { requirePage } from '@/lib/nav';
import { api } from '@/lib/api';
import { applyYeonmuSettings, createMaster, updateMaster } from '@/lib/actions';
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
  preset: { name: string; source: string; funds: { key: string; name: string; designated: boolean; purpose: string | null; sourcePages: string }[]; workflows: { name: string; pages: string; detail: string }[] };
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
  await requirePage('/settings');
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
        <h2>연무사회복지관 기본 항목 설정</h2>
        <p>{m.preset.source}의 업무 항목을 참고한 설정 후보입니다. 소속 법인과 지정후원 목적은 기관에서 확인해 주세요.</p>
        <p className="muted">시설: 연무사회복지관. 계좌·직원·후원자·수혜자·실제 거래는 가져오지 않습니다. 법인 후원과 시설 후원의 회계귀속은 합치지 않습니다.</p>
        {!activeLegal.length ? <p className="msg warn">먼저 아래 법인·시설에서 실제 소속 주체를 등록해 주세요. 운영법인 명칭을 임의로 생성하지 않습니다.</p> : (
          <form action={applyYeonmuSettings}>
            <input type="hidden" name="idempotencyKey" value={newKey('yeonmu-preset')} />
            <label htmlFor="presetLegalEntity">시설의 실제 소속 주체 *</label>
            <select id="presetLegalEntity" name="legalEntityId" required defaultValue=""><option value="">소속 선택</option>{activeLegal.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            <p>추가할 기금을 선택해 주세요. 지정 조건이 다르면 아래에서 실제 목적에 맞는 기금을 별도로 등록해 주세요.</p>
            {m.preset.funds.map((f) => <label key={f.key} className="row" style={{ marginBottom: 8 }}>
              <input type="checkbox" name="fundKeys" value={f.key} defaultChecked={f.key === 'GENERAL'} style={{ width: 'auto' }} />
              {f.name} · {f.designated ? `지정 / 목적: ${f.purpose}` : '비지정'} (근거 {f.sourcePages}쪽)
            </label>)}
            <label className="row" style={{ margin: '14px 0' }}><input type="checkbox" name="reviewed" required style={{ width: 'auto' }} />소속과 선택한 기금의 실제 사용 목적을 확인했습니다.</label>
            <button type="submit">선택한 기본 항목 추가</button>
          </form>
        )}
        <details style={{ marginTop: 16 }}><summary>인수인계서 업무·서식 연결 보기</summary>
          <table><thead><tr><th>업무</th><th>설정·서식 및 지원 범위</th><th>근거 쪽</th></tr></thead>
            <tbody>{m.preset.workflows.map((w) => <tr key={w.name}><td>{w.name}</td><td>{w.detail}</td><td>{w.pages}</td></tr>)}</tbody>
          </table>
          <p className="muted">내부 관행을 법정 기준으로 자동 적용하지 않습니다. 기관 서식 원본·발급 자격·외부 연계는 별도 검증이 필요합니다.</p>
        </details>
      </section>

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
