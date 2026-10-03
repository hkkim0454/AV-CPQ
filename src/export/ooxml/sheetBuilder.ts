/**
 * worksheet XML 생성 (설계서 §9.3).
 *
 * `sheetData`를 전부 새로 쓴다. 템플릿에서 가져오는 것은 셀 서식 인덱스와
 * `sheetData` 밖의 뼈대(열너비·인쇄 설정·머리글)뿐이다.
 *
 * 공유 수식(`<f t="shared">`)을 **내보내지 않는다.** 원본은 공유 수식을 쓰지만,
 * 행을 옮기면서 master 셀만 복제하면 종속 셀의 수식이 비어 금액이 0이 된다.
 * 모든 셀에 수식을 명시해 그 실패 모드를 아예 없앤다.
 */
import { element, textElement, type XmlElement } from './xml';
import { SYSTEM_COLUMNS, COVER_COLUMNS } from './cellRef';
import type { RowSkeleton, SheetSkeleton } from './template';

/** 한 셀에 넣을 내용. */
export type CellContent =
  | { kind: 'empty' }
  | { kind: 'number'; value: string }
  | { kind: 'text'; value: string }
  /** 수식 + 미리 계산한 캐시 값. 캐시가 없으면 Excel이 열 때 계산한다. */
  | { kind: 'formula'; formula: string; cachedNumber?: string }
  | { kind: 'formulaText'; formula: string; cachedText?: string };

export const EMPTY: CellContent = { kind: 'empty' };

export function num(value: string | undefined): CellContent {
  return value === undefined ? EMPTY : { kind: 'number', value };
}

export function str(value: string | undefined): CellContent {
  return value === undefined || value === '' ? EMPTY : { kind: 'text', value };
}

export function formula(expression: string, cachedNumber?: string): CellContent {
  return cachedNumber === undefined
    ? { kind: 'formula', formula: expression }
    : { kind: 'formula', formula: expression, cachedNumber };
}

export function formulaText(expression: string, cachedText?: string): CellContent {
  return cachedText === undefined
    ? { kind: 'formulaText', formula: expression }
    : { kind: 'formulaText', formula: expression, cachedText };
}

/** 수식이거나 상수 0인 결과를 셀 내용으로 바꾼다. `formulas.ts`의 반환 형태에 대응. */
export function formulaOrConstant(
  result: { formula: string } | { constant: 0 },
  cachedNumber?: string,
): CellContent {
  if ('constant' in result) return { kind: 'number', value: String(result.constant) };
  return formula(result.formula, cachedNumber);
}

export interface PlannedCell {
  column: string;
  content: CellContent;
}

export interface BuiltRow {
  row: number;
  /** 어느 모델 행의 서식을 쓸지. */
  skeleton: RowSkeleton;
  /** 행 높이 override. 없으면 모델 행의 높이를 쓴다. */
  height?: number;
  cells: PlannedCell[];
}

/**
 * 셀 안의 줄바꿈을 공백 하나로 눕힌다.
 *
 * 카탈로그의 규격 칸에 줄바꿈이 든 제품이 있다
 * (`H_4xHDMI  output  card⏎(HDMI  1.4  -  Dual  Link)`, `5C-CRIMP⏎ F-5C` 등).
 * 견적 양식은 행 높이가 21pt로 **고정**이라 두 줄짜리 값을 그대로 넣으면
 * 둘째 줄이 조용히 잘린다. 사람 눈에는 한 줄만 보이고 인쇄물도 그렇게 나간다.
 *
 * 줄바꿈을 살리려면 `wrapText` 서식이 필요한데, 그러려면 `xl/styles.xml`을
 * 건드려야 한다. 원본 서식을 바이트 그대로 옮긴다는 전제(설계서 §9.1)를 깨는 쪽보다
 * **눕혀서 전부 보이게 하는 쪽**을 택했다. 내용이 사라지지 않는다.
 */
export function flattenLineBreaks(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, ' ');
}

function buildCell(
  reference: string,
  styleIndex: number | undefined,
  content: CellContent,
): XmlElement | undefined {
  const attrs: Record<string, string | undefined> = { r: reference };
  if (styleIndex !== undefined) attrs['s'] = String(styleIndex);

  switch (content.kind) {
    case 'empty':
      // 서식만 있는 셀도 내보낸다 — 테두리와 채움이 유지돼야 한다.
      return styleIndex === undefined ? undefined : element('c', attrs);

    case 'number':
      return element('c', attrs, [textElement('v', content.value)]);

    case 'text':
      // inlineStr을 쓴다. sharedStrings.xml을 관리하지 않아도 되고,
      // 생성 파일에 문자열 풀이 남지 않아 감사하기 쉽다.
      attrs['t'] = 'inlineStr';
      return element('c', attrs, [
        element('is', {}, [
          textElement('t', flattenLineBreaks(content.value), { 'xml:space': 'preserve' }),
        ]),
      ]);

    case 'formula': {
      const children = [textElement('f', content.formula)];
      if (content.cachedNumber !== undefined) {
        children.push(textElement('v', content.cachedNumber));
      }
      return element('c', attrs, children);
    }

    case 'formulaText': {
      // 문자열을 돌려주는 수식은 t="str".
      attrs['t'] = 'str';
      const children = [textElement('f', content.formula)];
      if (content.cachedText !== undefined) {
        children.push(textElement('v', content.cachedText));
      }
      return element('c', attrs, children);
    }
  }
}

function buildRow(built: BuiltRow, columns: readonly string[]): XmlElement {
  const contentByColumn = new Map(built.cells.map((c) => [c.column, c.content]));

  const cells: XmlElement[] = [];
  for (const column of columns) {
    const content = contentByColumn.get(column) ?? EMPTY;
    const cell = buildCell(
      `${column}${built.row}`,
      built.skeleton.styles[column],
      content,
    );
    if (cell !== undefined) cells.push(cell);
  }

  const height = built.height ?? Number.parseFloat(built.skeleton.height ?? '');
  const attrs: Record<string, string | undefined> = {
    r: String(built.row),
    spans: `1:${columns.length}`,
  };
  if (built.skeleton.rowStyle !== undefined) {
    attrs['s'] = built.skeleton.rowStyle;
    attrs['customFormat'] = built.skeleton.customFormat ?? '1';
  }
  if (Number.isFinite(height)) {
    attrs['ht'] = String(height);
    attrs['customHeight'] = '1';
  }
  return element('row', attrs, cells);
}

export interface BuildSheetOptions {
  skeleton: SheetSkeleton;
  rows: BuiltRow[];
  columns: readonly string[];
  /** `A1:K35` 형태. */
  dimension: string;
  mergeRefs: readonly string[];
}

/**
 * worksheet 요소를 만든다.
 *
 * 자식 요소 순서는 OOXML(ECMA-376) 스키마가 고정한 순서다. 순서가 틀리면
 * Excel이 "복구 필요"로 연다.
 */
export function buildWorksheet(options: BuildSheetOptions): XmlElement {
  const { skeleton } = options;
  const children: XmlElement[] = [];

  if (skeleton.sheetPr !== undefined) children.push(skeleton.sheetPr);
  children.push(element('dimension', { ref: options.dimension }));
  if (skeleton.sheetViews !== undefined) children.push(skeleton.sheetViews);
  if (skeleton.sheetFormatPr !== undefined) children.push(skeleton.sheetFormatPr);
  if (skeleton.cols !== undefined) children.push(skeleton.cols);

  children.push(
    element(
      'sheetData',
      {},
      options.rows.map((r) => buildRow(r, options.columns)),
    ),
  );

  if (options.mergeRefs.length > 0) {
    children.push(
      element(
        'mergeCells',
        { count: String(options.mergeRefs.length) },
        options.mergeRefs.map((ref) => element('mergeCell', { ref })),
      ),
    );
  }

  // 템플릿에 남아 있던 conditionalFormatting(#REF! 수식)은 옮기지 않는다.
  if (skeleton.printOptions !== undefined) children.push(skeleton.printOptions);
  if (skeleton.pageMargins !== undefined) children.push(skeleton.pageMargins);
  if (skeleton.pageSetup !== undefined) children.push(skeleton.pageSetup);
  if (skeleton.headerFooter !== undefined) children.push(skeleton.headerFooter);
  // CT_Worksheet 스키마에서 drawing은 headerFooter 뒤에 온다.
  if (skeleton.drawing !== undefined) children.push(skeleton.drawing);

  // `xmlns:r`는 갑지의 `<drawing r:id="rId1"/>`(회사 직인)이 쓴다.
  // 선언하지 않으면 접두사가 정의되지 않은 XML이 되어 Excel이 파일을 열지 못한다.
  return element(
    'worksheet',
    {
      xmlns: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    },
    children,
  );
}

export { SYSTEM_COLUMNS, COVER_COLUMNS };
