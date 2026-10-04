/**
 * 원가 세션을 React 상태로 들고 있는 얇은 훅 — 교체·폐기·지연 응답
 * 무효화 규칙 자체는 `services/private-cost/controller.ts`(순수
 * 리듀서)에 있다. 이 훅은 비동기 파일 읽기 오케스트레이션과 문서
 * 식별자 연결만 맡는다(계획 Task5, 2026-10-05 독립 검토 지적).
 *
 * customer/shared/files 경로와 분리한다 — 이 디렉터리(`features/
 * private-cost/`)만 원가 서비스 계층을 import한다.
 */
import { useEffect, useRef, useState } from 'react';
import type { QuoteDocument } from '../../domain/quote/types';
import { readTable, TableReadError, type TableFormat } from '../../services/private-cost/readTable';
import { parsePrivatePrices, type ColumnMapping } from '../../services/private-cost/parse';
import {
  beginCostLoad,
  discardIfStale,
  effectiveCostSession,
  finishCostLoad,
  initialCostControllerState,
  type CostControllerState,
  type CostLoadResult,
  type CostLoadStatus,
} from '../../services/private-cost/controller';
import type { PrivateCostSession } from '../../services/private-cost/session';

export interface PrivateCostController {
  status: CostLoadStatus;
  /** 지금 문서에 유효한 세션. 문서가 바뀌면(새 문서/작업 파일/undo-redo) 자동으로 undefined다. */
  session: PrivateCostSession | undefined;
  loadFile(file: File, format: TableFormat, mapping: ColumnMapping): void;
}

export function usePrivateCostController(document: QuoteDocument | undefined): PrivateCostController {
  const [state, setState] = useState<CostControllerState<QuoteDocument | undefined>>(() =>
    initialCostControllerState(),
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  // 문서가 바뀌면(새 문서 열기/작업 파일 열기/undo-redo로 다른 문서가
  // 됨) 지금 세션은 더는 이 문서의 것이 아니다 — 물리적으로도 치운다.
  useEffect(() => {
    setState((current) => {
      const next = discardIfStale(current, document);
      stateRef.current = next;
      return next;
    });
  }, [document]);

  function applyResult(result: CostLoadResult<QuoteDocument | undefined>): void {
    setState((current) => {
      const next = finishCostLoad(current, result);
      stateRef.current = next;
      return next;
    });
  }

  function loadFile(file: File, format: TableFormat, mapping: ColumnMapping): void {
    // 로드를 시작한 시점의 문서에 못박는다 — 파싱이 끝나기 전에 사용자가
    // 다른 문서를 열어도, 이 결과는 "시작할 때의 문서"에만 유효해야
    // 한다(완료 시점의 최신 문서에 잘못 붙지 않는다).
    const sourceDocument = document;
    const [started, requestId] = beginCostLoad(stateRef.current);
    stateRef.current = started;
    setState(started);

    void (async () => {
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch {
        applyResult({ kind: 'read-error', requestId, fileName: file.name, message: '파일을 읽지 못했다.' });
        return;
      }

      try {
        const table = readTable(bytes, format);
        const result = parsePrivatePrices(table, mapping);
        if (result.errors.length > 0) {
          applyResult({ kind: 'parse-errors', requestId, fileName: file.name, errors: result.errors });
          return;
        }
        applyResult({
          kind: 'parsed',
          requestId,
          fileName: file.name,
          entries: result.entries,
          document: sourceDocument,
        });
      } catch (err) {
        applyResult({
          kind: 'read-error',
          requestId,
          fileName: file.name,
          message: err instanceof TableReadError ? err.message : '원가 파일을 읽지 못했다.',
        });
      }
    })();
  }

  return {
    status: state.status,
    session: effectiveCostSession(state, document),
    loadFile,
  };
}
