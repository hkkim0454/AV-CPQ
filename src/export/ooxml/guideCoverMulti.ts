/**
 * 갑지의 시스템 한 줄(11행)을 **여러 줄로 늘린다** (계획 2026-10-04 P1-5
 * 다중/혼합 시스템).
 *
 * ## 갑지 원본은 시스템 한 줄짜리 예시다
 *
 * 네 가이드 전부 같은 모양이다(실측으로 확인):
 *
 * ```
 *  10  Ⅰ 구역명                              ← 그룹 머리글
 *  11  1 시스템명 규격 단위 수량 =세부내역!M25 =F11*G11   ← 시스템 한 줄
 *  12    합계                      =ROUNDDOWN(SUM(H11:H11),-3)
 * 13~21  빈 줄·비고 박스
 * ```
 *
 * 세부내역이 품목 줄 수만큼 밀리는 것과 같은 이치로, 시스템이 늘면
 * **11행부터 밀어야 한다.** 11행의 서식을 그대로 복제해 쓴다(D17 —
 * 새 서식을 짓지 않고 기존 행의 서식을 확장한다). 12행 이후는 전부
 * `shift`(= 시스템 수 - 1) 만큼 내려가고, 12행의 SUM 범위도 늘어난
 * 시스템 줄을 전부 덮도록 다시 쓴다.
 */
import { GuideLayoutError } from './guideLayout';

/** 모든 가이드 템플릿이 공유하는 갑지 고정 구조(실측, `docs/template/verification.md`). */
const FIRST_SYSTEM_ROW = 11;
const SUBTOTAL_ROW = 12;

export interface CoverSystemEntry {
  name: string;
  summarySpec: string;
  unit: string;
  quantity: string;
  /** `'세부내역2'!M25` 꼴 — 이미 시트 이름까지 합쳐진 완성된 참조. */
  totalReference: string;
}

export interface CoverMultiSystemResult {
  sheetXml: string;
  /** 시스템이 늘어난 만큼 아래로 밀린 행 수. 시스템 1개면 0이다. */
  shift: number;
  /** 밀린 뒤의 합계 행. */
  subtotalRow: number;
  /** 시스템이 실제로 채워진 행 번호들. */
  systemRows: readonly number[];
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

const ROW_RE = /<row [^>]*\/>|<row [^>]*>[\s\S]*?<\/row>/g;
const CELL_RE = /<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g;

function columnOf(ref: string): string {
  return ref.replace(/\d+$/, '');
}
function rowOf(ref: string): number {
  return Number.parseInt(ref.replace(/^[A-Z]+/, ''), 10);
}

interface TemplateRow {
  styleByColumn: Map<string, string>;
}

function readRow(rowBlock: string): TemplateRow {
  const styleByColumn = new Map<string, string>();
  for (const cell of rowBlock.matchAll(CELL_RE)) {
    const ref = /\br="([A-Z]+\d+)"/.exec(cell[0])?.[1];
    if (ref === undefined) continue;
    const style = /\bs="(\d+)"/.exec(cell[0])?.[1];
    if (style !== undefined) styleByColumn.set(columnOf(ref), style);
  }
  return { styleByColumn };
}

function renderCell(
  ref: string,
  style: string | undefined,
  value: { kind: 'text' | 'number' | 'formula'; value: string } | undefined,
): string {
  const styleAttr = style === undefined ? '' : ` s="${style}"`;
  if (value === undefined) return `<c r="${ref}"${styleAttr}/>`;
  switch (value.kind) {
    case 'number':
      return `<c r="${ref}"${styleAttr}><v>${escapeXml(value.value)}</v></c>`;
    case 'text':
      return (
        `<c r="${ref}"${styleAttr} t="inlineStr">` +
        `<is><t xml:space="preserve">${escapeXml(value.value)}</t></is></c>`
      );
    case 'formula':
      return `<c r="${ref}"${styleAttr}><f>${escapeXml(value.value)}</f></c>`;
  }
}

/**
 * 갑지 시트에 시스템을 여러 줄로 채운다.
 *
 * `systems` 가 1개면 `shift` 가 0이고 결과는 기존 단일 시스템 처리와
 * 동일하다 — 이 함수가 단일 시스템의 상위집합이다.
 */
export function fillCoverMultiSystem(
  sheetXml: string,
  systems: readonly CoverSystemEntry[],
): CoverMultiSystemResult {
  if (systems.length === 0) {
    throw new GuideLayoutError('갑지에 넣을 시스템이 하나도 없다.');
  }

  const rows = [...sheetXml.matchAll(ROW_RE)].map((m) => ({
    row: Number.parseInt(/\br="(\d+)"/.exec(m[0])?.[1] ?? '', 10),
    block: m[0],
  }));

  const templateRowBlock = rows.find((r) => r.row === FIRST_SYSTEM_ROW)?.block;
  if (templateRowBlock === undefined) {
    throw new GuideLayoutError(`갑지 ${FIRST_SYSTEM_ROW}행(시스템 줄)을 찾지 못했다.`);
  }
  const template = readRow(templateRowBlock);
  const rowAttrsTemplate =
    /<row ([^>]*?)\/?>/.exec(templateRowBlock)?.[1]?.replace(/\br="\d+"/, '').trim() ?? '';

  const shift = systems.length - 1;

  // --- 시스템 줄들(11 ~ 11+shift) ---
  const systemRows = systems.map((_, index) => FIRST_SYSTEM_ROW + index);
  const systemRowXml = systems
    .map((system, index) => {
      const row = systemRows[index]!;
      const cells: Array<[string, { kind: 'text' | 'number' | 'formula'; value: string }]> = [
        ['B', { kind: 'number', value: String(index + 1) }],
        ['C', { kind: 'text', value: system.name }],
        ['D', { kind: 'text', value: system.summarySpec }],
        ['E', { kind: 'text', value: system.unit }],
        ['F', { kind: 'number', value: system.quantity }],
        ['G', { kind: 'formula', value: system.totalReference }],
        ['H', { kind: 'formula', value: `F${row}*G${row}` }],
      ];
      const columns = new Set<string>([...template.styleByColumn.keys(), ...cells.map((c) => c[0])]);
      const byColumn = new Map(cells);
      const sorted = [...columns].sort();
      const body = sorted
        .map((col) => renderCell(`${col}${row}`, template.styleByColumn.get(col), byColumn.get(col)))
        .join('');
      return `<row r="${row}" ${rowAttrsTemplate}>${body}</row>`;
    })
    .join('');

  // --- 그 아래 전부 shift 만큼 내린다 ---
  const shiftOf = (row: number): number => (row >= SUBTOTAL_ROW ? row + shift : row);

  const tailRowXml = rows
    .filter((r) => r.row > FIRST_SYSTEM_ROW)
    .map(({ row, block }) => {
      const newRow = shiftOf(row);
      let out = block.replace(/\br="\d+"/, `r="${newRow}"`);
      if (row === SUBTOTAL_ROW) {
        // ROUNDDOWN(SUM(H11:H11),-3) 의 합산 범위를 실제 시스템 줄 전체로 늘린다.
        out = out.replace(
          /SUM\(H\d+:H\d+\)/,
          `SUM(H${FIRST_SYSTEM_ROW}:H${systemRows[systemRows.length - 1]})`,
        );
      }
      // 이 행 안의 셀 r= 도 행 번호가 바뀌었으니 같이 옮긴다.
      out = out.replace(/\br="([A-Z]+)\d+"/g, (_w, col: string) => `r="${col}${newRow}"`);
      return out;
    })
    .join('');

  const headRowXml = rows
    .filter((r) => r.row < FIRST_SYSTEM_ROW)
    .map((r) => r.block)
    .join('');

  let out = sheetXml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, () =>
    `<sheetData>${headRowXml}${systemRowXml}${tailRowXml}</sheetData>`,
  );

  // --- 병합 범위 ---
  out = out.replace(/<mergeCells[^>]*>[\s\S]*?<\/mergeCells>/, (block) => {
    const refs: string[] = [];
    for (const merge of block.matchAll(/<mergeCell ref="([^"]*)"\/>/g)) {
      const parts = (merge[1] ?? '').split(':');
      if (parts.length !== 2) continue;
      const [start, end] = parts as [string, string];
      const startRow = rowOf(start);
      const endRow = rowOf(end);
      const newStart = shiftOf(startRow);
      const newEnd = shiftOf(endRow);
      refs.push(`${columnOf(start)}${newStart}:${columnOf(end)}${newEnd}`);
    }
    return `<mergeCells count="${refs.length}">${refs
      .map((ref) => `<mergeCell ref="${ref}"/>`)
      .join('')}</mergeCells>`;
  });

  // --- dimension ---
  out = out.replace(/<dimension ref="A1:([A-Z]+)(\d+)"\/>/, (_whole, col: string, lastRow: string) => {
    const newLast = shiftOf(Number.parseInt(lastRow, 10));
    return `<dimension ref="A1:${col}${newLast}"/>`;
  });

  return {
    sheetXml: out,
    shift,
    subtotalRow: SUBTOTAL_ROW + shift,
    systemRows,
  };
}

/** 갑지 인쇄 영역(localSheetId="0")의 마지막 행을 `shift` 만큼 늘린다. */
export function shiftCoverPrintArea(workbookXml: string, shift: number): string {
  if (shift === 0) return workbookXml;
  return workbookXml.replace(
    /(<definedName name="_xlnm\.Print_Area" localSheetId="0">[^<]*\$)(\d+)(<\/definedName>)/,
    (_whole, prefix: string, lastRow: string, suffix: string) =>
      `${prefix}${Number.parseInt(lastRow, 10) + shift}${suffix}`,
  );
}
