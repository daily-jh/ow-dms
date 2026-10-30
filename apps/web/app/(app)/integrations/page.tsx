import { getMe, requirePage } from '@/lib/nav';
import { api, apiIfAllowed, can, type Me } from '@/lib/api';
import { createBatch } from '@/lib/actions';
import { newKey } from '@/lib/format';
import { Flash, Status, type SearchParams } from '../../components';

interface Cap { operation: string; mode: string; enabled: boolean; label: string }
interface Batch { id: string; operation: string; mode: string; createdAt: string; total: number; exported: number; verified: number; notReady: number }
interface Code { code: string; label: string; note: string }
interface Guide {
  warning: string; exportNotice: string;
  evidence: { id: string; title: string; url: string; limit: string };
  uploadSteps: string[];
  goodsReceiptFields: { no: number; key: string; label: string; source: string; fill: 'auto' | 'mapping' | 'manual'; rule: string }[];
  goodsTypeCodes: Code[]; designationCodes: Code[];
  operations: { operation: string; evidence: string; template: string; now: string; status: string }[];
  pendingEvidence: { id: string; need: string; until: string }[];
}
interface Receipt { id: string; receivedOn: string; status: string; donorName: string | null; lineCount: number }

const OPERATION_LABEL: Record<string, string> = { goodsReceipt: '후원품 수입', moneyReceipt: '후원금 입금', donor: '후원자·결연자', goodsUse: '후원품 사용', report: '표준연계' };
const MODE_LABEL: Record<string, string> = { reference: '내부 검토', officialFile: '공식 파일', approvedModule: '표준연계모듈', officialApi: '공식 API' };
const FILL: Record<Guide['goodsReceiptFields'][number]['fill'], { tone: string; label: string }> = {
  auto: { tone: 'APPROVED', label: 'OW-DMS 값으로 채움' },
  mapping: { tone: 'UNKNOWN', label: '기관 코드 확인' },
  manual: { tone: 'REVERSED', label: '담당자 작성' },
};

export default async function IntegrationsPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePage('/integrations');
  const sp = await searchParams;
  const [me, caps, guide, batches, receipts] = await Promise.all([
    getMe(), api<Cap[]>('/v1/integrations/capabilities'), api<Guide>('/v1/integrations/hope-eum-guide'), api<Batch[]>('/v1/integration-batches'),
    apiIfAllowed<Receipt[]>('/v1/goods-receipts?status=APPROVED'),
  ]);
  return (
    <>
      <h1>희망이음 준비</h1>
      <p className="msg warn">{guide.warning} 전송 기능은 비활성이며, 등록은 담당자가 희망이음에서 직접 하고 결과를 대조합니다.</p>
      <Flash sp={sp} />
      <div className="card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>희망이음 후원품 수입 Excel 작성항목 9개</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          근거: <a href={guide.evidence.url} target="_blank" rel="noreferrer">{guide.evidence.title}</a> — {guide.evidence.limit}.{" "}
          아래는 <strong>항목 목록</strong>이며 원본 양식의 열 순서·시작행은 아직 모릅니다.
        </p>
        <table>
          <thead><tr><th className="num">순번</th><th>희망이음 항목</th><th>OW-DMS 값</th><th>채우는 방법</th><th>확인 규칙</th></tr></thead>
          <tbody>{guide.goodsReceiptFields.map((f) => (
            <tr key={f.key}><td className="num">{f.no}</td><td><strong>{f.label}</strong></td><td style={{ minWidth: 120 }}>{f.source}</td><td><Status value={FILL[f.fill].tone} label={FILL[f.fill].label} /></td><td className="muted" style={{ minWidth: 220 }}>{f.rule}</td></tr>
          ))}</tbody>
        </table>
        <p className="muted">희망이음 입력 순서: {guide.uploadSteps.join(' → ')}. 후원자·수입일자는 화면에서 고르므로, 후원자나 수입일이 다른 건은 따로 올리십시오.</p>
      </div>
      <details className="card">
        <summary>후원품 유형·지정구분 코드(사례집 기준, 현행 재확인 필요)</summary>
        <p className="muted">코드는 문자열(01, 02 …)로 유지합니다. 시스템은 어떤 거래에도 코드를 자동으로 정하지 않습니다.</p>
        <table>
          <thead><tr><th>코드</th><th>후원품 유형</th><th>설명</th></tr></thead>
          <tbody>{guide.goodsTypeCodes.map((c) => <tr key={c.code}><td><code>{c.code}</code></td><td>{c.label}</td><td className="muted" style={{ minWidth: 220 }}>{c.note}</td></tr>)}</tbody>
        </table>
        <table>
          <thead><tr><th>코드</th><th>지정구분</th><th>설명</th></tr></thead>
          <tbody>{guide.designationCodes.map((c) => <tr key={c.code}><td><code>{c.code}</code></td><td>{c.label}</td><td className="muted" style={{ minWidth: 220 }}>{c.note}</td></tr>)}</tbody>
        </table>
      </details>
      <div className="card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>업무별 연계 확인 수준</h2>
        <table>
          <thead><tr><th>업무</th><th>공개 근거로 확인된 것</th><th>원본 양식</th><th>지금 할 일</th><th>상태</th></tr></thead>
          <tbody>{guide.operations.map((o) => (
            <tr key={o.operation}><td style={{ minWidth: 96 }}><strong>{o.operation}</strong></td><td style={{ minWidth: 220 }}>{o.evidence}</td><td style={{ minWidth: 64 }}>{o.template}</td><td style={{ minWidth: 180 }}>{o.now}</td><td><Status value="UNKNOWN" label={o.status} /></td></tr>
          ))}</tbody>
        </table>
        <details>
          <summary>시스템 기능 상태(공식 파일·전송)</summary>
          <table>
            <thead><tr><th>업무</th><th>방식</th><th>상태</th><th>설명</th></tr></thead>
            <tbody>{caps.map((c) => <tr key={`${c.operation}-${c.mode}`}><td>{OPERATION_LABEL[c.operation] ?? c.operation}</td><td>{MODE_LABEL[c.mode] ?? c.mode}</td><td>{c.enabled ? <Status value="APPROVED" label="사용 가능" /> : <Status value="NOT_READY" label="비활성" />}</td><td>{c.label}</td></tr>)}</tbody>
          </table>
        </details>
      </div>
      <details className="card">
        <summary>공식 파일을 만들기 전에 확보할 자료(HV-01~12)</summary>
        <table>
          <thead><tr><th>번호</th><th>필요한 자료</th><th>확보 전 처리</th></tr></thead>
          <tbody>{guide.pendingEvidence.map((e) => <tr key={e.id}><td>{e.id}</td><td style={{ minWidth: 220 }}>{e.need}</td><td className="muted">{e.until}</td></tr>)}</tbody>
        </table>
        <p className="muted">빈 원본 양식에도 기관 정보가 들어 있을 수 있으니 공개 저장소·외부 AI에 올리지 말고 기관 보관 경로에 두십시오.</p>
      </details>
      {receipts && can(me, 'integration.prepare') && (
        <form action={createBatch} className="card">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>확정된 후원품 수입으로 내부 검토 배치 만들기</h2>
          <p className="muted" style={{ marginTop: 0 }}>내부 검토 Excel에는 9개 항목 대조표와 코드 참고 시트가 함께 들어갑니다. 유형·종류·지정구분은 비어 있고, 행마다 확인 필요 항목이 적힙니다.</p>
          <input type="hidden" name="idempotencyKey" value={newKey('batch')} />
          {receipts.map((r) => (
            <label key={r.id} className="row" style={{ color: 'var(--text)' }}>
              <input type="checkbox" name="sourceIds" value={r.id} style={{ width: 'auto' }} /> {r.receivedOn} · {r.donorName ?? '익명/미확인'} · {r.lineCount}행
            </label>
          ))}
          <button type="submit" style={{ marginTop: 8 }}>배치 만들기</button>
        </form>
      )}
      {batches.length > 0 && <p className="muted">{guide.exportNotice}</p>}
      <table>
        <thead><tr><th>생성</th><th>업무·방식</th><th>행</th><th>다운로드됨(미등록)</th><th>등록확인</th><th></th></tr></thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id}>
              <td className="muted">{new Date(b.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td><td>{b.operation} · {b.mode}</td>
              <td className="num">{b.total}{b.notReady ? ` (준비불가 ${b.notReady})` : ''}</td><td className="num">{b.exported}</td><td className="num">{b.verified}</td>
              <td>{can(me, 'integration.prepare') && <a className="btn secondary" href={`/integrations/${b.id}/export`}>내부 검토 Excel</a>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
