import Link from 'next/link';
import { requirePage } from '@/lib/nav';
import { api } from '@/lib/api';
import { bankExclude, bankReopen, bankToReceipt } from '@/lib/actions';
import { newKey, won } from '@/lib/format';
import { Flash, Status, type SearchParams } from '../../../components';
import { ImportForm } from './ImportForm';

interface Ref { facilities: { id: string; name: string }[]; funds: { id: string; name: string; designated: boolean }[] }
interface Tx {
  id: string; accountLabel: string; occurredOn: string; occurredTime: string | null; amount: string; allocated: string; remaining: string;
  counterparty: string; memo: string | null; status: 'OPEN' | 'PARTIAL' | 'MATCHED' | 'EXCLUDED'; excludeReason: string | null;
  receipts: { id: string; amount: string; status: string; donorName: string | null }[];
  donorCandidates: { id: string; displayName: string }[];
  pledgeCandidates: { id: string; donorId: string; amount: string; sameAmount: boolean }[];
}
interface Pledges { pledges: { id: string; donorName: string; amount: string; fundName: string }[] }
interface Batch { id: string; kind: string; accountLabel: string | null; fileName: string; importedRows: number; duplicateRows: number; createdAt: string; createdBy: string }
interface Donor { id: string; displayName: string }

const VIEWS = { open: '미대조 입금', excluded: '후원금 아님', all: '전체' } as const;
const TX_STATUS: Record<Tx['status'], [string, string]> = {
  OPEN: ['PENDING', '미대조'], PARTIAL: ['PENDING', '일부 연결'], MATCHED: ['APPROVED', '연결 완료'], EXCLUDED: ['CANCELLED', '후원금 아님'],
};
const EXCLUDE_REASONS = ['예금 이자', '보조금·법인전입금', '내부 계좌 이체', '사업 수입·이용료', '환불·반환', '기타'];

export default async function BankImportPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePage('/money/import');
  const sp = await searchParams;
  const view = (typeof sp.view === 'string' && sp.view in VIEWS ? sp.view : 'open') as keyof typeof VIEWS;
  const [txs, ref, batches, donors, pledges] = await Promise.all([
    api<Tx[]>(`/v1/bank-transactions?view=${view}`), api<Ref>('/v1/reference-data'), api<Batch[]>('/v1/imports'), api<Donor[]>('/v1/donors'),
    api<Pledges>('/v1/pledges?months=1'),
  ]);
  const pledgeLabel = (id: string) => {
    const p = pledges.pledges.find((x) => x.id === id);
    return p ? `${p.donorName} 월 ${won(p.amount)}` : '약정';
  };
  const labels = [...new Set(batches.map((b) => b.accountLabel).filter((l): l is string => !!l))];
  const facilityId = ref.facilities[0]?.id ?? '';
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>통장·엑셀 가져오기</h1>
          <p className="lead">은행 거래내역이나 엑셀로 정리한 후원금 목록을 올리면 후원금 초안으로 만듭니다. 확정 전에는 수입이 아닙니다.</p>
        </div>
        <Link className="btn secondary" href="/money">후원금 목록</Link>
      </div>
      <Flash sp={sp} />

      <section className="card">
        <h2>파일 올리기</h2>
        <ImportForm facilities={ref.facilities} accountLabels={labels} />
      </section>

      <div className="row" style={{ justifyContent: 'space-between', margin: '26px 0 10px' }}>
        <h2 style={{ margin: 0 }}>통장 입금</h2>
        <div className="row" role="tablist">
          {Object.entries(VIEWS).map(([k, l]) => (
            <Link key={k} href={`/money/import?view=${k}`} className={`btn ${k === view ? '' : 'secondary'}`} role="tab" aria-selected={k === view}>{l}</Link>
          ))}
        </div>
      </div>
      {txs.length === 0 ? (
        <p className="card muted">{view === 'open' ? '연결할 입금이 없습니다. 통장 거래내역을 올리면 여기에 나옵니다.' : '해당하는 입금이 없습니다.'}</p>
      ) : (
        <table>
          <thead><tr><th>입금일</th><th>입금자명(통장 표시)</th><th className="num">입금액</th><th className="num">남은 금액</th><th>상태</th><th style={{ width: '44%' }}>처리</th></tr></thead>
          <tbody>
            {txs.map((t) => {
              const label = `${t.occurredOn} ${t.counterparty || '(입금자 없음)'} ${won(t.amount)}`;
              const only = t.donorCandidates.length === 1 ? t.donorCandidates[0]!.id : '';
              // 이름이 같은 후원자 1명의 약정 중 금액까지 같은 것이 정확히 1건일 때만 미리 골라 둔다(최종 선택은 사람)
              const same = t.pledgeCandidates.filter((p) => p.sameAmount);
              const pledgePick = only && same.length === 1 && same[0]!.donorId === only ? same[0]!.id : '';
              return (
                <tr key={t.id}>
                  <td>{t.occurredOn}<br /><span className="muted">{t.occurredTime?.slice(0, 5) ?? ''} {t.accountLabel}</span></td>
                  <td>
                    {t.counterparty || <span className="muted">(없음)</span>}
                    {t.memo && <><br /><span className="muted">{t.memo}</span></>}
                    {t.receipts.map((r) => (
                      <div key={r.id} className="muted">→ {r.donorName ?? '익명/미확인'} {won(r.amount)} <Status value={r.status} /></div>
                    ))}
                    {t.excludeReason && <div className="muted">사유: {t.excludeReason}</div>}
                  </td>
                  <td className="num">{won(t.amount)}</td>
                  <td className="num">{won(t.remaining)}</td>
                  <td><Status value={TX_STATUS[t.status][0]} label={TX_STATUS[t.status][1]} /></td>
                  <td>
                    {t.status === 'EXCLUDED' ? (
                      <form action={bankReopen}>
                        <input type="hidden" name="txId" value={t.id} /><input type="hidden" name="label" value={label} />
                        <input type="hidden" name="idempotencyKey" value={newKey('bank-reopen')} />
                        <button type="submit" className="secondary">표시 해제</button>
                      </form>
                    ) : t.status !== 'MATCHED' && (
                      <>
                        <form action={bankToReceipt} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.2fr 0.9fr auto', gap: 6, alignItems: 'end' }}>
                          <input type="hidden" name="txId" value={t.id} /><input type="hidden" name="label" value={label} />
                          <select name="facilityId" aria-label="시설" required defaultValue={ref.facilities.length === 1 ? ref.facilities[0]!.id : ''}><option value="">시설 선택</option>{ref.facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select><input type="hidden" name="view" value={view} />
                          <input type="hidden" name="idempotencyKey" value={newKey('bank-receipt')} />
                          <label>후원자
                            <select name="donor" defaultValue={only} aria-label={`${label} 후원자`}>
                              <option value="">익명/미확인</option>
                              {t.donorCandidates.length > 0 && (
                                <optgroup label={t.donorCandidates.length > 1 ? `이름이 같은 후원자 ${t.donorCandidates.length}명: 확인 후 선택` : '이름이 같은 후원자'}>
                                  {t.donorCandidates.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
                                </optgroup>
                              )}
                              {t.counterparty && (
                                <optgroup label="새 후원자로 등록(입금자명)">
                                  <option value="new:INDIVIDUAL">+ 개인 &quot;{t.counterparty}&quot;</option>
                                  <option value="new:CORPORATION">+ 법인 &quot;{t.counterparty}&quot;</option>
                                  <option value="new:GROUP">+ 단체 &quot;{t.counterparty}&quot;</option>
                                </optgroup>
                              )}
                              <optgroup label="전체 후원자">
                                {donors.filter((d) => !t.donorCandidates.some((c) => c.id === d.id)).map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
                              </optgroup>
                            </select>
                          </label>
                          <label>기금
                            <select name="fundId" required aria-label={`${label} 기금`}>
                              {ref.funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </select>
                          </label>
                          <label>금액
                            <input name="amount" inputMode="numeric" defaultValue={t.remaining} aria-label={`${label} 연결 금액`} />
                          </label>
                          <button type="submit">초안 만들기</button>
                          {pledges.pledges.length > 0 && (<label style={{ gridColumn: '1 / -1' }}>정기후원 약정(선택)
                            <select name="pledgeId" defaultValue={pledgePick} aria-label={`${label} 약정`}>
                              <option value="">연결 안 함</option>
                              {t.pledgeCandidates.length > 0 && (
                                <optgroup label="이 입금자의 약정">
                                  {t.pledgeCandidates.map((p) => <option key={p.id} value={p.id}>{pledgeLabel(p.id)}{p.sameAmount ? ' (금액 같음)' : ''}</option>)}
                                </optgroup>
                              )}
                              {pledges.pledges.some((p) => !t.pledgeCandidates.some((c) => c.id === p.id)) && (
                                <optgroup label="다른 약정(입금자명이 다를 때)">
                                  {pledges.pledges.filter((p) => !t.pledgeCandidates.some((c) => c.id === p.id)).map((p) => (
                                    <option key={p.id} value={p.id}>{p.donorName} 월 {won(p.amount)} · {p.fundName}</option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                          </label>)}
                        </form>
                        {t.status === 'OPEN' && (
                          <details style={{ marginTop: 6 }}>
                            <summary>후원금이 아닌 입금(이자·보조금 등)</summary>
                            <form action={bankExclude} className="row" style={{ marginTop: 6 }}>
                              <input type="hidden" name="txId" value={t.id} /><input type="hidden" name="label" value={label} />
                              <input type="hidden" name="idempotencyKey" value={newKey('bank-exclude')} />
                              <select name="reasonKind" aria-label="사유" style={{ width: 'auto' }}>{EXCLUDE_REASONS.map((r) => <option key={r}>{r}</option>)}</select>
                              <input name="reasonText" placeholder="메모(선택, 개인정보 기재 금지)" maxLength={150} style={{ flex: 1, width: 'auto' }} />
                              <button type="submit" className="secondary">후원금 아님으로 표시</button>
                            </form>
                          </details>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="muted">금액을 나누면 한 입금을 여러 후원자·기금으로 연결할 수 있습니다. 이름이 같은 후원자가 여럿이면 자동으로 고르지 않습니다.
        약정을 고르고 후원자를 익명/미확인으로 두면 약정 후원자로 채우며, 입금일의 달을 약정 납입월로 기록합니다.</p>

      {batches.length > 0 && (
        <>
          <div className="section-title">최근 가져오기</div>
          <table>
            <thead><tr><th>일시</th><th>종류</th><th>파일</th><th className="num">가져옴</th><th className="num">중복 건너뜀</th><th>담당</th></tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td>{new Date(b.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{b.kind === 'BANK_STATEMENT' ? `통장(${b.accountLabel})` : '후원금 양식'}</td>
                  <td>{b.fileName}</td>
                  <td className="num">{b.importedRows}</td>
                  <td className="num">{b.duplicateRows}</td>
                  <td>{b.createdBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
