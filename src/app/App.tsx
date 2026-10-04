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
import { useEffect, useState } from 'react';
import { loadResources, type ResourcesResult } from './resources';
import { useWorkspace, type LoadedDocument } from './workspace';
import { DiagramInput } from '../features/entry/DiagramInput';
import { ProductPicker } from '../features/entry/ProductPicker';
import { CoverSheet } from '../features/worksheet/CoverSheet';
import { QuoteSheet } from '../features/worksheet/QuoteSheet';
import { IndirectPanel } from '../features/worksheet/IndirectPanel';
import { WarningList } from '../features/worksheet/WarningList';

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

  const resources = state.kind === 'ready' ? state.resources : undefined;
  const workspace = useWorkspace(resources);
  const status = workspace.status;

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
            {/* 준비된 출력 함수가 아직 안 붙었다 — 항상 비활성이다. 실제
                활성화는 Task 6(출력)에서 한다. */}
            <button type="button" className="q-button q-primary" disabled>
              Excel 다운로드
            </button>
          </div>
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

              {status.kind === 'editing' && (
                <>
                  <CoverSheet header={status.document.header} onChange={workspace.setHeader} />
                  <WarningList
                    warnings={status.prepared.importWarnings}
                    catalog={resources.catalog}
                    onResolveDevice={workspace.resolveDevice}
                    onResolveOption={workspace.resolveOption}
                  />
                  <QuoteSheet
                    document={status.document}
                    calculation={status.prepared.priced.calculation}
                    onQuantityChange={workspace.setQuantity}
                    onDescriptionChange={workspace.setDescription}
                    onRemarkChange={workspace.setRemark}
                    onRemoveRow={workspace.removeRow}
                  />
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
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
