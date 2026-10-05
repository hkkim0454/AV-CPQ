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
import { useWorkspace, type LoadedDocument } from './workspace';
import { DiagramInput } from '../features/entry/DiagramInput';
import { ProductPicker } from '../features/entry/ProductPicker';
import { ReferenceDocs } from '../features/entry/ReferenceDocs';
import { CoverSheet } from '../features/worksheet/CoverSheet';
import { QuoteSheet } from '../features/worksheet/QuoteSheet';
import { IndirectPanel } from '../features/worksheet/IndirectPanel';
import { WarningList } from '../features/worksheet/WarningList';
import { InstallationPanel } from '../features/installation/InstallationPanel';
import { CableRoutePanel } from '../features/installation/CableRoutePanel';
import { PrivateCostPanel } from '../features/private-cost/PrivateCostPanel';
import { encodeWorkFile, decodeWorkFile } from '../services/files/workFile';
import { downloadTextFile, downloadBinaryFile } from '../services/files/download';
import { buildCustomerDownload, buildSharedDownload } from '../export/variants/download';
import { buildSalesDownload } from '../export/internal/salesExportAction';
import type { SharedNotes } from '../export/shared/projection';
import type { InternalLine } from '../services/private-cost/calculate';

// 거래처/영업비고/AI 메모는 아직 입력 화면이 없다 — 지어내지 않고
// 항상 빈 값으로 둔다(Task6 범위: 원가 연결 출력, 이 세 칸은 후속).
const EMPTY_NOTES: SharedNotes = { supplierByRow: new Map(), salesRemarkByRow: new Map() };
const EMPTY_AI_NOTES: ReadonlyMap<string, string> = new Map();

type LoadState = { kind: 'loading' } | ResourcesResult;

type OutputGrade = '0' | '1' | '2';

const OUTPUT_GRADES: ReadonlyArray<{ value: OutputGrade; label: string }> = [
  { value: '0', label: '0 영업팀용' },
  { value: '1', label: '1 공유용' },
  { value: '2', label: '2 고객용' },
];

type EntryView = 'diagram' | 'picker' | null;

export function App() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [entry, setEntry] = useState<EntryView>(null);
  const [outputGrade, setOutputGrade] = useState<OutputGrade>('2');
  const [pendingCableEdit, setPendingCableEdit] = useState(false);
  const [workFileOpenError, setWorkFileOpenError] = useState<string | undefined>(undefined);
  const [workFileSaveError, setWorkFileSaveError] = useState<string | undefined>(undefined);
  const [exportError, setExportError] = useState<string | undefined>(undefined);
  const [costLines, setCostLines] = useState<readonly InternalLine[]>([]);
  const [cableResetRowIds, setCableResetRowIds] = useState<string[]>([]);
  const workFileInputRef = useRef<HTMLInputElement>(null);
  // 파일을 고를 때마다 늘어난다 — 먼저 고른 파일의 비동기 읽기가 나중에
  // 고른 파일보다 늦게 끝나도 그 늦은 결과로 최신 선택을 덮지 않는다
  // (`DiagramInput`과 같은 패턴. 독립 검토 지적: 전엔 이 토큰이 없었다).
  const workFileRequestRef = useRef(0);

  const resources = state.kind === 'ready' ? state.resources : undefined;
  const workspace = useWorkspace(resources);
  const status = workspace.status;

  function handleSaveWorkFile(): void {
    if (status.kind !== 'editing') return;
    try {
      const text = encodeWorkFile(status.document);
      downloadTextFile(`견적-${status.document.header.quoteNumber || status.document.documentId}.avcpq.json`, text);
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
    if (status.kind !== 'editing' || resources === undefined) return;
    try {
      const file =
        outputGrade === '2'
          ? buildCustomerDownload(status.prepared, resources.guides)
          : outputGrade === '1'
            ? buildSharedDownload(status.prepared, resources.guides, EMPTY_NOTES)
            : buildSalesDownload(status.prepared, resources.guides, EMPTY_NOTES, costLines, EMPTY_AI_NOTES);
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
    setWorkFileOpenError(undefined);
    workspace.openWorkFile(result.document);
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
    workspace.loadDocument(input);
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
              disabled={
                status.kind !== 'editing' || pendingCableEdit || resources === undefined ||
                status.prepared.blocking
              }
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

              {entry === 'diagram' && <DiagramInput catalog={resources.catalog} onLoaded={handleLoaded} />}
              {entry === 'picker' &&
                (status.kind === 'editing' ? (
                  <ProductPicker
                    catalog={resources.catalog}
                    onAddToExisting={(sku) => {
                      const systemId = status.document.systems[0]?.systemId;
                      if (systemId !== undefined) workspace.addItem(systemId, sku, '1');
                      setEntry(null);
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
                  <CoverSheet header={status.document.header} onChange={workspace.setHeader} />
                  <WarningList
                    warnings={status.prepared.importWarnings}
                    catalog={resources.catalog}
                    onResolveDevice={workspace.resolveDevice}
                    onResolveOption={workspace.resolveOption}
                    onResolveConduit={workspace.resolveConduit}
                    onResolveCable={workspace.resolveCable}
                    onResolveRow={workspace.resolveRow}
                  />
                  <QuoteSheet
                    document={status.document}
                    calculation={status.prepared.priced.calculation}
                    onQuantityChange={workspace.setQuantity}
                    onDescriptionChange={workspace.setDescription}
                    onRemarkChange={workspace.setRemark}
                    onRemoveRow={workspace.removeRow}
                  />
                  <CableRoutePanel document={status.document} catalog={resources.catalog}
                    onApply={workspace.applyCableRoutes} onPending={setPendingCableEdit} />
                  {pendingCableEdit && <p role="status" className="q-notice">케이블 거리 수정이 아직 견적에 반영되지 않았습니다. 미리보기 후 적용하거나 취소하세요.</p>}
                  {status.document.systems.map((system) => (
                    <InstallationPanel
                      key={system.systemId}
                      system={system}
                      document={status.document}
                      onChange={(patch) => workspace.setInstallationInput(system.systemId, patch)}
                    />
                  ))}
                  {status.document.systems.map((system) => {
                    const calc = status.prepared.priced.calculation.systems.find(
                      (s) => s.systemId === system.systemId,
                    );
                    if (calc === undefined) return null;
                    return (
                      <IndirectPanel
                        key={system.systemId}
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
                    );
                  })}
                  <PrivateCostPanel
                    document={status.document}
                    documentGeneration={workspace.documentGeneration}
                    onLinesChange={setCostLines}
                  />
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
