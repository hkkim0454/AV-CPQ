/**
 * 열을 **실제로 지운다** (계획 2026-10-04 Task 5, 결정 D18).
 *
 * ## 안 쓰는 것과 없는 것은 다르다
 *
 * 품목 행에 값을 안 쓰는 것으로는 부족하다. 템플릿의 **머리글과 3행 노임**이
 * 그대로 남기 때문이다. 실측으로 고객용 파일에서 이것들이 나왔다.
 *
 * ```
 * D2  설   명
 * M2  제조사/구매처     N2  영업비고
 * T2~AZ2  직종 이름 17개
 * U3~BA3  하반기 노임 324,979 / 304,662 / 316,875 …
 * ```
 *
 * 인쇄 영역 밖이라 눈에 안 보일 뿐 파일에는 있다. 평택 원본 감사에서
 * 인쇄 영역 밖 58칸의 내부 메모가 나온 것과 같은 자리다.
 *
 * ## 지우면 뒤가 당겨진다
 *
 * 열을 빼면 그 오른쪽이 한 칸씩 왼쪽으로 온다. 수식의 열 글자, 병합 범위,
 * 열 너비, 인쇄 영역, dimension 이 **전부** 따라가야 한다. 하나라도 빠지면
 * 금액이 엉뚱한 칸을 가리키거나 `#REF!` 가 된다.
 */
import { GuideLayoutError } from './guideLayout';

export function columnIndex(name: string): number {
  let out = 0;
  for (const ch of name) out = out * 26 + (ch.charCodeAt(0) - 64);
  return out;
}

export function columnName(index: number): string {
  let out = '';
  let rest = index;
  while (rest > 0) {
    const rem = (rest - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    rest = Math.floor((rest - 1) / 26);
  }
  return out;
}

/** 지울 열 → 남는 열의 새 번호. 지운 열은 `undefined`. */
export function buildColumnMap(
  deleted: ReadonlySet<number>,
  maxColumn: number,
): Map<number, number | undefined> {
  const map = new Map<number, number | undefined>();
  let next = 1;
  for (let index = 1; index <= maxColumn; index += 1) {
    if (deleted.has(index)) {
      map.set(index, undefined);
      continue;
    }
    map.set(index, next);
    next += 1;
  }
  return map;
}

/** 문자열 리터럴은 건드리지 않는다 — `IFERROR(…,"-")` 안을 옮기면 안 된다. */
const STRING_RE = /"[^"]*"/g;
const A1_RE = /(\$?)([A-Z]{1,3})(\$?)(\d{1,7})/g;

/**
 * 수식의 열 참조를 옮긴다.
 *
 * 지워진 열을 가리키던 참조는 `#REF!` 로 바꾼다. 그대로 두면 **엉뚱한 칸**을
 * 가리키게 되고, 그건 조용히 틀린 금액이 된다. `#REF!` 는 최소한 보인다.
 */
export function remapFormulaColumns(
  formula: string,
  map: ReadonlyMap<number, number | undefined>,
): string {
  const shift = (segment: string): string =>
    segment.replace(A1_RE, (whole, colAbs: string, col: string, rowAbs: string, row: string) => {
      const index = columnIndex(col);
      if (!map.has(index)) return whole;
      const moved = map.get(index);
      if (moved === undefined) return '#REF!';
      return `${colAbs}${columnName(moved)}${rowAbs}${row}`;
    });

  const out: string[] = [];
  let last = 0;
  STRING_RE.lastIndex = 0;
  for (const literal of formula.matchAll(STRING_RE)) {
    out.push(shift(formula.slice(last, literal.index)));
    out.push(literal[0]);
    last = literal.index + literal[0].length;
  }
  out.push(shift(formula.slice(last)));
  return out.join('');
}

/** 자기닫기 꼴을 **먼저** 둔다 — 뒤에 두면 빈 요소가 다음 요소까지 삼킨다. */
const CELL_RE = /<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g;
const ROW_RE = /<row [^>]*\/>|<row [^>]*>[\s\S]*?<\/row>/g;

function refOf(block: string): string | undefined {
  return /\br="([A-Z]+\d+)"/.exec(block)?.[1];
}

function splitRef(ref: string): { column: string; row: string } {
  const match = /^([A-Z]+)(\d+)$/.exec(ref)!;
  return { column: match[1]!, row: match[2]! };
}

export interface DeleteColumnsInput {
  sheetXml: string;
  /** 지울 열 번호(1부터). */
  deleted: ReadonlySet<number>;
  /** 시트에서 다룰 마지막 열. 보통 템플릿의 마지막 쓰인 열이다. */
  maxColumn: number;
  /** 지운 뒤의 인쇄 영역 마지막 행. */
  lastRow: number;
}

export function deleteSheetColumns(input: DeleteColumnsInput): {
  sheetXml: string;
  map: Map<number, number | undefined>;
  lastColumn: number;
} {
  const map = buildColumnMap(input.deleted, input.maxColumn);
  let lastColumn = 0;
  for (const moved of map.values()) {
    if (moved !== undefined && moved > lastColumn) lastColumn = moved;
  }
  if (lastColumn === 0) {
    throw new GuideLayoutError('열을 전부 지울 수는 없다.');
  }

  let out = input.sheetXml;

  // --- 셀: 지워진 열은 버리고, 남는 열은 새 주소로 ---
  out = out.replace(ROW_RE, (rowBlock) => {
    const head = /<row [^>]*?>/.exec(rowBlock)?.[0] ?? '';
    if (head === '') return rowBlock;

    const cells: string[] = [];
    for (const match of rowBlock.matchAll(CELL_RE)) {
      const block = match[0];
      const ref = refOf(block);
      if (ref === undefined) continue;
      const { column, row } = splitRef(ref);
      const moved = map.get(columnIndex(column));
      if (moved === undefined) continue; // 지워진 열

      let moved_block = block.replace(
        /\br="[A-Z]+\d+"/,
        `r="${columnName(moved)}${row}"`,
      );
      moved_block = moved_block.replace(
        /<f([^>]*)>([\s\S]*?)<\/f>/,
        (_whole, attrs: string, body: string) =>
          `<f${attrs}>${remapFormulaColumns(body, map)}</f>`,
      );
      cells.push(moved_block);
    }

    // `spans` 는 이 행이 쓰는 열 범위다. 안 고치면 Excel 이 복구를 요구한다.
    const open = (head.endsWith('/>') ? head.slice(0, -2) + '>' : head).replace(
      /\bspans="[^"]*"/,
      `spans="1:${lastColumn}"`,
    );
    if (cells.length === 0) {
      return open.replace(/>$/, '/>');
    }
    return `${open}${cells.join('')}</row>`;
  });

  // --- 열 너비 ---
  out = out.replace(/<cols>[\s\S]*?<\/cols>/, (block) => {
    const kept: string[] = [];
    for (const col of block.matchAll(/<col [^>]*\/>/g)) {
      const min = Number.parseInt(/\bmin="(\d+)"/.exec(col[0])?.[1] ?? '', 10);
      const max = Number.parseInt(/\bmax="(\d+)"/.exec(col[0])?.[1] ?? '', 10);
      if (Number.isNaN(min) || Number.isNaN(max)) continue;
      // 한 묶음이 여러 열을 덮는다. 살아남은 열만 추려 다시 묶는다.
      const survivors: number[] = [];
      for (let index = min; index <= max; index += 1) {
        const moved = map.get(index);
        if (moved !== undefined) survivors.push(moved);
      }
      if (survivors.length === 0) continue;
      kept.push(
        col[0]
          .replace(/\bmin="\d+"/, `min="${survivors[0]}"`)
          .replace(/\bmax="\d+"/, `max="${survivors[survivors.length - 1]}"`),
      );
    }
    return kept.length === 0 ? '' : `<cols>${kept.join('')}</cols>`;
  });

  // --- 병합 ---
  out = out.replace(/<mergeCells[^>]*>[\s\S]*?<\/mergeCells>/, (block) => {
    const refs: string[] = [];
    for (const merge of block.matchAll(/<mergeCell ref="([^"]*)"\/>/g)) {
      const parts = (merge[1] ?? '').split(':');
      if (parts.length !== 2) continue;
      const start = splitRef(parts[0]!);
      const end = splitRef(parts[1]!);
      // 범위 안에서 살아남은 열만 본다. 전부 지워졌으면 병합도 사라진다.
      const survivors: number[] = [];
      for (let index = columnIndex(start.column); index <= columnIndex(end.column); index += 1) {
        const moved = map.get(index);
        if (moved !== undefined) survivors.push(moved);
      }
      if (survivors.length < 2) continue; // 한 칸짜리는 병합이 아니다
      refs.push(
        `${columnName(survivors[0]!)}${start.row}:` +
          `${columnName(survivors[survivors.length - 1]!)}${end.row}`,
      );
    }
    return refs.length === 0
      ? ''
      : `<mergeCells count="${refs.length}">` +
          refs.map((ref) => `<mergeCell ref="${ref}"/>`).join('') +
          '</mergeCells>';
  });

  // --- dimension ---
  out = out.replace(
    /<dimension ref="[^"]*"\/>/,
    `<dimension ref="A1:${columnName(lastColumn)}${input.lastRow}"/>`,
  );

  return { sheetXml: out, map, lastColumn };
}

/**
 * 안 쓰이는 공유 문자열을 버리고 색인을 다시 매긴다.
 *
 * ## 칸을 지워도 글자는 남는다
 *
 * 열을 지우면 `<c t="s"><v>37</v></c>` 같은 셀이 사라지지만, 37번 자리의
 * **문자열 자체는 공유 문자열 표에 그대로** 있다. 실측으로 고객용 파일에서
 * `제조사/구매처` 와 `영업비고` 가 거기서 나왔다. 시트에는 없는데 파일에는
 * 있는 것이다 — 평택 원본 감사에서 인쇄 영역 밖 메모가 나온 것과 같은 종류다.
 *
 * @returns 바뀐 파트만. 공유 문자열 표가 없으면 빈 객체.
 */
export function pruneSharedStrings(
  parts: Readonly<Record<string, string>>,
): Record<string, string> {
  const table = parts['xl/sharedStrings.xml'];
  if (table === undefined) return {};

  const entries = [...table.matchAll(/<si(?:\s[^>]*)?>[\s\S]*?<\/si>|<si\s*\/>/g)].map(
    (m) => m[0],
  );
  if (entries.length === 0) return {};

  const sheetNames = Object.keys(parts).filter((name) =>
    /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
  );

  // `t="s"` 셀이 가리키는 색인만 모은다.
  const used = new Set<number>();
  const cellRe = /<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g;
  for (const name of sheetNames) {
    for (const cell of parts[name]!.matchAll(cellRe)) {
      if (!/\bt="s"/.test(cell[0])) continue;
      const index = Number.parseInt(/<v>(\d+)<\/v>/.exec(cell[0])?.[1] ?? '', 10);
      if (!Number.isNaN(index)) used.add(index);
    }
  }

  const order = [...used].sort((a, b) => a - b);
  const remap = new Map(order.map((old, next) => [old, next]));

  const out: Record<string, string> = {};
  for (const name of sheetNames) {
    out[name] = parts[name]!.replace(cellRe, (cell) => {
      if (!/\bt="s"/.test(cell)) return cell;
      const index = Number.parseInt(/<v>(\d+)<\/v>/.exec(cell)?.[1] ?? '', 10);
      const moved = remap.get(index);
      if (moved === undefined) return cell;
      return cell.replace(/<v>\d+<\/v>/, `<v>${moved}</v>`);
    });
  }

  const kept = order.map((index) => entries[index] ?? '<si><t></t></si>').join('');
  out['xl/sharedStrings.xml'] =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
    ` count="${order.length}" uniqueCount="${order.length}">${kept}</sst>`;
  return out;
}
