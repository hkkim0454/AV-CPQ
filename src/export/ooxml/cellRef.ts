/** A1 참조 유틸. 견적 양식은 A~K 열만 쓰므로 범위를 좁게 잡는다. */

/** 1 → `A`, 11 → `K`, 27 → `AA`. */
export function columnLetter(index: number): string {
  if (!Number.isInteger(index) || index < 1) {
    throw new RangeError(`열 번호는 1 이상 정수여야 한다: ${index}`);
  }
  let out = '';
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** `A` → 1, `K` → 11. */
export function columnIndex(letter: string): number {
  let out = 0;
  for (const ch of letter.toUpperCase()) {
    const code = ch.charCodeAt(0) - 64;
    if (code < 1 || code > 26) throw new RangeError(`열 이름이 아니다: ${letter}`);
    out = out * 26 + code;
  }
  return out;
}

export function cellRef(column: string, row: number): string {
  return `${column}${row}`;
}

export function rangeRef(
  startColumn: string,
  startRow: number,
  endColumn: string,
  endRow: number,
): string {
  return `${startColumn}${startRow}:${endColumn}${endRow}`;
}

/** 견적 내역 시트가 쓰는 열. */
export const SYSTEM_COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'] as const;
/** 갑지가 쓰는 열. */
export const COVER_COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;

export type SystemColumn = (typeof SYSTEM_COLUMNS)[number];
export type CoverColumn = (typeof COVER_COLUMNS)[number];
