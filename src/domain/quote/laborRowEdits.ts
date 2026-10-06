/**
 * 행의 노무 처리 방식을 바꾸는 순수 함수 (Task 6 노무 확인 보완 Task C).
 *
 * `workspace.ts`(React 훅)는 jsdom 없이 vitest로 단위 시험할 수 없다
 * (환경이 `node`뿐이다) — 그래서 "모드를 바꾸면 이전 금액·사유·확인을
 * 남기지 않는다"는 계약을 여기 순수 함수로 떼어 두고 여기서 직접
 * 시험한다. `workspace.ts`는 이 함수를 그대로 불러 쓰기만 한다.
 */
import { computeRowConfirmationFingerprint, type LaborReference, type LaborRowIdentity } from '../labor/calculateLabor';
import type { LaborMode, QuoteRow } from './types';

/**
 * mapped ↔ manual ↔ not-applicable 전환. 어느 방향이든 이전 수동
 * 단가·사유·노무 확인을 지운다 — 새 모드가 그 값들의 근거가 아니기
 * 때문이다(계획 §Task B "전환하면 이전 상태의 금액·사유를 남기지
 * 않는다").
 */
export function withLaborModeSwitch(row: QuoteRow, mode: LaborMode): QuoteRow {
  const { manualLaborUnitPrice: _manualLaborUnitPrice, overrideReason: _overrideReason, laborConfirmation: _laborConfirmation, ...rest } = row;
  return { ...rest, laborMode: mode };
}

/** 지금 지문으로 이 행의 품셈 연결을 확인한다. */
export function withLaborConfirmed(row: QuoteRow, basisFingerprint: string, confirmedAt: string): QuoteRow {
  return { ...row, laborConfirmation: { basisFingerprint, confirmedAt } };
}

/**
 * 화면이 **보여준**(`displayedFingerprint`) 근거와 확인 클릭 시점에
 * 다시 계산한 지금 지문이 같을 때만 확인한다(독립 검토 지적 — "그
 * 순간 재계산"은 "지금 다시 계산해 그냥 저장"이 아니라 "화면이 그린
 * 근거와 지금 근거가 같은지 비교"여야 한다). 둘이 다르면(화면이 그린
 * 뒤 문서가 바뀌었으면) `undefined`를 돌려준다 — 호출부는 아무 것도
 * 하지 않는다. `mapped` 모드가 아니거나 매핑을 못 찾아도 마찬가지다.
 *
 * basis-conflict 상태(기준이 바뀌어 재계산을 기다리는 중)에서 이
 * 함수를 부르는 것 자체를 막는 책임은 호출부(workspace.ts)에 있다 —
 * 그 상태에서는 `reference`가 지금 채택된 기준이 아닐 수 있다.
 */
export function confirmLaborRowIfDisplayedFingerprintMatches(
  row: QuoteRow,
  reference: LaborReference,
  identity: LaborRowIdentity,
  displayedFingerprint: string,
  confirmedAt: string,
): QuoteRow | undefined {
  if (row.laborMode !== 'mapped' || row.laborMappingId === undefined) return undefined;
  const currentFingerprint = computeRowConfirmationFingerprint(row.rowId, row.laborMappingId, reference, identity);
  if (currentFingerprint === undefined || currentFingerprint !== displayedFingerprint) return undefined;
  return withLaborConfirmed(row, currentFingerprint, confirmedAt);
}
