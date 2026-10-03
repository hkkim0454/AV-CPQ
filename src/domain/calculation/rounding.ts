/**
 * 통화 연산과 Excel 절사 의미 (설계서 §5.1, §5.2, §5.5).
 *
 * 화면 계산과 Excel 수식이 같은 결과를 내야 하므로, 여기서 쓰는 함수는 전부
 * 원본 양식에 실제로 등장하는 Excel 함수의 의미를 그대로 구현한다.
 * 일반적인 모든 Excel 함수를 구현하지 않는다.
 */
import Decimal from 'decimal.js';
import type { DecimalText } from '../quote/types';

// 금액 계산에 충분한 정밀도. 중간 계산에서 반올림이 끼어들지 않게 한다.
Decimal.set({ precision: 40, toExpNeg: -40, toExpPos: 40 });

export { Decimal };

/**
 * 10진 문자열을 Decimal로 읽는다.
 *
 * 설계서 §5.6: "가격 미등록 → 0 처리하지 않고 확정 차단".
 * 빈 문자열·null·숫자가 아닌 값을 조용히 0으로 바꾸지 않고 던진다.
 * 미등록은 호출하는 쪽이 `undefined`로 구분해서 다뤄야 한다.
 */
export function dec(value: DecimalText): Decimal {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`금액으로 읽을 수 없는 값: ${JSON.stringify(value)}`);
  }
  const d = new Decimal(value);
  if (!d.isFinite()) {
    throw new TypeError(`유한한 수가 아님: ${value}`);
  }
  return d;
}

/** 미등록(`undefined`)과 명시적 0을 구분해서 읽는다. */
export function decOrUndefined(value: DecimalText | undefined): Decimal | undefined {
  return value === undefined ? undefined : dec(value);
}

export const ZERO = new Decimal(0);

export function isZero(value: Decimal): boolean {
  return value.isZero();
}

export function add(a: DecimalText | Decimal, b: DecimalText | Decimal): Decimal {
  return toD(a).plus(toD(b));
}

export function sub(a: DecimalText | Decimal, b: DecimalText | Decimal): Decimal {
  return toD(a).minus(toD(b));
}

export function mul(a: DecimalText | Decimal, b: DecimalText | Decimal): Decimal {
  return toD(a).times(toD(b));
}

export function sum(values: Array<DecimalText | Decimal>): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(toD(v)), ZERO);
}

function toD(v: DecimalText | Decimal): Decimal {
  return v instanceof Decimal ? v : dec(v);
}

/**
 * Excel `INT(n)` — 음의 무한대 방향으로 내린다.
 *
 * 설계서 §5.2: "INT는 음수에서 단순 소수점 버림과 다르다."
 * `INT(-1.5) = -2`이고 `TRUNC(-1.5) = -1`이다. 원본의 간접비·노무단가 수식이
 * 전부 INT를 쓰므로 여기서도 INT 의미를 쓴다.
 */
export function excelInt(value: DecimalText | Decimal): Decimal {
  return toD(value).floor();
}

/**
 * Excel `ROUNDDOWN(n, digits)` — **0 방향**으로 버린다.
 *
 * 갑지 `H16 = ROUNDDOWN(SUM(H11:H15),-4)` — 만원 미만 절사에 쓴다.
 * INT와 달리 음수에서 0 쪽으로 간다.
 */
export function roundDown(value: DecimalText | Decimal, digits: number): Decimal {
  const d = toD(value);
  if (!Number.isInteger(digits)) {
    throw new TypeError(`digits는 정수여야 한다: ${digits}`);
  }
  // digits=-4 → 10^4 단위로 버린다. digits=2 → 소수 둘째 자리까지 남긴다.
  const factor = new Decimal(10).pow(-digits);
  return d.div(factor).trunc().times(factor);
}

/** 화면·직렬화용 문자열. 지수 표기를 쓰지 않는다. */
export function text(value: Decimal): DecimalText {
  return value.toFixed();
}

/** 금액 표시 — 천 단위 구분. 원 단위 정수로 가정한다. */
export function formatKRW(value: Decimal | DecimalText): string {
  const d = toD(value);
  const neg = d.isNegative();
  const digits = d.abs().toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? `-${digits}` : digits;
}
