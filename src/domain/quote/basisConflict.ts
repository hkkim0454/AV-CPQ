/**
 * 저장한 작업 파일을 다시 열 때, 계산에 쓴 기준(`DocumentVersions`)이 지금
 * 환경과 같은지 본다 — 다르면 조용히 새 기준으로 계산하지 않고 알린다
 * (계획 2026-10-04-quote-workspace-ui Task 4, 설계서 §6.3).
 *
 * ## 다섯 축을 세 곳에서 나눠 본다
 *
 * - `catalog`, `rule` — 이 파일이 본다. 둘 다 "이 값과 현재 상수/해시가
 *   같은가"로 끝나는 단순 대조라 가이드·노임 묶음이 필요 없다.
 * - `template` — `export/variants/prepare.ts`(`prepareQuote`)가 본다.
 *   가이드 묶음(`GuideTemplateSet`)을 쥔 유일한 자리이고, `preserve`에서
 *   다르면 거기서 바로 막는다(`GuideBasisError`). 여기서 같은 검사를
 *   다시 하면 한쪽만 고쳐져 조용히 갈린다.
 * - `labor`, `wage` — `prepareQuote`가 기존 `assertSameBasis`로 본다.
 *
 * ## `rule`은 입구 출처가 아니다
 *
 * 처음엔 `rule`을 "구성도 입력/직접 선택"처럼 입구별로 다른 문자열로
 * 적었다. 독립 검토 지적: 그건 "계산 규칙이 바뀌었는가"를 대조할 수 없는
 * 값이다(입구가 다르면 늘 다르고, 입구가 같으면 규칙이 실제로 바뀌어도
 * 늘 같다). 그래서 입구 출처는 `QuoteDocument.entryKind`로 옮기고,
 * `rule`은 케이블 계단·커넥터 3개 규칙·배관 거리×줄 수 공식·잡자재 LED
 * 제외 규칙의 **버전**(`buildDocument.ts`의 `CURRENT_RULE_VERSION`)만
 * 가리키게 했다.
 *
 * ## `treatUnknownAsConflict`
 *
 * 저장된 작업 파일을 다시 열 때는 **모든 축이 적혀 있어야 정상**이다
 * (`'unknown'`이면 그 자체가 충돌이다 — 독립 검토 지적: 예전엔 모르는
 * 값은 그냥 건너뛰어서, 다섯 축을 전부 지운 파일도 조용히 통과했다).
 * 반대로 새 문서(`loadDocument`)는 아직 아무 기준도 못 박은 상태라
 * `'unknown'`이 정상이다 — 호출부가 어느 경로인지 알려 줘야 한다.
 */
import type { QuoteDocument } from './types';
import { CURRENT_RULE_VERSION } from './buildDocument';

export interface BasisAxisConflict {
  readonly axis: 'catalog' | 'rule';
  readonly saved: string;
  readonly current: string;
}

function known(value: string): string | undefined {
  return value === '' || value === 'unknown' ? undefined : value;
}

export function computeDocumentBasisConflicts(
  document: QuoteDocument,
  current: { catalogSha256: string },
  options: { treatUnknownAsConflict: boolean },
): readonly BasisAxisConflict[] {
  const conflicts: BasisAxisConflict[] = [];

  const checkAxis = (axis: BasisAxisConflict['axis'], saved: string, currentValue: string) => {
    if (options.treatUnknownAsConflict) {
      if (saved !== currentValue) conflicts.push({ axis, saved, current: currentValue });
      return;
    }
    const knownSaved = known(saved);
    if (knownSaved !== undefined && knownSaved !== currentValue) {
      conflicts.push({ axis, saved: knownSaved, current: currentValue });
    }
  };

  checkAxis('catalog', document.versions.catalog, current.catalogSha256);
  checkAxis('rule', document.versions.rule, CURRENT_RULE_VERSION);

  return conflicts;
}

const AXIS_LABEL: Record<BasisAxisConflict['axis'], string> = {
  catalog: '카탈로그',
  rule: '계산 규칙(케이블/배관/잡자재 파생 규칙)',
};

export function describeBasisConflicts(conflicts: readonly BasisAxisConflict[]): string {
  return conflicts
    .map((c) => `${AXIS_LABEL[c.axis]} 기준이 바뀌었다(저장 당시 ${c.saved} → 지금 ${c.current})`)
    .join('. ');
}
