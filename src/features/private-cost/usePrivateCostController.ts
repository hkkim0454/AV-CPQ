/**
 * 원가 세션을 React 상태로 들고 있는 얇은 훅 — 교체·폐기·지연 응답
 * 무효화 규칙 자체는 `services/private-cost/controller.ts`(순수
 * 리듀서)에 있다. 이 훅은 비동기 파일 읽기 오케스트레이션, 통화/단위
 * 확인 재파싱, 문서 식별자 연결만 맡는다(계획 Task5, 2026-10-05 독립
 * 검토 지적).
 *
 * customer/shared/files 경로와 분리한다 — 이 디렉터리(`features/
 * private-cost/`)만 원가 서비스 계층을 import한다.
 */
import { useEffect, useRef, useState } from 'react';
import type { QuoteDocument } from '../../domain/quote/types';
import { readTable, TableReadError, type Table, type TableFormat } from '../../services/private-cost/readTable';
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
  /**
   * `status.kind === 'needs-defaults'`일 때만 뜻이 있다. 이미 읽어 둔
   * 표를 다시 읽지 않고, 확인값만 더해 같은 자리에서 다시 파싱한다.
   * 확인값은 열이 비었을 때만 채운다 — 열에 실제 값이 있으면 덮지
   * 않는다(parse.ts의 `defaultCurrency`/`defaultUnit` 규칙).
   */
  confirmDefaults(defaults: { currency?: string; unit?: string }): void;
}

interface PendingConfirmation<Doc> {
  requestId: number;
  fileName: string;
  table: Table;
  mapping: ColumnMapping;
  missing: { currency: boolean; unit: boolean };
  sourceDocument: Doc;
}

export function usePrivateCostController(document: QuoteDocument | undefined): PrivateCostController {
  const [state, setState] = useState<CostControllerState<QuoteDocument | undefined>>(() =>
    initialCostControllerState(),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const pendingRef = useRef<PendingConfirmation<QuoteDocument | undefined> | undefined>(undefined);

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
    pendingRef.current = undefined; // 새 파일을 고르면 이전 확인 대기는 더는 뜻이 없다.
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

        // 통화·단위 열 이름이 머리글에 아예 없을 때만(열 매핑 자체는
        // 틀리지 않았다는 전제) 확인 입력을 연다 — 다른 오류가 섞여
        // 있으면(예: 매입단가 열도 없음) 평소대로 전부 보여준다.
        const missingCurrency = result.errors.some(
          (e) => e.code === 'column-missing' && e.column === mapping.currency,
        );
        const missingUnit = result.errors.some((e) => e.code === 'column-missing' && e.column === mapping.unit);
        const otherErrors = result.errors.filter(
          (e) => !(e.code === 'column-missing' && (e.column === mapping.currency || e.column === mapping.unit)),
        );

        if ((missingCurrency || missingUnit) && otherErrors.length === 0) {
          pendingRef.current = {
            requestId,
            fileName: file.name,
            table,
            mapping,
            missing: { currency: missingCurrency, unit: missingUnit },
            sourceDocument,
          };
          applyResult({
            kind: 'needs-defaults',
            requestId,
            fileName: file.name,
            missing: { currency: missingCurrency, unit: missingUnit },
          });
          return;
        }

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

  function confirmDefaults(defaults: { currency?: string; unit?: string }): void {
    const pending = pendingRef.current;
    if (pending === undefined) return;

    const base: ColumnMapping = { ...pending.mapping };
    if (pending.missing.currency) delete base.currency;
    if (pending.missing.unit) delete base.unit;
    const mergedMapping: ColumnMapping = {
      ...base,
      ...(defaults.currency !== undefined ? { defaultCurrency: defaults.currency } : {}),
      ...(defaults.unit !== undefined ? { defaultUnit: defaults.unit } : {}),
    };
    const result = parsePrivatePrices(pending.table, mergedMapping);
    pendingRef.current = undefined;

    if (result.errors.length > 0) {
      applyResult({
        kind: 'parse-errors',
        requestId: pending.requestId,
        fileName: pending.fileName,
        errors: result.errors,
      });
      return;
    }
    applyResult({
      kind: 'parsed',
      requestId: pending.requestId,
      fileName: pending.fileName,
      entries: result.entries,
      document: pending.sourceDocument,
    });
  }

  return {
    status: state.status,
    session: effectiveCostSession(state, document),
    loadFile,
    confirmDefaults,
  };
}
