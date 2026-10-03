/**
 * Excel `NUMBERSTRING(n, 1)`과 같은 한글 금액 문자열 (설계서 §9.4).
 *
 * Excel 파일에는 `NUMBERSTRING` **수식을 그대로** 넣는다. 금액을 고치면 한글 금액도
 * 따라 바뀌어야 하고, 정적 문자열로 바꾸면 그 연동이 끊기기 때문이다 (§9.4).
 * 이 구현은 두 군데에 쓴다.
 *   1. 웹 화면의 금액 문구 표시
 *   2. Excel 셀의 **캐시 값** — 재계산 전에도 올바른 문구가 보이도록
 *
 * 기대값은 Microsoft 365 Excel 16.0 ko-KR에서 측정해 `tests/unit/koreanAmount.test.ts`에
 * 고정했다. `NUMBERSTRING`은 문서화되지 않은 함수라 추측으로 구현하지 않았다.
 */
import { dec } from '../../domain/calculation/rounding';
import type { DecimalText } from '../../domain/quote/types';

const DIGITS = ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'] as const;
/** 4자리 안에서 쓰는 자리 이름. */
const SMALL_UNITS = ['', '십', '백', '천'] as const;
/** 4자리 묶음의 자리 이름. */
const GROUP_UNITS = ['', '만', '억', '조', '경'] as const;

/**
 * 0~9999를 한글로 바꾼다.
 *
 * Excel과 같게, 앞자리가 1이어도 `일`을 생략하지 않는다 — `10 → 일십`, `100 → 일백`.
 */
function groupToKorean(value: number): string {
  let out = '';
  for (let position = SMALL_UNITS.length - 1; position >= 0; position -= 1) {
    const digit = Math.floor(value / 10 ** position) % 10;
    if (digit === 0) continue;
    out += DIGITS[digit] + SMALL_UNITS[position];
  }
  return out;
}

/**
 * Excel `NUMBERSTRING(n, 1)`.
 *
 * 정수부만 읽는다. 음수는 견적 금액에 쓰지 않으므로 던진다.
 */
export function numberString(amount: DecimalText): string {
  const value = dec(amount).trunc();
  if (value.isNegative()) {
    throw new RangeError(`한글 금액은 음수를 받지 않는다: ${amount}`);
  }
  if (value.isZero()) {
    return DIGITS[0];
  }

  const digits = value.toFixed(0);
  // 뒤에서부터 4자리씩 끊는다.
  const groups: number[] = [];
  for (let end = digits.length; end > 0; end -= 4) {
    groups.push(Number.parseInt(digits.slice(Math.max(0, end - 4), end), 10));
  }

  if (groups.length > GROUP_UNITS.length) {
    throw new RangeError(`한글 금액으로 표현할 수 있는 범위를 넘었다: ${amount}`);
  }

  let out = '';
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]!;
    if (group === 0) continue;
    out += groupToKorean(group) + GROUP_UNITS[index];
  }
  return out;
}

/** 천 단위 구분 — Excel `TEXT(n,"###,##0")`과 같다. */
function thousands(amount: DecimalText): string {
  const value = dec(amount).trunc();
  const sign = value.isNegative() ? '-' : '';
  return sign + value.abs().toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 갑지 C8의 금액 문구 전체.
 *
 * 원본 수식: `="일금"&NUMBERSTRING(H18,1)&"원정(\"&TEXT(H18,"###,##0")&") V.A.T별도"`
 * `\`(U+005C)는 한국어 Windows에서 ₩로 보인다. 원본 바이트를 그대로 쓴다.
 */
export function koreanAmountSentence(amount: DecimalText): string {
  return `일금${numberString(amount)}원정(\\${thousands(amount)}) V.A.T별도`;
}

/**
 * 갑지 C8에 넣을 Excel 수식.
 *
 * @param finalTotalRef 최종 합계 셀 주소 (`H18` 등).
 */
export function koreanAmountFormula(finalTotalRef: string): string {
  return `"일금"&NUMBERSTRING(${finalTotalRef},1)&"원정(\\"&TEXT(${finalTotalRef},"###,##0")&") V.A.T별도"`;
}
