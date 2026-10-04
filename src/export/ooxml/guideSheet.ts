/**
 * 가이드 템플릿의 세부내역 시트에 **행을 채운다** (계획 2026-10-04 Task 5).
 *
 * ## 서식은 템플릿에서 온다
 *
 * 글꼴·테두리·열너비·행높이는 **하나도 만들지 않는다.** 원본 행의 속성과
 * 셀 스타일 번호를 그대로 베낀다. 품목이 7줄을 넘으면 마지막 품목 행의
 * 서식을 되쓴다 (D17).
 *
 * ## 머리 다섯 줄은 건드리지 않는다
 *
 * 1행 공사명 수식, 2·3행 머리글, 4행 `Ⅰ 직접비` 는 양식 그 자체다.
 * 6행부터 합계 행까지만 새로 쓴다.
 *
 * ## 밀린 만큼 따라가야 하는 것들
 *
 * ```
 * dimension      A1:BP419 → A1:{마지막열}{합계행}
 * mergeCells     A15:C15 같은 본문 병합이 밀린다
 * 인쇄 영역      workbook.xml 의 definedName
 * 갑지 참조      세부내역!K25 → 세부내역!K58
 * ```
 *
 * 하나라도 빠지면 금액이 틀리거나 복구 경고가 뜬다.
 */
import { strFromU8, strToU8 } from 'fflate';

import type { GuideSheetLayout, PlannedRow } from './guideLayout';
import { GuideLayoutError } from './guideLayout';

/** 셀 하나에 넣을 것. 셋 중 하나만 쓴다. */
export type CellValue =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: string }
  | { kind: 'formula'; value: string }
  | { kind: 'blank' };

export const text = (value: string): CellValue => ({ kind: 'text', value });
export const num = (value: string): CellValue => ({ kind: 'number', value });
export const formula = (value: string): CellValue => ({ kind: 'formula', value });
export const blank: CellValue = { kind: 'blank' };

/** 한 행에 채울 내용. 열 **글자**를 열쇠로 쓴다. */
export type RowContent = ReadonlyMap<string, CellValue>;

export interface FillSheetInput {
  /** 정리된 템플릿의 세부내역 시트 XML. */
  sheetXml: string;
  layout: GuideSheetLayout;
  /** 계획된 행 → 그 행에 채울 내용. */
  contentByRow: ReadonlyMap<number, RowContent>;
}

const XML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => XML_ESCAPE[ch]!);
}

function columnOf(ref: string): string {
  return ref.replace(/\d+$/, '');
}

function rowOf(ref: string): number {
  return Number.parseInt(ref.replace(/^[A-Z]+/, ''), 10);
}

/** 자기닫기 꼴을 **먼저** 둔다 — 뒤에 두면 빈 요소가 다음 요소까지 삼킨다. */
const ROW_RE = /<row [^>]*\/>|<row [^>]*>[\s\S]*?<\/row>/g;
const CELL_RE = /<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g;

interface TemplateRow {
  /** `<row …>` 의 속성 문자열. 행 높이와 서식이 여기 있다. */
  attrs: string;
  /** 열 글자 → 스타일 번호. */
  styleByColumn: Map<string, string>;
}

function readTemplateRows(sheetData: string): Map<number, TemplateRow> {
  const out = new Map<number, TemplateRow>();
  for (const match of sheetData.matchAll(ROW_RE)) {
    const block = match[0];
    const attrs = /<row ([^>]*?)\/?>/.exec(block)?.[1] ?? '';
    const rowNumber = Number.parseInt(/\br="(\d+)"/.exec(attrs)?.[1] ?? '', 10);
    if (Number.isNaN(rowNumber)) continue;
    const styleByColumn = new Map<string, string>();
    for (const cell of block.matchAll(CELL_RE)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(cell[0])?.[1];
      if (ref === undefined) continue;
      const style = /\bs="(\d+)"/.exec(cell[0])?.[1];
      if (style !== undefined) styleByColumn.set(columnOf(ref), style);
    }
    out.set(rowNumber, { attrs, styleByColumn });
  }
  return out;
}

/** 행 속성에서 `r=` 만 새 번호로 바꾼다. 높이·서식은 그대로 둔다. */
function rowAttrsFor(template: TemplateRow | undefined, row: number): string {
  if (template === undefined) return `r="${row}"`;
  return template.attrs.replace(/\br="\d+"/, `r="${row}"`).trim();
}

function renderCell(ref: string, style: string | undefined, value: CellValue): string {
  const styleAttr = style === undefined ? '' : ` s="${style}"`;
  switch (value.kind) {
    case 'blank':
      return `<c r="${ref}"${styleAttr}/>`;
    case 'number':
      return `<c r="${ref}"${styleAttr}><v>${escapeXml(value.value)}</v></c>`;
    case 'text':
      // 인라인 문자열을 쓴다. 공유 문자열 표를 다시 쓰면 색인이 전부 밀린다.
      return (
        `<c r="${ref}"${styleAttr} t="inlineStr">` +
        `<is><t xml:space="preserve">${escapeXml(value.value)}</t></is></c>`
      );
    case 'formula':
      // 캐시된 결과를 넣지 않는다. 통합문서에 "열 때 다시 계산" 표시가 있다.
      return `<c r="${ref}"${styleAttr}><f>${escapeXml(value.value)}</f></c>`;
  }
}

function renderRow(
  planned: PlannedRow,
  templates: Map<number, TemplateRow>,
  content: RowContent | undefined,
): string {
  const template = templates.get(planned.styleFromRow);
  const attrs = rowAttrsFor(template, planned.row);

  // 서식이 있는 칸은 **값이 없어도** 내보낸다. 빼면 테두리가 사라진다.
  const columns = new Set<string>([
    ...(template?.styleByColumn.keys() ?? []),
    ...(content?.keys() ?? []),
  ]);
  if (columns.size === 0) return `<row ${attrs}/>`;

  const sorted = [...columns].sort((a, b) => {
    const index = (letter: string): number =>
      [...letter].reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
    return index(a) - index(b);
  });

  const cells = sorted
    .map((column) =>
      renderCell(
        `${column}${planned.row}`,
        template?.styleByColumn.get(column),
        content?.get(column) ?? blank,
      ),
    )
    .join('');
  return `<row ${attrs}>${cells}</row>`;
}

/** 병합 범위 `A15:C15` 를 밀린 만큼 옮긴다. */
function shiftMerge(ref: string, shiftOf: (row: number) => number): string | undefined {
  const parts = ref.split(':');
  if (parts.length !== 2) return ref;
  const [start, end] = parts as [string, string];
  const startRow = rowOf(start);
  const endRow = rowOf(end);
  const newStart = shiftOf(startRow);
  const newEnd = shiftOf(endRow);
  if (newStart <= 0 || newEnd <= 0) return undefined; // 사라진 행의 병합
  return `${columnOf(start)}${newStart}:${columnOf(end)}${newEnd}`;
}

export function fillGuideSheet(input: FillSheetInput): string {
  const { sheetXml, layout } = input;

  const dataMatch = /<sheetData>[\s\S]*?<\/sheetData>|<sheetData\/>/.exec(sheetXml);
  if (dataMatch === null) {
    throw new GuideLayoutError('세부내역 시트에 sheetData 가 없다.');
  }
  const sheetData = dataMatch[0];
  const templates = readTemplateRows(sheetData);

  // 머리 다섯 줄은 양식 그 자체다. 그대로 둔다.
  const headRows: string[] = [];
  for (const match of sheetData.matchAll(ROW_RE)) {
    const rowNumber = Number.parseInt(
      /\br="(\d+)"/.exec(match[0])?.[1] ?? '',
      10,
    );
    if (!Number.isNaN(rowNumber) && rowNumber < layout.firstBodyRow) {
      headRows.push(match[0]);
    }
  }

  const bodyRows = layout.rows.map((planned) =>
    renderRow(planned, templates, input.contentByRow.get(planned.row)),
  );

  let out = sheetXml.replace(
    dataMatch[0],
    `<sheetData>${headRows.join('')}${bodyRows.join('')}</sheetData>`,
  );

  // --- dimension ---
  const lastColumn = layout.printArea.split(':')[1]!.replace(/\d+$/, '');
  const widest = [lastColumn, layout.column('tradeLast')].sort((a, b) =>
    a.length === b.length ? a.localeCompare(b) : a.length - b.length,
  );
  out = out.replace(
    /<dimension ref="[^"]*"\/>/,
    `<dimension ref="A1:${widest[widest.length - 1]}${layout.grandTotalRow}"/>`,
  );

  // --- 병합 ---
  // 본문 행이 밀리면 `A15:C15`(직접비계) 같은 병합도 따라가야 한다.
  // 안 따라가면 직접비계 글자가 한 칸에만 남고 테두리가 어긋난다.
  const base = layout;
  const originalDirect = base.directSubtotalRow - base.shift;
  const shiftOf = (row: number): number =>
    row >= originalDirect ? row + base.shift : row;

  out = out.replace(/<mergeCells[^>]*>[\s\S]*?<\/mergeCells>/, (block) => {
    const refs: string[] = [];
    for (const merge of block.matchAll(/<mergeCell ref="([^"]*)"\/>/g)) {
      const shifted = shiftMerge(merge[1]!, shiftOf);
      if (shifted !== undefined) refs.push(shifted);
    }
    if (refs.length === 0) return '';
    return (
      `<mergeCells count="${refs.length}">` +
      refs.map((ref) => `<mergeCell ref="${ref}"/>`).join('') +
      '</mergeCells>'
    );
  });

  return out;
}

export function fillGuideSheetBytes(
  sheet: Uint8Array,
  layout: GuideSheetLayout,
  contentByRow: ReadonlyMap<number, RowContent>,
): Uint8Array {
  return strToU8(
    fillGuideSheet({ sheetXml: strFromU8(sheet), layout, contentByRow }),
  );
}

/**
 * 인쇄 영역 정의를 새 마지막 행으로 고친다.
 *
 * 품목이 늘었는데 인쇄 영역이 그대로면 **합계가 인쇄물에서 잘린다.**
 */
export function updatePrintArea(
  workbookXml: string,
  detailSheetName: string,
  layout: GuideSheetLayout,
): string {
  const quoted = detailSheetName.replace(/'/g, "''");
  return workbookXml.replace(
    /<definedName name="_xlnm\.Print_Area" localSheetId="1">[^<]*<\/definedName>/,
    () => {
      const [start, end] = layout.printArea.split(':') as [string, string];
      const area = `$${start.replace(/(\d+)/, '$$$1')}:$${end.replace(/(\d+)/, '$$$1')}`;
      return (
        `<definedName name="_xlnm.Print_Area" localSheetId="1">` +
        `${/[\s']/.test(detailSheetName) ? `'${quoted}'` : detailSheetName}!${area}` +
        `</definedName>`
      );
    },
  );
}
