/**
 * 행의 노무 처리 방식을 바꾸는 순수 함수 (Task 6 노무 확인 보완 Task C).
 *
 * `workspace.ts`(React 훅)는 jsdom 없이 vitest로 단위 시험할 수 없다
 * (환경이 `node`뿐이다) — 그래서 "모드를 바꾸면 이전 금액·사유·확인을
 * 남기지 않는다"는 계약을 여기 순수 함수로 떼어 두고 여기서 직접
 * 시험한다. `workspace.ts`는 이 함수를 그대로 불러 쓰기만 한다.
 */
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
