import { api, can, type Me } from '@/lib/api';
import { createDonor } from '@/lib/actions';
import { newKey } from '@/lib/format';
import { Flash, type SearchParams } from '../../components';

interface Donor { id: string; donorType: string; displayName: string; maskedPhone?: string | null; createdAt: string }
const TYPES = { INDIVIDUAL: '개인', CORPORATION: '법인', GROUP: '단체', ANONYMOUS: '익명' } as const;

export default async function DonorsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const search = typeof sp.q === 'string' ? sp.q : '';
  const [me, donors] = await Promise.all([api<Me>('/v1/auth/me'), api<Donor[]>(`/v1/donors${search ? `?search=${encodeURIComponent(search)}` : ''}`)]);
  const showContact = can(me, 'donor.private.read');
  return (
    <>
      <h1>후원자</h1>
      <p className="lead">동명이인을 허용합니다. 같은 이름은 후보로만 표시하고 자동 병합하지 않습니다. 연락처는 권한자에게만 마스킹해 보여 줍니다.</p>
      <Flash sp={sp} />
      {can(me, 'donor.write') && (
        <form action={createDonor} className="card">
          <input type="hidden" name="idempotencyKey" value={newKey('donor')} />
          <div className="fields">
            <div><label htmlFor="donorType">유형</label><select id="donorType" name="donorType">{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label htmlFor="displayName">표시명</label><input id="displayName" name="displayName" required maxLength={100} /></div>
            <div><label htmlFor="phone">연락처(선택·암호화 저장)</label><input id="phone" name="phone" autoComplete="off" /></div>
          </div>
          <button type="submit">등록</button>
        </form>
      )}
      <form className="row" style={{ marginBottom: 12 }}>
        <input name="q" defaultValue={search} placeholder="이름 검색" aria-label="이름 검색" style={{ maxWidth: 240 }} />
        <button type="submit" className="secondary">검색</button>
      </form>
      <table>
        <thead><tr><th>표시명</th><th>유형</th>{showContact && <th>연락처</th>}<th>등록</th></tr></thead>
        <tbody>
          {donors.map((d) => (
            <tr key={d.id}><td>{d.displayName}</td><td>{TYPES[d.donorType as keyof typeof TYPES]}</td>{showContact && <td className="mono">{d.maskedPhone ?? '-'}</td>}<td className="muted">{d.createdAt.slice(0, 10)}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
