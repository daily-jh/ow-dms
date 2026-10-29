import Link from 'next/link';
import { api } from '@/lib/api';
import { Flash, Status, type SearchParams } from '../../components';

interface Doc { id: string; title: string; sourceType: string; sourceId: string; sourceVersion: number; isDraft: boolean; generatedAt: string; auto: boolean }

export default async function DocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const docs = await api<Doc[]>('/v1/documents');
  return (
    <>
      <h1>서식·문서</h1>
      <p className="lead">모든 문서는 원장 스냅샷·서식 버전·생성시각·해시와 함께 저장됩니다. 다시 열면 당시 문서가 그대로 재현됩니다. 현재 서식은 공통 예시이며 기관 원본 대조 전입니다.</p>
      <Flash sp={sp} />
      <table>
        <thead><tr><th>문서</th><th>원거래</th><th>상태</th><th>생성</th></tr></thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td><Link href={`/documents/${d.id}`}>{d.title}</Link></td>
              <td className="mono">{d.sourceId.slice(0, 8)} v{d.sourceVersion}</td>
              <td>{d.isDraft ? <Status value="PENDING" label="초안" /> : <Status value="APPROVED" label="승인본 기준" />}</td>
              <td className="muted">{new Date(d.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · {d.auto ? '승인 시 자동' : '수동'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
