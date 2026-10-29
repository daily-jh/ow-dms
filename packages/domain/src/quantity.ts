import { DomainError } from './errors';

/**
 * 수량은 소수 3자리 고정소수(1/1000 단위 bigint)로 다룬다. DB는 numeric(18,3).
 * 서로 다른 단위의 수량은 이 타입끼리라도 직접 합산하지 않는다(호출부에서 단위 확인).
 */
export type Qty = bigint;
export const QTY_SCALE = 1000n;

const QTY_PATTERN = /^-?\d{1,15}(\.\d{1,3})?$/;

export function parseQty(value: string | number | bigint, field = 'quantity'): Qty {
  if (typeof value === 'bigint') return value;
  const text = typeof value === 'number' ? String(value) : value.trim();
  if (!QTY_PATTERN.test(text)) {
    throw new DomainError('INVALID_QUANTITY', '수량 형식이 올바르지 않습니다.', { [field]: '소수 3자리 이내 숫자' });
  }
  const negative = text.startsWith('-');
  const [intPart, frac = ''] = (negative ? text.slice(1) : text).split('.');
  const scaled = BigInt(intPart!) * QTY_SCALE + BigInt(frac.padEnd(3, '0'));
  return negative ? -scaled : scaled;
}

export function parsePositiveQty(value: string | number | bigint, field = 'quantity'): Qty {
  const q = parseQty(value, field);
  if (q <= 0n) throw new DomainError('INVALID_QUANTITY', '수량은 0보다 커야 합니다.', { [field]: '0보다 큰 값' });
  return q;
}

export function formatQty(q: Qty): string {
  const negative = q < 0n;
  const abs = negative ? -q : q;
  const intPart = abs / QTY_SCALE;
  const frac = (abs % QTY_SCALE).toString().padStart(3, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${intPart}${frac ? `.${frac}` : ''}`;
}
