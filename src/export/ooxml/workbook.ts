/**
 * 통합문서 조립 (설계서 §9.1, §9.3, §9.6).
 *
 * 템플릿 ZIP을 풀고, 워크시트 파트를 새로 만들고, `workbook.xml`·관계·콘텐츠 타입을
 * 다시 쓴 뒤 ZIP으로 묶는다. `xl/styles.xml`·`xl/theme/*`는 손대지 않는다.
 */
import { zipSync, strToU8, strFromU8 } from 'fflate';
import { parseXml, serializeXml, element, findChild, type XmlDocument } from './xml';
import { loadTemplate, type TemplatePackage } from './template';
export type { TemplatePackage };
import { planWorkbook, COVER_SHEET_NAME, type SystemLayout, type CoverLayout } from './layout';
import {
  buildWorksheet,
  type BuiltRow,
  type PlannedCell,
  EMPTY,
  num,
  str,
  formula,
  formulaText,
  formulaOrConstant,
} from './sheetBuilder';
import { SYSTEM_COLUMNS, COVER_COLUMNS } from './cellRef';
import { COVER_ANCHOR, SYSTEM_ANCHOR, PRINT } from './anchors';
import { quoteSheetRef } from './sheetName';
import { koreanAmountFormula, koreanAmountSentence } from './koreanAmount';
import * as F from './formulas';
import type { CustomerExport } from '../customer/projection';
import type { Decimal } from '../../domain/calculation/rounding';
import { dec } from '../../domain/calculation/rounding';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function cached(value: Decimal | undefined): string | undefined {
  return value === undefined ? undefined : value.toFixed();
}

function cell(column: string, content: PlannedCell['content']): PlannedCell {
  return { column, content };
}

/** `2026-10-03` → `2026 년  10 월  03 일` (원본 갑지 C3 형식). */
function formatQuoteDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) return iso;
  return `${match[1]} 년  ${match[2]} 월  ${match[3]} 일`;
}

/** `"0.2"` → `"20"` — 수식의 퍼센트 표기용. */
function ratePercent(rate: string): string {
  return dec(rate).times(100).toFixed();
}

// ---------------------------------------------------------------------------
// 내역 시트
// ---------------------------------------------------------------------------

function buildSystemSheet(layout: SystemLayout, template: TemplatePackage): string {
  const skeleton = template.systemSkeleton;
  const modelRow = (anchor: number) => {
    const row = skeleton.rows.get(anchor);
    if (row === undefined) throw new Error(`템플릿 모델 행 ${anchor}이 없다.`);
    return row;
  };

  const rows: BuiltRow[] = [];

  // 1행 — 공사명 참조
  rows.push({
    row: layout.titleRow,
    skeleton: modelRow(SYSTEM_ANCHOR.title),
    cells: [
      cell(
        'A',
        formulaText(F.systemTitle(COVER_SHEET_NAME, `C${COVER_ANCHOR.projectName}`)),
      ),
    ],
  });

  // 2–3행 — 2단 머리글
  rows.push({
    row: layout.headerTopRow,
    skeleton: modelRow(SYSTEM_ANCHOR.headerTop),
    cells: [
      cell('A', str('번호')),
      cell('B', str('품   명')),
      cell('C', str('규   격')),
      cell('D', str('단위')),
      cell('E', str('수량')),
      cell('F', str('재료비')),
      cell('H', str('노무비')),
      cell('J', str('합  계')),
      cell('K', str('비 고')),
    ],
  });
  rows.push({
    row: layout.headerBottomRow,
    skeleton: modelRow(SYSTEM_ANCHOR.headerBottom),
    cells: [
      cell('F', str('단 가')),
      cell('G', str('금 액')),
      cell('H', str('단 가')),
      cell('I', str('금 액')),
    ],
  });

  // 4행 — Ⅰ 직접비
  rows.push({
    row: layout.directHeaderRow,
    skeleton: modelRow(SYSTEM_ANCHOR.directHeader),
    cells: [cell('A', str('Ⅰ')), cell('B', str('직접비'))],
  });

  // 본문
  for (const planned of layout.bodyRows) {
    const model = modelRow(planned.styleAnchor);
    const source = planned.source;

    if (source.type === 'display') {
      rows.push({
        row: planned.row,
        skeleton: model,
        cells: [
          cell('B', str(source.name)),
          cell('C', str(source.specification)),
          cell('F', str(source.materialNote)),
          cell('K', str(source.remark)),
        ],
      });
      continue;
    }

    const r = planned.row;
    const calc = planned.calc;
    const cells: PlannedCell[] = [];

    // A열 — 번호
    if (planned.numbering !== undefined) {
      cells.push(
        'constant' in planned.numbering
          ? cell('A', num(String(planned.numbering.constant)))
          : cell('A', formula(F.nextNumber(planned.numbering.previousRow))),
      );
    }

    cells.push(cell('B', str(source.name)));
    cells.push(cell('C', str(source.specification)));
    cells.push(cell('D', str(source.unit)));
    cells.push(cell('E', num(source.quantity)));

    // F열 — 재료비 단가
    if (source.type === 'derived') {
      const percent = ratePercent(source.rate);
      if (planned.derivedSourceRow !== undefined) {
        cells.push(
          cell(
            'F',
            formula(
              F.derivedFromSingleRow(planned.derivedSourceRow, percent),
              cached(calc?.materialUnitPrice),
            ),
          ),
        );
      } else if (planned.derivedRange !== undefined) {
        cells.push(
          cell(
            'F',
            formula(
              F.derivedFromRange(
                planned.derivedRange.first,
                planned.derivedRange.last,
                percent,
              ),
              cached(calc?.materialUnitPrice),
            ),
          ),
        );
      } else {
        // 기준이 될 행이 없으면 수식 대신 계산값을 쓴다.
        cells.push(cell('F', num(cached(calc?.materialUnitPrice))));
      }
    } else {
      cells.push(cell('F', num(cached(calc?.materialUnitPrice))));
    }

    cells.push(cell('G', formula(F.materialAmount(r), cached(calc?.materialAmount))));
    cells.push(cell('H', num(cached(calc?.laborUnitPrice))));
    cells.push(cell('I', formula(F.laborAmount(r), cached(calc?.laborAmount))));
    cells.push(cell('J', formula(F.rowTotal(r), cached(calc?.total))));
    cells.push(cell('K', str(source.remark)));

    rows.push({ row: r, skeleton: model, cells });
  }

  // 직접비계
  const calc = layout.calculation;
  rows.push({
    row: layout.directTotalRow,
    skeleton: modelRow(SYSTEM_ANCHOR.directTotal),
    cells: [
      cell('A', str('직접비계')),
      cell(
        'G',
        formulaOrConstant(
          F.directTotalSum('G', layout.firstItemRow, layout.lastBodyRow),
          calc.directMaterial.toFixed(),
        ),
      ),
      cell(
        'I',
        formulaOrConstant(
          F.directTotalSum('I', layout.firstItemRow, layout.lastBodyRow),
          calc.directLabor.toFixed(),
        ),
      ),
      cell(
        'J',
        formulaOrConstant(
          F.directTotalSum('J', layout.firstItemRow, layout.lastBodyRow),
          calc.directTotal.toFixed(),
        ),
      ),
    ],
  });

  // Ⅱ 간접비
  rows.push({
    row: layout.indirectHeaderRow,
    skeleton: modelRow(SYSTEM_ANCHOR.indirectHeader),
    cells: [cell('A', str('Ⅱ')), cell('B', str('간접비'))],
  });

  const indirectCalcById = new Map(calc.indirect.map((i) => [i.itemId, i]));
  layout.indirectRows.forEach((planned, index) => {
    const { rule } = planned;
    const amount = indirectCalcById.get(rule.itemId);
    const rateCell = `E${planned.row}`;

    rows.push({
      row: planned.row,
      skeleton: modelRow(planned.styleAnchor),
      cells: [
        cell(
          'A',
          index === 0 ? num('1') : formula(F.nextNumber(planned.row - 1)),
        ),
        cell('B', str(rule.name)),
        cell('C', str(rule.basisLabel)),
        cell('D', str('식')),
        cell('E', num(rule.rate)),
        cell(
          'J',
          // 설계서 §5.4: 미적용 항목은 요율을 남기되 금액은 상수 0으로 둔다.
          // 원본의 연금·건강·노인장기요양이 정확히 이 형태다.
          rule.applied
            ? formula(
                F.indirectAmount(rule.basis, layout.directTotalRow, rateCell, planned.plusRows),
                cached(amount?.amount),
              )
            : num('0'),
        ),
      ],
    });
  });

  const firstIndirectRow = layout.indirectRows[0]?.row;
  const lastIndirectRow = layout.indirectRows.at(-1)?.row;

  rows.push({
    row: layout.indirectTotalRow,
    skeleton: modelRow(SYSTEM_ANCHOR.indirectTotal),
    cells: [
      cell('A', str('간접비계')),
      cell(
        'J',
        formulaOrConstant(
          F.indirectTotalSum(firstIndirectRow, lastIndirectRow),
          calc.indirectTotal.toFixed(),
        ),
      ),
    ],
  });

  rows.push({
    row: layout.grandTotalRow,
    skeleton: modelRow(SYSTEM_ANCHOR.grandTotal),
    cells: [
      cell('A', str('합      계')),
      cell(
        'J',
        formula(
          F.systemGrandTotal(layout.directTotalRow, layout.indirectTotalRow),
          calc.systemTotal.toFixed(),
        ),
      ),
    ],
  });

  const merges = [
    `A${layout.titleRow}:K${layout.titleRow}`,
    `A${layout.headerTopRow}:A${layout.headerBottomRow}`,
    `B${layout.headerTopRow}:B${layout.headerBottomRow}`,
    `C${layout.headerTopRow}:C${layout.headerBottomRow}`,
    `D${layout.headerTopRow}:D${layout.headerBottomRow}`,
    `E${layout.headerTopRow}:E${layout.headerBottomRow}`,
    `F${layout.headerTopRow}:G${layout.headerTopRow}`,
    `H${layout.headerTopRow}:I${layout.headerTopRow}`,
    `J${layout.headerTopRow}:J${layout.headerBottomRow}`,
    `K${layout.headerTopRow}:K${layout.headerBottomRow}`,
    `A${layout.directTotalRow}:C${layout.directTotalRow}`,
    `A${layout.indirectTotalRow}:C${layout.indirectTotalRow}`,
    `A${layout.grandTotalRow}:C${layout.grandTotalRow}`,
  ];

  return (
    XML_DECL +
    serializeXml({
      root: buildWorksheet({
        skeleton,
        rows,
        columns: SYSTEM_COLUMNS,
        dimension: `A1:K${layout.lastRow}`,
        mergeRefs: merges,
      }),
    })
  );
}

// ---------------------------------------------------------------------------
// 갑지
// ---------------------------------------------------------------------------

function buildCoverSheet(
  exported: CustomerExport,
  cover: CoverLayout,
  systems: readonly SystemLayout[],
  template: TemplatePackage,
): string {
  const skeleton = template.coverSkeleton;
  const modelRow = (anchor: number) => {
    const row = skeleton.rows.get(anchor);
    if (row === undefined) throw new Error(`템플릿 갑지 모델 행 ${anchor}이 없다.`);
    return row;
  };

  const { calculation } = exported;
  const finalRef = `H${cover.finalRow}`;
  const rows: BuiltRow[] = [];

  rows.push({
    row: cover.titleRow,
    skeleton: modelRow(COVER_ANCHOR.title),
    cells: [cell('B', str('견   적   서'))],
  });

  const headerFields: Array<[number, number, string, string]> = [
    [cover.quoteNumberRow, COVER_ANCHOR.quoteNumber, 'No.', exported.header.quoteNumber],
    [
      cover.quoteDateRow,
      COVER_ANCHOR.quoteDate,
      '견적일 : ',
      formatQuoteDate(exported.header.quoteDate),
    ],
    [cover.customerRow, COVER_ANCHOR.customer, '견적처 : ', exported.header.customer],
    [
      cover.projectNameRow,
      COVER_ANCHOR.projectName,
      '견적명 : ',
      exported.header.projectName,
    ],
    [cover.contactRow, COVER_ANCHOR.contact, '담당자 : ', exported.header.contact],
  ];
  for (const [row, anchor, label, value] of headerFields) {
    rows.push({
      row,
      skeleton: modelRow(anchor),
      cells: [cell('B', str(label)), cell('C', str(value))],
    });
  }

  rows.push({
    row: cover.introRow,
    skeleton: modelRow(COVER_ANCHOR.intro),
    cells: [cell('B', str('아래와 같이 견적합니다.'))],
  });

  rows.push({
    row: cover.amountSentenceRow,
    skeleton: modelRow(COVER_ANCHOR.amountSentence),
    cells: [
      cell('B', str('금  액 : ')),
      cell(
        'C',
        // 설계서 §9.4: 정적 문자열로 바꾸지 않는다. 금액을 고치면 문구도 따라 바뀌어야 한다.
        formulaText(
          koreanAmountFormula(finalRef),
          koreanAmountSentence(calculation.cover.finalTotal.toFixed()),
        ),
      ),
    ],
  });

  rows.push({
    row: cover.headerRow,
    skeleton: modelRow(COVER_ANCHOR.header),
    cells: [
      cell('B', str('순위')),
      cell('C', str('품     명')),
      cell('D', str('  규     격')),
      cell('E', str('단위')),
      cell('F', str('수량')),
      cell('G', str('금 액')),
      cell('H', str('합 계')),
      cell('I', str('비 고')),
    ],
  });

  const systemById = new Map(systems.map((s) => [s.systemId, s]));
  const amountById = new Map(
    calculation.cover.systemAmounts.map((a) => [a.systemId, a]),
  );

  for (const planned of cover.bodyRows) {
    if (planned.kind === 'group') {
      rows.push({
        row: planned.row,
        skeleton: modelRow(planned.styleAnchor),
        cells: [cell('B', str(planned.groupMarker)), cell('C', str(planned.groupName))],
      });
      continue;
    }

    const layout = systemById.get(planned.systemId!)!;
    const amount = amountById.get(planned.systemId!);
    rows.push({
      row: planned.row,
      skeleton: modelRow(planned.styleAnchor),
      cells: [
        cell('B', num(String(planned.sequence))),
        cell('C', str(layout.system.name)),
        cell('D', str(layout.system.summarySpec)),
        cell('E', str(layout.system.unit)),
        cell('F', num(layout.system.quantity)),
        cell(
          'G',
          formula(
            F.coverSystemReference(layout.sheetName, layout.grandTotalRow),
            cached(amount?.unitAmount),
          ),
        ),
        cell('H', formula(F.coverSystemAmount(planned.row), cached(amount?.amount))),
        cell('I', str(layout.system.remark)),
      ],
    });
  }

  rows.push({
    row: cover.sumRow,
    skeleton: modelRow(COVER_ANCHOR.sum),
    cells: [
      cell('B', str('합     계')),
      cell(
        'H',
        formulaOrConstant(
          F.coverRoundDown(cover.firstBodyRow, cover.lastBodyRow, exported.roundingDigits),
          calculation.cover.rounded.toFixed(),
        ),
      ),
      cell('I', str('만원미만절사')),
    ],
  });

  rows.push({
    row: cover.negoRow,
    skeleton: modelRow(COVER_ANCHOR.nego),
    cells: [
      cell('B', str('NEGO')),
      // 설계서 §5.5: 원본은 음수 입력값이다. 수식이 아니다.
      cell('H', num(calculation.cover.negoAdjustment.toFixed())),
    ],
  });

  rows.push({
    row: cover.finalRow,
    skeleton: modelRow(COVER_ANCHOR.final),
    cells: [
      cell('B', str('최     종     합     계')),
      cell(
        'H',
        formula(
          F.coverFinalTotal(cover.sumRow, cover.negoRow),
          calculation.cover.finalTotal.toFixed(),
        ),
      ),
    ],
  });

  cover.remarkRows.forEach((row, index) => {
    const anchor = index === 0 ? COVER_ANCHOR.remarkFirst : COVER_ANCHOR.remarkSecond;
    rows.push({
      row,
      skeleton: modelRow(anchor),
      cells: [
        ...(index === 0 ? [cell('B', str('비 고'))] : []),
        cell('C', str(exported.header.conditions[index])),
      ],
    });
  });

  rows.push({
    row: cover.closeRow,
    skeleton: modelRow(COVER_ANCHOR.close),
    cells: [cell('A', EMPTY)],
  });

  const merges = [
    `B${cover.titleRow}:I${cover.titleRow}`,
    `B${cover.sumRow}:D${cover.sumRow}`,
    `B${cover.negoRow}:D${cover.negoRow}`,
    `B${cover.finalRow}:D${cover.finalRow}`,
    `B${cover.remarkRows[0]}:B${cover.remarkRows[1]}`,
    `C${cover.remarkRows[0]}:I${cover.remarkRows[0]}`,
    `C${cover.remarkRows[1]}:I${cover.remarkRows[1]}`,
  ];

  return (
    XML_DECL +
    serializeXml({
      root: buildWorksheet({
        skeleton,
        rows,
        columns: COVER_COLUMNS,
        dimension: `A1:J${cover.lastRow}`,
        mergeRefs: merges,
      }),
    })
  );
}

// ---------------------------------------------------------------------------
// 패키지
// ---------------------------------------------------------------------------

/**
 * 통합문서를 다시 쓰는 데 필요한 시트 한 장의 정보.
 *
 * `rebuildWorkbookXml`·`rebuildWorkbookRels`·`rebuildContentTypes` 는
 * 이 모양만 알면 되므로, 다중 시스템 가이드 조립(`guideMultiSystem.ts`)도
 * 그대로 재사용한다 — "sheetId·관계·Content_Types 갱신"을 두 번 짓지 않는다.
 */
export interface SheetEntry {
  name: string;
  path: string;
  relId: string;
  printArea: string;
  printTitles?: string;
}

/** 파싱된 문서를 표준 선언 하나만 붙여 직렬화한다. 선언을 두 번 쓰면 Excel이 파일을 거부한다. */
function serializeWithDeclaration(doc: XmlDocument): string {
  doc.declaration = XML_DECL;
  return serializeXml(doc);
}

export function rebuildWorkbookXml(workbook: XmlDocument, sheets: readonly SheetEntry[]): string {
  const root = workbook.root;
  root.children = root.children.filter(
    (c) => c.tag !== 'sheets' && c.tag !== 'definedNames' && c.tag !== 'externalReferences',
  );

  const sheetsElement = element(
    'sheets',
    {},
    sheets.map((s, index) =>
      element('sheet', {
        name: s.name,
        sheetId: String(index + 1),
        'r:id': s.relId,
      }),
    ),
  );

  const definedNames = element('definedNames', {});
  sheets.forEach((s, index) => {
    if (s.printTitles !== undefined) {
      const titles = element('definedName', {
        name: '_xlnm.Print_Titles',
        localSheetId: String(index),
      });
      titles.text = `${quoteSheetRef(s.name)}!${s.printTitles}`;
      definedNames.children.push(titles);
    }
    const area = element('definedName', {
      name: '_xlnm.Print_Area',
      localSheetId: String(index),
    });
    area.text = `${quoteSheetRef(s.name)}!${s.printArea}`;
    definedNames.children.push(area);
  });

  // OOXML 스키마가 요구하는 순서: … sheets, …, definedNames, calcPr …
  const calcIndex = root.children.findIndex((c) => c.tag === 'calcPr');
  const insertAt = calcIndex === -1 ? root.children.length : calcIndex;
  root.children.splice(insertAt, 0, sheetsElement, definedNames);

  // 설계서 §9.3: 재계산 설정을 일관되게 기록한다.
  let calcPr = findChild(root, 'calcPr');
  if (calcPr === undefined) {
    calcPr = element('calcPr', {});
    root.children.push(calcPr);
  }
  calcPr.attrs['fullCalcOnLoad'] = '1';
  delete calcPr.attrs['calcId'];

  return serializeWithDeclaration(workbook);
}

export function rebuildWorkbookRels(rels: XmlDocument, sheets: readonly SheetEntry[]): string {
  const WORKSHEET_TYPE =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';

  // 워크시트가 아닌 관계(styles, theme 등)는 그대로 두고 id만 피해서 재배치한다.
  const others = rels.root.children.filter((r) => r.attrs['Type'] !== WORKSHEET_TYPE);
  const sheetRels = sheets.map((s) =>
    element('Relationship', {
      Id: s.relId,
      Type: WORKSHEET_TYPE,
      Target: s.path.replace(/^xl\//, ''),
    }),
  );

  let next = sheets.length + 1;
  for (const rel of others) {
    rel.attrs['Id'] = `rId${next}`;
    next += 1;
  }

  rels.root.children = [...sheetRels, ...others];
  return serializeWithDeclaration(rels);
}

export function rebuildContentTypes(
  contentTypes: XmlDocument,
  sheets: readonly SheetEntry[],
): string {
  const WORKSHEET_CT =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';

  contentTypes.root.children = contentTypes.root.children.filter(
    (c) => c.attrs['ContentType'] !== WORKSHEET_CT,
  );
  for (const sheet of sheets) {
    contentTypes.root.children.push(
      element('Override', { PartName: `/${sheet.path}`, ContentType: WORKSHEET_CT }),
    );
  }
  return serializeWithDeclaration(contentTypes);
}

/** `xl/worksheets/sheet1.xml` → `xl/worksheets/_rels/sheet1.xml.rels` */
export function relsPathOf(partPath: string): string {
  const at = partPath.lastIndexOf('/');
  return `${partPath.slice(0, at)}/_rels${partPath.slice(at)}.rels`;
}

export interface BuildWorkbookResult {
  bytes: Uint8Array;
  /** 만들어진 시트 이름 — 사용자가 지은 이름과 다를 수 있다. */
  sheetNames: string[];
}

/**
 * 통합문서에 덧붙일 시트.
 *
 * **고객용 exporter는 이것을 넘기지 않는다.** 내부용 exporter만 쓴다
 * (설계서 §8.7 — 고객용과 내부용은 별도 exporter를 쓴다).
 * 고객용 경로에서 이 값이 비어 있다는 것은 `tests/integration/exportWorkbook.test.ts`의
 * 시트 수 검사가 고정한다.
 */
export interface ExtraSheet {
  name: string;
  printArea: string;
  /** 워크시트 XML 전체를 만든다. */
  build(template: TemplatePackage): string;
}

export interface BuildWorkbookOptions {
  extraSheets?: readonly ExtraSheet[];
}

/**
 * 견적 통합문서를 만든다.
 *
 * @param templateBytes 정리된 빈 템플릿 `.xlsx`의 바이트.
 */
export function buildQuoteWorkbook(
  exported: CustomerExport,
  templateBytes: Uint8Array,
  options: BuildWorkbookOptions = {},
): BuildWorkbookResult {
  const template = loadTemplate(templateBytes);
  const layout = planWorkbook(exported);
  const extraSheets = options.extraSheets ?? [];

  const sheets: SheetEntry[] = [
    {
      name: COVER_SHEET_NAME,
      path: 'xl/worksheets/sheet1.xml',
      relId: 'rId1',
      printArea: `$A$1:$J$${layout.cover.lastRow}`,
    },
    ...layout.systems.map((system, index) => ({
      name: system.sheetName,
      path: `xl/worksheets/sheet${index + 2}.xml`,
      relId: `rId${index + 2}`,
      printArea: `$A$1:$K$${system.lastRow}`,
      printTitles: PRINT.systemTitleRows,
    })),
    ...extraSheets.map((extra, index) => ({
      name: extra.name,
      path: `xl/worksheets/sheet${layout.systems.length + index + 2}.xml`,
      relId: `rId${layout.systems.length + index + 2}`,
      printArea: extra.printArea,
      printTitles: PRINT.systemTitleRows,
    })),
  ];

  const files: Record<string, Uint8Array> = {};

  // [Content_Types].xml은 OPC 패키지의 **첫 엔트리**여야 한다. 뒤에 있으면 Excel이
  // "파일 형식 또는 파일 확장명이 잘못되었습니다"로 거부한다.
  files['[Content_Types].xml'] = strToU8(
    rebuildContentTypes(template.contentTypes, sheets),
  );

  // 워크시트가 아닌 파트는 그대로 복사한다 — styles.xml을 손대지 않는 것이 핵심이다.
  for (const [path, data] of Object.entries(template.files)) {
    if (path.startsWith('xl/worksheets/')) continue;
    if (path === 'xl/workbook.xml') continue;
    if (path === 'xl/_rels/workbook.xml.rels') continue;
    if (path === '[Content_Types].xml') continue;
    if (path === 'xl/calcChain.xml') continue;
    files[path] = data;
  }

  // 갑지의 시트 관계 파트 — 회사 직인 이미지(drawing)를 가리킨다.
  // 템플릿의 갑지 시트가 sheet1이 아닐 수도 있으므로 실제 경로에서 찾아 옮긴다.
  const templateCoverRels = template.files[relsPathOf(template.coverSheetPath)];
  if (templateCoverRels !== undefined) {
    files[relsPathOf('xl/worksheets/sheet1.xml')] = templateCoverRels;
  }

  files['xl/worksheets/sheet1.xml'] = strToU8(
    buildCoverSheet(exported, layout.cover, layout.systems, template),
  );
  layout.systems.forEach((system, index) => {
    files[`xl/worksheets/sheet${index + 2}.xml`] = strToU8(
      buildSystemSheet(system, template),
    );
  });
  extraSheets.forEach((extra, index) => {
    files[`xl/worksheets/sheet${layout.systems.length + index + 2}.xml`] = strToU8(
      extra.build(template),
    );
  });

  files['xl/workbook.xml'] = strToU8(rebuildWorkbookXml(template.workbook, sheets));
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    rebuildWorkbookRels(template.workbookRels, sheets),
  );

  return {
    bytes: zipSync(files, { level: 6 }),
    sheetNames: sheets.map((s) => s.name),
  };
}

export { strFromU8, parseXml };
