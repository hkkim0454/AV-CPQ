/**
 * 가이드 템플릿으로 **고객용(2단계)** 통합문서를 만든다
 * (계획 2026-10-04 Task 5·6, 결정 D18).
 *
 * ## 2단계에 없는 것
 *
 * 원가·이윤·설명·품셈 근거·제조사/구매처·영업비고·AI 메모. **열을 비우는 게
 * 아니라 쓰지 않는다.** 인쇄 영역 밖 58칸에 내부 메모가 남아 있던 적이 있다
 * (평택 원본 감사). 눈에 안 보이는 것과 파일에 없는 것은 다르다.
 *
 * ## 금액은 수식으로 둔다
 *
 * 단가는 확정된 숫자로 넣고, 금액·직접비계·간접비·합계는 **수식**이다.
 * 사용자가 Excel 에서 수량을 고치면 갑지까지 따라와야 한다 (인수 기준 A09).
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import type { CustomerExport } from './projection';
import type { GuideTemplate } from '../ooxml/guideTemplate';
import { planGuideSheet, type GuideSheetLayout } from '../ooxml/guideLayout';
import * as F from '../ooxml/guideFormulas';
import {
  columnIndex,
  columnName,
  deleteSheetColumns,
} from '../ooxml/guideColumns';
import {
  blank,
  fillGuideSheet,
  formula,
  num,
  text,
  updatePrintArea,
  type CellValue,
  type RowContent,
} from '../ooxml/guideSheet';

export interface GuideWorkbookResult {
  bytes: Uint8Array;
  layout: GuideSheetLayout;
  sheetNames: { cover: string; detail: string };
}

export class GuideWorkbookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuideWorkbookError';
  }
}

const DETAIL_PART = 'xl/worksheets/sheet2.xml';
const COVER_PART = 'xl/worksheets/sheet1.xml';

/** `0.0486` → `4.86`. 원본이 퍼센트 표기를 쓴다. */
function ratePercent(rate: string): string {
  const value = Number(rate) * 100;
  return String(Number(value.toFixed(10)));
}

/**
 * 고객용(2단계) — **금지 열을 실제로 지운다.**
 *
 * 값을 안 쓰는 것으로는 부족하다. 템플릿의 머리글과 3행 노임이 그대로 남는다.
 * 실측으로 `D2 설명`, `M2 제조사/구매처`, `N2 영업비고`, `T2~AZ2 직종 이름`,
 * `U3~BA3 하반기 노임 17개` 가 고객용 파일에서 나왔다.
 */
export function buildCustomerGuideWorkbook(
  exported: CustomerExport,
  guide: GuideTemplate,
): GuideWorkbookResult {
  const base = buildGuideBase(exported, guide);
  return stripInternalColumns(base, guide);
}

/**
 * 공통 뼈대 — **열을 지우지 않는다.**
 *
 * 0·1단계는 설명·품셈·거래처를 그 위에 얹으므로 열이 살아 있어야 한다.
 * 2단계 입구만 지우기를 더 한다.
 */
export function buildGuideBase(
  exported: CustomerExport,
  guide: GuideTemplate,
): GuideWorkbookResult {
  const systems = exported.systems;
  if (systems.length !== 1) {
    // 가이드에는 세부내역 시트가 하나뿐이다. 시트를 더 만들려면 관계와
    // Content_Types 까지 손대야 하고, 그건 서식을 지어내는 것과 다른 문제다.
    throw new GuideWorkbookError(
      `가이드 출력은 아직 시스템 1개만 받는다 (받은 수: ${systems.length}).`,
    );
  }
  const system = systems[0]!;
  const calculation = exported.calculation.systems.find(
    (s) => s.systemId === system.systemId,
  );
  if (calculation === undefined) {
    throw new GuideWorkbookError(`시스템 ${system.systemId} 의 계산 결과가 없다.`);
  }

  const itemRows = system.rows.filter((r) => r.type === 'item');
  const derivedRows = system.rows.filter((r) => r.type === 'derived');

  const layout = planGuideSheet({
    guide,
    itemRowIds: itemRows.map((r) => r.rowId),
    derivedRowIds: derivedRows.map((r) => r.rowId),
  });

  const col = layout.column;
  const rowByRowId = new Map<string, number>();
  for (const planned of layout.rows) {
    if (planned.rowId !== undefined) rowByRowId.set(planned.rowId, planned.row);
  }
  const calcByRowId = new Map(calculation.rows.map((r) => [r.rowId, r]));

  const contentByRow = new Map<number, RowContent>();
  const put = (row: number, cells: Record<string, CellValue>): void => {
    contentByRow.set(row, new Map(Object.entries(cells)));
  };

  // --- 품목 ---
  itemRows.forEach((row, index) => {
    const at = rowByRowId.get(row.rowId)!;
    const calc = calcByRowId.get(row.rowId);
    const cells: Record<string, CellValue> = {
      A: num(String(index + 1)),
      [col('name')]: text(row.name),
      [col('spec')]: text(row.specification),
      [col('unit')]: text(row.unit),
      [col('quantity')]: num(row.quantity),
      [col('remark')]: text(row.remark),
    };
    // 미등록 단가는 **빈 칸**이다. `0` 으로 채우면 공짜 제품이 된다 (§5.6).
    if (calc?.materialUnitPrice !== undefined) {
      cells[col('material.unit')] = num(calc.materialUnitPrice.toFixed());
      cells[col('material.amount')] = formula(F.amount(layout, at, 'material.unit'));
    }
    if (calc?.laborUnitPrice !== undefined) {
      cells[col('labor.unit')] = num(calc.laborUnitPrice.toFixed());
      cells[col('labor.amount')] = formula(F.amount(layout, at, 'labor.unit'));
    }
    if (calc?.materialUnitPrice !== undefined || calc?.laborUnitPrice !== undefined) {
      cells[col('total')] = formula(F.rowTotal(layout, at));
    }
    put(at, cells);
  });

  // --- 파생 (배관 기타자재 → 잡자재비) ---
  derivedRows.forEach((row) => {
    const at = rowByRowId.get(row.rowId)!;
    const calc = calcByRowId.get(row.rowId);
    const percent = ratePercent(row.rate);
    let unitPrice: CellValue = blank;

    if (row.derived.kind === 'single-row-material') {
      const sourceRow = rowByRowId.get(row.derived.sourceRowId);
      if (sourceRow === undefined) {
        // 기준 행이 사라졌다. 수식으로 두면 엉뚱한 칸을 가리킨다.
        unitPrice =
          calc?.materialUnitPrice === undefined
            ? blank
            : num(calc.materialUnitPrice.toFixed());
      } else {
        unitPrice = formula(
          F.derivedFromRow(layout, sourceRow, 'material.amount', percent),
        );
      }
    } else {
      // 잡자재비 — 품목부터 **바로 윗 행까지**. 배관 기타자재를 포함한다.
      const built = F.derivedFromRange(
        layout,
        layout.firstBodyRow,
        at - 1,
        'material.amount',
        percent,
      );
      unitPrice = typeof built === 'string' ? formula(built) : num('0');
    }

    put(at, {
      [col('name')]: text(row.name),
      [col('spec')]: text(row.specification),
      [col('unit')]: text(row.unit),
      [col('quantity')]: num(row.quantity),
      [col('material.unit')]: unitPrice,
      [col('material.amount')]: formula(F.amount(layout, at, 'material.unit')),
      [col('total')]: formula(F.rowTotal(layout, at)),
      [col('remark')]: text(row.remark),
    });
  });

  // --- 직접비계 ---
  const subtotalCell = (role: string): CellValue => {
    const built = F.directSubtotal(layout, role);
    return 'formula' in built ? formula(built.formula) : num('0');
  };
  put(layout.directSubtotalRow, {
    A: text('직접비계'),
    [col('material.amount')]: subtotalCell('material.amount'),
    [col('labor.amount')]: subtotalCell('labor.amount'),
    [col('total')]: subtotalCell('total'),
  });

  // --- 간접비 ---
  put(layout.indirectHeaderRow, { A: text('Ⅱ'), [col('name')]: text('간접비') });

  const rowByItemId = new Map(
    layout.indirectRows.map((planned) => [planned.itemId!, planned.row]),
  );
  system.indirectCosts.forEach((rule, index) => {
    const at = layout.indirectRows[index]!.row;
    const rateCell = `${col('quantity')}${at}`;
    const cells: Record<string, CellValue> = {
      A: num(String(index + 1)),
      [col('name')]: text(rule.name),
      [col('spec')]: text(rule.basisLabel),
      [col('unit')]: text('식'),
      [col('quantity')]: num(rule.rate),
      // 미적용 항목은 **상수 0**이다. 원본이 그렇게 돼 있다 (§5.4).
      [col('total')]: rule.applied
        ? formula(F.indirectAmount(layout, rule.basis, rateCell, rowByItemId))
        : num('0'),
    };
    // 조건 문구는 인쇄 영역 밖 칸에 둔다 — 원본이 그 자리에 적어 뒀다.
    if (rule.conditionText !== undefined) {
      cells[col('supplier')] = text(rule.conditionText);
    }
    put(at, cells);
  });

  const indirectSum = F.indirectSubtotal(layout);
  put(layout.indirectSubtotalRow, {
    A: text('간접비계'),
    [col('total')]: typeof indirectSum === 'string' ? formula(indirectSum) : num('0'),
  });

  put(layout.grandTotalRow, {
    A: text('합      계'),
    [col('total')]: formula(F.grandTotal(layout)),
  });

  // --- 시트에 쓴다 ---
  const files = unzipSync(guide.bytes);
  const detail = files[DETAIL_PART];
  if (detail === undefined) {
    throw new GuideWorkbookError('가이드에 세부내역 시트가 없다.');
  }

  const patched: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(files)) {
    patched[name] = bytes;
  }
  patched[DETAIL_PART] = strToU8(
    fillGuideSheet({ sheetXml: strFromU8(detail), layout, contentByRow }),
  );

  // 갑지 — 공사명과 세부내역 합계 참조.
  const cover = files[COVER_PART];
  if (cover !== undefined) {
    patched[COVER_PART] = strToU8(
      fillCover(strFromU8(cover), exported, guide, layout),
    );
  }

  const workbook = files['xl/workbook.xml'];
  if (workbook !== undefined) {
    patched['xl/workbook.xml'] = strToU8(
      updatePrintArea(strFromU8(workbook), guide.sheets.detail, layout),
    );
  }

  const ordered: Record<string, Uint8Array> = {
    '[Content_Types].xml': patched['[Content_Types].xml']!,
  };
  for (const [name, bytes] of Object.entries(patched)) {
    if (name !== '[Content_Types].xml') ordered[name] = bytes;
  }

  return {
    bytes: zipSync(ordered),
    layout,
    sheetNames: guide.sheets,
  };
}

/**
 * 갑지의 견적 머리정보와 금액 참조를 채운다.
 *
 * 금액은 **수식**으로 둔다. 숫자로 박으면 Excel 에서 수량을 고쳐도
 * 갑지가 안 따라오고, 인쇄물만 보면 멀쩡해 보인다.
 */
function fillCover(
  coverXml: string,
  exported: CustomerExport,
  guide: GuideTemplate,
  layout: GuideSheetLayout,
): string {
  const reference = F.coverReference(guide.sheets.detail, layout);
  const system = exported.systems[0]!;
  const group = exported.groups[0];

  const replacements = new Map<string, CellValue>([
    ['C2', text(exported.header.quoteNumber)],
    ['C3', text(exported.header.quoteDate)],
    ['C4', text(exported.header.customer)],
    ['C5', text(exported.header.projectName)],
    ['C6', text(exported.header.contact)],
    // 10행은 구역 제목, 11행이 시스템 한 줄이다. 템플릿에는 '건명 타이틀' 같은
    // **플레이스홀더**가 들어 있다. 안 바꾸면 그 글자가 그대로 고객에게 간다.
    ['B10', text(group?.marker ?? 'Ⅰ')],
    ['C10', text(group?.name ?? exported.header.projectName)],
    ['C11', text(system.name)],
    ['D11', text(system.summarySpec)],
    ['E11', text(system.unit)],
    ['F11', num(system.quantity)],
    // 갑지 금액 — 세부내역 합계를 가리킨다.
    ['G11', formula(reference)],
  ]);

  return coverXml.replace(/<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g, (cell) => {
    const ref = /\br="([A-Z]+\d+)"/.exec(cell)?.[1];
    if (ref === undefined) return cell;
    const value = replacements.get(ref);
    if (value === undefined) return cell;
    const style = /\bs="(\d+)"/.exec(cell)?.[1];
    const styleAttr = style === undefined ? '' : ` s="${style}"`;
    if (value.kind === 'formula') {
      return `<c r="${ref}"${styleAttr}><f>${value.value}</f></c>`;
    }
    if (value.kind === 'number') {
      return `<c r="${ref}"${styleAttr}><v>${value.value}</v></c>`;
    }
    if (value.kind === 'text' && value.value !== '') {
      return (
        `<c r="${ref}"${styleAttr} t="inlineStr">` +
        `<is><t xml:space="preserve">${value.value
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')}</t></is></c>`
      );
    }
    return `<c r="${ref}"${styleAttr}/>`;
  });
}

/**
 * 고객용에 나가면 안 되는 열을 **지운다.**
 *
 * 설명 열과, 제조사/구매처부터 끝까지(영업비고·품셈 블록·직종·노임·AI 메모)를
 * 뺀다. 빼면 뒤가 당겨지므로 수식·병합·열너비·인쇄 영역이 함께 따라간다.
 */
function stripInternalColumns(
  base: GuideWorkbookResult,
  guide: GuideTemplate,
): GuideWorkbookResult {
  const layout = base.layout;
  const files = unzipSync(base.bytes);
  const detail = files[DETAIL_PART];
  if (detail === undefined) throw new GuideWorkbookError('세부내역 시트가 없다.');

  const sheetXml = strFromU8(detail);
  const dimension = /<dimension ref="A1:([A-Z]+)\d+"\/>/.exec(sheetXml)?.[1];
  const maxColumn = Math.max(
    columnIndex(dimension ?? 'BZ'),
    columnIndex('BZ'),
  );

  const supplier = columnIndex(layout.column('supplier'));
  const description = columnIndex(layout.column('description'));
  const deleted = new Set<number>([description]);
  for (let index = supplier; index <= maxColumn; index += 1) deleted.add(index);

  const stripped = deleteSheetColumns({
    sheetXml,
    deleted,
    maxColumn,
    lastRow: layout.grandTotalRow,
  });

  const patched: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(files)) patched[name] = bytes;
  patched[DETAIL_PART] = strToU8(stripped.sheetXml);

  // **갑지가 세부내역을 가리키는 참조도 당겨진다.**
  // 세부내역만 고치면 갑지는 여전히 지우기 전 열을 가리킨다. 합계가 K 에서
  // J 로 왔는데 갑지가 K 를 보면 비고 칸을 금액으로 읽는다 — 그리고
  // 수량을 고쳐도 갑지가 안 따라온다.
  const coverPart = files[COVER_PART];
  if (coverPart !== undefined) {
    patched[COVER_PART] = strToU8(
      remapCrossSheetRefs(
        strFromU8(coverPart),
        guide.sheets.detail,
        stripped.map,
      ),
    );
  }

  // 인쇄 영역도 당겨진다. 안 고치면 빈 열까지 인쇄 범위에 남는다.
  const lastColumn = columnName(stripped.lastColumn);
  const workbook = files['xl/workbook.xml'];
  if (workbook !== undefined) {
    const quoted = /[\s']/.test(guide.sheets.detail)
      ? `'${guide.sheets.detail.replace(/'/g, "''")}'`
      : guide.sheets.detail;
    patched['xl/workbook.xml'] = strToU8(
      strFromU8(workbook).replace(
        /<definedName name="_xlnm\.Print_Area" localSheetId="1">[^<]*<\/definedName>/,
        `<definedName name="_xlnm.Print_Area" localSheetId="1">` +
          `${quoted}!$A$1:$${lastColumn}$${layout.grandTotalRow}` +
          `</definedName>`,
      ),
    );
  }

  const ordered: Record<string, Uint8Array> = {
    '[Content_Types].xml': patched['[Content_Types].xml']!,
  };
  for (const [name, bytes] of Object.entries(patched)) {
    if (name !== '[Content_Types].xml') ordered[name] = bytes;
  }

  // **열 함수도 새 주소를 돌려줘야 한다.** 안 고치면 기대값과 검증 manifest 가
  // 지우기 전 글자를 가리켜, 비고 칸을 금액으로 대조하게 된다.
  const remappedColumn = (role: string): string => {
    const before = columnIndex(layout.column(role));
    const after = stripped.map.get(before);
    if (after === undefined) {
      throw new GuideWorkbookError(
        `'${role}' 열은 고객용에서 지워졌다. 그 열을 쓰려 하면 안 된다.`,
      );
    }
    return columnName(after);
  };

  return {
    ...base,
    bytes: zipSync(ordered),
    layout: {
      ...layout,
      printArea: `A1:${lastColumn}${layout.grandTotalRow}`,
      column: remappedColumn,
    },
  };
}

/**
 * 다른 시트를 가리키는 참조의 **열 글자**를 옮긴다.
 *
 * 세부내역에서 열을 지우면 갑지의 `세부내역!K25` 도 따라가야 한다.
 * 안 고치면 합계가 K 에서 J 로 왔는데 갑지는 K(비고) 를 읽고, 수량을
 * 고쳐도 갑지가 안 따라온다.
 *
 * 정규식을 쓰지 않는다 — 시트 이름에 어떤 글자가 들어올지 모르고,
 * 이스케이프를 한 번 틀리면 조용히 아무것도 안 바뀐다.
 */
export function remapCrossSheetRefs(
  xml: string,
  sheetName: string,
  map: ReadonlyMap<number, number | undefined>,
): string {
  const quoted = `'${sheetName.replace(/'/g, "''")}'`;
  let out = '';
  let at = 0;

  while (at < xml.length) {
    // 따옴표 있는 이름과 없는 이름을 둘 다 본다.
    const plainAt = xml.indexOf(`${sheetName}!`, at);
    const quotedAt = xml.indexOf(`${quoted}!`, at);
    const candidates = [plainAt, quotedAt].filter((n) => n !== -1);
    if (candidates.length === 0) {
      out += xml.slice(at);
      break;
    }
    const found = Math.min(...candidates);
    const prefix = found === quotedAt ? quoted : sheetName;
    const refStart = found + prefix.length + 1;

    out += xml.slice(at, refStart);

    // `$A$1` 꼴을 읽는다. 아니면 손대지 않는다.
    let cursor = refStart;
    let colAbs = '';
    if (xml[cursor] === '$') {
      colAbs = '$';
      cursor += 1;
    }
    let column = '';
    while (cursor < xml.length && xml[cursor]! >= 'A' && xml[cursor]! <= 'Z') {
      column += xml[cursor];
      cursor += 1;
    }
    let rowAbs = '';
    if (xml[cursor] === '$') {
      rowAbs = '$';
      cursor += 1;
    }
    let row = '';
    while (cursor < xml.length && xml[cursor]! >= '0' && xml[cursor]! <= '9') {
      row += xml[cursor];
      cursor += 1;
    }

    if (column === '' || row === '') {
      at = refStart;
      continue;
    }

    const moved = map.get(columnIndex(column));
    // 지워진 열을 가리키던 참조는 `#REF!` 로 둔다. 그대로 두면 엉뚱한 칸을
    // 가리키고, 그건 조용히 틀린 금액이 된다.
    out += moved === undefined ? '#REF!' : `${colAbs}${columnName(moved)}${rowAbs}${row}`;
    at = cursor;
  }

  return out;
}
