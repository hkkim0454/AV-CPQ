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
  guideTemplateFingerprint,
  selectGuide,
  type GuideTemplate,
  type GuideTemplateSet,
  type IndirectProfileId,
} from '../ooxml/guideTemplate';
import { assertSameBasis, GuideBasisError, type BasisVersions } from '../../data/catalog/guideBasis';

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
 * 공통 출력 경계의 단일 게이트 — 등급과 무관하게 전부 거부한다
 * (2026-10-05 독립 검토 지적: 전엔 화면 버튼의 disabled 속성만이 유일한
 * 방어선이었다 — 이 세 함수를 UI 없이 직접 불러도 막혀야 한다).
 *
 * **`blocking` 플래그만 보는 것으로는 부족하다**(재지적) — `prepared`가
 * 과거 한때는(그 시점 기준으로) 유효했더라도(`blocking: false`), **지금
 * 넘겨받은 `guides`와 그 문서가 기록한 가이드 템플릿 기준이 다르면**
 * 옛 계산 결과를 지금 기준인 것처럼 출력하는 셈이다. `prepareQuote`의
 * `assertSameTemplate`(재계산·재열기 경로)과 같은 비교를, 실제로 바이트를
 * 쓰는 이 경계에서 **한 번 더** 한다 — 호출부가 신선한 `prepared`를
 * 들고 있었다는 것만 믿지 않는다.
 *
 * **템플릿 지문과 노임(wage)/품셈(labor) 지문은 별개다**(2026-10-05 독립
 * 검토 재지적) — "화면이 새 `prepared`를 안 만든다"는 것만으로는, 이
 * 공통 함수가 **UI 없이 직접 받는** stale `prepared`를 막는 것을
 * 대체하지 못한다. 그래서 호출부가 지금 채택한 `currentBasisVersions`
 * (`labor`/`wage`)까지 받아, `prepareQuote`가 재열기·재계산 경로에서
 * 쓰는 것과 같은 `assertSameBasis`로 한 번 더 비교한다.
 */
export function assertExportAllowed(
  prepared: PreparedQuote,
  guides: GuideTemplateSet,
  currentBasisVersions: BasisVersions,
): void {
  if (prepared.blocking) {
    throw new ExportBlockedError('해결되지 않은 구성도/품셈/계산 경고가 있어 출력할 수 없다.');
  }
  const currentTemplate = guideTemplateFingerprint(guides);
  if (prepared.document.versions.template !== currentTemplate) {
    throw new ExportBlockedError(
      '이 견적은 지금과 다른 가이드 템플릿 기준으로 계산됐다 — 출력하지 않는다. ' +
        '명시적으로 재계산을 거쳐야 한다.',
    );
  }
  try {
    assertSameBasis(
      { labor: prepared.document.versions.labor, wage: prepared.document.versions.wage },
      currentBasisVersions,
    );
  } catch (err) {
    if (err instanceof GuideBasisError) {
      throw new ExportBlockedError(err.message);
    }
    throw err;
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
export function buildCustomerDownload(
  prepared: PreparedQuote,
  guides: GuideTemplateSet,
  currentBasisVersions: BasisVersions,
): ExportFile {
  assertExportAllowed(prepared, guides, currentBasisVersions);
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
  currentBasisVersions: BasisVersions,
): ExportFile {
  assertExportAllowed(prepared, guides, currentBasisVersions);
  assertSingleCompleteGroup(prepared.document);
  const shared = buildSharedProjection(prepared, notes);
  const guideBySystemId = guideBySystemOf(prepared.document, guides, false);
  const result = buildMultiSystemSharedGuideWorkbook({ shared, guideBySystemId });
  return {
    bytes: result.bytes,
    fileName: quoteFileName(prepared.document.header.projectName, prepared.document.header.quoteDate, 1),
  };
}
