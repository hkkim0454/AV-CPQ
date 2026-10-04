/**
 * 저장한 작업 파일을 다시 열 때, 계산에 쓴 기준(`DocumentVersions`)이 지금
 * 환경과 같은지 본다 — 다르면 조용히 새 기준으로 계산하지 않고 알린다
 * (계획 2026-10-04-quote-workspace-ui Task 4, 설계서 §6.3).
 *
 * ## 다섯 축 중 이 파일이 보는 것은 둘뿐이다
 *
 * - `catalog` — 지금 승인 카탈로그의 `sourceSha256`과 대조한다.
 * - `template` — `buildDocument.ts`의 `CURRENT_TEMPLATE_VERSION` 한
 *   곳과만 대조한다(문서를 새로 만들 때 쓰는 값과 같은 상수).
 *
 * `labor`/`wage`는 여기서 다루지 않는다 — `prepareQuote`의
 * `wageMode:'preserve'`가 이미 `assertSameBasis`로 막는다
 * (`export/variants/prepare.ts`). 같은 검사를 두 번 적으면 한쪽만 고쳐져
 * 조용히 갈린다.
 *
 * `rule`은 아예 비교하지 않는다 — 이건 기준이 아니라 **출처 표식**이다
 * (구성도 입력은 `'diagram-2026-10-04'`, 직접 선택은 `'manual-pick'`처럼
 * 입구마다 값이 다르게 박힌다). 시간이 지나 "낡는" 값이 아니므로 대조할
 * "지금의 rule"이라는 게 성립하지 않는다 — 추측해서 거짓 비교를 만들지
 * 않는다.
 */
import type { QuoteDocument } from './types';
import { CURRENT_TEMPLATE_VERSION } from './buildDocument';

export interface BasisAxisConflict {
  readonly axis: 'catalog' | 'template';
  readonly saved: string;
  readonly current: string;
}

function known(value: string): string | undefined {
  return value === '' || value === 'unknown' ? undefined : value;
}

/** 문서에 기준이 안 적혀 있으면(옛 문서·'unknown') 대조하지 않는다 — 없는 값과 비교해 거짓 충돌을 만들지 않는다. */
export function computeDocumentBasisConflicts(
  document: QuoteDocument,
  current: { catalogSha256: string },
): readonly BasisAxisConflict[] {
  const conflicts: BasisAxisConflict[] = [];

  const savedCatalog = known(document.versions.catalog);
  if (savedCatalog !== undefined && savedCatalog !== current.catalogSha256) {
    conflicts.push({ axis: 'catalog', saved: savedCatalog, current: current.catalogSha256 });
  }

  const savedTemplate = known(document.versions.template);
  if (savedTemplate !== undefined && savedTemplate !== CURRENT_TEMPLATE_VERSION) {
    conflicts.push({ axis: 'template', saved: savedTemplate, current: CURRENT_TEMPLATE_VERSION });
  }

  return conflicts;
}

const AXIS_LABEL: Record<BasisAxisConflict['axis'], string> = {
  catalog: '카탈로그',
  template: '가이드 템플릿',
};

export function describeBasisConflicts(conflicts: readonly BasisAxisConflict[]): string {
  return conflicts
    .map((c) => `${AXIS_LABEL[c.axis]} 기준이 바뀌었다(저장 당시 ${c.saved} → 지금 ${c.current})`)
    .join('. ');
}
