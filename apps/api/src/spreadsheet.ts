import ExcelJS from 'exceljs';
import { DomainError, type Grid } from '@owdms/domain';

/**
 * 올린 파일 → 문자열 표. 지원: xlsx, csv(UTF-8·EUC-KR), 은행이 .xls 이름으로 내려주는 HTML 표.
 * 옛 엑셀(.xls, BIFF) 이진 형식은 읽지 않고 xlsx·csv로 저장해 달라고 안내한다.
 */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 20000;

export async function readGrid(fileName: string, content: Buffer): Promise<Grid> {
  if (content.length === 0) throw new DomainError('VALIDATION_FAILED', '빈 파일입니다.');
  if (content.length > MAX_IMPORT_BYTES) throw new DomainError('VALIDATION_FAILED', '파일은 5MB 이하만 올릴 수 있습니다.');
  const head = content.subarray(0, 8);
  if (head[0] === 0x50 && head[1] === 0x4b) return readXlsx(content); // zip(xlsx)
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
    throw new DomainError('VALIDATION_FAILED',
      '옛 엑셀(.xls) 형식은 읽을 수 없습니다. 엑셀에서 열어 "다른 이름으로 저장 → Excel 통합 문서(.xlsx)" 또는 CSV로 저장해 올려 주십시오.');
  }
  const text = decodeText(content);
  if (/<table[\s>]/i.test(text)) return readHtmlTable(text);
  if (/\.(xlsx|xls)$/i.test(fileName) && text.includes('\u0000')) {
    throw new DomainError('VALIDATION_FAILED', '엑셀 파일을 읽을 수 없습니다. xlsx 또는 CSV로 저장해 올려 주십시오.');
  }
  return readCsv(text);
}

/** BOM이 있으면 UTF-8, 아니면 UTF-8로 깨끗이 읽히는지 보고 아니면 EUC-KR(CP949)로 읽는다. */
export function decodeText(b: Buffer): string {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString('utf8');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return new TextDecoder('euc-kr').decode(b);
  }
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    // 엑셀 날짜는 시간대 없이 저장되므로 UTC 값 그대로 읽는다.
    const iso = v.toISOString();
    const time = iso.slice(11, 19);
    return time === '00:00:00' ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${time}`;
  }
  if (typeof v === 'number') return String(v); // 금액은 이후 문자열로만 해석한다(소수면 오류로 걸러짐)
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
    if ('error' in v) return '';
  }
  return String(v);
}

async function readXlsx(content: Buffer): Promise<Grid> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(content as unknown as ArrayBuffer);
  } catch {
    throw new DomainError('VALIDATION_FAILED', '엑셀 파일을 열 수 없습니다. 암호가 걸려 있으면 해제하고 다시 저장해 올려 주십시오.');
  }
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const grid: Grid = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    if (n > MAX_ROWS) return;
    const out: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) out.push(cellText(row.getCell(c).value).trim());
    grid[n - 1] = out;
  });
  return Array.from(grid, (r) => r ?? []);
}

/** 따옴표·쉼표·줄바꿈을 처리하는 CSV 읽기. 탭 구분도 허용. */
export function readCsv(text: string): Grid {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? '\t' : ',';
  const rows: Grid = [];
  let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim()); rows.push(row); row = []; cell = '';
      if (rows.length >= MAX_ROWS) return rows;
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** 은행 "엑셀 저장"이 실제로는 HTML 표인 경우. 태그를 실행하지 않고 글자만 뽑는다. */
export function readHtmlTable(html: string): Grid {
  const rows: Grid = [];
  for (const tr of html.matchAll(/<tr[\s>][\s\S]*?<\/tr>/gi)) {
    const cells = [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      m[1]!.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
        .replace(/&(#\d+|[a-z]+);/gi, (_, e: string) => (e.startsWith('#') ? String.fromCharCode(Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? ''))
        .replace(/\s+/g, ' ').trim());
    rows.push(cells);
    if (rows.length >= MAX_ROWS) break;
  }
  return rows;
}
