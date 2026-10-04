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

export function buildCustomerGuideWorkbook(
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
