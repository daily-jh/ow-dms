import Link from 'next/link';
import { api, can, type Me } from '@/lib/api';
import { closePeriod, reopenPeriod } from '@/lib/actions';
import { won } from '@/lib/format';
import { Flash, Status, type SearchParams } from '../../components';

interface Checklist {
  period: string; status: 'OPEN' | 'CLOSED'; closedAt: string | null; closedByName: string | null; canClose: boolean;
  items: { code: string; label: string; count: number; blocking: boolean; href: string }[];
  totals: { moneyConfirmed: string; goodsReceipts: number; distributionsPosted: number };
  history: { closedAt: string; closedBy: string; reopenedAt: string | null; reopenedBy: string | null; reopenReason: string | null }[];
}

const fmt = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

export default async function ClosingPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const current = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date());
  const period = typeof sp.period === 'string' && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : current;
  const [me, c] = await Promise.all([api<Me>('/v1/auth/me'), api<Checklist>(`/v1/period-closures/${period}`)]);
  const canDecide = can(me, 'approval.decide');
  return (
    <>
      <h1>월 마감 <Status value={c.status} /></h1>
      <p className="lead">점검표의 차단 항목이 0건이어야 마감할 수 있습니다. 마감된 달에는 새 거래·승인·출고·정정을 기록할 수 없고, 재개방은 승인권자가 사유를 남겨야 합니다.</p>
      <Flash sp={sp} />
      <form className="row" style={{ marginBottom: 16 }}>
        <label htmlFor="period" style={{ margin: 0 }}>기간</label>
        <input id="period" name="period" type="month" defaultValue={period} style={{ width: 170 }} />
        <button type="submit" className="secondary">보기</button>
      </form>
      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="tile"><div className="n">{won(c.totals.moneyConfirmed)}</div><div className="l">승인된 후원금 수납</div></div>
        <div className="tile"><div className="n">{c.totals.goodsReceipts}건</div><div className="l">승인된 후원품 수입</div></div>
        <div className="tile"><div className="n">{c.totals.distributionsPosted}건</div><div className="l">출고 반영된 배분</div></div>
      </div>
      <table>
        <thead><tr><th>점검 항목</th><th>건수</th><th>구분</th><th></th></tr></thead>
        <tbody>
          {c.items.map((i) => (
            <tr key={i.code}>
              <td>{i.label}</td><td className="num">{i.count}</td>
              <td>{i.blocking ? (i.count > 0 ? <Status value="REJECTED" label="마감 차단" /> : <Status value="APPROVED" label="통과" />) : <Status value={i.count > 0 ? 'PENDING' : 'APPROVED'} label={i.count > 0 ? '확인 권장' : '없음'} />}</td>
              <td>{i.count > 0 && <Link href={i.href}>정리하러 가기</Link>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">은행 입금·회계전표 대조 항목은 다음 단계(은행·CMS 반입)에서 추가됩니다.</p>
      {canDecide ? (
        c.status === 'OPEN' ? (
          <form action={closePeriod} className="card">
            <input type="hidden" name="period" value={period} />
            <button type="submit" disabled={!c.canClose}>{period} 마감</button>
            {!c.canClose && <span className="muted" style={{ marginLeft: 8 }}>차단 항목을 먼저 정리하십시오.</span>}
          </form>
        ) : (
          <form action={reopenPeriod} className="card row">
            <input type="hidden" name="period" value={period} />
            <span>{c.closedAt && fmt(c.closedAt)} · {c.closedByName} 마감</span>
            <input name="reason" placeholder="재개방 사유" aria-label="재개방 사유" required maxLength={500} style={{ width: 260 }} />
            <button type="submit" className="danger">재개방</button>
          </form>
        )
      ) : <p className="msg warn">마감·재개방은 승인권자만 할 수 있습니다.</p>}
      {c.history.length > 0 && (
        <>
          <h2 style={{ fontSize: 17 }}>마감 이력</h2>
          <ul>{c.history.map((h) => <li key={h.closedAt}>{fmt(h.closedAt)} {h.closedBy} 마감{h.reopenedAt && ` → ${fmt(h.reopenedAt)} ${h.reopenedBy} 재개방(${h.reopenReason})`}</li>)}</ul>
        </>
      )}
    </>
  );
}
