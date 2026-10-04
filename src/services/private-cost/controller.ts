/**
 * 원가 세션의 교체·폐기 규칙 — React 없이 순수한 리듀서로 둔다(계획
 * Task5, 독립 검토 지적 2026-10-05: 세션 폐기·지연 응답 무효화는
 * 타이밍에 기대지 않고 결정적으로 검증해야 한다).
 *
 * 비동기 파일 읽기는 이 모듈 바깥(React 훅)에서 한다. 그래서 "먼저
 * 고른 큰 파일이 나중에 고른 작은 파일보다 늦게 끝난다" 같은 경쟁
 * 상황을 실제 타이머 없이 **액션 호출 순서만으로** 재현하고 검증할
 * 수 있다.
 */
import type { PriceEntry, PriceError } from './parse';
import { clearSession, createSession, type PrivateCostSession } from './session';

export interface PinnedSession<Doc> {
  readonly session: PrivateCostSession;
  readonly sourceDocument: Doc;
  readonly fileName: string;
}

export type CostLoadStatus =
  | { kind: 'idle' }
  | { kind: 'loaded'; fileName: string; count: number }
  | { kind: 'rejected'; fileName: string; message: string }
  | { kind: 'invalid'; fileName: string; errors: readonly PriceError[] };

export interface CostControllerState<Doc> {
  readonly requestSeq: number;
  readonly pinned: PinnedSession<Doc> | undefined;
  readonly status: CostLoadStatus;
}

export function initialCostControllerState<Doc>(): CostControllerState<Doc> {
  return { requestSeq: 0, pinned: undefined, status: { kind: 'idle' } };
}

/** 파일을 고를 때마다 부른다. 반환된 번호를 비동기 읽기 끝에서 그대로 들고 온다. */
export function beginCostLoad<Doc>(state: CostControllerState<Doc>): [CostControllerState<Doc>, number] {
  const requestSeq = state.requestSeq + 1;
  return [{ ...state, requestSeq }, requestSeq];
}

interface FinishBase {
  requestId: number;
  fileName: string;
}

export type CostLoadResult<Doc> =
  | ({ kind: 'read-error'; message: string } & FinishBase)
  | ({ kind: 'parse-errors'; errors: readonly PriceError[] } & FinishBase)
  | ({ kind: 'parsed'; entries: readonly PriceEntry[]; document: Doc } & FinishBase);

/**
 * 비동기 읽기/파싱이 끝났을 때 부른다. `requestId`가 지금 최신 번호와
 * 다르면(그 사이 다른 파일을 골랐다) **조용히 버린다** — 늦게 끝난
 * 이전 결과가 최신 선택을 덮지 않는다.
 */
export function finishCostLoad<Doc>(
  state: CostControllerState<Doc>,
  result: CostLoadResult<Doc>,
): CostControllerState<Doc> {
  if (result.requestId !== state.requestSeq) return state; // 늦게 끝난 이전 선택 — 버린다

  if (result.kind === 'read-error') {
    return { ...state, status: { kind: 'rejected', fileName: result.fileName, message: result.message } };
  }
  if (result.kind === 'parse-errors') {
    return { ...state, status: { kind: 'invalid', fileName: result.fileName, errors: result.errors } };
  }

  // 새 세션으로 완전히 교체한다 — 옛 세션은 지운다(참조를 끊는다).
  // 옛 세션에서 사람이 확인해 연결한 자리표(entryId)는 새 세션의
  // sessionId를 품지 않으므로 더는 붙지 않는다(session.ts의
  // ownsEntryId) — 화면은 "미등록"이 아니라 "다시 연결하세요"를 띄운다.
  if (state.pinned !== undefined) clearSession(state.pinned.session);
  const session = createSession(result.entries);
  return {
    ...state,
    pinned: { session, sourceDocument: result.document, fileName: result.fileName },
    status: { kind: 'loaded', fileName: result.fileName, count: result.entries.length },
  };
}

/**
 * 지금 문서에 유효한 세션만 돌려준다 — 문서가 바뀌면(새 문서를 열거나
 * 작업 파일을 새로 열거나 undo/redo로 다른 문서가 되면) `undefined`다.
 *
 * 세션을 지우는 액션을 문서를 바꾸는 모든 자리에서 일일이 부르는 대신,
 * 노출 시점에 참조 동일성(`===`)으로 매번 다시 확인한다 —
 * `workspace.ts`의 `recalcPreview`/`sourceDocument`와 같은 설계다.
 * 문서를 바꾸는 새 경로가 생겨도 이 비교 하나로 전부 막힌다.
 */
export function effectiveCostSession<Doc>(
  state: CostControllerState<Doc>,
  currentDocument: Doc | undefined,
): PrivateCostSession | undefined {
  if (state.pinned === undefined) return undefined;
  return state.pinned.sourceDocument === currentDocument ? state.pinned.session : undefined;
}

/**
 * 문서가 바뀌어 세션이 더는 유효하지 않으면 물리적으로 치운다(참조를
 * 끊는다 — `clearSession`은 완전한 소거를 보장하지 않는다는 것이 기존
 * 설계의 명시적 전제다). `effectiveCostSession`은 이 호출 없이도 이미
 * 올바른 값을 반환하지만, 더 이상 쓸모없는 세션을 계속 메모리에 들고
 * 있을 이유가 없어 능동적으로도 치운다.
 */
export function discardIfStale<Doc>(
  state: CostControllerState<Doc>,
  currentDocument: Doc | undefined,
): CostControllerState<Doc> {
  if (state.pinned === undefined || state.pinned.sourceDocument === currentDocument) return state;
  clearSession(state.pinned.session);
  return { ...state, pinned: undefined, status: { kind: 'idle' } };
}
