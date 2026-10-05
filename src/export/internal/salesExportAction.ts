/**
 * 영업팀용(0단계) 출력 — 원가 세션에서 나온 값을 받는 **유일한** 자리
 * (계획 2026-10-04-quote-workspace-ui Task 6 Interfaces: "SalesExportAction만
 * 원가 세션에 접근한다").
 *
 * `src/export/internal`은 `tools/audit-exports.mjs`의 cost-free 목록에
 * 없다 — 원가를 받는 것이 이 디렉터리의 역할이다. 고객용/공유용
 * 어댑터(`export/variants/download.ts`)는 이 파일을 참조하지 않고,
 * 이 파일도 그 반대 방향(cost-free 쪽에서 쓰는 헬퍼를 가져오는 것)만
 * 한다 — 원가가 거슬러 올라가지 않는다.
 */
import type { PreparedQuote } from '../variants/prepare';
import { quoteFileName } from '../variants/fileName';
import { assertExportAllowed, assertSingleCompleteGroup, guideBySystemOf, type ExportFile } from '../variants/download';
import { buildSharedProjection, type SharedNotes } from '../shared/projection';
import { buildMultiSystemSalesGuideWorkbook, type MultiSystemSalesExtras } from './guideWorkbookMulti';
import type { GuideTemplateSet } from '../ooxml/guideTemplate';
import type { InternalLine } from '../../services/private-cost/calculate';

/** 영업팀용(0단계) — 원가·이윤·AI 메모 포함. */
export function buildSalesDownload(
  prepared: PreparedQuote,
  guides: GuideTemplateSet,
  notes: SharedNotes,
  lines: readonly InternalLine[],
  aiNotesByRow: ReadonlyMap<string, string>,
): ExportFile {
  assertExportAllowed(prepared, guides);
  assertSingleCompleteGroup(prepared.document);
  const shared = buildSharedProjection(prepared, notes);
  const guideBySystemId = guideBySystemOf(prepared.document, guides, true);
  const baseGuideBySystemId = guideBySystemOf(prepared.document, guides, false);
  const extras: MultiSystemSalesExtras = { ...notes, lines, aiNotesByRow };
  const result = buildMultiSystemSalesGuideWorkbook({ shared, extras, guideBySystemId, baseGuideBySystemId });
  return {
    bytes: result.bytes,
    fileName: quoteFileName(prepared.document.header.projectName, prepared.document.header.quoteDate, 0),
  };
}
