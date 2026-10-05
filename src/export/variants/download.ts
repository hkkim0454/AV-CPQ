/**
 * 화면이 준비된 문서를 실제 고객용(2)·공유용(1) 출력으로 잇는다
 * (계획 2026-10-04-quote-workspace-ui Task 6).
 *
 * **원가를 받지 않는다.** 원가(InternalLine)를 받는 자리는
 * `export/internal/salesExportAction.ts` 뿐이다(계획 Task6 Interfaces:
 * "adapter는 1·2 입력에 원가 controller를 전달하지 않는다") —
 * `tools/audit-exports.mjs`가 이 파일 경로(`src/export/variants`)를
 * cost-free로 강제하므로, 여기서 원가 모듈을 import하면 감사가 막는다.
 *
 * 단일 시스템도 다중 시스템 조립 경로(`buildMultiSystemGuideBase`)로
 * 다룬다 — 계획이 확인한 API 그대로다. 그룹이 여러 개이거나 그룹에
 * 일부 시스템만 들어간 문서는 아직 갑지 조립이 지원하지 않으므로
 * 조용히 첫 그룹만 내지 않고 이유를 던져 막는다.
 */
import type { QuoteDocument } from '../../domain/quote/types';
import type { PreparedQuote } from './prepare';
import { quoteFileName } from './fileName';
import { buildCustomerProjection } from '../customer/projection';
import { buildMultiSystemCustomerGuideWorkbook } from '../customer/guideMultiSystem';
import { buildSharedProjection, type SharedNotes } from '../shared/projection';
import { buildMultiSystemSharedGuideWorkbook } from '../shared/workbookMulti';
import {
  selectGuide,
  type GuideTemplate,
  type GuideTemplateSet,
  type IndirectProfileId,
} from '../ooxml/guideTemplate';

export class ExportBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportBlockedError';
  }
}

export interface ExportFile {
  bytes: Uint8Array;
  fileName: string;
}

/** 시스템마다 자기 간접비 프로파일(DS/일반)에 맞는 가이드를 고른다. */
export function guideBySystemOf(
  document: QuoteDocument,
  guides: GuideTemplateSet,
  withCost: boolean,
): Map<string, GuideTemplate> {
  const map = new Map<string, GuideTemplate>();
  for (const system of document.systems) {
    const profile = (system.indirectProfileId as IndirectProfileId | undefined) ?? 'ds';
    map.set(system.systemId, selectGuide(guides, profile, withCost));
  }
  return map;
}

/**
 * 공통 출력 경계의 단일 게이트 — `prepared.blocking`이면 등급과 무관하게
 * 전부 거부한다(2026-10-05 독립 검토 지적: 전엔 화면 버튼의 disabled
 * 속성만이 유일한 방어선이었다 — 이 세 함수를 UI 없이 직접 불러도
 * blocking인 `prepared`로는 바이트를 만들 수 없어야 한다).
 */
export function assertExportAllowed(prepared: PreparedQuote): void {
  if (prepared.blocking) {
    throw new ExportBlockedError('해결되지 않은 구성도/품셈/계산 경고가 있어 출력할 수 없다.');
  }
}

/**
 * 그룹이 하나이고 그 그룹에 모든 시스템이 들어 있는지 확인한다.
 *
 * 여러 그룹이나 일부 시스템만 묶인 그룹은 지금 출력이 지원하지
 * 않는다 — 첫 그룹만 조용히 내보내지 않고 이유를 보여준다.
 */
export function assertSingleCompleteGroup(document: QuoteDocument): void {
  if (document.coverGroups.length !== 1) {
    throw new ExportBlockedError(
      `그룹이 ${document.coverGroups.length}개다 — 지금은 그룹이 하나뿐인 문서만 출력할 수 있다.`,
    );
  }
  const group = document.coverGroups[0]!;
  const groupIds = new Set(group.systemIds);
  const missing = document.systems.map((s) => s.systemId).filter((id) => !groupIds.has(id));
  if (missing.length > 0) {
    throw new ExportBlockedError(
      `그룹 '${group.name}'에 일부 시스템(${missing.join(', ')})이 빠져 있다 — ` +
        '지금은 그룹에 전체 시스템이 들어간 문서만 출력할 수 있다.',
    );
  }
}

/** 고객용(2단계) — 원가 없음, 설명/품셈 없음. */
export function buildCustomerDownload(prepared: PreparedQuote, guides: GuideTemplateSet): ExportFile {
  assertExportAllowed(prepared);
  assertSingleCompleteGroup(prepared.document);
  const exported = buildCustomerProjection(prepared.document, prepared.priced.calculation);
  const guideBySystemId = guideBySystemOf(prepared.document, guides, false);
  const result = buildMultiSystemCustomerGuideWorkbook({ exported, guideBySystemId });
  return {
    bytes: result.bytes,
    fileName: quoteFileName(prepared.document.header.projectName, prepared.document.header.quoteDate, 2),
  };
}

/** 공유용(1단계) — 설명/품셈/거래처 포함, 원가는 없음. */
export function buildSharedDownload(
  prepared: PreparedQuote,
  guides: GuideTemplateSet,
  notes: SharedNotes,
): ExportFile {
  assertExportAllowed(prepared);
  assertSingleCompleteGroup(prepared.document);
  const shared = buildSharedProjection(prepared, notes);
  const guideBySystemId = guideBySystemOf(prepared.document, guides, false);
  const result = buildMultiSystemSharedGuideWorkbook({ shared, guideBySystemId });
  return {
    bytes: result.bytes,
    fileName: quoteFileName(prepared.document.header.projectName, prepared.document.header.quoteDate, 1),
  };
}
