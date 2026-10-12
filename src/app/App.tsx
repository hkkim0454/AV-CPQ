/**
 * React 진입 셸 — 견적 작업 화면 (계획 2026-10-04-quote-workspace-ui
 * Task 1·2).
 *
 * 금액은 전부 `prepareQuote`가 돌려주는 `CalculationSnapshot`에서 읽는다
 * — React에서 다시 계산하지 않는다(§4 Global Constraints).
 *
 * 툴바(입구 버튼·실행취소/다시실행·출력 등급)는 초기 자료 로딩이
 * 실패해도 계속 보인다 — 화면이 통째로 죽지 않는다(계획 §5 Review
 * Focus 5번). `useWorkspace`는 자료가 아직 없을 때도 같은 순서로
 * 불려야 하므로(React 훅 규칙) `Resources | undefined`를 받는다.
 */
import { useEffect, useRef, useState } from 'react';
import { loadResources, type ResourcesResult } from './resources';
import { useWorkspace, exportGate, type LoadedDocument } from './workspace';
import { DiagramInput } from '../features/entry/DiagramInput';
import { ProductPicker } from '../features/entry/ProductPicker';
import { ReferenceDocs } from '../features/entry/ReferenceDocs';
import { CoverSheet } from '../features/worksheet/CoverSheet';
import { QuoteSheet } from '../features/worksheet/QuoteSheet';
import { IndirectPanel } from '../features/worksheet/IndirectPanel';
import { WarningList } from '../features/worksheet/WarningList';
import { ReviewSummary } from '../features/worksheet/ReviewSummary';
import { WorkspaceSection } from '../features/worksheet/WorkspaceSection';
import { buildReviewItems, decideNavigation, type ReviewTarget } from '../features/worksheet/reviewItems';
import type { RowNavigation } from '../features/worksheet/QuoteSheet';
import type { ImportNavigation } from '../features/worksheet/WarningList';
import { InstallationPanel } from '../features/installation/InstallationPanel';
import { CableRoutePanel } from '../features/installation/CableRoutePanel';
import { PrivateCostPanel } from '../features/private-cost/PrivateCostPanel';
import { encodeWorkFile, decodeWorkFile } from '../services/files/workFile';
import { downloadTextFile, downloadBinaryFile } from '../services/files/download';
import { buildCustomerDownload, buildSharedDownload } from '../export/variants/download';
import { buildSalesDownload } from '../export/internal/salesExportAction';
import type { SharedNotes } from '../export/shared/projection';
import type { InternalLine } from '../services/private-cost/calculate';
import type { QuoteDocument } from '../domain/quote/types';
import { QuoteDrafts, useHasPendingQuoteDrafts } from './QuoteDrafts';

/** 거래처/영업비고 — 사람이 QuoteSheet에서 입력한 값만 담는다. 지어내지 않는다. */
function notesOf(document: QuoteDocument): SharedNotes {
  const supplierByRow = new Map<string, string>();
  const salesRemarkByRow = new Map<string, string>();
  for (const row of document.rows) {
    if (row.type !== 'item') continue;
    if (row.supplier !== undefined && row.supplier !== '') supplierByRow.set(row.rowId, row.supplier);
    if (row.salesRemark !== undefined && row.salesRemark !== '') salesRemarkByRow.set(row.rowId, row.salesRemark);
  }
  return { supplierByRow, salesRemarkByRow };
}

/**
 * AI 메모(0단계 BF열 전용) — **새 입력 칸이 아니다.** 구성도 변환이 이미
 * 만들어 둔 `conversionNote`를 그대로 옮긴다(결정 D16: "AI 메모는 지운다가
 * 아니라 안 쓴다" — 1·2단계 함수는 이 맵을 아예 받지 않는다).
 */
function aiNotesOf(document: QuoteDocument): ReadonlyMap<string, string> {
  const notes = new Map<string, string>();
  for (const row of document.rows) {
    if (row.type !== 'item') continue;
    if (row.conversionNote !== undefined && row.conversionNote !== '') notes.set(row.rowId, row.conversionNote);
  }
  return notes;
}

type LoadState = { kind: 'loading' } | ResourcesResult;

type OutputGrade = '0' | '1' | '2';

const OUTPUT_GRADES: ReadonlyArray<{ value: OutputGrade; label: string }> = [
  { value: '0', label: '0 영업팀용' },
  { value: '1', label: '1 공유용' },
  { value: '2', label: '2 고객용' },
];

type EntryView = 'diagram' | 'picker' | null;

export function App() {
  return <QuoteDrafts><QuoteWorkspace /></QuoteDrafts>;
}

function QuoteWorkspace() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [entry, setEntry] = useState<EntryView>(null);
  const [outputGrade, setOutputGrade] = useState<OutputGrade>('2');
  const [pendingCableEdit, setPendingCableEdit] = useState(false);
  const [workFileOpenError, setWorkFileOpenError] = useState<string | undefined>(undefined);
  const [workFileSaveError, setWorkFileSaveError] = useState<string | undefined>(undefined);
  const [exportError, setExportError] = useState<string | undefined>(undefined);
  const [costLines, setCostLines] = useState<readonly InternalLine[]>([]);
  const [cableResetRowIds, setCableResetRowIds] = useState<string[]>([]);
  // 확인 목록 → 입력 자리 이동. 화면 state 일 뿐 문서에 들어가지 않는다.
  const [rowNavigation, setRowNavigation] = useState<RowNavigation | undefined>(undefined);
  const [importNavigation, setImportNavigation] = useState<ImportNavigation | undefined>(undefined);
  const [navigationError, setNavigationError] = useState<string | undefined>(undefined);
  // 펼치라는 **일회성 요청 번호**다. 참/거짓이 아니라 번호인 이유는,
  // 한 번 펼친 뒤에도 사람이 다시 접을 수 있어야 하기 때문이다.
  const [cableOpenRequest, setCableOpenRequest] = useState<number | undefined>(undefined);
  const [warningOpenRequest, setWarningOpenRequest] = useState<number | undefined>(undefined);
  const navigationNonce = useRef(0);
  const workFileInputRef = useRef<HTMLInputElement>(null);
  // 작업 파일과 구성도가 선택 순서를 공유한다. 어느 입구든 늦게 끝난
  // 이전 선택으로 나중에 선택한 문서를 덮지 않는다.
  const workFileRequestRef = useRef(0);

  function beginDocumentLoad(): () => boolean {
    const requestId = ++workFileRequestRef.current;
    return () => requestId === workFileRequestRef.current;
  }

  const resources = state.kind === 'ready' ? state.resources : undefined;
  const workspace = useWorkspace(resources);
  const status = workspace.status;
  const pendingQuoteDrafts = useHasPendingQuoteDrafts();
  const hasUnsavedChanges = workspace.hasUnsavedChanges || pendingCableEdit || pendingQuoteDrafts;
  // 파일 읽기가 끝날 때의 문서를 보호한다. 읽기 시작 시점의 상태를 쓰면
  // 기다리는 동안 편집한 내용이나 새로 연 문서를 놓칠 수 있다.
  const currentWork = useRef({ workspace, hasUnsavedChanges });
  currentWork.current = { workspace, hasUnsavedChanges };
  // 다음 프레임에 포커스할 때 **그때의** 계산 결과와 대조하려고 보관한다.
  // 그 사이 문서가 바뀌었으면 오래된 요청을 소비하지 않는다.
  const currentPrepared = useRef<unknown>(undefined);
  currentPrepared.current = status.kind === 'editing' ? status.prepared : undefined;

  /**
   * 확인 목록에서 누른 항목으로 이동한다.
   *
   * 누른 **그 순간의 prepared 참조**를 함께 보관한다. 소비 직전과 포커스
   * 직전에 지금 결과와 같은지 보고, 다르면 요청을 버린다 — 그 사이 문서가
   * 바뀌어 **엉뚱한 행이 열리는** 것을 막는다.
   */
  function handleNavigate(target: ReviewTarget): void {
    setNavigationError(undefined);
    if (status.kind !== 'editing') {
      setNavigationError('계산 기준이 바뀌어 지금은 이동할 수 없습니다. 현재 기준으로 다시 계산해 주세요.');
      return;
    }
    navigationNonce.current += 1;
    if (target.kind === 'labor' || target.kind === 'quantity') {
      setImportNavigation(undefined);
      setRowNavigation({
        rowId: target.rowId,
        kind: target.kind,
        sourcePrepared: status.prepared,
        nonce: navigationNonce.current,
      });
      return;
    }
    if (target.kind === 'import') {
      // 행 이동과 **같은 계약**이다 — 누른 순간의 계산 결과와 nonce 를 함께
      // 보낸다. 문자열 id 만 보내면 같은 항목을 다시 눌러도 state 가 그대로라
      // 아무 일도 일어나지 않고, 다른 이유로 재렌더될 때 옛 요청이 또 스크롤한다.
      setRowNavigation(undefined);
      // 구성도 경고 목록은 표 아래 접기 영역에 있다 — 먼저 펼쳐야 포커스가 먹는다.
      setWarningOpenRequest(navigationNonce.current);
      setImportNavigation({
        warningId: target.warningId,
        sourcePrepared: status.prepared,
        nonce: navigationNonce.current,
      });
      return;
    }
    if (target.kind === 'cables') {
      setRowNavigation(undefined);
      setImportNavigation(undefined);
      // 접혀 있으면 **한 번 펼치라고 요청**하고, 그려진 뒤에 스크롤·포커스한다.
      // 요청은 번호라서 한 번 쓰고 끝난다 — 그 뒤에는 사람이 다시 접을 수 있다.
      setCableOpenRequest(navigationNonce.current);
      const requested = status.prepared;
      requestAnimationFrame(() => {
        const section = document.querySelector<HTMLElement>('[data-section="cables"]');
        const focusTarget = section?.querySelector<HTMLElement>('button, input, select') ?? undefined;
        // 행·구성도 이동과 **같은 계약**이다. 펼치고 그리는 사이에 문서가
        // 바뀌었을 수 있으므로, 포커스 직전에 계산 결과를 다시 대조한다.
        const decision = decideNavigation({
          sourcePrepared: requested,
          currentPrepared: currentPrepared.current,
          targetExists: focusTarget !== undefined,
        });
        if (decision.kind !== 'go') {
          setNavigationError(decision.message);
          return;
        }
        section!.scrollIntoView({ block: 'start' });
        focusTarget!.focus();
      });
    }
  }

  // 케이블 거리를 고치기 시작하면 그 영역을 **한 번** 펼쳐 보여준다.
  // 계속 펼쳐 두지는 않는다 — 입력하는 내내 접을 수 없으면 안 된다.
  const wasPendingCableEdit = useRef(false);
  useEffect(() => {
    if (pendingCableEdit && !wasPendingCableEdit.current) {
      navigationNonce.current += 1;
      setCableOpenRequest(navigationNonce.current);
    }
    wasPendingCableEdit.current = pendingCableEdit;
  }, [pendingCableEdit]);

  function mayReplaceDocument(): boolean {
    return !currentWork.current.hasUnsavedChanges || window.confirm(
      '저장하지 않은 변경 내용이 있습니다. 현재 작업을 버리고 다른 견적을 여시겠습니까?',
    );
  }

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [hasUnsavedChanges]);

  function handleSaveWorkFile(): void {
    if (status.kind !== 'editing') return;
    if (pendingCableEdit || pendingQuoteDrafts) {
      setWorkFileSaveError('입력 중인 값을 확인해 주세요. 잘못된 숫자를 고치거나 조건 추가·케이블 적용을 마친 뒤 저장할 수 있습니다.');
      return;
    }
    try {
      const text = encodeWorkFile(status.document);
      downloadTextFile(`견적-${status.document.header.quoteNumber || status.document.documentId}.avcpq.json`, text);
      workspace.markWorkFileSaved(status.document);
      setWorkFileSaveError(undefined);
    } catch (err) {
      // 저장 직전 스키마 검증이 막은 경우(원가 비슷한 칸, 구조 불일치
      // 등) 던지는 대로 두면 UI가 이유 없이 멈춘다 — 사유를 보여준다
      // (독립 검토 지적).
      setWorkFileSaveError(err instanceof Error ? err.message : '작업 파일을 저장하지 못했다.');
    }
  }

  function handleExcelDownload(): void {
    // 버튼이 비활성이어도 핸들러 자신이 다시 확인한다 — 최신 기준인지는
    // 버튼 disabled 하나로만 보장하지 않는다(D23, 2026-10-04 사용자
    // 지적: "handler/출력 경계에서 재확인, 버튼만 차단하지 않기").
    // `exportGate`는 버튼의 disabled 조건과 **같은 함수**다 — 전엔
    // 핸들러가 `status.kind`만 보고 `prepared.blocking`·`pendingCableEdit`는
    // 버튼에만 있어, 버튼이 비활성인 이유로 클릭이 막힌 것과 핸들러가
    // 직접 막은 것이 실제로는 구분되지 않았다(2026-10-05 독립 검토 지적).
    if (resources === undefined || !exportGate(status, pendingCableEdit).allowed) return;
    if (status.kind !== 'editing' || workspace.basisVersions === undefined) return; // 위 gate와 같은 결론이지만, 아래 타입 좁히기에 필요하다.
    // Task6: 원가 포함 파일은 매번 저장 직전에 확인한다. 취소하면 생성도 하지 않는다.
    if (outputGrade === '0' && !window.confirm(
      '영업팀용 파일에는 등록된 원가와 내부 메모가 포함됩니다. 고객에게 전달하지 않도록 주의해 주세요. 다운로드하시겠습니까?',
    )) return;
    try {
      const notes = notesOf(status.document);
      const basisVersions = workspace.basisVersions;
      const file =
        outputGrade === '2'
          ? buildCustomerDownload(status.prepared, resources.guides, basisVersions)
          : outputGrade === '1'
            ? buildSharedDownload(status.prepared, resources.guides, notes, basisVersions)
            : buildSalesDownload(
                status.prepared,
                resources.guides,
                notes,
                costLines,
                aiNotesOf(status.document),
                basisVersions,
              );
      downloadBinaryFile(file.fileName, file.bytes);
      setExportError(undefined);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : '출력 파일을 만들지 못했다.');
    }
  }

  async function handleOpenWorkFileSelected(file: File): Promise<void> {
    const requestId = ++workFileRequestRef.current;
    let text: string;
    try {
      text = await file.text();
    } catch {
      if (requestId === workFileRequestRef.current) {
        setWorkFileOpenError(`${file.name} — 파일을 읽지 못했습니다.`);
      }
      return;
    }
    if (requestId !== workFileRequestRef.current) return; // 그 사이 다른 파일을 골랐다 — 이 결과는 버린다.

    const result = decodeWorkFile(text);
    if (!result.ok) {
      setWorkFileOpenError(`${file.name} — ${result.reason}`);
      return;
    }
    if (!mayReplaceDocument()) return;
    setWorkFileOpenError(undefined);
    currentWork.current.workspace.openWorkFile(result.document);
    setPendingCableEdit(false);
    setEntry(null);
  }

  useEffect(() => {
    let cancelled = false;
    loadResources({ baseUrl: import.meta.env.BASE_URL })
      .then((result) => {
        if (!cancelled) setState(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            reasons: [err instanceof Error ? err.message : '초기 자료를 불러오지 못했다.'],
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleLoaded(input: LoadedDocument): void {
    if (!mayReplaceDocument()) return;
    ++workFileRequestRef.current;
    currentWork.current.workspace.loadDocument(input);
    setPendingCableEdit(false);
    setEntry(null);
  }

  return (
    <div className="q-page">
      <div className="q-shell">
        <header className="q-top">
          <a className="q-brand-lockup" href="./">
            <span className="q-brand-mark" aria-hidden="true">
              견
            </span>
            <span>
              <span className="q-brand">
                AV <span>견적</span>
              </span>
              <span className="q-brand-sub">QUOTE WORKSPACE</span>
            </span>
          </a>
          <div className="q-meta">
            <b>㈜서울영상테크</b>
            <br />
            견적 작업 공간
          </div>
        </header>

        <ReferenceDocs />

        <div className="q-workspace">
          {status.kind !== 'empty' && (
            <p role="status" aria-label="작업 저장 상태" className="q-save-status">
              <strong>{hasUnsavedChanges ? '저장하지 않은 변경 내용이 있습니다' : '저장한 내용과 같습니다'}</strong>
              <span className="q-muted">저장 상태는 다운로드 요청 기준입니다. 내려받은 작업 파일을 확인해 보관해 주세요.</span>
            </p>
          )}
          <div className="q-tools">
            <button
              type="button"
              className="q-button"
              disabled={resources === undefined}
              onClick={() => setEntry('diagram')}
            >
              구성도 JSON 열기
            </button>
            <button
              type="button"
              className="q-button"
              disabled={resources === undefined}
              onClick={() => setEntry('picker')}
            >
              품목 직접 선택
            </button>
            <button type="button" className="q-button" onClick={workspace.undo} disabled={!workspace.canUndo}>
              실행 취소
            </button>
            <button type="button" className="q-button" onClick={workspace.redo} disabled={!workspace.canRedo}>
              다시 실행
            </button>
            <button
              type="button"
              className="q-button"
              onClick={handleSaveWorkFile}
              disabled={status.kind !== 'editing' || pendingCableEdit}
            >
              작업 파일로 저장
            </button>
            <button
              type="button"
              className="q-button"
              disabled={resources === undefined}
              onClick={() => workFileInputRef.current?.click()}
            >
              작업 파일 열기
            </button>
            <input
              ref={workFileInputRef}
              type="file"
              aria-label="작업 파일 선택"
              accept=".json,application/json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file !== undefined) void handleOpenWorkFileSelected(file);
              }}
            />
          </div>
          <div className="q-grade" role="radiogroup" aria-label="출력 등급">
            {OUTPUT_GRADES.map((grade) => (
              <label key={grade.value} className="q-grade-option">
                <input
                  type="radio"
                  name="output-grade"
                  value={grade.value}
                  checked={outputGrade === grade.value}
                  onChange={() => setOutputGrade(grade.value)}
                />
                {grade.label}
              </label>
            ))}
            <button
              type="button"
              className="q-button q-primary"
              onClick={handleExcelDownload}
              disabled={resources === undefined || !exportGate(status, pendingCableEdit).allowed}
            >
              Excel 다운로드
            </button>
          </div>
          {status.kind === 'editing' && status.prepared.blocking && (
            <p role="status" className="q-muted">
              해결되지 않은 구성도/품셈/계산 경고가 있어 Excel을 출력할 수 없습니다 — 위 경고를
              먼저 해결하세요.
            </p>
          )}
          {exportError !== undefined && (
            <p role="alert" className="q-notice q-notice-error">
              출력 파일을 만들지 못했습니다 — {exportError}
            </p>
          )}
        </div>

        <main className="q-main">
          {state.kind === 'loading' && (
            <p role="status" className="q-notice">
              자료를 불러오는 중입니다…
            </p>
          )}
          {state.kind === 'error' && (
            <div role="alert" className="q-notice q-notice-error">
              <h2>초기 자료를 불러오지 못했습니다</h2>
              <p className="q-muted">아래 사유를 해결한 뒤 새로고침하세요.</p>
              <ul>
                {state.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}
          {resources !== undefined && (
            <>
              {!resources.catalog.pricesAvailable && (
                <p role="status" className="q-notice">
                  판매단가 파일이 없습니다({resources.catalog.pricesUnavailableReason}) — 모든 품목을
                  '미등록'으로 표시합니다.
                </p>
              )}
              {workFileOpenError !== undefined && (
                <p role="alert" className="q-notice q-notice-error">
                  작업 파일을 열지 못했습니다 — {workFileOpenError}
                </p>
              )}
              {workFileSaveError !== undefined && (
                <p role="alert" className="q-notice q-notice-error">
                  작업 파일을 저장하지 못했습니다 — {workFileSaveError}
                </p>
              )}

              {entry === 'diagram' && <DiagramInput catalog={resources.catalog} onLoaded={handleLoaded} onBeginLoad={beginDocumentLoad} />}
              {entry === 'picker' &&
                (status.kind === 'editing' ? (
                  <ProductPicker
                    key={workspace.documentGeneration}
                    catalog={resources.catalog}
                    systems={status.document.systems}
                    onClose={() => setEntry(null)}
                    onAddToExisting={(systemId, sku) => {
                      workspace.addItem(systemId, sku, '1');
                    }}
                  />
                ) : (
                  <ProductPicker catalog={resources.catalog} onLoaded={handleLoaded} />
                ))}

              {entry === null && status.kind === 'empty' && (
                <p className="q-muted">왼쪽 위 버튼으로 구성도를 열거나 품목을 직접 고르세요.</p>
              )}

              {status.kind === 'basis-conflict' && (
                <div role="alert" className="q-notice q-notice-error">
                  <h2>계산 기준이 바뀌었습니다</h2>
                  <p>{status.reason}</p>
                  <p className="q-muted">
                    저장 당시와 다른 기준으로 조용히 다시 계산하지 않습니다. 먼저 미리보기로
                    바뀔 내용을 확인한 뒤 적용하세요.
                  </p>
                  {workspace.recalcPreview === undefined ? (
                    <button
                      type="button"
                      className="q-button q-primary"
                      onClick={() => workspace.previewRecalculateWithCurrentBasis()}
                    >
                      현재 기준으로 다시 계산 — 미리보기
                    </button>
                  ) : (
                    <div className="q-notice">
                      <h3>다시 계산하면 바뀌는 내용</h3>
                      {workspace.recalcPreview.laborOrWageChanged && <p>노임/품셈 기준이 바뀝니다.</p>}
                      {workspace.recalcPreview.roundingChanged && <p>갑지 절사 자릿수가 바뀝니다.</p>}
                      {workspace.recalcPreview.rowChanges.length === 0 ? (
                        <p>바뀌는 행은 없습니다.</p>
                      ) : (
                        <ul>
                          {workspace.recalcPreview.rowChanges.map((change) => (
                            <li key={change.rowId}>
                              {change.kind === 'added' && `${change.name}: 새로 추가됨 (수량 ${change.after?.quantity})`}
                              {change.kind === 'removed' && `${change.name}: 삭제됨`}
                              {change.kind === 'changed' &&
                                `${change.name}: 수량 ${change.before?.quantity} → ${change.after?.quantity}, ` +
                                  `단가 ${change.before?.sellingUnitPrice ?? '미등록'} → ${change.after?.sellingUnitPrice ?? '미등록'}`}
                            </li>
                          ))}
                        </ul>
                      )}
                      <p>
                        합계: {workspace.recalcPreview.beforeTotal ?? '이전 기준을 재현할 수 없습니다'} →{' '}
                        {workspace.recalcPreview.afterTotal}
                      </p>
                      {workspace.recalcPreview.miscMigrations.length > 0 && (
                        <section aria-label="잡자재비 기준 이전">
                          <h4>잡자재비 기준 이전</h4>
                          <p className="q-muted">
                            적용하면 잡자재비가 LED 캐비넷을 뺀 재료비 기준으로 바뀝니다. 적용하지
                            않으면 지금처럼 출력이 막힌 채로 남습니다.
                          </p>
                          <ul>
                            {workspace.recalcPreview.miscMigrations.map((migration) => (
                              <li key={migration.previousRowId}>
                                <p>
                                  잡자재비 {migration.previousAmount ?? '구할 수 없음'} →{' '}
                                  {migration.nextAmount ?? '구할 수 없음'}
                                </p>
                                {migration.excludedRows.length === 0 ? (
                                  <p>빠지는 LED 캐비넷 행이 없습니다.</p>
                                ) : (
                                  <ul>
                                    {migration.excludedRows.map((row) => (
                                      <li key={row.rowId}>{row.name}: 합산에서 빠집니다</li>
                                    ))}
                                  </ul>
                                )}
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}
                      {workspace.recalcPreview.cableConflict && (
                        <div role="alert">
                          <p>
                            케이블 재산출이 수동 수정과 충돌해 적용할 수 없습니다. 아래에서 자동
                            산출값을 쓸 행을 고르고 다시 미리보세요.
                          </p>
                          <ul>
                            {workspace.recalcPreview.cableConflictDetails.map((detail, index) => (
                              <li key={index}>
                                {detail.message}
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={detail.rowIds.every((id) => cableResetRowIds.includes(id))}
                                    onChange={(event) =>
                                      setCableResetRowIds((current) =>
                                        event.target.checked
                                          ? [...new Set([...current, ...detail.rowIds])]
                                          : current.filter((id) => !detail.rowIds.includes(id)),
                                      )
                                    }
                                  />
                                  이 항목의 수동 수정을 버리고 자동 산출값을 사용합니다
                                </label>
                              </li>
                            ))}
                          </ul>
                          <button
                            type="button"
                            className="q-button"
                            onClick={() => workspace.previewRecalculateWithCurrentBasis(cableResetRowIds)}
                          >
                            선택한 항목으로 다시 미리보기
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        className="q-button q-primary"
                        disabled={workspace.recalcPreview.cableConflict}
                        onClick={() => {
                          workspace.applyRecalculatedBasis();
                          setCableResetRowIds([]);
                        }}
                      >
                        적용
                      </button>
                      <button
                        type="button"
                        className="q-button"
                        onClick={() => {
                          workspace.cancelRecalculateWithCurrentBasis();
                          setCableResetRowIds([]);
                        }}
                      >
                        취소
                      </button>
                    </div>
                  )}
                </div>
              )}

              {status.kind === 'editing' && (
                <>
                  {/*
                    견적표를 **먼저** 보여준다. 갑지 정보·시공·간접비·원가는
                    아래 접기 영역으로 내린다 — 처음 열었을 때 눈에 들어와야
                    하는 것은 품목과 합계다(계획 §1 기본 배치).
                  */}
                  <ReviewSummary
                    items={buildReviewItems(status.prepared, pendingCableEdit)}
                    onNavigate={handleNavigate}
                    navigationError={navigationError}
                  />
                  <QuoteSheet
                    key={`sheet-${workspace.documentGeneration}`}
                    document={status.document}
                    calculation={status.prepared.priced.calculation}
                    laborBreakdowns={status.prepared.priced.laborBreakdowns}
                    laborWarnings={status.prepared.priced.laborWarnings}
                    onQuantityChange={workspace.setQuantity}
                    onDescriptionChange={workspace.setDescription}
                    onRemarkChange={workspace.setRemark}
                    onSupplierChange={workspace.setSupplier}
                    onSalesRemarkChange={workspace.setSalesRemark}
                    onRemoveRow={workspace.removeRow}
                    onLaborModeChange={workspace.setLaborMode}
                    onManualLaborUnitPriceChange={workspace.setManualLaborUnitPrice}
                    onOverrideReasonChange={workspace.setOverrideReason}
                    onConfirmLaborRow={workspace.confirmLaborRow}
                    navigation={rowNavigation}
                    prepared={status.prepared}
                    onNavigationMissed={setNavigationError}
                  />
                  {/*
                    구성도 경고는 후보 목록까지 달려 있어 길다. 표 **앞에** 두면
                    미해결이 많은 실제 구성도에서 견적표가 화면 밖으로 밀려난다
                    (2026-10-12 독립 검토 지적). 표 아래 접기 영역으로 내리고,
                    확인 항목에서 누를 때 펼쳐서 그 항목으로 데려간다.
                  */}
                  {status.prepared.importWarnings.length > 0 && (
                    <WorkspaceSection
                      title={`구성도 경고 (${status.prepared.importWarnings.length}건)`}
                      sectionId="warnings"
                      // 경고는 **지금 막아야 할 일**이라 기본은 펼쳐 둔다. 접을
                      // 수 있게만 하고 감추지는 않는다 — 표 아래로 내린 것만으로
                      // "표가 한참 아래" 문제는 이미 해결된다.
                      defaultOpen
                      {...(warningOpenRequest === undefined ? {} : { openRequest: warningOpenRequest })}
                    >
                      <WarningList
                        warnings={status.prepared.importWarnings}
                        catalog={resources.catalog}
                        onResolveDevice={workspace.resolveDevice}
                        onResolveOption={workspace.resolveOption}
                        onResolveConduit={workspace.resolveConduit}
                        onResolveCable={workspace.resolveCable}
                        onResolveRow={workspace.resolveRow}
                        navigation={importNavigation}
                        prepared={status.prepared}
                        onNavigationMissed={setNavigationError}
                      />
                    </WorkspaceSection>
                  )}

                  <WorkspaceSection title="견적 정보 (고객·현장)" sectionId="cover">
                    <CoverSheet key={`cover-${workspace.documentGeneration}`} header={status.document.header} onChange={workspace.setHeader} />
                  </WorkspaceSection>

                  <WorkspaceSection
                    title="케이블 거리"
                    sectionId="cables"
                    // 펼치라는 요청은 **번호 한 번**이다. 반영되지 않은 수정이
                    // 생긴 순간과 확인 목록에서 눌렀을 때만 올라간다.
                    {...(cableOpenRequest === undefined ? {} : { openRequest: cableOpenRequest })}
                  >
                    <CableRoutePanel key={`cables-${workspace.documentGeneration}`} document={status.document} catalog={resources.catalog}
                      onApply={workspace.applyCableRoutes} onPending={setPendingCableEdit} />
                    {pendingCableEdit && <p role="status" className="q-notice">케이블 거리 수정이 아직 견적에 반영되지 않았습니다. 미리보기 후 적용하거나 취소하세요.</p>}
                  </WorkspaceSection>

                  {status.document.systems.map((system) => (
                    <WorkspaceSection key={`inst-${workspace.documentGeneration}-${system.systemId}`} title={`설치 입력 — ${system.name}`}>
                      <InstallationPanel
                        system={system}
                        document={status.document}
                        onChange={(patch) => workspace.setInstallationInput(system.systemId, patch)}
                      />
                    </WorkspaceSection>
                  ))}
                  {status.document.systems.map((system) => {
                    const calc = status.prepared.priced.calculation.systems.find(
                      (s) => s.systemId === system.systemId,
                    );
                    if (calc === undefined) return null;
                    return (
                      <WorkspaceSection key={`ind-${workspace.documentGeneration}-${system.systemId}`} title={`간접비 — ${system.name}`}>
                        <IndirectPanel
                          system={system}
                          calculation={calc}
                          onProfileChange={(profile) => workspace.setProfile(system.systemId, profile)}
                          onToggleApplied={(itemId, applied) =>
                            workspace.setIndirectRule(system.systemId, itemId, { applied })
                          }
                          onRateChange={(itemId, rate) =>
                            workspace.setIndirectRule(system.systemId, itemId, { rate })
                          }
                        />
                      </WorkspaceSection>
                    );
                  })}
                  {/*
                    ⛔ 접어도 PrivateCostPanel 을 떼지 않는다 — 떼면 원가 세션과
                    연결이 끊긴다. 문서 교체에 따른 폐기는 기존 정책 그대로다.
                  */}
                  <WorkspaceSection title="내 PC 원가 확인" sectionId="private-cost">
                    <PrivateCostPanel
                      document={status.document}
                      documentGeneration={workspace.documentGeneration}
                      onLinesChange={setCostLines}
                    />
                  </WorkspaceSection>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
