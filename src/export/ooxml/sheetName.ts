/**
 * Excel 시트명 정규화와 수식 참조 escaping (설계서 §9.3).
 *
 * 사용자가 시스템 이름을 자유 입력하므로 금지 문자·31자 초과·중복이 반드시 들어온다.
 * 이것을 거르지 않으면 Excel이 통합문서를 "복구 필요"로 열거나, 갑지의 시스템 참조가
 * 조용히 `#REF!`가 된다.
 *
 * 원본 시트 `LED Display `는 **끝 공백이 있다**. Excel은 끝 공백 시트명을 허용하고
 * 원본이 실제로 그렇게 저장돼 있으므로, 잘라내지 않고 보존한다 (mapping.md R5).
 */

export const MAX_SHEET_NAME_LENGTH = 31;

/** Excel이 시트명에 허용하지 않는 문자. */
const FORBIDDEN_CHARS = /[:\\/?*[\]]/g;

/** Excel 예약 시트명. 대소문자를 가리지 않는다. */
const RESERVED = new Set(['history']);

const FALLBACK = '시트';

/**
 * 시트명 하나를 Excel이 받아들이는 형태로 바꾼다.
 *
 * 중복 해소는 하지 않는다 — 전체 목록을 알아야 하므로 `assignSheetNames`가 한다.
 */
export function normalizeSheetName(raw: string): string {
  let name = raw.replace(FORBIDDEN_CHARS, '_');

  // Excel은 작은따옴표로 시작하거나 끝나는 시트명을 거부한다.
  // (끝 공백은 허용하므로 여기서 trim 하지 않는다.)
  if (name.startsWith("'")) name = `_${name.slice(1)}`;
  if (name.endsWith("'")) name = `${name.slice(0, -1)}_`;

  if (name.length > MAX_SHEET_NAME_LENGTH) {
    name = name.slice(0, MAX_SHEET_NAME_LENGTH);
    // 자른 결과가 다시 작은따옴표로 끝날 수 있다.
    if (name.endsWith("'")) name = `${name.slice(0, -1)}_`;
  }

  if (name.trim() === '') {
    name = FALLBACK;
  }

  if (RESERVED.has(name.toLowerCase())) {
    name = `${name}_`;
  }

  return name;
}

/** Excel의 시트명 동일성 판정 — 대소문자를 구분하지 않는다. */
function key(name: string): string {
  return name.toLowerCase();
}

/**
 * 시스템 이름 목록을 통합문서 안에서 유일한 시트명으로 바꾼다.
 *
 * @param rawNames  사용자가 지은 시스템 이름. 입력 순서가 곧 시트 순서다.
 * @param reserved  이미 통합문서에 있는 시트명 (`갑지` 등).
 * @returns `rawNames`와 같은 길이·순서의 시트명 배열.
 */
export function assignSheetNames(
  rawNames: readonly string[],
  reserved: readonly string[] = [],
): string[] {
  const taken = new Set(reserved.map(key));
  const result: string[] = [];

  for (const raw of rawNames) {
    const base = normalizeSheetName(raw);
    let candidate = base;
    let counter = 2;

    while (taken.has(key(candidate))) {
      const suffix = ` (${counter})`;
      const room = MAX_SHEET_NAME_LENGTH - suffix.length;
      candidate = `${base.length > room ? base.slice(0, room) : base}${suffix}`;
      counter += 1;
    }

    taken.add(key(candidate));
    result.push(candidate);
  }

  return result;
}

/**
 * 수식 안에서 쓸 시트 참조를 만든다.
 *
 * 항상 작은따옴표로 감싼다. Excel은 불필요한 따옴표를 허용하고, 감싸지 않아도 되는
 * 조건(영문·숫자·밑줄로만 이루어지고 숫자로 시작하지 않으며 셀 주소와 겹치지 않을 것)을
 * 매번 판정하는 것보다 항상 감싸는 쪽이 안전하다.
 *
 * 이름 안의 작은따옴표는 두 번 써서 escape한다.
 */
export function quoteSheetRef(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}
