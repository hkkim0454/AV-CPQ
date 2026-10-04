/**
 * **영업팀용(0단계)** 통합문서 — 원가가 들어가는 **유일한** 경로
 * (계획 2026-10-04 Task 5·6, 결정 D18).
 *
 * ## 이 파일만 원가를 받는다
 *
 * `audit-exports.mjs` 가 `src/export/customer`·`src/export/shared`·
 * `src/export/variants` 를 원가 금지 경로로 검사한다. 원가 세션에 닿는
 * exporter 는 여기 하나뿐이다.
 *
 * ## 원가와 이윤은 한 덩어리다
 *
 * 원가 열(G·H)을 끄면 이윤 열(N)도 함께 꺼져야 한다. 이윤만 남아도
 * `판매가 ÷ (1 + 이윤율) = 원가` 로 역산된다. 그래서 0단계가 아니면
 * 둘 다 없는 템플릿을 쓴다 — 열을 비우는 게 아니라 **열이 없다.**
 *
 * ## AI 메모는 BF 고정
 *
 * 사용자 지시(2026-10-04 00:22): 표 중간에 열을 끼우지 말고 BF 에 적는다.
 * 0단계에만 쓴다. 1·2단계에는 메모 열도 값도 만들지 않는다.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import type { InternalLine } from '../../services/private-cost/calculate';
import { applySharedOverlay } from '../shared/workbook';
import type { SharedExport, SharedNotes } from '../shared/projection';
import type { GuideTemplate } from '../ooxml/guideTemplate';
import type { GuideWorkbookResult } from '../customer/guideWorkbook';
import * as F from '../ooxml/guideFormulas';

const DETAIL_PART = 'xl/worksheets/sheet2.xml';

/** 사용자가 지정한 AI 변환 메모 열. 17직종 블록 끝(BD) 다음 자리다. */
export const AI_NOTE_COLUMN = 'BF';

export class SalesWorkbookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SalesWorkbookError';
  }
}

/** 0단계에만 얹는 것. **원가가 여기에만 있다.** */
export interface SalesExtras extends SharedNotes {
  /** `internalLines(rows, session)` 결과. rowId 로 견적 행과 이어진다. */
  lines: readonly InternalLine[];
  /** rowId → AI 변환 메모. */
  aiNotesByRow: ReadonlyMap<string, string>;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 행에 칸을 덧쓴다. 없으면 **열 순서를 지켜** 끼워 넣는다.
 *
 * 순서가 어긋나면 Excel 이 복구를 요구한다.
 */
function overwrite(
  sheetXml: string,
  valuesByRef: ReadonlyMap<string, { value: string; numeric: boolean }>,
): string {
  const indexOf = (ref: string): number =>
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

  return sheetXml.replace(/<row [^>]*\/>|<row [^>]*>[\s\S]*?<\/row>/g, (block) => {
    const head = /<row [^>]*?>/.exec(block)?.[0] ?? '';
    const row = Number.parseInt(/\br="(\d+)"/.exec(head)?.[1] ?? '', 10);
    const refs = byRow.get(row);
    if (refs === undefined) return block;

    const cells = [...block.matchAll(/<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g)].map(
      (m) => m[0],
    );
    const styleOf = (ref: string): string => {
      const existing = cells.find((c) => c.includes(`r="${ref}"`));
      const style = existing === undefined ? undefined : /\bs="(\d+)"/.exec(existing)?.[1];
      return style === undefined ? '' : ` s="${style}"`;
    };

    const kept = cells.filter((c) => !refs.some((ref) => c.includes(`r="${ref}"`)));
    for (const ref of refs) {
      const entry = valuesByRef.get(ref)!;
      kept.push(
        entry.numeric
          ? `<c r="${ref}"${styleOf(ref)}><v>${escapeXml(entry.value)}</v></c>`
          : `<c r="${ref}"${styleOf(ref)} t="inlineStr">` +
            `<is><t xml:space="preserve">${escapeXml(entry.value)}</t></is></c>`,
      );
    }
    kept.sort((a, b) => {
      const refA = /\br="([A-Z]+\d+)"/.exec(a)?.[1] ?? 'A1';
      const refB = /\br="([A-Z]+\d+)"/.exec(b)?.[1] ?? 'A1';
      return indexOf(refA) - indexOf(refB);
    });

    const open = head.endsWith('/>') ? head.slice(0, -2) + '>' : head;
    return `${open}${kept.join('')}</row>`;
  });
}

export interface SalesWorkbookInput {
  shared: SharedExport;
  extras: SalesExtras;
  /** 원가 열이 있는 템플릿. `_원` 둘 중 하나다. */
  guide: GuideTemplate;
  /** 1단계 템플릿 — 공유용 생성기가 쓴다. 같은 프로파일이어야 한다. */
  baseGuide: GuideTemplate;
}

export function buildSalesGuideWorkbook(
  input: SalesWorkbookInput,
): GuideWorkbookResult {
  const { shared, extras, guide, baseGuide } = input;
  if (!guide.hasCost) {
    throw new SalesWorkbookError(
      `영업팀용은 원가 열이 있는 템플릿을 쓴다 (받은 것: ${guide.id}).`,
    );
  }
  if (guide.profile !== baseGuide.profile) {
    // 프로파일이 다르면 간접비 항목 수가 달라 행이 어긋난다.
    throw new SalesWorkbookError(
      `프로파일이 다르다: ${guide.profile} vs ${baseGuide.profile}.`,
    );
  }

  // 설명·품셈·거래처까지는 공유용과 **같은 함수**를 쓴다. 둘로 적으면
  // 한쪽만 고쳐져 0단계와 1단계가 갈린다.
  const base = applySharedOverlay({ shared, guide });
  const layout = base.layout;

  const rowByRowId = new Map<string, number>();
  for (const planned of layout.rows) {
    if (planned.rowId !== undefined) rowByRowId.set(planned.rowId, planned.row);
  }

  const values = new Map<string, { value: string; numeric: boolean }>();

  for (const line of extras.lines) {
    const row = rowByRowId.get(line.rowId);
    if (row === undefined) continue;
    if (line.purchaseUnitPrice === undefined) {
      // **미등록 원가는 빈 칸이다.** `0` 으로 채우면 공짜로 사 온 것이 된다.
      continue;
    }
    values.set(`${layout.column('cost.unit')}${row}`, {
      value: line.purchaseUnitPrice.toFixed(),
      numeric: true,
    });
  }

  for (const [rowId, note] of extras.aiNotesByRow) {
    const row = rowByRowId.get(rowId);
    if (row === undefined || note === '') continue;
    values.set(`${AI_NOTE_COLUMN}${row}`, { value: note, numeric: false });
  }

  const files = unzipSync(base.bytes);
  const detail = files[DETAIL_PART];
  if (detail === undefined) throw new SalesWorkbookError('세부내역 시트가 없다.');

  // 원가 금액과 이윤율은 **수식**이다. 수량을 고치면 따라와야 한다.
  let sheet = overwrite(strFromU8(detail), values);
  sheet = addCostFormulas(sheet, layout, values);

  const patched: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(files)) patched[name] = bytes;
  patched[DETAIL_PART] = strToU8(sheet);

  const ordered: Record<string, Uint8Array> = {
    '[Content_Types].xml': patched['[Content_Types].xml']!,
  };
  for (const [name, bytes] of Object.entries(patched)) {
    if (name !== '[Content_Types].xml') ordered[name] = bytes;
  }

  return { ...base, bytes: zipSync(ordered) };
}

/**
 * 원가 금액(`=F7*G7`)과 이윤율(`=IFERROR((I7/G7)-1,"-")`)을 넣는다.
 *
 * **원가 단가가 있는 행에만** 넣는다. 없는 행에 수식을 넣으면 0 으로 나누기가
 * 되거나 0 원이 되어, 원가가 없는 것과 공짜인 것이 같아 보인다.
 */
function addCostFormulas(
  sheetXml: string,
  layout: GuideWorkbookResult['layout'],
  values: ReadonlyMap<string, { value: string; numeric: boolean }>,
): string {
  const costUnit = layout.column('cost.unit');
  const rowsWithCost = new Set<number>();
  for (const ref of values.keys()) {
    if (ref.startsWith(costUnit) && /^\D+\d+$/.test(ref)) {
      const row = Number.parseInt(ref.replace(/^[A-Z]+/, ''), 10);
      if (layout.itemRows.some((planned) => planned.row === row)) rowsWithCost.add(row);
    }
  }
  if (rowsWithCost.size === 0) return sheetXml;

  const formulas = new Map<string, string>();
  for (const row of rowsWithCost) {
    formulas.set(`${layout.column('cost.amount')}${row}`, F.amount(layout, row, 'cost.unit'));
    formulas.set(`${layout.column('profit')}${row}`, F.profitRate(layout, row));
  }

  return sheetXml.replace(/<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g, (cell) => {
    const ref = /\br="([A-Z]+\d+)"/.exec(cell)?.[1];
    if (ref === undefined) return cell;
    const formula = formulas.get(ref);
    if (formula === undefined) return cell;
    const style = /\bs="(\d+)"/.exec(cell)?.[1];
    const styleAttr = style === undefined ? '' : ` s="${style}"`;
    return `<c r="${ref}"${styleAttr}><f>${escapeXml(formula)}</f></c>`;
  });
}
