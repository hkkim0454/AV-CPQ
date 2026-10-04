/**
 * **사내 공유용(1단계), 다중 시스템.**
 *
 * 단일 시스템의 `applySharedOverlay`(`shared/workbook.ts`)와 같은 일 —
 * 설명·품셈 근거·거래처를 얹는다 — 를 세부내역 시트마다 되풀이한다.
 * 시스템마다 프로파일(가이드)이 다를 수 있으므로, 직종 열 목록도 그
 * 시스템 자신의 가이드에서 가져온다.
 *
 * 원가·AI 메모는 얹지 않는다 — 단일 시스템 경로와 같은 경계다.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import type { LaborBreakdown } from '../../domain/labor/calculateLabor';
import {
  buildMultiSystemGuideBase,
  type MultiSystemGuideWorkbookResult,
  type SystemSheetInfo,
} from '../customer/guideMultiSystem';
import { GuideWorkbookError } from '../customer/guideWorkbook';
import * as F from '../ooxml/guideFormulas';
import type { GuideTemplate } from '../ooxml/guideTemplate';
import type { SharedExport } from './projection';

const WAGE_ROW = 3;

interface CellEntry {
  value: string;
  numeric: boolean;
  formula?: boolean;
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
function formulaCell(ref: string, style: string | undefined, formula: string): string {
  const styleAttr = style === undefined ? '' : ` s="${style}"`;
  return `<c r="${ref}"${styleAttr}><f>${escapeXml(formula)}</f></c>`;
}

function overwriteCells(sheetXml: string, valuesByRef: ReadonlyMap<string, CellEntry>): string {
  const columnIndex = (ref: string): number =>
    [...ref.replace(/\d+$/, '')].reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
  const rowOf = (ref: string): number => Number.parseInt(ref.replace(/^[A-Z]+/, ''), 10);

  const byRow = new Map<number, string[]>();
  for (const ref of valuesByRef.keys()) {
    const list = byRow.get(rowOf(ref)) ?? [];
    list.push(ref);
    byRow.set(rowOf(ref), list);
  }

  return sheetXml.replace(/<row [^>]*\/>|<row [^>]*>[\s\S]*?<\/row>/g, (block) => {
    const attrs = /<row ([^>]*?)\/?>/.exec(block)?.[1] ?? '';
    const row = Number.parseInt(/\br="(\d+)"/.exec(attrs)?.[1] ?? '', 10);
    const refs = byRow.get(row);
    if (refs === undefined) return block;

    const cells = [...block.matchAll(/<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g)].map((m) => m[0]);
    const styleOf = (ref: string): string | undefined => {
      const existing = cells.find((c) => c.includes(`r="${ref}"`));
      return existing === undefined ? undefined : (/\bs="(\d+)"/.exec(existing)?.[1] ?? undefined);
    };

    const kept = cells.filter((c) => !refs.some((ref) => c.includes(`r="${ref}"`)));
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
  });
}

function pumsemCellsOf(breakdown: LaborBreakdown): {
  code: string;
  itemRate: string;
  surcharge: string;
  standardUnitPrice: string;
} {
  return {
    code: breakdown.code,
    itemRate: breakdown.itemRate.toFixed(),
    surcharge: breakdown.surcharge.toFixed(),
    standardUnitPrice: breakdown.standardUnitPrice.toFixed(),
  };
}

function writeTrades(
  values: Map<string, CellEntry>,
  layout: SystemSheetInfo['layout'],
  guide: GuideTemplate,
  row: number,
  breakdown: LaborBreakdown,
): string[] {
  const columns = F.tradeColumns(layout, guide.trades.length);
  const quantityByTrade = new Map<string, string>();
  for (const trade of breakdown.tradeAmounts) {
    if (trade.quantity.isZero()) continue;
    if (!guide.trades.includes(trade.trade)) continue;
    quantityByTrade.set(trade.trade, trade.quantity.toFixed());
  }

  const amountColumns: string[] = [];
  guide.trades.forEach((trade, index) => {
    const pair = columns[index]!;
    const quantity = quantityByTrade.get(trade);
    if (quantity !== undefined) {
      values.set(`${pair.quantity}${row}`, { value: quantity, numeric: true });
    }
    values.set(`${pair.amount}${row}`, {
      value: F.tradeAmount(pair.quantity, pair.amount, row, WAGE_ROW),
      numeric: false,
      formula: true,
    });
    amountColumns.push(pair.amount);
  });
  return amountColumns;
}

export interface MultiSystemSharedOverlayInput {
  shared: SharedExport;
  guideBySystemId: ReadonlyMap<string, GuideTemplate>;
}

/**
 * 다중 시스템에 설명·품셈 근거·거래처를 얹는다. **원가 유무를 따지지
 * 않는다** — 0·1단계 둘 다 쓴다(단일 시스템 경로와 같은 구조).
 */
export function applyMultiSystemSharedOverlay(
  input: MultiSystemSharedOverlayInput,
): MultiSystemGuideWorkbookResult {
  const { shared, guideBySystemId } = input;
  const base = buildMultiSystemGuideBase({ exported: shared.customer, guideBySystemId });
  const files = unzipSync(base.bytes);

  const patched: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(files)) patched[name] = bytes;

  const written = new Set<string>(base.writtenCells);

  base.systems.forEach((sys) => {
    const guide = guideBySystemId.get(sys.systemId);
    if (guide === undefined) {
      throw new GuideWorkbookError(`시스템 ${sys.systemId} 의 가이드가 없다.`);
    }
    const layout = sys.layout;
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
      if (description !== undefined) put(`${layout.column('description')}${row}`, description);
      const supplier = shared.notes.supplierByRow.get(rowId);
      if (supplier !== undefined) put(`${layout.column('supplier')}${row}`, supplier);
      const salesRemark = shared.notes.salesRemarkByRow.get(rowId);
      if (salesRemark !== undefined) put(`${layout.column('salesRemark')}${row}`, salesRemark);

      const breakdown = shared.details.laborByRow.get(rowId);
      if (breakdown !== undefined) {
        const cells = pumsemCellsOf(breakdown);
        put(`${layout.column('pumsemCode')}${row}`, cells.code);
        put(`${layout.column('itemRate')}${row}`, cells.itemRate, true);
        put(`${layout.column('surcharge')}${row}`, cells.surcharge, true);

        const amountColumns = writeTrades(values, layout, guide, row, breakdown);
        putFormula(
          `${layout.column('standardUnitPrice')}${row}`,
          F.standardUnitPrice(amountColumns, row),
        );
        putFormula(
          `${layout.column('labor.unit')}${row}`,
          F.laborUnitPrice(layout, row, breakdown.conversionFactor.toFixed()),
        );
        if (!breakdown.conversionFactor.equals(1)) {
          put(`${layout.column('laborNote')}${row}`, `환산 ×${breakdown.conversionFactor.toFixed()}`);
        }
      }
    }

    const detail = files[sys.partPath];
    if (detail === undefined) throw new GuideWorkbookError(`${sys.partPath} 가 없다.`);
    patched[sys.partPath] = strToU8(overwriteCells(strFromU8(detail), values));
    for (const ref of values.keys()) written.add(`${sys.partPath}!${ref}`);
  });

  const ordered: Record<string, Uint8Array> = {
    '[Content_Types].xml': patched['[Content_Types].xml']!,
  };
  for (const [name, bytes] of Object.entries(patched)) {
    if (name !== '[Content_Types].xml') ordered[name] = bytes;
  }

  return {
    ...base,
    bytes: zipSync(ordered),
    writtenCells: written,
  };
}

/** 1단계 입구 — 원가 템플릿을 받으면 거부한다(원가 열이 없는 템플릿만 쓴다). */
export function buildMultiSystemSharedGuideWorkbook(
  input: MultiSystemSharedOverlayInput,
): MultiSystemGuideWorkbookResult {
  for (const [systemId, guide] of input.guideBySystemId) {
    if (guide.hasCost) {
      throw new GuideWorkbookError(
        `공유용은 원가 열이 없는 템플릿을 쓴다 (시스템 ${systemId} 받은 것: ${guide.id}).`,
      );
    }
  }
  return applyMultiSystemSharedOverlay(input);
}
