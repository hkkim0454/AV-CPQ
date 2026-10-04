/**
 * **영업팀용(0단계), 다중 시스템** — 원가가 들어가는 유일한 경로.
 *
 * 단일 시스템의 `buildSalesGuideWorkbook`(`internal/guideWorkbook.ts`)과
 * 같은 일을 세부내역 시트마다 되풀이한다. `overwrite`·`addCostFormulas`·
 * `rowsWithCostFormulas`·`AI_NOTE_COLUMN` 은 단일 시스템 모듈에서 그대로
 * 가져다 쓴다 — 같은 수식 생성 규칙을 두 번 적지 않는다.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import type { InternalLine } from '../../services/private-cost/calculate';
import {
  applyMultiSystemSharedOverlay,
  type MultiSystemSharedOverlayInput,
} from '../shared/workbookMulti';
import type { SharedNotes } from '../shared/projection';
import type { GuideTemplate } from '../ooxml/guideTemplate';
import { GuideWorkbookError } from '../customer/guideWorkbook';
import type { MultiSystemGuideWorkbookResult } from '../customer/guideMultiSystem';
import {
  AI_NOTE_COLUMN,
  addCostFormulas,
  overwrite,
  rowsWithCostFormulas,
  SalesWorkbookError,
} from './guideWorkbook';

export interface MultiSystemSalesExtras extends SharedNotes {
  lines: readonly InternalLine[];
  aiNotesByRow: ReadonlyMap<string, string>;
}

export interface MultiSystemSalesWorkbookInput {
  shared: MultiSystemSharedOverlayInput['shared'];
  extras: MultiSystemSalesExtras;
  /** 시스템 id → 원가 열이 있는 템플릿(`_원` 둘 중 하나). */
  guideBySystemId: ReadonlyMap<string, GuideTemplate>;
  /** 시스템 id → 1단계가 쓰는, 원가 열이 없는 같은 프로파일 템플릿. */
  baseGuideBySystemId: ReadonlyMap<string, GuideTemplate>;
}

export function buildMultiSystemSalesGuideWorkbook(
  input: MultiSystemSalesWorkbookInput,
): MultiSystemGuideWorkbookResult {
  const { shared, extras, guideBySystemId, baseGuideBySystemId } = input;

  for (const [systemId, guide] of guideBySystemId) {
    if (!guide.hasCost) {
      throw new SalesWorkbookError(
        `영업팀용은 원가 열이 있는 템플릿을 쓴다 (시스템 ${systemId} 받은 것: ${guide.id}).`,
      );
    }
    const baseGuide = baseGuideBySystemId.get(systemId);
    if (baseGuide === undefined) {
      throw new GuideWorkbookError(`시스템 ${systemId} 의 1단계 가이드가 없다.`);
    }
    if (guide.profile !== baseGuide.profile) {
      throw new SalesWorkbookError(
        `시스템 ${systemId}: 프로파일이 다르다 (${guide.profile} vs ${baseGuide.profile}).`,
      );
    }
  }

  // 설명·품셈·거래처까지는 공유용과 같은 함수를 쓴다 — guide 는 원가
  // 템플릿 그대로 넘긴다(단일 시스템 경로와 같은 구조: 원가 열은 템플릿에
  // 이미 있고, 이 단계가 하는 일은 값·수식을 채우는 것뿐이다).
  const base = applyMultiSystemSharedOverlay({ shared, guideBySystemId });

  const files = unzipSync(base.bytes);
  const patched: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(files)) patched[name] = bytes;

  const written = new Set<string>(base.writtenCells);

  base.systems.forEach((sys) => {
    const layout = sys.layout;
    const rowByRowId = new Map<string, number>();
    for (const planned of layout.rows) {
      if (planned.rowId !== undefined) rowByRowId.set(planned.rowId, planned.row);
    }

    const values = new Map<string, { value: string; numeric: boolean }>();
    for (const line of extras.lines) {
      const row = rowByRowId.get(line.rowId);
      if (row === undefined) continue;
      if (line.purchaseUnitPrice === undefined) continue; // 미등록 원가는 빈 칸이다.
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

    const detail = patched[sys.partPath];
    if (detail === undefined) throw new SalesWorkbookError(`${sys.partPath} 가 없다.`);

    let sheet = overwrite(strFromU8(detail), values);
    sheet = addCostFormulas(sheet, layout, values);
    patched[sys.partPath] = strToU8(sheet);

    for (const ref of values.keys()) written.add(`${sys.partPath}!${ref}`);
    for (const ref of rowsWithCostFormulas(layout, values)) written.add(`${sys.partPath}!${ref}`);
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
