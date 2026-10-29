import Link from 'next/link';
import { api } from '@/lib/api';
import { won } from '@/lib/format';

interface Dashboard {
  businessDate: string; pendingApprovals: number; goodsDrafts: number; moneyDrafts: number; unconfirmedValuations: number;
  expiringLots: number; distributionsToPost: number; externalPending: number; monthConfirmedIncome: string; monthGoodsReceipts: number;
}

export default async function TodayPage() {
  const d = await api<Dashboard>('/v1/dashboard');
  const tasks = [
    { n: d.pendingApprovals, l: '승인 대기', href: '/approvals' },
    { n: d.goodsDrafts + d.moneyDrafts, l: '승인 요청 전 초안·반려', href: '/goods' },
    { n: d.distributionsToPost, l: '승인됐지만 출고 미반영 배분', href: '/distributions' },
    { n: d.unconfirmedValuations, l: '가액 미확정 후원품 행', href: '/goods' },
    { n: d.expiringLots, l: '30일 내 유효기한 로트', href: '/stock' },
    { n: d.externalPending, l: '희망이음 등록확인 대기', href: '/integrations' },
  ];
  return (
    <>
      <h1>오늘의 업무</h1>
      <p className="lead">{d.businessDate} 기준 · 처리할 일을 먼저 보여 줍니다.</p>
      <div className="grid" style={{ marginBottom: 20 }}>
        {tasks.map((t) => (
          <Link key={t.l} href={t.href} className={`tile ${t.n > 0 ? 'attn' : ''}`}>
            <div className="n">{t.n}</div>
            <div className="l">{t.l}{t.n > 0 ? ' · 확인 필요' : ''}</div>
          </Link>
        ))}
      </div>
      <div className="grid">
        <div className="tile"><div className="n">{won(d.monthConfirmedIncome)}</div><div className="l">이번 달 승인된 후원금 수납(수납일 기준)</div></div>
        <div className="tile"><div className="n">{d.monthGoodsReceipts}건</div><div className="l">이번 달 승인된 후원품 수입(헤더 건수)</div></div>
      </div>
      <p className="muted" style={{ marginTop: 16 }}>약정액은 수입에 포함하지 않습니다. 서로 다른 단위의 후원품 수량은 합산하지 않습니다.</p>
    </>
  );
}
