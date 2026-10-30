import Link from 'next/link';

export interface Readiness {
  presetAvailable: boolean;
  steps: Record<'legalEntity' | 'facility' | 'fund' | 'donationStaff' | 'warehouse' | 'item', { status: 'DONE' | 'MISSING'; count: number; inactive?: number }>;
  catalog: { managementTypes: number; programs: number; partners: number; schedules: number };
  canEnterMoney: boolean;
  canEnterGoods: boolean;
  lastPresetApplication: { appliedAt: string; presetVersion: string } | null;
}

const STEPS: [keyof Readiness['steps'], string, string][] = [
  ['legalEntity', '소속 법인·시설', '실제 운영 주체(관리자가 직접 확인)'],
  ['facility', '시설', '후원금·후원품을 받는 시설'],
  ['fund', '기금', '비지정·지정 후원금 구분'],
  ['donationStaff', '후원담당 직원', '직원 관리에서 역할 지정'],
  ['warehouse', '창고', '후원품을 쓸 때만 필요'],
  ['item', '품목', '후원품을 쓸 때만 필요'],
];

/** 업무 시작 전 준비 상태. 관리자는 설정으로, 담당자는 관리자 요청 안내로 이어진다. */
export function ReadinessCard({ r, admin, compact = false, link = true }: { r: Readiness; admin: boolean; compact?: boolean; link?: boolean }) {
  const missing = STEPS.filter(([k]) => r.steps[k].status === 'MISSING');
  if (compact && r.canEnterMoney) return null;
  return (
    <section className="card" aria-label="업무 준비 상태" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>업무 준비 상태</h2>
          <p className="muted" style={{ margin: 0 }}>
            {r.canEnterMoney ? '후원금 입력 준비가 됐습니다.' : '후원금을 입력하려면 시설과 기금이 필요합니다.'}
            {' '}{r.canEnterGoods ? '후원품 입력 준비가 됐습니다.' : '후원품은 창고와 품목을 등록한 뒤 쓸 수 있습니다.'}
          </p>
        </div>
        {admin && link ? <Link className="btn" href="/setup">{r.canEnterMoney ? '기관 설정 보기' : '기관 설정 시작'}</Link> : null}
      </div>
      {!admin && !r.canEnterMoney && <p className="msg warn" style={{ marginTop: 12 }}>시스템 관리자에게 기관 설정(시설·기금 등록)을 요청해 주세요.</p>}
      {!compact && (
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>항목</th><th>상태</th><th>설명</th></tr></thead>
          <tbody>{STEPS.map(([k, label, hint]) => (
            <tr key={k}>
              <td>{label}</td>
              <td>{r.steps[k].status === 'DONE'
                ? <span className="badge ok">사용 중 {r.steps[k].count}</span>
                : <span className={`badge ${k === 'warehouse' || k === 'item' ? 'info' : 'warn'}`}>없음</span>}
                {k === 'fund' && (r.steps.fund.inactive ?? 0) > 0 && <span className="muted"> · 사용 중지 {r.steps.fund.inactive}</span>}</td>
              <td className="muted">{hint}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {compact && missing.length > 0 && <p className="muted" style={{ marginTop: 8 }}>비어 있음: {missing.map(([, l]) => l).join(', ')}</p>}
    </section>
  );
}
