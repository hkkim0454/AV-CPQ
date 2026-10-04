/**
 * 구성도 변환 경고 중 "사람이 모델/옵션을 다시 연결하면 해소되는" 것만
 * 문서의 **현재 상태**로 다시 평가한다 (계획 2026-10-04-quote-workspace-ui
 * Task 2 독립 검토 지적).
 *
 * 화면에서만 숨기면 안 된다 — `prepareQuote`에 넘기는 `importWarnings`도
 * 같은 기준으로 걸러야 `blocking`과 출력 차단이 실제로 풀린다. 그래서
 * 이 함수를 워크스페이스(`prepareNow`)와 화면(`WarningList`)이 **똑같이**
 * 쓴다 — 두 곳이 각자 판단하면 한쪽만 "해결됐다"고 보는 일이 생긴다.
 *
 * 경고 원본(`warnings`)은 건드리지 않는다. 이 함수는 매번 새로
 * 걸러낸 **부분집합**을 돌려줄 뿐이다 — 그래서 문서가 실행취소로
 * 되돌아가면, 다음 호출이 같은 조건을 다시 평가해 경고가 저절로
 * 다시 뜬다(별도 "해결됨" 상태를 안 둔다).
 */
import type { ImportWarning } from '../../import/diagram/devices';
import type { QuoteDocument, SheetRow } from './types';

type ItemRow = Extract<SheetRow, { type: 'item' }>;

function isFilled(row: ItemRow | undefined): boolean {
  return row !== undefined && row.sku !== undefined && row.sellingUnitPrice !== undefined;
}

/**
 * 본체 장비 행 — `optionId`가 없는 행만 본다. 옵션 행은 같은
 * `sourceNodeIds`를 가질 수 있으므로 여기서 제외해야, 본체를
 * 해결했다고 옵션 경고까지 조용히 사라지지 않는다.
 *
 * 노드 여럿이 한 행으로 합쳐졌으면(같은 미해결 모델이라 합쳐진 경우),
 * 그 행에 속한 노드 중 하나의 경고만 참조해도 행 전체가 해소된 것으로
 * 본다 — 부분 해결이 아니라, 애초에 "같은 것"이라서 합친 것이기
 * 때문이다(합친 수량 전체가 고른 제품 하나를 가리킨다).
 */
function deviceRowResolved(document: QuoteDocument, nodeId: string): boolean {
  const row = document.rows.find(
    (r): r is ItemRow =>
      r.type === 'item' && r.optionId === undefined && (r.sourceNodeIds?.includes(nodeId) ?? false),
  );
  return isFilled(row);
}

/** 옵션 행 — optionId로 정확히 찾는다. 본체 상태와 무관하다. */
function optionRowResolved(document: QuoteDocument, optionId: string): boolean {
  const row = document.rows.find((r): r is ItemRow => r.type === 'item' && r.optionId === optionId);
  return isFilled(row);
}

export function computeActiveWarnings(
  document: QuoteDocument,
  warnings: readonly ImportWarning[],
): readonly ImportWarning[] {
  return warnings.filter((warning) => {
    // 옵션 경고(optionId가 있으면 코드와 무관하게 전부) — 본체 행
    // 상태는 보지 않는다.
    if (warning.optionId !== undefined) {
      return !optionRowResolved(document, warning.optionId);
    }
    // 본체 장비 경고 — 아직 이 기능이 다루지 않는 다른 경고(가격 미등록,
    // 케이블·배관 관련 등)는 항상 유효한 것으로 둔다.
    if (
      (warning.code === 'device-not-in-catalog' || warning.code === 'device-ambiguous-match') &&
      warning.nodeId !== undefined
    ) {
      return !deviceRowResolved(document, warning.nodeId);
    }
    return true;
  });
}
