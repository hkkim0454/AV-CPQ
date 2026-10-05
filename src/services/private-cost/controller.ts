/**
 * 원가 세션의 교체·폐기 규칙 — React 없이 순수한 리듀서로 둔다(계획
 * Task5, 독립 검토 지적 2026-10-05: 세션 폐기·지연 응답 무효화는
 * 타이밍에 기대지 않고 결정적으로 검증해야 한다).
 *
 * 비동기 파일 읽기는 이 모듈 바깥(React 훅)에서 한다. 그래서 "먼저
 * 고른 큰 파일이 나중에 고른 작은 파일보다 늦게 끝난다" 같은 경쟁
 * 상황을 실제 타이머 없이 **액션 호출 순서만으로** 재현하고 검증할
 * 수 있다.
 *
 * 문서 식별은 문서 **객체 참조**가 아니라 호출부가 넘기는
 * `documentGeneration`(정수)로 한다 — 참조는 같은 문서를 편집만 해도
 * 매번 바뀌므로, 참조로 가르면 수량 한 번만 고쳐도 "다른 문서"로
 * 오인해 세션을 지워 버린다(독립 검토 지적 2026-10-05). 문서가
 * **통째로 교체**될 때만(새 견적, 작업 파일 열기) 호출부가 이 번호를
 * 올린다(`workspace.ts`의 `documentGeneration`).
 */
import type { PriceEntry, PriceError } from './parse';
import { clearSession, createSession, type PrivateCostSession } from './session';

export interface PinnedSession {
  readonly session: PrivateCostSession;
  readonly documentGeneration: number;
  readonly fileName: string;
}

export type CostLoadStatus =
  | { kind: 'idle' }
  | { kind: 'loaded'; fileName: string; count: number }
  | { kind: 'rejected'; fileName: string; message: string }
  | { kind: 'invalid'; fileName: string; errors: readonly PriceError[] }
  /**
   * 통화·단위 열이 파일 머리글에 아예 없다 — 추측하지 않고 사람의
   * 명시 확인을 기다린다. 확인을 받으면 호출부가 같은 파일을 다시
   * 읽지 않고 이미 읽어 둔 표에 확인값만 더해 다시 파싱한다.
   */
  | { kind: 'needs-defaults'; fileName: string; missing: { currency: boolean; unit: boolean } };

export interface CostControllerState {
  readonly requestSeq: number;
  readonly pinned: PinnedSession | undefined;
  readonly status: CostLoadStatus;
}

export function initialCostControllerState(): CostControllerState {
  return { requestSeq: 0, pinned: undefined, status: { kind: 'idle' } };
}

/**
 * 파일을 고를 때마다(확장자를 지원하든 안 하든) 부른다. **선택한
 * 순간** 옛 세션을 즉시 폐기한다 — 결과가 아직 안 왔다고 복구하지
 * 않는다. 이 뒤에 읽기 실패·지원하지 않는 형식·파싱 오류·통화/단위
 * 확인 대기 중 무엇이 오더라도 옛 원가는 돌아오지 않는다(독립 검토
 * 지적 2026-10-05: "다른 파일을 고른다"는 행동 자체가 이전 연결의
 * 유효성을 무효화하는 신호다 — 실패해도 되살리지 않는다).
 */
export function beginCostLoad(state: CostControllerState): [CostControllerState, number] {
  if (state.pinned !== undefined) clearSession(state.pinned.session);
  const requestSeq = state.requestSeq + 1;
  return [{ requestSeq, pinned: undefined, status: { kind: 'idle' } }, requestSeq];
}

/** "원가 비우기" 버튼 — 다음 파일을 고르지 않아도 지금 세션을 바로 지운다. */
export function clearCostLoad(state: CostControllerState): CostControllerState {
  if (state.pinned !== undefined) clearSession(state.pinned.session);
  return { requestSeq: state.requestSeq + 1, pinned: undefined, status: { kind: 'idle' } };
}

interface FinishBase {
  requestId: number;
  fileName: string;
}

export type CostLoadResult =
  | ({ kind: 'read-error'; message: string } & FinishBase)
  | ({ kind: 'parse-errors'; errors: readonly PriceError[] } & FinishBase)
  | ({ kind: 'needs-defaults'; missing: { currency: boolean; unit: boolean } } & FinishBase)
  | ({ kind: 'parsed'; entries: readonly PriceEntry[]; documentGeneration: number } & FinishBase);

/**
 * 비동기 읽기/파싱이 끝났을 때 부른다. `requestId`가 지금 최신 번호와
 * 다르면(그 사이 다른 파일을 골랐거나 문서가 통째로 교체됐다) **조용히
 * 버린다** — 늦게 끝난 이전 결과가 최신 상태를 덮지 않는다.
 */
export function finishCostLoad(state: CostControllerState, result: CostLoadResult): CostControllerState {
  if (result.requestId !== state.requestSeq) return state; // 늦게 끝난 이전 선택 — 버린다

  if (result.kind === 'read-error') {
    return { ...state, status: { kind: 'rejected', fileName: result.fileName, message: result.message } };
  }
  if (result.kind === 'parse-errors') {
    return { ...state, status: { kind: 'invalid', fileName: result.fileName, errors: result.errors } };
  }
  if (result.kind === 'needs-defaults') {
    return { ...state, status: { kind: 'needs-defaults', fileName: result.fileName, missing: result.missing } };
  }

  // beginCostLoad가 이미 옛 세션을 지워 뒀다 — 여기서는 새 세션만 만든다.
  const session = createSession(result.entries);
  return {
    ...state,
    pinned: { session, documentGeneration: result.documentGeneration, fileName: result.fileName },
    status: { kind: 'loaded', fileName: result.fileName, count: result.entries.length },
  };
}

/**
 * 지금 문서 세대에 유효한 세션만 돌려준다 — 문서가 통째로 교체되면
 * (새 견적, 작업 파일 열기) `undefined`다. 같은 문서를 편집만 하면
 * (수량·설명·요율 등) `documentGeneration`이 그대로라 세션이 유지된다.
 *
 * 세션을 지우는 액션을 문서를 바꾸는 모든 자리에서 일일이 부르는 대신,
 * 노출 시점에 세대 번호 비교로 매번 다시 확인한다 — 문서를 바꾸는 새
 * 경로가 생겨도 이 비교 하나로 전부 막힌다.
 */
export function effectiveCostSession(
  state: CostControllerState,
  currentGeneration: number,
): PrivateCostSession | undefined {
  if (state.pinned === undefined) return undefined;
  return state.pinned.documentGeneration === currentGeneration ? state.pinned.session : undefined;
}

/**
 * 문서가 통째로 교체됐을 때(호출부의 `documentGeneration`이 바뀌었을
 * 때)만 부른다 — 호출됐다는 사실 자체가 "교체됐다"는 뜻이므로 세대를
 * 다시 비교하지 않고 무조건 지운다. 진행 중이던 요청(아직 끝나지 않은
 * needs-defaults/parsed 포함)도 `requestSeq`를 올려 전부 무효화한다 —
 * 그래야 교체 전에 시작한 파싱이 뒤늦게 도착해 새 세대에 잘못 붙는
 * 일이 없다.
 */
export function discardForNewGeneration(state: CostControllerState): CostControllerState {
  if (state.pinned !== undefined) clearSession(state.pinned.session);
  return { requestSeq: state.requestSeq + 1, pinned: undefined, status: { kind: 'idle' } };
}
