import Link from 'next/link';
import { apiIfAllowed } from '@/lib/api';
import { won } from '@/lib/format';

interface Dashboard {
  businessDate: string; pendingApprovals: number; goodsDrafts: number; moneyDrafts: number; unconfirmedValuations: number;
  expiringLots: number; distributionsToPost: number; externalPending: number; monthConfirmedIncome: string; monthGoodsReceipts: number;
}

export default async function TodayPage() {
  const d = await apiIfAllowed<Dashboard>('/v1/dashboard');
  if (!d) {
    // 기관관리자처럼 장부 열람 권한이 없는 역할(관리자라는 이유로 업무자료를 다 보지 않는다)
    return (
      <>
        <h1>오늘의 업무</h1>
        <p className="lead">이 역할에는 후원·재고 업무 현황이 표시되지 않습니다. 관리자라는 이유로 장부·개인정보를 모두 보지 않도록 나눠 두었습니다.</p>
        <div className="grid">
          <Link href="/settings" className="tile"><div className="n" style={{ fontSize: 20 }}>기준정보</div><div className="l">법인·시설·창고·품목·기금 등록</div></Link>
          <Link href="/admin/users" className="tile"><div className="n" style={{ fontSize: 20 }}>직원 관리</div><div className="l">직원 계정 만들기·역할 주기. 입력 업무도 하려면 본인에게 후원담당·물품담당 역할을 추가하십시오</div></Link>
          <Link href="/account" className="tile"><div className="n" style={{ fontSize: 20 }}>내 계정</div><div className="l">비밀번호·2단계 인증</div></Link>
        </div>
      </>
    );
  }
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
      <div className="section-title">처리할 일</div>
      <div className="grid">
        {tasks.map((t) => (
          <Link key={t.l} href={t.href} className={`tile ${t.n > 0 ? 'attn' : ''}`}>
            <div className="n">{t.n}</div>
            <div className="l">{t.l}</div>
          </Link>
        ))}
      </div>
      <div className="section-title">이번 달</div>
      <div className="grid">
        <div className="tile"><div className="n">{won(d.monthConfirmedIncome)}</div><div className="l">이번 달 승인된 후원금 수납(수납일 기준)</div></div>
        <div className="tile"><div className="n">{d.monthGoodsReceipts}건</div><div className="l">이번 달 승인된 후원품 수입(헤더 건수)</div></div>
      </div>
      <p className="muted" style={{ marginTop: 16 }}>약정액은 수입에 포함하지 않습니다. 서로 다른 단위의 후원품 수량은 합산하지 않습니다.</p>
    </>
  );
}
