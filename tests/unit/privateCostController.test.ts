import { describe, expect, it } from 'vitest';
import {
  beginCostLoad,
  clearCostLoad,
  discardForNewGeneration,
  effectiveCostSession,
  finishCostLoad,
  initialCostControllerState,
  type CostControllerState,
} from '@/services/private-cost/controller';
import type { PriceEntry } from '@/services/private-cost/parse';

/**
 * 원가 세션 교체·폐기 규칙 — 독립 검토 지적(2026-10-05): 원가파일
 * 교체/문서 교체 시 세션 폐기, 지연 응답 무효화를 실제 타이밍에 기대지
 * 않고 결정적으로 검증한다.
 *
 * 문서 식별은 `documentGeneration`(정수)로 한다 — 문서 **교체**(새
 * 견적/작업 파일 열기)에서만 호출부가 올린다. 같은 문서를 편집만 하면
 * (수량 등) 이 번호가 그대로라 세션이 유지돼야 한다(두 번째 독립 검토
 * 지적: 참조 동일성으로 가르면 편집할 때마다 세션이 사라졌다).
 */

const entry = (entryId: string, price: string): PriceEntry => ({
  entryId,
  model: `MODEL-${entryId}`,
  purchaseUnitPrice: price,
  currency: 'KRW',
  unit: 'EA',
});

function loadedAt(generation: number): CostControllerState {
  let state = initialCostControllerState();
  const [s1, req1] = beginCostLoad(state);
  state = finishCostLoad(s1, {
    kind: 'parsed',
    requestId: req1,
    fileName: 'a.csv',
    entries: [entry('row-1', '1000000')],
    documentGeneration: generation,
  });
  return state;
}

describe('원가 파일 교체 — 선택한 순간 옛 세션을 즉시 지운다(성공이든 실패든)', () => {
  it('두 번째 파일을 올리면 첫 세션의 entryId는 더는 붙지 않는다', () => {
    let state = loadedAt(1);
    const firstSession = state.pinned!.session;
    const firstEntryId = firstSession.candidatesByModel('MODEL-row-1')[0]!.entryId;
    expect(firstSession.ownsEntryId(firstEntryId)).toBe(true);

    const [s2, req2] = beginCostLoad(state);
    // begin 시점에 이미 옛 세션이 지워진다 — finish를 기다리지 않는다.
    expect(s2.pinned).toBeUndefined();
    expect(firstSession.cleared).toBe(true);

    state = finishCostLoad(s2, {
      kind: 'parsed',
      requestId: req2,
      fileName: 'b.csv',
      entries: [entry('row-1', '2000000')],
      documentGeneration: 1,
    });
    expect(state.pinned!.session.ownsEntryId(firstEntryId)).toBe(false);
  });

  it('새 파일이 읽기 실패여도 옛 세션은 되살아나지 않는다', () => {
    const state = loadedAt(1);
    const firstSession = state.pinned!.session;

    const [s2, req2] = beginCostLoad(state);
    const failed = finishCostLoad(s2, { kind: 'read-error', requestId: req2, fileName: 'bad.csv', message: '읽기 실패' });

    expect(failed.pinned).toBeUndefined();
    expect(failed.status).toEqual({ kind: 'rejected', fileName: 'bad.csv', message: '읽기 실패' });
    expect(firstSession.cleared).toBe(true);
  });

  it('새 파일이 파싱 오류여도 옛 세션은 되살아나지 않는다', () => {
    const state = loadedAt(1);
    const firstSession = state.pinned!.session;

    const [s2, req2] = beginCostLoad(state);
    const failed = finishCostLoad(s2, {
      kind: 'parse-errors',
      requestId: req2,
      fileName: 'bad.csv',
      errors: [{ code: 'price-empty', row: 1, message: '비었다' }],
    });

    expect(failed.pinned).toBeUndefined();
    expect(firstSession.cleared).toBe(true);
  });

  it('새 파일이 통화/단위 확인 대기여도 옛 세션은 되살아나지 않는다', () => {
    const state = loadedAt(1);
    const firstSession = state.pinned!.session;

    const [s2, req2] = beginCostLoad(state);
    const waiting = finishCostLoad(s2, {
      kind: 'needs-defaults',
      requestId: req2,
      fileName: 'needs.csv',
      missing: { currency: true, unit: false },
    });

    expect(waiting.pinned).toBeUndefined();
    expect(firstSession.cleared).toBe(true);
  });

  it('원가 비우기(clearCostLoad)는 다음 파일을 고르지 않아도 바로 지운다', () => {
    const state = loadedAt(1);
    const firstSession = state.pinned!.session;
    const cleared = clearCostLoad(state);
    expect(cleared.pinned).toBeUndefined();
    expect(cleared.status).toEqual({ kind: 'idle' });
    expect(firstSession.cleared).toBe(true);
  });
});

describe('지연 응답 무효화 — 늦게 끝난 이전 선택은 버린다', () => {
  it('먼저 고른 파일의 결과가 나중에 고른 파일보다 늦게 도착해도 최신 선택을 덮지 않는다', () => {
    let state = initialCostControllerState();
    const [s1, reqA] = beginCostLoad(state);
    state = s1;
    const [s2, reqB] = beginCostLoad(state);
    state = s2;

    state = finishCostLoad(state, {
      kind: 'parsed',
      requestId: reqB,
      fileName: 'b-small.csv',
      entries: [entry('row-1', '2000000')],
      documentGeneration: 1,
    });
    expect(state.status).toMatchObject({ kind: 'loaded', fileName: 'b-small.csv' });

    state = finishCostLoad(state, {
      kind: 'parsed',
      requestId: reqA,
      fileName: 'a-big.csv',
      entries: [entry('row-1', '1000000')],
      documentGeneration: 1,
    });

    expect(state.status).toMatchObject({ kind: 'loaded', fileName: 'b-small.csv' });
    expect(state.pinned!.fileName).toBe('b-small.csv');
  });

  it('needs-defaults 결과도 늦게 끝난 이전 선택이면 버린다', () => {
    let state = initialCostControllerState();
    const [s1, reqA] = beginCostLoad(state);
    state = s1;
    const [s2, reqB] = beginCostLoad(state);
    state = s2;

    state = finishCostLoad(state, {
      kind: 'parsed',
      requestId: reqB,
      fileName: 'b.csv',
      entries: [entry('row-1', '2000000')],
      documentGeneration: 1,
    });
    state = finishCostLoad(state, {
      kind: 'needs-defaults',
      requestId: reqA,
      fileName: 'a.csv',
      missing: { currency: true, unit: false },
    });

    expect(state.status).toMatchObject({ kind: 'loaded', fileName: 'b.csv' });
  });
});

describe('문서 교체 — 통째로 바뀔 때만 세션이 무효화된다', () => {
  it('같은 문서 세대에서는 세션이 그대로 유효하다', () => {
    const state = loadedAt(1);
    expect(effectiveCostSession(state, 1)).toBe(state.pinned!.session);
  });

  it('다른 세대가 되면(새 문서를 열거나 작업 파일을 다시 열면) 세션이 보이지 않는다', () => {
    const state = loadedAt(1);
    expect(effectiveCostSession(state, 2)).toBeUndefined();
  });

  it('discardForNewGeneration은 세대가 바뀌었을 때 세션을 실제로 치운다', () => {
    const state = loadedAt(1);
    const session = state.pinned!.session;
    const next = discardForNewGeneration(state);
    expect(next.pinned).toBeUndefined();
    expect(next.status).toEqual({ kind: 'idle' });
    expect(session.cleared).toBe(true);
  });

  it('진행 중이던 요청도 세대 교체와 함께 무효화된다(requestSeq가 올라간다)', () => {
    const state = loadedAt(1);
    const [afterBegin, requestId] = beginCostLoad(state); // 새 파일을 고르는 중이라고 하자
    // 그 사이 문서가 통째로 바뀐다.
    const afterGenerationChange = discardForNewGeneration(afterBegin);
    // 교체 전에 시작한 파싱이 뒤늦게 도착한다 — 버려야 한다.
    const late = finishCostLoad(afterGenerationChange, {
      kind: 'parsed',
      requestId,
      fileName: 'late.csv',
      entries: [entry('row-1', '999')],
      documentGeneration: 1,
    });
    expect(late.pinned).toBeUndefined();
  });
});

describe('격리 — 세션 상태를 직렬화해도 원가 값이 새지 않는다', () => {
  it('JSON.stringify(state)에 매입단가 값이 없다', () => {
    const state = loadedAt(1);
    expect(JSON.stringify(state)).not.toContain('1000000');
    expect(JSON.stringify(state.pinned)).not.toContain('1000000');
  });
});
