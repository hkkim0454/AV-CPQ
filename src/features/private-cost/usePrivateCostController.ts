/**
 * 원가 세션 + rowId↔entryId 확인 연결을 React 상태로 들고 있는 훅.
 * 교체·폐기·지연 응답 무효화 규칙 자체는 `services/private-cost/
 * controller.ts`(순수 리듀서)에 있다. 이 훅은 비동기 파일 읽기
 * 오케스트레이션, 시트/헤더행/열매핑 확인, 통화/단위 확인 재파싱,
 * rowId 연결, 문서 세대 연결을 맡는다(계획 Task5, 2026-10-05 독립
 * 검토 지적).
 *
 * 문서 **교체**(새 견적/작업 파일 열기)는 `documentGeneration`으로
 * 가른다 — 문서 객체 참조가 아니다. 참조는 같은 문서를 수량만 고쳐도
 * 매번 바뀌므로, 참조로 가르면 편집할 때마다 세션이 사라진다(독립
 * 검토 지적). 원가 파일 **교체**(새 파일 선택)는 성공이든 실패든
 * **선택한 순간** 옛 세션·연결·확인 대기·마법사 상태를 전부 지운다 —
 * 실패해도 복구하지 않는다.
 *
 * ## CSV는 기존 간단 경로 그대로, XLSX만 시트·헤더행·열매핑을 확인한다
 *
 * 실제 원가 파일은 "갑지" 등 여러 시트를 담거나(시트 선택), 설명
 * 제목 행이 머리글 위에 있을 수 있다(헤더행 선택). 추측하지 않고
 * 사람이 시트·머리글 행·열 매핑을 직접 확인한 뒤에만 읽는다. CSV는
 * 이런 구조가 없으므로 기존처럼 바로 읽는다.
 *
 * customer/shared/files 경로와 분리한다 — 이 디렉터리(`features/
 * private-cost/`)만 원가 서비스 계층을 import한다.
 */
import { useEffect, useRef, useState } from 'react';
import type { QuoteDocument, QuoteRow } from '../../domain/quote/types';
import {
  listXlsxSheets,
  previewXlsxRows,
  readTable,
  TableReadError,
  type Table,
  type TableFormat,
  type XlsxSheetInfo,
} from '../../services/private-cost/readTable';
import {
  parsePrivatePrices,
  resolveColumnRef,
  type ColumnMapping,
  type PriceError,
} from '../../services/private-cost/parse';
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
import {
  linkStillValid,
  unresolvedCandidates,
  type ConfirmedLink,
  type UnresolvedRowCandidates,
} from '../../services/private-cost/candidates';

export type XlsxWizard =
  | { step: 'choosing-sheet'; requestId: number; fileName: string; sheets: readonly XlsxSheetInfo[] }
  | {
      step: 'choosing-header-row';
      requestId: number;
      fileName: string;
      sheetName: string;
      preview: readonly string[][];
    }
  | {
      step: 'choosing-data-end';
      requestId: number;
      fileName: string;
      sheetName: string;
      headerRowIndex: number;
      header: readonly string[];
      /** 머리글 다음 행부터 시트 끝까지, 원본 행 번호(0부터) 그대로. */
      rowsAfterHeader: readonly { rowIndex: number; cells: readonly string[] }[];
    }
  | {
      step: 'confirming-mapping';
      requestId: number;
      fileName: string;
      sheetName: string;
      header: readonly string[];
    };

export interface PrivateCostController {
  status: CostLoadStatus;
  /** XLSX 선택 중 시트·헤더행·열매핑을 확인하는 단계 — 비어 있으면 평소 `status` 화면을 보여준다. */
  wizard: XlsxWizard | undefined;
  /** 지금 문서 세대에 유효한 세션. 문서가 통째로 교체되면 자동으로 undefined다. */
  session: PrivateCostSession | undefined;
  lines: readonly InternalLine[];
  unresolved: readonly UnresolvedRowCandidates[];
  loadFile(file: File, format: TableFormat | undefined): void;
  /** 마법사 — 시트를 고른다(`wizard.step === 'choosing-sheet'`일 때만 뜻이 있다). */
  chooseSheet(sheetPath: string): void;
  /** 마법사 — 머리글 행을 고른다(`wizard.step === 'choosing-header-row'`일 때만 뜻이 있다). */
  chooseHeaderRow(rowIndex: number): void;
  /**
   * 마법사 — 품목 데이터가 끝나는 행을 고른다(`wizard.step ===
   * 'choosing-data-end'`일 때만 뜻이 있다). `rowIndex`를 생략하면
   * "시트 끝까지 전부 포함"이다.
   */
  chooseDataEnd(rowIndex?: number): void;
  /** 마법사 — 열 매핑을 확인하고 실제로 읽는다(`wizard.step === 'confirming-mapping'`일 때만 뜻이 있다). */
  confirmMapping(mapping: ColumnMapping): void;
  /** 마법사를 버린다 — 아직 아무것도 연결되지 않았으므로 idle로 되돌아간다. */
  cancelWizard(): void;
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
  documentGeneration: number;
}

/** 시트 선택 뒤에도 같은 파일을 다시 읽지 않도록 바이트를 들고 있는다. */
interface XlsxSession {
  bytes: Uint8Array;
  sheetPath?: string;
  headerRowIndex?: number;
  dataEndRowIndex?: number;
}

/** 데이터 끝 선택 화면에서 트레일링 행(잡자재비·합계 등)까지 보이도록 넉넉히 가져온다. */
const DATA_END_PREVIEW_ROWS = 500;

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
  const [links, setLinks] = useState<Record<string, ConfirmedLink>>({});
  const [wizard, setWizard] = useState<XlsxWizard | undefined>(undefined);
  const stateRef = useRef(state);
  stateRef.current = state;
  const pendingRef = useRef<PendingConfirmation | undefined>(undefined);
  const xlsxRef = useRef<XlsxSession | undefined>(undefined);
  const generationRef = useRef(documentGeneration);

  // 문서가 통째로 교체되면(generationRef와 다름) 세션·연결·확인
  // 대기·마법사를 전부 지운다. 같은 문서를 편집만 하면(수량 등)
  // generation이 그대로라 아무것도 하지 않는다 — effect가 매 렌더
  // 돌아도 안전하다.
  useEffect(() => {
    if (generationRef.current === documentGeneration) return;
    generationRef.current = documentGeneration;
    pendingRef.current = undefined;
    xlsxRef.current = undefined;
    setWizard(undefined);
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

  /** 표를 다 읽은 뒤 공통 경로 — CSV 간단 경로와 XLSX 마법사 마지막 단계가 같이 쓴다. */
  function attemptParse(
    table: Table,
    mapping: ColumnMapping,
    requestId: number,
    fileName: string,
    sourceGeneration: number,
  ): void {
    const result = parsePrivatePrices(table, mapping);

    // 통화·단위 열이 아예 없거나(column-missing), 열은 있는데 일부
    // 줄만 비었을 때(currency-empty/unit-empty) 확인 입력을 연다 —
    // 확인값은 **비었을 때만** 채우므로(parse.ts), 통화가 섞인
    // 행(currency-mixed)이나 다른 오류가 섞여 있으면 평소대로 전부
    // 보여주고 확인 입력을 열지 않는다(기존 값·혼합 오류 보존).
    const currencyRelated = (e: PriceError): boolean =>
      (e.code === 'column-missing' && e.column === mapping.currency) || e.code === 'currency-empty';
    const unitRelated = (e: PriceError): boolean =>
      (e.code === 'column-missing' && e.column === mapping.unit) || e.code === 'unit-empty';
    // 매핑 자체에서 열을 아예 안 줬으면(마법사에서 "사용 안 함") 그
    // 사실만으로 이미 "열이 없다"는 뜻이다 — 한 줄이 통화·단위 둘 다
    // 비어 한 번에 하나씩만 오류를 내더라도(parsePrivatePrices는 그
    // 줄에서 처음 걸리는 오류만 내고 더 보지 않는다) 매핑으로 바로
    // 알 수 있으므로 둘 다 놓치지 않는다.
    const missingCurrency = mapping.currency === undefined || result.errors.some(currencyRelated);
    const missingUnit = mapping.unit === undefined || result.errors.some(unitRelated);
    const otherErrors = result.errors.filter((e) => !currencyRelated(e) && !unitRelated(e));

    if ((missingCurrency || missingUnit) && otherErrors.length === 0) {
      // requestId가 그 사이 최신이 아니게 됐으면(다른 파일을 더 골랐거나
      // 문서가 교체됐다) 대기 상태를 기록하지 않는다 — 늦게 도착한 이
      // 결과가 더 최신 선택의 pendingRef를 덮으면 안 된다.
      if (requestId !== stateRef.current.requestSeq) return;
      pendingRef.current = { requestId, fileName, table, mapping, documentGeneration: sourceGeneration };
      applyResult({
        kind: 'needs-defaults',
        requestId,
        fileName,
        missing: { currency: missingCurrency, unit: missingUnit },
      });
      return;
    }

    if (result.errors.length > 0) {
      applyResult({ kind: 'parse-errors', requestId, fileName, errors: result.errors });
      return;
    }
    applyResult({ kind: 'parsed', requestId, fileName, entries: result.entries, documentGeneration: sourceGeneration });
  }

  function loadFile(file: File, format: TableFormat | undefined): void {
    // 로드를 시작한 시점의 문서 세대에 못박는다 — 파싱이 끝나기 전에
    // 사용자가 문서를 통째로 바꿔도, 이 결과는 "시작할 때의 세대"에만
    // 유효해야 한다.
    const sourceGeneration = documentGeneration;
    pendingRef.current = undefined; // 새 파일을 고르면 이전 확인 대기는 더는 뜻이 없다.
    xlsxRef.current = undefined;
    setWizard(undefined); // 새 파일을 고르면 이전 마법사 진행도 더는 뜻이 없다.
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
      if (requestId !== stateRef.current.requestSeq) return; // 그 사이 다른 파일을 골랐거나 문서가 교체됐다.

      if (format === 'csv') {
        // 기존 간단 경로 — 시트·헤더행 개념이 없다. 바로 읽는다.
        try {
          const table = readTable(bytes, 'csv');
          attemptParse(table, DEFAULT_MAPPING, requestId, file.name, sourceGeneration);
        } catch (err) {
          applyResult({
            kind: 'read-error',
            requestId,
            fileName: file.name,
            message: err instanceof TableReadError ? err.message : '원가 파일을 읽지 못했다.',
          });
        }
        return;
      }

      // XLSX — 시트 목록부터 본다(workbook 관계·순서로, 파일 이름
      // 정렬이 아니다 — readTable.ts의 모듈 설명 참고).
      try {
        const sheets = listXlsxSheets(bytes);
        if (requestId !== stateRef.current.requestSeq) return;
        xlsxRef.current = { bytes };
        if (sheets.length === 1) {
          enterHeaderRowStep(requestId, file.name, bytes, sheets[0]!);
        } else {
          setWizard({ step: 'choosing-sheet', requestId, fileName: file.name, sheets });
        }
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

  function enterHeaderRowStep(requestId: number, fileName: string, bytes: Uint8Array, sheet: XlsxSheetInfo): void {
    try {
      const preview = previewXlsxRows(bytes, sheet.sheetPath);
      xlsxRef.current = { bytes, sheetPath: sheet.sheetPath };
      setWizard({ step: 'choosing-header-row', requestId, fileName, sheetName: sheet.name, preview });
    } catch (err) {
      applyResult({
        kind: 'read-error',
        requestId,
        fileName,
        message: err instanceof TableReadError ? err.message : '시트를 읽지 못했다.',
      });
    }
  }

  function chooseSheet(sheetPath: string): void {
    if (wizard === undefined || wizard.step !== 'choosing-sheet') return;
    if (wizard.requestId !== stateRef.current.requestSeq) {
      setWizard(undefined);
      return;
    }
    const sheet = wizard.sheets.find((s) => s.sheetPath === sheetPath);
    const xlsx = xlsxRef.current;
    if (sheet === undefined || xlsx === undefined) return;
    enterHeaderRowStep(wizard.requestId, wizard.fileName, xlsx.bytes, sheet);
  }

  function chooseHeaderRow(rowIndex: number): void {
    if (wizard === undefined || wizard.step !== 'choosing-header-row') return;
    if (wizard.requestId !== stateRef.current.requestSeq) {
      setWizard(undefined);
      return;
    }
    const header = (wizard.preview[rowIndex] ?? []).map((c) => c.trim());
    const xlsx = xlsxRef.current;
    if (xlsx === undefined) return;
    xlsxRef.current = { ...xlsx, headerRowIndex: rowIndex };
    // 트레일링 행(잡자재비·합계 등)까지 보이도록 미리보기를 넉넉히 다시
    // 가져온다 — 머리글 선택 때 쓴 짧은 미리보기로는 시트 끝이 안 보일
    // 수 있다(독립 검토 지적 2026-10-05: 시트 끝까지가 데이터라고
    // 멋대로 가정하면 집계 행이 섞이거나 품목이 빠질 수 있다).
    try {
      const full = previewXlsxRows(xlsx.bytes, xlsx.sheetPath!, DATA_END_PREVIEW_ROWS);
      const rowsAfterHeader = full
        .slice(rowIndex + 1)
        .map((cells, i) => ({ rowIndex: rowIndex + 1 + i, cells }));
      setWizard({
        step: 'choosing-data-end',
        requestId: wizard.requestId,
        fileName: wizard.fileName,
        sheetName: wizard.sheetName,
        headerRowIndex: rowIndex,
        header,
        rowsAfterHeader,
      });
    } catch (err) {
      applyResult({
        kind: 'read-error',
        requestId: wizard.requestId,
        fileName: wizard.fileName,
        message: err instanceof TableReadError ? err.message : '시트를 읽지 못했다.',
      });
    }
  }

  function chooseDataEnd(rowIndex?: number): void {
    if (wizard === undefined || wizard.step !== 'choosing-data-end') return;
    if (wizard.requestId !== stateRef.current.requestSeq) {
      setWizard(undefined);
      return;
    }
    const xlsx = xlsxRef.current;
    if (xlsx === undefined) return;
    xlsxRef.current = { ...xlsx, ...(rowIndex !== undefined ? { dataEndRowIndex: rowIndex } : {}) };
    setWizard({
      step: 'confirming-mapping',
      requestId: wizard.requestId,
      fileName: wizard.fileName,
      sheetName: wizard.sheetName,
      header: wizard.header,
    });
  }

  function confirmMapping(mapping: ColumnMapping): void {
    if (wizard === undefined || wizard.step !== 'confirming-mapping') return;
    const requestId = wizard.requestId;
    const fileName = wizard.fileName;
    if (requestId !== stateRef.current.requestSeq) {
      setWizard(undefined);
      return;
    }
    const xlsx = xlsxRef.current;
    if (xlsx?.sheetPath === undefined || xlsx.headerRowIndex === undefined) return;
    setWizard(undefined);

    try {
      const table = readTable(xlsx.bytes, 'xlsx', undefined, {
        sheetPath: xlsx.sheetPath,
        headerRowIndex: xlsx.headerRowIndex,
        ...(xlsx.dataEndRowIndex !== undefined ? { dataEndRowIndex: xlsx.dataEndRowIndex } : {}),
      });
      attemptParse(table, mapping, requestId, fileName, documentGeneration);
    } catch (err) {
      applyResult({
        kind: 'read-error',
        requestId,
        fileName,
        message: err instanceof TableReadError ? err.message : '원가 파일을 읽지 못했다.',
      });
    }
  }

  function cancelWizard(): void {
    xlsxRef.current = undefined;
    setWizard(undefined);
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
    if (base.currency === undefined || resolveColumnRef(base.currency, pending.table.header) === undefined) {
      delete base.currency;
    }
    if (base.unit === undefined || resolveColumnRef(base.unit, pending.table.header) === undefined) {
      delete base.unit;
    }
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
    // 확인 당시 행의 제품 식별을 그대로 찍어 둔다 — 나중에 이 행이
    // 다른 제품으로 바뀌면(규격 문구가 우연히 같아도) 식별이 달라져
    // 다시 확인받는다(독립 검토 지적 2026-10-05, candidates.ts의
    // `linkStillValid`가 이 스냅샷을 매 렌더 재검증한다).
    const row = itemRowsOf(document).find((r) => r.rowId === rowId);
    if (row === undefined) return;
    const link: ConfirmedLink = {
      entryId,
      ...(row.productId !== undefined ? { productId: row.productId } : {}),
      ...(row.sku !== undefined ? { sku: row.sku } : {}),
      specification: row.specification,
      unit: row.unit,
    };
    setLinks((current) => ({ ...current, [rowId]: link }));
  }

  function clearCost(): void {
    pendingRef.current = undefined;
    xlsxRef.current = undefined;
    setWizard(undefined);
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
            // 제품이 바뀐 행(productId/SKU/규격/단위 중 하나라도 확인
            // 당시와 달라짐)의 옛 연결은 다시 확인받아야 한다 — 그러면
            // costEntryId를 아예 넘기지 않는다(internalLines는 이
            // 재검증까지는 보지 않는다).
            const linked = links[row.rowId];
            const linkStillMatches = linked !== undefined && linkStillValid(row, linked, session);
            return {
              rowId: row.rowId,
              ...(row.sku !== undefined ? { sku: row.sku } : {}),
              ...(linkStillMatches ? { costEntryId: linked.entryId } : {}),
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
    wizard,
    session,
    lines,
    unresolved,
    loadFile,
    chooseSheet,
    chooseHeaderRow,
    chooseDataEnd,
    confirmMapping,
    cancelWizard,
    confirmDefaults,
    confirmLink,
    clearCost,
  };
}

/** CSV 간단 경로의 고정 매핑 — 실제 원가 파일의 공통 모양(품명/규격/매입단가/통화/단위). */
const DEFAULT_MAPPING: ColumnMapping = {
  name: '품명',
  model: '규격',
  purchaseUnitPrice: '매입단가',
  currency: '통화',
  unit: '단위',
};
