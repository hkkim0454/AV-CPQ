/**
 * 견적 표 입력 검증 (계획 2026-10-04-quote-workspace-ui Task 2).
 *
 * 빈 수량·음수·잘못된 소수는 원래 문서를 덮어쓰지 않는다 — 화면은 이
 * 함수가 `ok:false`를 돌려주면 reducer를 부르지 않고 그 이유만 입력
 * 옆에 보여준다. 숫자 형식은 배포 스키마의 `decimalText`
 * (`src/data/catalog/schema.ts`)와 같은 규칙이다 — 부호 없는 10진수
 * 문자열만 허용한다.
 */
export type DecimalValidation = { ok: true; value: string } | { ok: false; reason: string };
export type QuantityValidation = DecimalValidation;

const DECIMAL_RE = /^\d+(\.\d+)?$/;

/** `label`은 오류 문구에만 쓴다 — "수량을 입력하세요." / "요율을 입력하세요." */
export function validateDecimalInput(raw: string, label: string): DecimalValidation {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: false, reason: `${label}을(를) 입력하세요.` };
  }
  if (trimmed.startsWith('-')) {
    return { ok: false, reason: `${label}은(는) 음수를 허용하지 않습니다.` };
  }
  if (!DECIMAL_RE.test(trimmed)) {
    return { ok: false, reason: '숫자 형식이 올바르지 않습니다 (예: 1, 1.5).' };
  }
  return { ok: true, value: trimmed };
}

export function validateQuantityInput(raw: string): QuantityValidation {
  return validateDecimalInput(raw, '수량');
}
