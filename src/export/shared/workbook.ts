/**
 * **사내 공유용(1단계)** 통합문서 (계획 2026-10-04 Task 5·6, 결정 D18).
 *
 * 고객용에 설명·품셈 근거·제조사/구매처·영업비고를 얹는다.
 * **원가·이윤·AI 메모는 얹지 않는다.**
 *
 * ## 왜 고객용 생성기를 그대로 부르는가
 *
 * 1단계를 따로 만들면 두 경로가 갈려서, 고객용에서 고친 것이 공유용에
 * 안 반영되거나 그 반대가 된다. 고객용을 **먼저 만들고** 그 위에
 * 허용된 칸만 덧쓴다. 빼는 방향으로만 가므로 되돌아갈 길이 없다.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import type { LaborBreakdown } from '../../domain/labor/calculateLabor';
import { buildGuideBase, type GuideWorkbookResult } from '../customer/guideWorkbook';
import * as F from '../ooxml/guideFormulas';
import { columnIndex, columnName } from '../ooxml/guideColumns';
import type { GuideTemplate } from '../ooxml/guideTemplate';
import type { SharedExport } from './projection';

const DETAIL_PART = 'xl/worksheets/sheet2.xml';

/** 노임이 적힌 행. 원본 3행이고, 머리 다섯 줄은 건드리지 않으므로 고정이다. */
const WAGE_ROW = 3;

interface CellEntry {
  value: string;
  numeric: boolean;
  formula?: boolean;
}

export class SharedWorkbookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SharedWorkbookError';
  }
}

/** 품셈 근거를 적을 칸들. 전부 **인쇄 영역 밖**이다. */
interface PumsemCells {
  /** 품셈 코드. */
  code: string;
  /** 품목별 요율. */
  itemRate: string;
  /** 할증. */
  surcharge: string;
  /** 표준단가 — 직종별 금액의 합. */
  standardUnitPrice: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function textCell(ref: string, style: string | undefined, value: string): string {
  const styleAttr = style === undefined ? '' : ` s="${style}"`;
  return (
    `<c r="${ref}"${styleAttr} t="inlineStr">` +
    `<is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
  );
}

function numberCell(ref: string, style: string | undefined, value: string): string {
  const styleAttr = style === undefined ? '' : ` s="${style}"`;
  return `<c r="${ref}"${styleAttr}><v>${escapeXml(value)}</v></c>`;
}

/**
 * 이미 있는 행에 칸을 덧쓴다.
 *
 * 그 칸이 이미 있으면 바꾸고, 없으면 **열 순서를 지켜** 끼워 넣는다.
 * 순서가 어긋나면 Excel 이 복구를 요구한다.
 */
function formulaCell(ref: string, style: string | undefined, formula: string): string {
  const styleAttr = style === undefined ? '' : ` s="${style}"`;
  return `<c r="${ref}"${styleAttr}><f>${escapeXml(formula)}</f></c>`;
}

function overwriteCells(
  sheetXml: string,
  valuesByRef: ReadonlyMap<string, CellEntry>,
): string {
  const columnIndex = (ref: string): number =>
    [...ref.replace(/\d+$/, '')].reduce(
      (acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64),
      0,
    );
  const rowOf = (ref: string): number =>
    Number.parseInt(ref.replace(/^[A-Z]+/, ''), 10);

  const byRow = new Map<number, string[]>();
  for (const ref of valuesByRef.keys()) {
    const list = byRow.get(rowOf(ref)) ?? [];
    list.push(ref);
    byRow.set(rowOf(ref), list);
  }

  return sheetXml.replace(
    /<row [^>]*\/>|<row [^>]*>[\s\S]*?<\/row>/g,
    (block) => {
      const attrs = /<row ([^>]*?)\/?>/.exec(block)?.[1] ?? '';
      const row = Number.parseInt(/\br="(\d+)"/.exec(attrs)?.[1] ?? '', 10);
      const refs = byRow.get(row);
      if (refs === undefined) return block;

      const cells = [...block.matchAll(/<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g)].map(
        (m) => m[0],
      );
      const styleOf = (ref: string): string | undefined => {
        const existing = cells.find((c) => c.includes(`r="${ref}"`));
        return existing === undefined
          ? undefined
          : (/\bs="(\d+)"/.exec(existing)?.[1] ?? undefined);
      };

      const kept = cells.filter(
        (c) => !refs.some((ref) => c.includes(`r="${ref}"`)),
      );
      for (const ref of refs) {
        const entry = valuesByRef.get(ref)!;
        kept.push(
          entry.formula === true
            ? formulaCell(ref, styleOf(ref), entry.value)
            : entry.numeric
              ? numberCell(ref, styleOf(ref), entry.value)
              : textCell(ref, styleOf(ref), entry.value),
        );
      }
      kept.sort((a, b) => {
        const refA = /\br="([A-Z]+\d+)"/.exec(a)?.[1] ?? 'A1';
        const refB = /\br="([A-Z]+\d+)"/.exec(b)?.[1] ?? 'A1';
        return columnIndex(refA) - columnIndex(refB);
      });

      const head = /<row [^>]*?>/.exec(block)?.[0] ?? `<row ${attrs}>`;
      const open = head.endsWith('/>') ? head.slice(0, -2) + '>' : head;
      return `${open}${kept.join('')}</row>`;
    },
  );
}

export interface SharedWorkbookInput {
  shared: SharedExport;
  guide: GuideTemplate;
}

export function buildSharedGuideWorkbook(
  input: SharedWorkbookInput,
): GuideWorkbookResult {
  if (input.guide.hasCost) {
    // 1단계는 원가 열이 없는 템플릿을 쓴다. 원가본을 주면 빈 원가 열이
    // 고객 아닌 직원에게 열린 채로 나간다.
    throw new SharedWorkbookError(
      `공유용은 원가 열이 없는 템플릿을 쓴다 (받은 것: ${input.guide.id}).`,
    );
  }
  return applySharedOverlay(input);
}

/**
 * 설명·품셈 근거·거래처를 얹는다. **원가 유무를 따지지 않는다.**
 *
 * 1단계와 0단계가 같은 일을 한다. 둘로 적으면 한쪽만 고쳐져 갈린다.
 * 원가 템플릿 금지는 1단계 쪽 입구(`buildSharedGuideWorkbook`)가 건다.
 */
export function applySharedOverlay(
  input: SharedWorkbookInput,
): GuideWorkbookResult {
  const { shared, guide } = input;
  // **열을 지우지 않은** 뼈대를 쓴다 — 설명·품셈·거래처를 그 위에 얹는다.
  const base = buildGuideBase(shared.customer, guide);
  const layout = base.layout;
  const files = unzipSync(base.bytes);
  const detail = files[DETAIL_PART];
  if (detail === undefined) throw new SharedWorkbookError('세부내역 시트가 없다.');

  const rowByRowId = new Map<string, number>();
  for (const planned of layout.rows) {
    if (planned.rowId !== undefined) rowByRowId.set(planned.rowId, planned.row);
  }

  const values = new Map<string, CellEntry>();
  const put = (ref: string, value: string, numeric = false): void => {
    if (value === '') return;
    values.set(ref, { value, numeric });
  };
  const putFormula = (ref: string, formula: string): void => {
    values.set(ref, { value: formula, numeric: false, formula: true });
  };

  for (const [rowId, row] of rowByRowId) {
    const description = shared.details.descriptionByRow.get(rowId);
    if (description !== undefined) {
      put(`${layout.column('description')}${row}`, description);
    }
    const supplier = shared.notes.supplierByRow.get(rowId);
    if (supplier !== undefined) put(`${layout.column('supplier')}${row}`, supplier);
    const salesRemark = shared.notes.salesRemarkByRow.get(rowId);
    if (salesRemark !== undefined) {
      put(`${layout.column('salesRemark')}${row}`, salesRemark);
    }

    const breakdown = shared.details.laborByRow.get(rowId);
    if (breakdown !== undefined) {
      const cells = pumsemCellsOf(breakdown);
      if (!breakdown.conversionFactor.equals(1)) {
        // 원본에 환산계수 칸이 없다. 수식으로는 엔진과 같은 값이 안 나온다.
        // 조용히 다른 값을 내보내지 않는다.
        throw new SharedWorkbookError(
          `품셈 ${breakdown.code} 의 환산계수가 1 이 아니다 ` +
            `(${breakdown.conversionFactor.toFixed()}). 원본 양식에 적을 칸이 없다.`,
        );
      }
      put(`${layout.column('pumsemCode')}${row}`, cells.code);
      put(`${layout.column('itemRate')}${row}`, cells.itemRate, true);
      put(`${layout.column('surcharge')}${row}`, cells.surcharge, true);

      const amountColumns = writeTrades(values, layout, guide, row, breakdown);
      // **표준단가와 노무비 단가를 수식으로 둔다.**
      // 상수로 박으면 사용자가 품이나 요율을 고쳐도 아무것도 안 따라온다.
      // 그러면 품셈 블록이 근거가 아니라 숫자 껍데기가 된다.
      putFormula(
        `${layout.column('standardUnitPrice')}${row}`,
        F.standardUnitPrice(amountColumns, row),
      );
      putFormula(`${layout.column('labor.unit')}${row}`, F.laborUnitPrice(layout, row));
    }
  }

  const patched: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(files)) patched[name] = bytes;
  patched[DETAIL_PART] = strToU8(overwriteCells(strFromU8(detail), values));

  const ordered: Record<string, Uint8Array> = {
    '[Content_Types].xml': patched['[Content_Types].xml']!,
  };
  for (const [name, bytes] of Object.entries(patched)) {
    if (name !== '[Content_Types].xml') ordered[name] = bytes;
  }

  return { ...base, bytes: zipSync(ordered) };
}

function pumsemCellsOf(breakdown: LaborBreakdown): PumsemCells {
  return {
    code: breakdown.code,
    itemRate: breakdown.itemRate.toFixed(),
    surcharge: breakdown.surcharge.toFixed(),
    standardUnitPrice: breakdown.standardUnitPrice.toFixed(),
  };
}

/**
 * 직종별 품을 쓴다.
 *
 * 직종 블록은 `품 / 금액` 두 칸 묶음이 직종 수만큼 이어진다. 품만 쓰고
 * **금액 칸은 비워 둔다** — 원본에서 금액은 `품 × 3행 노임` 수식이고,
 * 그 수식은 템플릿에 이미 있다.
 */
function writeTrades(
  values: Map<string, CellEntry>,
  layout: GuideWorkbookResult['layout'],
  guide: GuideTemplate,
  row: number,
  breakdown: LaborBreakdown,
): string[] {
  const firstIndex = columnIndex(layout.column('tradeFirst'));
  const amountColumns: string[] = [];

  for (const trade of breakdown.tradeAmounts) {
    if (trade.quantity.isZero()) continue;
    // **이름으로 칸을 찾는다.** 품셈의 직종 순서와 가이드의 열 순서가 같다는
    // 보장이 없다. 순서로 쓰면 보통인부의 품이 통신설비공 칸에 들어가고,
    // 노임이 달라 금액이 조용히 틀린다.
    const index = guide.trades.indexOf(trade.trade);
    if (index === -1) {
      // 가이드에 없는 직종이다. 아무 칸에나 쓰지 않는다 — 계산 엔진이
      // 이미 `wage-missing` 으로 출력을 막았다.
      continue;
    }
    const quantityColumn = columnName(firstIndex + index * 2);
    const amountColumn = columnName(firstIndex + index * 2 + 1);
    values.set(`${quantityColumn}${row}`, {
      value: trade.quantity.toFixed(),
      numeric: true,
    });
    // 금액도 **수식**이다. 품만 쓰고 금액을 비워 두면 근거가 반쪽이 된다.
    values.set(`${amountColumn}${row}`, {
      value: F.tradeAmount(quantityColumn, amountColumn, row, WAGE_ROW),
      numeric: false,
      formula: true,
    });
    amountColumns.push(amountColumn);
  }
  return amountColumns;
}
