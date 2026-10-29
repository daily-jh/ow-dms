import { formatWon, sha256Hex } from '@owdms/domain';

/**
 * 공통 예시 서식(기관 원본 미확보). 모든 출력에 검증 상태를 표기한다.
 * 템플릿 버전이 바뀌면 TEMPLATE_VERSION을 올리고 이전 버전 렌더러를 남겨 과거 문서 재출력을 보장한다.
 */
export type DocumentType = 'GOODS_RECEIPT_CERT' | 'DISTRIBUTION_LIST' | 'MONEY_RECEIPT_NOTE';

export interface TemplateInfo {
  templateId: string;
  version: string;
  title: string;
  sourceType: 'GOODS_RECEIPT' | 'DISTRIBUTION' | 'MONEY_RECEIPT';
  verification: '공통 예시·기관 검토 필요';
}

export const TEMPLATES: Record<DocumentType, TemplateInfo> = {
  GOODS_RECEIPT_CERT: { templateId: 'common.goods-receipt-cert', version: '1', title: '후원품 인수증', sourceType: 'GOODS_RECEIPT', verification: '공통 예시·기관 검토 필요' },
  DISTRIBUTION_LIST: { templateId: 'common.distribution-list', version: '1', title: '후원품 배분명부·출고대장', sourceType: 'DISTRIBUTION', verification: '공통 예시·기관 검토 필요' },
  MONEY_RECEIPT_NOTE: { templateId: 'common.money-receipt-note', version: '1', title: '후원금 수입 확인(내부용)', sourceType: 'MONEY_RECEIPT', verification: '공통 예시·기관 검토 필요' },
};

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const e = escapeHtml;

const STYLE = `
  @page { size: A4; margin: 18mm 15mm; }
  body { font-family: 'Noto Sans KR', 'Malgun Gothic', sans-serif; color: #111; font-size: 11pt; }
  h1 { text-align: center; font-size: 18pt; letter-spacing: 0.3em; margin: 0 0 4mm; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 1mm 6mm; margin-bottom: 4mm; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th, td { border: 1px solid #333; padding: 1.5mm 2mm; vertical-align: top; word-break: keep-all; overflow-wrap: anywhere; }
  th { background: #eee; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: bold; }
  .notice { border: 1px solid #b45309; color: #92400e; padding: 2mm; margin-bottom: 4mm; font-size: 9pt; }
  .draft { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font-size: 72pt; color: rgba(200,0,0,.15); transform: rotate(-20deg); pointer-events: none; }
  .foot { margin-top: 6mm; font-size: 8.5pt; color: #444; }
  .sign { margin-top: 10mm; display: flex; justify-content: flex-end; gap: 20mm; }
`;

function shell(title: string, isDraft: boolean, body: string, foot: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${e(title)}</title><style>${STYLE}</style></head><body>` +
    (isDraft ? `<div class="draft" aria-hidden="true">초안</div>` : '') +
    `<h1>${e(title)}</h1>` +
    `<div class="notice">공통 예시 서식입니다. 기관 원본 서식과 대조·승인 전에는 공식 제출용으로 사용하지 마십시오.${isDraft ? ' 승인 전 초안입니다.' : ''}</div>` +
    body + `<div class="foot">${foot}</div></body></html>`;
}

interface Header { institutionName: string; facilityName: string; documentId: string; generatedAt: string; snapshotHash: string }

function footer(h: Header, t: TemplateInfo, sourceId: string, sourceVersion: number): string {
  return `문서ID ${e(h.documentId)} · 원거래 ${e(sourceId)} v${e(sourceVersion)} · 서식 ${e(t.templateId)} v${e(t.version)} (${e(t.verification)}) · 생성 ${e(h.generatedAt)} · 스냅샷 ${e(h.snapshotHash.slice(0, 16))}`;
}

export interface GoodsReceiptDocSnapshot {
  id: string; version: number; receivedOn: string; donorName: string | null; memo: string | null;
  lines: { lineNo: number; itemName: string; quantity: string; unit: string; lotCode: string | null; expiresOn: string | null; valuationStatus: string; totalValue: string | null; warehouseName: string }[];
}

export interface DistributionDocSnapshot {
  id: string; version: number; plannedOn: string; programName: string; recipientRef: string | null; status: string;
  lines: { lineNo: number; itemName: string; lotCode: string; quantity: string; unit: string; warehouseName: string; sourceReceiptId: string }[];
}

export interface MoneyReceiptDocSnapshot {
  id: string; version: number; receivedOn: string; donorName: string | null; amount: string; method: string;
  fundLines: { fundName: string; amount: string }[];
}

const VALUATION_LABEL: Record<string, string> = { UNCONFIRMED: '미확정', PROPOSED: '평가안(미승인)', CONFIRMED: '확정' };

export function renderDocument(
  type: DocumentType,
  header: Header,
  snapshot: GoodsReceiptDocSnapshot | DistributionDocSnapshot | MoneyReceiptDocSnapshot,
  isDraft: boolean,
): { html: string; outputHash: string } {
  const t = TEMPLATES[type];
  let body = `<div class="meta"><div>기관: ${e(header.institutionName)}</div><div>시설: ${e(header.facilityName)}</div>`;
  if (type === 'GOODS_RECEIPT_CERT') {
    const s = snapshot as GoodsReceiptDocSnapshot;
    body += `<div>후원처: ${e(s.donorName ?? '익명/미확인')}</div><div>수입일: ${e(s.receivedOn)}</div></div>`;
    body += `<table><thead><tr><th>No</th><th>품목</th><th>수량</th><th>단위</th><th>로트</th><th>유효기한</th><th>보관</th><th>가액(상태)</th></tr></thead><tbody>`;
    for (const l of s.lines) {
      const value = l.totalValue === null ? '-' : formatWon(BigInt(l.totalValue));
      body += `<tr><td class="num">${e(l.lineNo)}</td><td>${e(l.itemName)}</td><td class="num">${e(l.quantity)}</td><td>${e(l.unit)}</td><td>${e(l.lotCode ?? '승인 후 부여')}</td><td>${e(l.expiresOn ?? '-')}</td><td>${e(l.warehouseName)}</td><td class="num">${e(value)} (${e(VALUATION_LABEL[l.valuationStatus] ?? l.valuationStatus)})</td></tr>`;
    }
    body += `</tbody></table><p>위 물품을 후원품으로 인수하였음을 확인합니다. 이 인수증은 세법상 기부금영수증이 아닙니다.</p>`;
    body += `<div class="sign"><span>인수자 (서명)</span><span>확인자 (서명)</span></div>`;
    return finish(shell(t.title, isDraft, body, footer(header, t, s.id, s.version)));
  }
  if (type === 'DISTRIBUTION_LIST') {
    const s = snapshot as DistributionDocSnapshot;
    body += `<div>사업: ${e(s.programName)}</div><div>배분일(예정): ${e(s.plannedOn)}</div><div>대상자 ID: ${e(s.recipientRef ?? '-')}</div><div>상태: ${e(s.status)}</div></div>`;
    body += `<table><thead><tr><th>No</th><th>품목</th><th>로트</th><th>수량</th><th>단위</th><th>출고창고</th><th>원입고ID</th></tr></thead><tbody>`;
    for (const l of s.lines) {
      body += `<tr><td class="num">${e(l.lineNo)}</td><td>${e(l.itemName)}</td><td>${e(l.lotCode)}</td><td class="num">${e(l.quantity)}</td><td>${e(l.unit)}</td><td>${e(l.warehouseName)}</td><td>${e(l.sourceReceiptId.slice(0, 8))}</td></tr>`;
    }
    body += `</tbody></table><p>승인·실출고·전달확인은 별도 상태로 관리됩니다. 수령확인은 개인정보 등급이 분리된 별도 증빙으로 받습니다.</p>`;
    return finish(shell(t.title, isDraft, body, footer(header, t, s.id, s.version)));
  }
  const s = snapshot as MoneyReceiptDocSnapshot;
  body += `<div>후원자: ${e(s.donorName ?? '익명/미확인')}</div><div>수납일: ${e(s.receivedOn)}</div><div>수납방법: ${e(s.method)}</div><div>금액: ${e(formatWon(BigInt(s.amount)))}</div></div>`;
  body += `<table><thead><tr><th>기금</th><th>배분액</th></tr></thead><tbody>`;
  for (const l of s.fundLines) body += `<tr><td>${e(l.fundName)}</td><td class="num">${e(formatWon(BigInt(l.amount)))}</td></tr>`;
  body += `</tbody><tfoot><tr><td>합계</td><td class="num">${e(formatWon(s.fundLines.reduce((a, l) => a + BigInt(l.amount), 0n)))}</td></tr></tfoot></table>`;
  body += `<p>내부 확인용 자료이며 기부금영수증이 아닙니다.</p>`;
  return finish(shell(t.title, isDraft, body, footer(header, t, s.id, s.version)));
}

function finish(html: string) {
  return { html, outputHash: sha256Hex(html) };
}
