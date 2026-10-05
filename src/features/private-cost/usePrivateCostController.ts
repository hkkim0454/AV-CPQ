/**
 * 원가 세션 + rowId↔entryId 확인 연결을 React 상태로 들고 있는 훅.
 * 교체·폐기·지연 응답 무효화 규칙 자체는 `services/private-cost/
 * controller.ts`(순수 리듀서)에 있다. 이 훅은 비동기 파일 읽기
 * 오케스트레이션, 통화/단위 확인 재파싱, rowId 연결, 문서 세대 연결만
 * 맡는다(계획 Task5, 2026-10-05 독립 검토 지적).
 *
 * 문서 **교체**(새 견적/작업 파일 열기)는 `documentGeneration`으로
 * 가른다 — 문서 객체 참조가 아니다. 참조는 같은 문서를 수량만 고쳐도
 * 매번 바뀌므로, 참조로 가르면 편집할 때마다 세션이 사라진다(독립
 * 검토 지적). 원가 파일 **교체**(새 파일 선택)는 성공이든 실패든
 * **선택한 순간** 옛 세션·연결·확인 대기를 전부 지운다 — 실패해도
 * 복구하지 않는다.
 *
 * customer/shared/files 경로와 분리한다 — 이 디렉터리(`features/
 * private-cost/`)만 원가 서비스 계층을 import한다.
 */
import { useEffect, useRef, useState } from 'react';
import type { QuoteDocument, QuoteRow } from '../../domain/quote/types';
import { readTable, TableReadError, type Table, type TableFormat } from '../../services/private-cost/readTable';
import { parsePrivatePrices, type ColumnMapping } from '../../services/private-cost/parse';
import {
  beginCostLoad,
  clearCostLoad,
  discardForNewGeneration,
  effectiveCostSession,
  finishCostLoad,
  initialCostControllerState,
  type CostControllerState,
  type CostLoadResult,
  type CostLoadStatus,
} from '../../services/private-cost/controller';
import type { PrivateCostSession } from '../../services/private-cost/session';
import { internalLines, type InternalLine } from '../../services/private-cost/calculate';
import { unresolvedCandidates, type UnresolvedRowCandidates } from '../../services/private-cost/candidates';

export interface PrivateCostController {
  status: CostLoadStatus;
  /** 지금 문서 세대에 유효한 세션. 문서가 통째로 교체되면 자동으로 undefined다. */
  session: PrivateCostSession | undefined;
  lines: readonly InternalLine[];
  unresolved: readonly UnresolvedRowCandidates[];
  loadFile(file: File, format: TableFormat | undefined, mapping: ColumnMapping): void;
  /**
   * `status.kind === 'needs-defaults'`일 때만 뜻이 있다. 이미 읽어 둔
   * 표를 다시 읽지 않고, 확인값만 더해 같은 자리에서 다시 파싱한다.
   * 확인값은 열이 비었을 때만 채운다 — 열에 실제 값이 있으면 덮지
   * 않는다(parse.ts의 `defaultCurrency`/`defaultUnit` 규칙).
   */
  confirmDefaults(defaults: { currency?: string; unit?: string }): void;
  /** rowId에 원가 자리표를 확인해 잇는다 — 사람이 후보 중 직접 고른 결과만 온다. */
  confirmLink(rowId: string, entryId: string): void;
  /** "원가 비우기" — 다음 파일을 고르지 않아도 지금 세션·연결을 바로 지운다. */
  clearCost(): void;
}

interface PendingConfirmation {
  requestId: number;
  fileName: string;
  table: Table;
  mapping: ColumnMapping;
  missing: { currency: boolean; unit: boolean };
  documentGeneration: number;
}

function itemRowsOf(document: QuoteDocument | undefined): QuoteRow[] {
  if (document === undefined) return [];
  const out: QuoteRow[] = [];
  for (const row of document.rows) {
    if (row.type === 'item') out.push(row);
  }
  return out;
}

export function usePrivateCostController(
  document: QuoteDocument | undefined,
  documentGeneration: number,
): PrivateCostController {
  const [state, setState] = useState<CostControllerState>(() => initialCostControllerState());
  const [links, setLinks] = useState<Record<string, string>>({});
  const stateRef = useRef(state);
  stateRef.current = state;
  const pendingRef = useRef<PendingConfirmation | undefined>(undefined);
  const generationRef = useRef(documentGeneration);

  // 문서가 통째로 교체되면(generationRef와 다름) 세션·연결·확인 대기를
  // 전부 지운다. 같은 문서를 편집만 하면(수량 등) generation이 그대로라
  // 아무것도 하지 않는다 — effect가 매 렌더 돌아도 안전하다.
  useEffect(() => {
    if (generationRef.current === documentGeneration) return;
    generationRef.current = documentGeneration;
    pendingRef.current = undefined;
    setLinks({});
    setState((current) => {
      const next = discardForNewGeneration(current);
      stateRef.current = next;
      return next;
    });
  }, [documentGeneration]);

  function applyResult(result: CostLoadResult): void {
    setState((current) => {
      const next = finishCostLoad(current, result);
      stateRef.current = next;
      return next;
    });
  }

  function loadFile(file: File, format: TableFormat | undefined, mapping: ColumnMapping): void {
    // 로드를 시작한 시점의 문서 세대에 못박는다 — 파싱이 끝나기 전에
    // 사용자가 문서를 통째로 바꿔도, 이 결과는 "시작할 때의 세대"에만
    // 유효해야 한다.
    const sourceGeneration = documentGeneration;
    pendingRef.current = undefined; // 새 파일을 고르면 이전 확인 대기는 더는 뜻이 없다.
    setLinks({}); // 새 파일을 고르면 이전 연결도 전부 무효다 — 성공 여부와 무관하다.
    const [started, requestId] = beginCostLoad(stateRef.current);
    stateRef.current = started;
    setState(started);

    if (format === undefined) {
      // 지원하지 않는 확장자다 — 추측하지 않는다. begin이 이미 옛
      // 세션을 지웠으니, 여기서는 사유만 보여준다.
      applyResult({ kind: 'read-error', requestId, fileName: file.name, message: '지원하지 않는 파일 형식이다(.csv/.xlsx만 된다).' });
      return;
    }

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

        // 통화·단위 열이 아예 없거나(column-missing), 열은 있는데 일부
        // 줄만 비었을 때(currency-empty/unit-empty) 확인 입력을 연다 —
        // 확인값은 **비었을 때만** 채우므로(parse.ts), 통화가 섞인
        // 행(currency-mixed)이나 다른 오류가 섞여 있으면 평소대로
        // 전부 보여주고 확인 입력을 열지 않는다(기존 값·혼합 오류
        // 보존, 독립 검토 지적 2026-10-05).
        const currencyRelated = (e: (typeof result.errors)[number]): boolean =>
          (e.code === 'column-missing' && e.column === mapping.currency) || e.code === 'currency-empty';
        const unitRelated = (e: (typeof result.errors)[number]): boolean =>
          (e.code === 'column-missing' && e.column === mapping.unit) || e.code === 'unit-empty';
        const missingCurrency = result.errors.some(currencyRelated);
        const missingUnit = result.errors.some(unitRelated);
        const otherErrors = result.errors.filter((e) => !currencyRelated(e) && !unitRelated(e));

        if ((missingCurrency || missingUnit) && otherErrors.length === 0) {
          // requestId가 그 사이 최신이 아니게 됐으면(다른 파일을 더
          // 골랐거나 문서가 교체됐다) 대기 상태를 기록하지 않는다 —
          // 늦게 도착한 이 결과가 더 최신 선택의 pendingRef를 덮으면
          // 안 된다(독립 검토 지적 2026-10-05).
          if (requestId !== stateRef.current.requestSeq) return;
          pendingRef.current = {
            requestId,
            fileName: file.name,
            table,
            mapping,
            missing: { currency: missingCurrency, unit: missingUnit },
            documentGeneration: sourceGeneration,
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
          documentGeneration: sourceGeneration,
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
    // 그 사이 다른 파일을 고르거나 문서가 교체됐으면 이 확인은 더는
    // 뜻이 없다 — 적용하지 않는다.
    if (pending.requestId !== stateRef.current.requestSeq) {
      pendingRef.current = undefined;
      return;
    }

    // 열이 머리글에 실제로 있으면(일부 줄만 비었던 경우) 그대로 두어
    // 기존 값을 계속 읽는다 — 확인값은 빈 줄만 메운다. 열 자체가
    // 없었을 때만 매핑에서 빼서 모든 줄이 확인값을 쓰게 한다.
    const base: ColumnMapping = { ...pending.mapping };
    if (base.currency === undefined || !pending.table.header.includes(base.currency)) delete base.currency;
    if (base.unit === undefined || !pending.table.header.includes(base.unit)) delete base.unit;
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
      documentGeneration: pending.documentGeneration,
    });
  }

  function confirmLink(rowId: string, entryId: string): void {
    setLinks((current) => ({ ...current, [rowId]: entryId }));
  }

  function clearCost(): void {
    pendingRef.current = undefined;
    setLinks({});
    setState((current) => {
      const next = clearCostLoad(current);
      stateRef.current = next;
      return next;
    });
  }

  const session = effectiveCostSession(state, documentGeneration);
  const itemRows = itemRowsOf(document);
  const lines =
    session === undefined
      ? []
      : internalLines(
          itemRows.map((row) => {
            // 모델이 바뀐 행(제품 교체)의 옛 연결은 다시 확인받아야 한다
            // — 지금 규격과 더는 안 맞으면 costEntryId를 아예 넘기지
            // 않는다(internalLines는 모델 일치까지는 보지 않는다).
            const linked = links[row.rowId];
            const linkStillMatches =
              linked !== undefined && session.ownsEntryId(linked) && session.matchesModel(linked, row.specification);
            return {
              rowId: row.rowId,
              ...(row.sku !== undefined ? { sku: row.sku } : {}),
              ...(linkStillMatches ? { costEntryId: linked } : {}),
              name: row.name,
              specification: row.specification,
              unit: row.unit,
              quantity: row.quantity,
              ...(row.sellingUnitPrice !== undefined ? { sellingUnitPrice: row.sellingUnitPrice } : {}),
            };
          }),
          session,
        );
  const unresolved = session === undefined ? [] : unresolvedCandidates(itemRows, session, links);

  return {
    status: state.status,
    session,
    lines,
    unresolved,
    loadFile,
    confirmDefaults,
    confirmLink,
    clearCost,
  };
}
