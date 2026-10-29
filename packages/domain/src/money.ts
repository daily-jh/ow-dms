import { DomainError } from './errors';

/**
 * 금액은 원 단위 정수(bigint)로만 다룬다. JS number(부동소수점)로 합산하지 않는다.
 * API·DB 경계에서는 10진 문자열로 직렬화한다.
 */
export type Won = bigint;

const WON_PATTERN = /^-?\d{1,18}$/;

export function parseWon(value: string | bigint, field = 'amount'): Won {
  if (typeof value === 'bigint') return value;
  const trimmed = value.trim().replaceAll(',', '');
  if (!WON_PATTERN.test(trimmed)) {
    throw new DomainError('INVALID_AMOUNT', '금액은 원 단위 정수여야 합니다.', { [field]: '원 단위 정수' });
  }
  return BigInt(trimmed);
}

export function parsePositiveWon(value: string | bigint, field = 'amount'): Won {
  const won = parseWon(value, field);
  if (won <= 0n) throw new DomainError('INVALID_AMOUNT', '금액은 0보다 커야 합니다.', { [field]: '0보다 큰 값' });
  return won;
}

export function sumWon(values: readonly Won[]): Won {
  return values.reduce((acc, v) => acc + v, 0n);
}

export function formatWon(value: Won): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${digits}원`;
}
