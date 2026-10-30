import { requirePage } from '@/lib/nav';
export default async function DocumentView({ params }: { params: Promise<{ id: string }> }) {
  await requirePage('/documents/detail');
  const { id } = await params;
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>문서 미리보기</h1>
        <a className="btn secondary" href={`/documents/${id}/raw`} target="_blank" rel="noopener">새 창에서 열기·인쇄</a>
      </div>
      <p className="lead">A4 인쇄 레이아웃입니다. 브라우저 인쇄(PDF 저장)를 사용할 수 있습니다. 서버 PDF 생성은 다음 단계에서 격리 worker로 추가합니다.</p>
      <iframe className="doc" title="문서 미리보기" src={`/documents/${id}/raw`} sandbox="allow-modals allow-same-origin" />
    </>
  );
}
