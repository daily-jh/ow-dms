import Link from 'next/link';
import { requirePage } from '@/lib/nav';
import { api, apiIfAllowed, can } from '@/lib/api';
import { createPledge, endPledge } from '@/lib/actions';
import { newKey, won } from '@/lib/format';
import { Flash, Status, type SearchParams } from '../../components';

type MonthStatus = 'NOT_DUE' | 'UPCOMING' | 'PAID' | 'PARTIAL' | 'PENDING' | 'UNPAID';
interface Pledge {
  id: string; donorName: string; fundName: string; amount: string; method: string; memo: string | null;
  startMonth: string; endMonth: string | null; ended: boolean; endReason: string | null;
  statuses: { month: string; status: MonthStatus }[]; unpaidPastMonths: string[]; currentMonthOpen: boolean;
}
interface PledgeList { current: string; months: string[]; pledges: Pledge[] }
interface Ref { facilities: { id: string; name: string }[]; funds: { id: string; name: string; designated: boolean }[] }
interface Donor { id: string; displayName: string }

const VIEWS = { active: '진행 중', ended: '끝난 약정', all: '전체' } as const;
const METHODS = { BANK_TRANSFER: '자동이체·계좌이체', CMS: 'CMS', CARD: '카드', OTHER: '기타' } as const;
/** 상태는 색과 글자를 함께 쓴다. 확정된 후원금만 '납입'이다. */
const MONTH: Record<MonthStatus, [string, string]> = {
  PAID: ['APPROVED', '납입'], PARTIAL: ['PENDING', '일부'], PENDING: ['PENDING_APPROVAL', '승인 대기'],
  UNPAID: ['REJECTED', '미납'], UPCOMING: ['CANCELLED', '예정'], NOT_DUE: ['', '—'],
};

export default async function PledgesPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await requirePage('/pledges');
  const sp = await searchParams;
  const view = (typeof sp.view === 'string' && sp.view in VIEWS ? sp.view : 'active') as keyof typeof VIEWS;
  const arrearsOnly = sp.arrears === '1';
  const canWrite = can(me, 'money.draft');
  const [list, ref, donors] = await Promise.all([
    api<PledgeList>(`/v1/pledges?view=${view}&months=6`), api<Ref>('/v1/reference-data'), apiIfAllowed<Donor[]>('/v1/donors'),
  ]);
  const rows = arrearsOnly ? list.pledges.filter((p) => p.unpaidPastMonths.length > 0) : list.pledges;
  const active = list.pledges.filter((p) => !p.endMonth || p.endMonth >= list.current);
  const monthly = active.reduce((a, p) => a + BigInt(p.amount), 0n);
  const inArrears = list.pledges.filter((p) => p.unpaidPastMonths.length > 0).length;
  const lastMonth = list.months[list.months.length - 2] ?? list.current;
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>정기후원 약정</h1>
          <p className="lead">약정은 수입이 아닙니다. 실제 입금을 후원금으로 연결하고 확정해야 그 달이 &lsquo;납입&rsquo;으로 표시됩니다.</p>
        </div>
        {canWrite && <Link className="btn secondary" href="/money/import">통장 입금 연결하기</Link>}
      </div>
      <Flash sp={sp} />

      <div className="grid" style={{ marginBottom: 18 }}>
        <div className="tile"><div className="n">{active.length}</div><div className="l">{view === 'ended' ? '이 목록 중 진행 중' : '진행 중 약정'}</div></div>
        <div className="tile"><div className="n">{won(monthly.toString())}</div><div className="l">월 약정 합계(예정액, 수입 아님)</div></div>
        <Link href={`/pledges?view=${view}&arrears=1`} className={`tile ${inArrears ? 'attn' : ''}`}>
          <div className="n">{inArrears}</div><div className="l">{lastMonth}까지 미납 있는 약정</div>
        </Link>
      </div>

      {canWrite && (
        <details className="card" open={list.pledges.length === 0}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>약정 등록</summary>
          <form action={createPledge} style={{ marginTop: 12 }}>
            <input type="hidden" name="idempotencyKey" value={newKey('pledge')} />
            <select name="facilityId" aria-label="시설" required defaultValue={ref.facilities.length === 1 ? ref.facilities[0]!.id : ''}><option value="">시설 선택</option>{ref.facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
            <div className="fields">
              <div><label htmlFor="donorId">후원자</label>
                <select id="donorId" name="donorId" required>
                  <option value="">선택</option>
                  {(donors ?? []).map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
                </select>
              </div>
              <div><label htmlFor="fundId">기금</label>
                <select id="fundId" name="fundId" required>{ref.funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
              </div>
              <div><label htmlFor="amount">월 약정액(원)</label><input id="amount" name="amount" inputMode="numeric" required /></div>
              <div><label htmlFor="method">납입 방법</label>
                <select id="method" name="method">{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </div>
              <div><label htmlFor="startMonth">시작월</label><input id="startMonth" name="startMonth" type="month" defaultValue={list.current} required /></div>
              <div><label htmlFor="endMonth">종료월(선택)</label><input id="endMonth" name="endMonth" type="month" /></div>
              <div style={{ gridColumn: 'span 2' }}><label htmlFor="memo">메모(선택, 계좌번호·개인정보 기재 금지)</label><input id="memo" name="memo" maxLength={300} /></div>
            </div>
            <button type="submit">약정 등록</button>
            <p className="muted">후원자가 없으면 후원자 화면에서 먼저 등록하십시오. 금액이 바뀌면 기존 약정을 끝내고 새로 등록합니다(이력 보존).</p>
          </form>
        </details>
      )}

      <div className="row" style={{ justifyContent: 'space-between', margin: '26px 0 10px' }}>
        <h2 style={{ margin: 0 }}>월별 납입 현황{arrearsOnly && ' · 미납 있는 약정만'}</h2>
        <div className="row" role="tablist">
          {arrearsOnly && <Link className="btn secondary" href={`/pledges?view=${view}`}>모두 보기</Link>}
          {Object.entries(VIEWS).map(([k, l]) => (
            <Link key={k} href={`/pledges?view=${k}`} className={`btn ${k === view && !arrearsOnly ? '' : 'secondary'}`} role="tab" aria-selected={k === view}>{l}</Link>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="card muted">{arrearsOnly ? '미납이 있는 약정이 없습니다.' : view === 'active' ? '등록된 약정이 없습니다.' : '해당하는 약정이 없습니다.'}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>후원자</th><th className="num">월 약정액</th><th>기간</th>
                {list.months.map((m) => <th key={m} style={{ textAlign: 'center' }}>{m === list.current ? `${m.slice(5)}월(이번 달)` : `${m.slice(5)}월`}</th>)}
                <th className="num">미납</th>{canWrite && <th></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>{p.donorName}<br /><span className="muted">{p.fundName} · {METHODS[p.method as keyof typeof METHODS] ?? p.method}</span></td>
                  <td className="num">{won(p.amount)}</td>
                  <td>{p.startMonth} ~ {p.endMonth ?? ''}{p.endReason && <><br /><span className="muted">끝냄: {p.endReason}</span></>}</td>
                  {p.statuses.map((s) => (
                    <td key={s.month} style={{ textAlign: 'center' }}>
                      {s.status === 'NOT_DUE' ? <span className="muted" aria-label="약정 기간 아님">—</span> : <Status value={MONTH[s.status][0]} label={MONTH[s.status][1]} />}
                    </td>
                  ))}
                  <td className="num" title={p.unpaidPastMonths.join(', ')}>{p.unpaidPastMonths.length ? `${p.unpaidPastMonths.length}개월` : '—'}</td>
                  {canWrite && (
                    <td>{!p.ended && (
                      <details>
                        <summary className="muted" style={{ cursor: 'pointer' }}>약정 끝내기</summary>
                        <form action={endPledge} className="row" style={{ marginTop: 6 }}>
                          <input type="hidden" name="pledgeId" value={p.id} /><input type="hidden" name="label" value={`${p.donorName} 월 ${won(p.amount)}`} />
                          <input type="hidden" name="idempotencyKey" value={newKey('pledge-end')} />
                          <input name="endMonth" type="month" defaultValue={list.current} aria-label={`${p.donorName} 마지막 납입월`} style={{ width: 'auto' }} required />
                          <input name="reason" placeholder="사유(예: 후원자 요청)" maxLength={200} aria-label={`${p.donorName} 끝내는 사유`} style={{ width: 'auto' }} required />
                          <button type="submit" className="secondary">끝내기</button>
                        </form>
                      </details>
                    )}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">
        납입: 확정된 후원금 합계가 약정액 이상 · 일부: 승인 합계가 약정액보다 적음 · 승인 대기: 초안·확정하기 중 · 미납: 연결된 후원금 없음 · 예정: 아직 오지 않은 달.
        늦게 낸 달은 후원금 입력에서 &lsquo;몇 월분&rsquo;을 골라 연결합니다. 미납 안내 연락 여부·방법은 기관 검토 필요.
      </p>
    </>
  );
}
