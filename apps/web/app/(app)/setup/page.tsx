import Link from 'next/link';
import { requirePage } from '@/lib/nav';
import { api } from '@/lib/api';
import { applyYeonmuSettings } from '@/lib/actions';
import { newKey } from '@/lib/format';
import { Flash, type SearchParams } from '../../components';
import { ReadinessCard, type Readiness } from './readiness';

type Status = 'ACTIVE' | 'MISSING' | 'INACTIVE' | 'CONFLICT';
interface Item { code: string; name: string; detail?: string; sourcePages: string; defaultSelected: boolean; note?: string; status: Status; category?: string; kind?: string }
interface Preview {
  preset: { code: string; version: string; name: string; source: string };
  legalEntities: { id: string; name: string; kind: string }[];
  facility: { name: string; status: Status; legalEntityId: string | null; legalEntityName: string | null };
  funds: { key: string; name: string; designated: boolean; purpose: string | null; sourcePages: string; status: Status }[];
  managementTypes: Item[]; programs: Item[]; partners: Item[]; schedules: Item[];
  itemSuggestions: string[];
  workflows: { name: string; pages: string; detail: string }[];
  lastApplication: { appliedAt: string; presetVersion: string; createdCount: number; reusedCount: number } | null;
}

const STATUS: Record<Status, [string, string]> = {
  ACTIVE: ['ok', '사용 중'], MISSING: ['info', '추가 후보'], INACTIVE: ['warn', '사용 중지됨'], CONFLICT: ['err', '조건 다름'],
};
const Badge = ({ s }: { s: Status }) => <span className={`badge ${STATUS[s][0]}`}>{STATUS[s][1]}</span>;
const GROUP_LABEL: Record<string, string> = {
  SPONSORSHIP: '결연', EXTERNAL_SPONSORSHIP: '외부기관 결연', SCHOLARSHIP: '장학', ONLINE: '온라인모금', CAMPAIGN: '캠페인',
  COLLECTION_BOX: '모금함', EVENT: '행사', GRANT: '외부지원사업', GOODS: '후원품', CORPORATE: '법인후원',
  CHILDCARE: '저금통 참여 어린이집', EXTERNAL: '외부 협력기관',
};

/** 미리 채운 후보 목록. 이미 있거나 중지된 항목은 고를 수 없고(그대로 둠), 추가 후보만 체크한다. */
function Choices({ name, title, help, items, group }: { name: string; title: string; help: string; items: Item[]; group?: 'category' | 'kind' }) {
  const picked = items.filter((i) => i.status === 'MISSING' && i.defaultSelected).length;
  return (
    <details open={name !== 'partners'} style={{ marginTop: 14 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{title} <span className="muted">· {items.length}개 중 {picked}개 미리 선택</span></summary>
      <p className="muted">{help}</p>
      <table>
        <thead><tr><th style={{ width: 40 }}></th><th>이름</th>{group && <th>구분</th>}<th>내용</th><th>근거 쪽</th><th>상태</th></tr></thead>
        <tbody>{items.map((i) => (
          <tr key={i.code}>
            <td><input type="checkbox" name={name} value={i.code} aria-label={i.name} style={{ width: 'auto' }}
              defaultChecked={i.status === 'MISSING' && i.defaultSelected} disabled={i.status !== 'MISSING'} /></td>
            <td>{i.name}<br /><span className="muted">{i.code}</span></td>
            {group && <td>{GROUP_LABEL[(group === 'category' ? i.category : i.kind) ?? ''] ?? '-'}</td>}
            <td>{i.detail ?? ''}{i.note && <><br /><span className="muted">{i.note}</span></>}</td>
            <td>{i.sourcePages}</td>
            <td><Badge s={i.status} /></td>
          </tr>
        ))}</tbody>
      </table>
    </details>
  );
}

export default async function SetupPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePage('/setup');
  const sp = await searchParams;
  const r = await api<Readiness>('/v1/onboarding/readiness');
  const p = r.presetAvailable ? await api<Preview>('/v1/onboarding/presets/yeonmu') : null;
  return (
    <>
      <h1>기관 설정</h1>
      <p className="lead">업무를 시작하기 전에 필요한 기준정보를 확인하고, 기관에 맞는 기본 항목을 한 번에 추가합니다. 후원자·수혜자·계좌·거래는 만들지 않습니다.</p>
      <Flash sp={sp} />
      <ReadinessCard r={r} admin link={false} />
      {!p ? (
        <section className="card">
          <h2>기준정보 직접 등록</h2>
          <p>이 기관에 맞춘 기본 항목 후보가 없습니다. 기준정보 화면에서 법인·시설, 기금, 창고, 품목을 직접 등록해 주세요.</p>
          <Link className="btn" href="/settings">기준정보 등록하기</Link>
        </section>
      ) : (
        <section className="card">
          <h2>{p.preset.name} 기본 항목</h2>
          <p>{p.preset.source}의 비개인 업무 항목으로 미리 채운 후보입니다(버전 {p.preset.version}). 소속 법인은 한 번만 확인하면 되고, 나머지는 기본값을 검토해 고칠 수 있습니다.</p>
          <p className="muted">사업·관리유형은 회계 기금이 아니라 분류입니다. 업무일정은 내부 관행 예시이며 법정 기한이 아닙니다(기관 검토 필요). 이미 있는 항목은 덮어쓰지 않고, 사용 중지한 항목은 다시 켜지 않습니다.</p>
          {p.lastApplication && <p className="msg ok">마지막 적용: {new Date(p.lastApplication.appliedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 새로 추가 {p.lastApplication.createdCount} · 이미 있음 {p.lastApplication.reusedCount}</p>}
          <form action={applyYeonmuSettings}>
            <input type="hidden" name="idempotencyKey" value={newKey('yeonmu-preset')} />
            <h3>1. 시설의 실제 소속 주체 *</h3>
            <p className="muted">시설: {p.facility.name} <Badge s={p.facility.status} />{p.facility.legalEntityName && <> · 현재 소속 {p.facility.legalEntityName}</>}. 운영법인 이름은 시스템이 지어내지 않습니다. 등록된 법인을 고르거나 정확한 명칭을 직접 입력해 주세요.</p>
            <select id="presetLegalEntity" name="legalEntityId" required defaultValue={p.facility.legalEntityId ?? (p.legalEntities.length ? '' : 'new')}>
              <option value="">소속 선택</option>
              {p.legalEntities.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              <option value="new">새로 입력(아래 칸)</option>
            </select>
            <div className="row" style={{ marginTop: 8 }}>
              <input name="newLegalName" placeholder="새 법인·시설 정확한 명칭" aria-label="새 법인·시설 명칭" maxLength={80} style={{ width: 280 }} />
              <select name="newLegalKind" aria-label="새 법인 구분" style={{ width: 180 }}><option value="CORPORATION">사회복지법인 등</option><option value="FACILITY">시설 자체</option></select>
            </div>

            <h3 style={{ marginTop: 18 }}>2. 기금(회계 구분)</h3>
            {p.funds.map((f) => <label key={f.key} className="row" style={{ marginBottom: 8 }}>
              <input type="checkbox" name="fundKeys" value={f.key} style={{ width: 'auto' }}
                defaultChecked={f.status === 'MISSING' || f.status === 'ACTIVE'} disabled={f.status === 'CONFLICT' || f.status === 'INACTIVE'} />
              {f.name} · {f.designated ? `지정 / 목적: ${f.purpose}` : '비지정'} (근거 {f.sourcePages}쪽) <Badge s={f.status} />
            </label>)}
            {p.funds.some((f) => f.status === 'CONFLICT') && <p className="msg warn">같은 이름의 기금이 다른 조건으로 있습니다. 기준정보에서 기존 기금을 확인해 주세요. 덮어쓰지 않습니다.</p>}

            <h3 style={{ marginTop: 18 }}>3. 분류·사업·협력처·일정</h3>
            <Choices name="managementTypes" title="후원 관리유형" items={p.managementTypes} help="검색·표시용 분류입니다. 후원자 신분이나 기금과 별개입니다." />
            <Choices name="programs" title="후원사업" group="category" items={p.programs} help="사업코드는 개발 제안값입니다. 운영법인 후원은 회계 귀속 확인 전에는 고르지 않았습니다." />
            <Choices name="partners" title="협력처" group="kind" items={p.partners} help="이름만 등록합니다(연락처·주소·담당자 없음). 어린이집·모금함 비치처는 올해 참여 여부를 확인한 뒤 고르세요. 비치처는 기부자가 아닙니다." />
            <Choices name="schedules" title="업무일정" items={p.schedules} help="기관 내부 관행 예시입니다. 법정 기한으로 쓰지 않습니다." />

            <label className="row" style={{ margin: '18px 0' }}><input type="checkbox" name="reviewed" required style={{ width: 'auto' }} />소속 주체와 선택한 기금의 실제 사용 목적, 고른 항목을 확인했습니다.</label>
            <button type="submit">선택한 기본 항목 한 번에 추가</button>
          </form>
          <details style={{ marginTop: 16 }}><summary>품목 예시·인수인계서 업무 연결 보기</summary>
            <p className="muted">품목 예시(자동 등록하지 않음, 단위 확인 후 기준정보에서 직접 추가): {p.itemSuggestions.join(', ')}</p>
            <table><thead><tr><th>업무</th><th>설정·서식 및 지원 범위</th><th>근거 쪽</th></tr></thead>
              <tbody>{p.workflows.map((w) => <tr key={w.name}><td>{w.name}</td><td>{w.detail}</td><td>{w.pages}</td></tr>)}</tbody>
            </table>
          </details>
        </section>
      )}
    </>
  );
}
