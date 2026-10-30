import { createHash } from 'node:crypto';
import { DomainError } from './errors';
import { parseWon, type Won } from './money';

/**
 * 은행 거래내역·후원금 양식 파일 해석(순수 함수).
 * 파일 → 표(문자열 2차원 배열) 변환은 API 어댑터가 하고, 여기서는 표의 의미만 해석한다.
 * 은행마다 내려받기 양식이 달라 특정 은행 규격을 가정하지 않고, 머리글 이름으로 열을 찾는다.
 * 찾지 못하면 사람이 고쳐 올리도록 오류를 돌려준다(추측해서 넣지 않는다).
 */
export type Grid = string[][];

export interface BankColumns {
  date: number;
  time?: number;
  deposit: number;
  withdrawal?: number;
  balance?: number;
  counterparty: number;
  memo?: number;
}

export interface BankRow {
  line: number; // 파일의 행 번호(1부터)
  date: string; // YYYY-MM-DD
  time: string | null; // HH:MM:SS
  amount: Won; // 입금액(양수)
  balance: Won | null;
  counterparty: string; // 입금자명·기재내용
  memo: string | null;
  fingerprint: string;
}

export interface RowError { line: number; message: string }

const BANK_HEADERS: Record<keyof BankColumns, string[]> = {
  date: ['거래일시', '거래일자', '거래일', '거래날짜', '일자', '날짜', '일시'],
  time: ['거래시간', '거래시각', '시간', '시각'],
  deposit: ['입금액', '입금금액', '맡기신금액', '입금', '받은금액'],
  withdrawal: ['출금액', '출금금액', '찾으신금액', '지급액', '출금', '보낸금액'],
  balance: ['거래후잔액', '잔액', '잔고'],
  counterparty: ['입금자명', '입금자', '보낸분', '보낸사람', '의뢰인', '기재내용', '받는분/보낸분', '보낸분/받는분', '거래내용', '내용', '적요'],
  memo: ['메모', '비고', '거래점', '취급점', '거래구분', '구분'],
};

/** 머리글 비교용: 공백·괄호 안 단위·기호 제거. */
export function normalizeHeader(v: string): string {
  return v.replace(/\(.*?\)|\[.*?\]/g, '').replace(/[\s:·.*]/g, '').trim();
}

function findColumn(headers: string[], names: string[], used: Set<number>): number | undefined {
  for (const name of names) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && h === name);
    if (i >= 0) return i;
  }
  return undefined;
}

/** 앞쪽 30행에서 머리글 행을 찾는다. 날짜·입금액·입금자(내용) 열이 모두 있어야 한다. */
export function detectBankHeader(grid: Grid): { headerRow: number; columns: BankColumns } | null {
  for (let r = 0; r < Math.min(grid.length, 30); r++) {
    const headers = (grid[r] ?? []).map((c) => normalizeHeader(c ?? ''));
    const used = new Set<number>();
    const pick = (k: keyof BankColumns) => {
      const i = findColumn(headers, BANK_HEADERS[k], used);
      if (i !== undefined) used.add(i);
      return i;
    };
    const date = pick('date');
    const deposit = pick('deposit');
    const withdrawal = pick('withdrawal');
    const balance = pick('balance');
    const time = pick('time');
    const counterparty = pick('counterparty');
    const memo = pick('memo');
    if (date !== undefined && deposit !== undefined && counterparty !== undefined) {
      return { headerRow: r, columns: { date, time, deposit, withdrawal, balance, counterparty, memo } };
    }
  }
  return null;
}

/** 2026-10-30, 2026.10.30, 2026/10/30, 20261030, 뒤에 시각(14:05[:09]) 허용. */
export function parseBankDate(value: string): { date: string; time: string | null } | null {
  const m = value.trim().match(/^(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})\.?(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss] = m;
  const date = `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  const t = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== date) return null;
  const time = hh ? `${hh.padStart(2, '0')}:${mi}:${ss ?? '00'}` : null;
  return { date, time };
}

export function parseBankTime(value: string): string | null {
  const m = value.trim().match(/^(\d{1,2}):?(\d{2}):?(\d{2})?$/);
  if (!m) return null;
  return `${m[1]!.padStart(2, '0')}:${m[2]}:${m[3] ?? '00'}`;
}

/** 금액 칸: "1,000", "1,000원", "1000.00", 빈칸·"-"는 0. 소수 원 단위나 음수는 오류. */
export function parseAmountCell(value: string): Won {
  const v = value.trim().replace(/원$/, '').replace(/^\+/, '');
  if (v === '' || v === '-' || v === '0') return 0n;
  const m = v.replace(/,/g, '').match(/^(\d{1,18})(?:\.0+)?$/);
  if (!m) throw new DomainError('INVALID_AMOUNT', `금액을 읽을 수 없습니다: ${value}`);
  return parseWon(m[1]!);
}

/**
 * 거래 지문: 같은 파일을 다시 넣거나 기간이 겹친 파일을 넣어도 같은 거래는 한 번만 들어가게 한다.
 * 같은 날 같은 금액·같은 입금자의 정상 거래가 여러 건일 수 있으므로 파일 안 순번(occurrence)을 함께 넣는다.
 */
export function bankFingerprint(r: { date: string; time: string | null; amount: Won; balance: Won | null; counterparty: string }, occurrence: number): string {
  const key = [r.date, r.time ?? '', r.amount.toString(), r.balance?.toString() ?? '', r.counterparty.replace(/\s+/g, ' ').trim(), occurrence].join('|');
  return createHash('sha256').update(key).digest('hex');
}

/** 은행 거래내역 표 → 입금 행. 출금 행은 세기만 하고 버린다(후원금 수입 후보가 아님). */
export function interpretBankGrid(grid: Grid): { rows: BankRow[]; withdrawals: number; errors: RowError[] } {
  const found = detectBankHeader(grid);
  if (!found) {
    throw new DomainError('VALIDATION_FAILED',
      '거래내역의 머리글(거래일시·입금액·입금자명 또는 내용)을 찾지 못했습니다. 은행에서 내려받은 원본을 그대로 올리거나, 첫 줄을 "거래일시, 입금액, 출금액, 잔액, 입금자명" 머리글로 맞춰 주십시오.');
  }
  const { headerRow, columns: c } = found;
  const rows: BankRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  let withdrawals = 0;
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const cell = (i: number | undefined) => (i === undefined ? '' : (row[i] ?? '').trim());
    if (row.every((v) => !v || !v.trim())) continue;
    const line = r + 1;
    const when = parseBankDate(cell(c.date));
    if (!when) {
      // 합계·안내 문구 줄(날짜 칸에 숫자가 없음)은 건너뛰고, 날짜처럼 보이는데 깨졌으면 오류로 알린다.
      if (/\d/.test(cell(c.date))) errors.push({ line, message: `날짜를 읽을 수 없습니다: ${cell(c.date) || '(빈칸)'}` });
      continue;
    }
    let deposit: Won; let withdrawal: Won; let balance: Won | null = null;
    try {
      deposit = parseAmountCell(cell(c.deposit));
      withdrawal = c.withdrawal === undefined ? 0n : parseAmountCell(cell(c.withdrawal));
    } catch (e) {
      errors.push({ line, message: e instanceof Error ? e.message : '금액 오류' });
      continue;
    }
    if (deposit === 0n) { if (withdrawal > 0n) withdrawals++; continue; }
    // 잔액은 중복 판별 보조값일 뿐이라 읽지 못하면 비워 둔다(마이너스통장 등).
    try { if (c.balance !== undefined && cell(c.balance) !== '') balance = parseAmountCell(cell(c.balance)); } catch { balance = null; }
    const time = when.time ?? (c.time !== undefined ? parseBankTime(cell(c.time)) : null);
    const counterparty = cell(c.counterparty).replace(/\s+/g, ' ').slice(0, 100);
    const memo = cell(c.memo).slice(0, 200) || null;
    const base = { date: when.date, time, amount: deposit, balance, counterparty };
    const baseKey = bankFingerprint(base, 0);
    const occurrence = seen.get(baseKey) ?? 0;
    seen.set(baseKey, occurrence + 1);
    rows.push({ line, ...base, memo, fingerprint: bankFingerprint(base, occurrence) });
  }
  return { rows, withdrawals, errors };
}

/* ── 후원금 입력 양식(기관이 엑셀로 정리해 올리는 표) ── */

export const MONEY_SHEET_HEADERS = ['수납일', '후원자', '후원자번호', '금액', '수납방법', '기금', '메모'] as const;

const METHOD_LABELS: Record<string, 'BANK_TRANSFER' | 'CASH' | 'CMS' | 'CARD' | 'OTHER'> = {
  계좌이체: 'BANK_TRANSFER', 이체: 'BANK_TRANSFER', 무통장입금: 'BANK_TRANSFER', 입금: 'BANK_TRANSFER',
  현금: 'CASH', cms: 'CMS', CMS: 'CMS', 자동이체: 'CMS', 카드: 'CARD', 신용카드: 'CARD', 기타: 'OTHER',
};

export interface MoneySheetRow {
  line: number;
  receivedOn: string;
  donorName: string | null; // 비우면 익명/미확인
  donorRef: string | null; // 동명이인 구분용(후원자 외부참조번호)
  amount: Won;
  method: 'BANK_TRANSFER' | 'CASH' | 'CMS' | 'CARD' | 'OTHER';
  fundName: string;
  memo: string | null;
}

export function interpretMoneySheet(grid: Grid): { rows: MoneySheetRow[]; errors: RowError[] } {
  let headerRow = -1; let idx: Record<string, number> = {};
  for (let r = 0; r < Math.min(grid.length, 10); r++) {
    const headers = (grid[r] ?? []).map((h) => normalizeHeader(h ?? ''));
    const map: Record<string, number> = {};
    for (const h of MONEY_SHEET_HEADERS) { const i = headers.indexOf(h); if (i >= 0) map[h] = i; }
    if (map['수납일'] !== undefined && map['금액'] !== undefined && map['기금'] !== undefined) { headerRow = r; idx = map; break; }
  }
  if (headerRow < 0) {
    throw new DomainError('VALIDATION_FAILED', `양식의 머리글을 찾지 못했습니다. 첫 줄은 ${MONEY_SHEET_HEADERS.join(', ')} 이어야 합니다(후원자번호·메모는 선택).`);
  }
  const rows: MoneySheetRow[] = [];
  const errors: RowError[] = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (row.every((v) => !v || !v.trim())) continue;
    const line = r + 1;
    const cell = (h: string) => (idx[h] === undefined ? '' : (row[idx[h]!] ?? '').trim());
    const problems: string[] = [];
    const when = parseBankDate(cell('수납일'));
    if (!when) problems.push('수납일(YYYY-MM-DD)');
    let amount = 0n;
    try { amount = parseAmountCell(cell('금액')); if (amount <= 0n) problems.push('금액(0보다 큰 원 단위)'); } catch { problems.push('금액(원 단위 정수)'); }
    const methodText = cell('수납방법');
    const method = methodText === '' ? 'BANK_TRANSFER' : METHOD_LABELS[methodText] ?? METHOD_LABELS[methodText.replace(/\s/g, '')];
    if (!method) problems.push(`수납방법(${Object.keys(METHOD_LABELS).filter((k) => k !== 'cms').join('·')})`);
    const fundName = cell('기금');
    if (!fundName) problems.push('기금');
    if (problems.length) { errors.push({ line, message: `확인 필요: ${problems.join(', ')}` }); continue; }
    rows.push({
      line, receivedOn: when!.date, donorName: cell('후원자') || null, donorRef: cell('후원자번호') || null,
      amount, method: method!, fundName, memo: cell('메모').slice(0, 500) || null,
    });
  }
  return { rows, errors };
}

/**
 * 입금자명 ↔ 후원자 이름 비교 키: 공백, (주)·㈜·주식회사, 괄호 속 덧말을 뺀다.
 * 후보를 보여 줄 때만 쓰고, 같은 키라도 자동으로 연결하거나 병합하지 않는다(동명이인).
 */
export function nameKey(name: string): string {
  return name.replace(/㈜|\(주\)|주식회사/g, '').replace(/\(.*?\)|\[.*?\]/g, '').replace(/[\s.·]/g, '').toLowerCase();
}
