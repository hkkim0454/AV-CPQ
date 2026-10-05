import { describe, expect, it } from 'vitest';
import {
  beginCostLoad,
  discardIfStale,
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
 * `Doc`은 여기서는 단순 문자열로 대신한다 — 문서 "자체"가 아니라
 * **참조 동일성**만으로 유효성을 가르는 로직이라, 실제 QuoteDocument
 * 타입이 필요 없다.
 */

const entry = (entryId: string, price: string): PriceEntry => ({
  entryId,
  model: `MODEL-${entryId}`,
  purchaseUnitPrice: price,
  currency: 'KRW',
  unit: 'EA',
});

describe('원가 파일 교체 — 옛 세션을 완전히 버린다', () => {
  it('두 번째 파일을 올리면 첫 세션의 entryId는 더는 붙지 않는다', () => {
    let state = initialCostControllerState<string>();
    const [s1, req1] = beginCostLoad(state);
    state = finishCostLoad(s1, {
      kind: 'parsed',
      requestId: req1,
      fileName: 'a.csv',
      entries: [entry('row-1', '1000000')],
      document: 'doc-A',
    });
    // 첫 세션이 실제로 자리표를 붙였는지 먼저 확인한다.
    const firstEntryId = state.pinned!.session.candidatesByModel('MODEL-row-1')[0]!.entryId;
    expect(state.pinned!.session.ownsEntryId(firstEntryId)).toBe(true);

    const [s2, req2] = beginCostLoad(state);
    state = finishCostLoad(s2, {
      kind: 'parsed',
      requestId: req2,
      fileName: 'b.csv',
      entries: [entry('row-1', '2000000')],
      document: 'doc-A',
    });

    // 새 세션은 첫 세션이 발급한 자리표를 모른다 — "다시 연결하세요"로
    // 이어진다(calculate.ts의 costLinkStale 경로).
    expect(state.pinned!.session.ownsEntryId(firstEntryId)).toBe(false);
    expect(state.pinned!.session.byEntryId(firstEntryId)).toBeUndefined();
  });

  it('옛 세션은 지워진다(clearSession) — size가 0이 되고 cleared가 true다', () => {
    let state = initialCostControllerState<string>();
    const [s1, req1] = beginCostLoad(state);
    state = finishCostLoad(s1, {
      kind: 'parsed',
      requestId: req1,
      fileName: 'a.csv',
      entries: [entry('row-1', '1000000')],
      document: 'doc-A',
    });
    const firstSession = state.pinned!.session;
    expect(firstSession.cleared).toBe(false);

    const [s2, req2] = beginCostLoad(state);
    finishCostLoad(s2, {
      kind: 'parsed',
      requestId: req2,
      fileName: 'b.csv',
      entries: [entry('row-1', '2000000')],
      document: 'doc-A',
    });

    expect(firstSession.cleared).toBe(true);
    expect(firstSession.size).toBe(0);
  });
});

describe('지연 응답 무효화 — 늦게 끝난 이전 선택은 버린다', () => {
  it('먼저 고른 파일의 결과가 나중에 고른 파일보다 늦게 도착해도 최신 선택을 덮지 않는다', () => {
    let state = initialCostControllerState<string>();
    // 큰 파일 A를 먼저 고른다 — 아직 안 끝났다.
    const [s1, reqA] = beginCostLoad(state);
    state = s1;
    // 그 사이 작은 파일 B를 골랐다 — 더 빨리 끝난다.
    const [s2, reqB] = beginCostLoad(state);
    state = s2;

    // B(나중 선택, 먼저 끝남)가 먼저 도착한다.
    state = finishCostLoad(state, {
      kind: 'parsed',
      requestId: reqB,
      fileName: 'b-small.csv',
      entries: [entry('row-1', '2000000')],
      document: 'doc-A',
    });
    expect(state.status).toMatchObject({ kind: 'loaded', fileName: 'b-small.csv' });

    // A(먼저 선택, 늦게 끝남)가 뒤늦게 도착한다 — 버려야 한다.
    state = finishCostLoad(state, {
      kind: 'parsed',
      requestId: reqA,
      fileName: 'a-big.csv',
      entries: [entry('row-1', '1000000')],
      document: 'doc-A',
    });

    expect(state.status).toMatchObject({ kind: 'loaded', fileName: 'b-small.csv' });
    expect(state.pinned!.fileName).toBe('b-small.csv');
  });

  it('늦게 끝난 이전 선택의 오류도 최신 상태를 덮지 않는다', () => {
    let state = initialCostControllerState<string>();
    const [s1, reqA] = beginCostLoad(state);
    state = s1;
    const [s2, reqB] = beginCostLoad(state);
    state = s2;

    state = finishCostLoad(state, {
      kind: 'parsed',
      requestId: reqB,
      fileName: 'b.csv',
      entries: [entry('row-1', '2000000')],
      document: 'doc-A',
    });
    // A의 읽기 실패가 뒤늦게 도착한다.
    state = finishCostLoad(state, { kind: 'read-error', requestId: reqA, fileName: 'a.csv', message: '파일을 읽지 못했습니다.' });

    expect(state.status).toMatchObject({ kind: 'loaded', fileName: 'b.csv' });
  });
});

describe('문서 교체 — 세션이 자동으로 더는 유효하지 않다', () => {
  function loaded(document: string): CostControllerState<string> {
    let state = initialCostControllerState<string>();
    const [s1, req1] = beginCostLoad(state);
    state = finishCostLoad(s1, {
      kind: 'parsed',
      requestId: req1,
      fileName: 'a.csv',
      entries: [entry('row-1', '1000000')],
      document,
    });
    return state;
  }

  it('같은 문서에서는 세션이 그대로 유효하다', () => {
    const state = loaded('doc-A');
    expect(effectiveCostSession(state, 'doc-A')).toBe(state.pinned!.session);
  });

  it('다른 문서가 되면(새 문서를 열거나 undo/redo) 세션이 보이지 않는다', () => {
    const state = loaded('doc-A');
    expect(effectiveCostSession(state, 'doc-B')).toBeUndefined();
    expect(effectiveCostSession(state, undefined)).toBeUndefined();
  });

  it('discardIfStale은 다른 문서가 되면 세션을 실제로 치운다(clearSession)', () => {
    const state = loaded('doc-A');
    const session = state.pinned!.session;
    const next = discardIfStale(state, 'doc-B');
    expect(next.pinned).toBeUndefined();
    expect(next.status).toEqual({ kind: 'idle' });
    expect(session.cleared).toBe(true);
  });

  it('discardIfStale은 같은 문서면 아무것도 하지 않는다', () => {
    const state = loaded('doc-A');
    const next = discardIfStale(state, 'doc-A');
    expect(next).toBe(state);
    expect(state.pinned!.session.cleared).toBe(false);
  });
});

describe('통화/단위 확인 대기 — 지연 응답 무효화 규칙도 똑같이 적용된다', () => {
  it('needs-defaults 결과도 늦게 끝난 이전 선택이면 버린다', () => {
    let state = initialCostControllerState<string>();
    const [s1, reqA] = beginCostLoad(state);
    state = s1;
    const [s2, reqB] = beginCostLoad(state);
    state = s2;

    // B가 먼저 끝나고 정상 로드된다.
    state = finishCostLoad(state, {
      kind: 'parsed',
      requestId: reqB,
      fileName: 'b.csv',
      entries: [entry('row-1', '2000000')],
      document: 'doc-A',
    });
    // A(먼저 선택, 늦게 끝남)가 뒤늦게 "통화 확인 필요"로 도착한다 — 버려야 한다.
    state = finishCostLoad(state, {
      kind: 'needs-defaults',
      requestId: reqA,
      fileName: 'a.csv',
      missing: { currency: true, unit: false },
    });

    expect(state.status).toMatchObject({ kind: 'loaded', fileName: 'b.csv' });
  });

  it('최신 선택이면 needs-defaults 상태로 전환되고, 기존 세션은 건드리지 않는다', () => {
    let state = loadedHelper('doc-A');
    const existingSession = state.pinned!.session;

    const [s2, req2] = beginCostLoad(state);
    state = finishCostLoad(s2, {
      kind: 'needs-defaults',
      requestId: req2,
      fileName: 'b.csv',
      missing: { currency: true, unit: true },
    });

    expect(state.status).toEqual({ kind: 'needs-defaults', fileName: 'b.csv', missing: { currency: true, unit: true } });
    // 확인을 기다리는 동안 이전 파일의 세션은 그대로 유효하다.
    expect(state.pinned!.session).toBe(existingSession);
    expect(existingSession.cleared).toBe(false);
  });
});

function loadedHelper(document: string): CostControllerState<string> {
  let state = initialCostControllerState<string>();
  const [s1, req1] = beginCostLoad(state);
  state = finishCostLoad(s1, {
    kind: 'parsed',
    requestId: req1,
    fileName: 'a.csv',
    entries: [entry('row-1', '1000000')],
    document,
  });
  return state;
}

describe('격리 — 세션 상태를 직렬화해도 원가 값이 새지 않는다', () => {
  it('JSON.stringify(state)에 매입단가 값이 없다', () => {
    const state = (() => {
      let s = initialCostControllerState<string>();
      const [s1, req1] = beginCostLoad(s);
      return finishCostLoad(s1, {
        kind: 'parsed',
        requestId: req1,
        fileName: 'a.csv',
        entries: [entry('row-1', '987654321')],
        document: 'doc-A',
      });
    })();
    expect(JSON.stringify(state)).not.toContain('987654321');
    expect(JSON.stringify(state.pinned)).not.toContain('987654321');
  });
});
