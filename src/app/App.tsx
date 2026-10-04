/**
 * React 진입 셸 — 원가 없는 작업 화면 (계획 2026-10-04-quote-workspace-ui Task 1).
 *
 * 이 파일은 초기 자료 로딩 상태와 두 실제 입구만 다룬다. 문서 편집·
 * 견적 표·원가는 각각의 Task에서 이어 만든다(§4 파일 책임). 여기서
 * 앞질러 만들지 않는다 — 버튼만 그리고 동작을 남겨두지 않는다는 원칙은
 * 반대 방향으로도 적용된다: 아직 만들 단계가 아닌 기능은 거짓으로
 * "완성된 것처럼" 보이게 하지 않는다.
 */
import { useEffect, useState } from 'react';
import { loadResources, type ResourcesResult } from './resources';
import { DiagramInput } from '../features/entry/DiagramInput';
import { ProductPicker } from '../features/entry/ProductPicker';

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
  const [outputGrade, setOutputGrade] = useState<OutputGrade>('2');
  const [entry, setEntry] = useState<EntryView>(null);

  useEffect(() => {
    let cancelled = false;
    loadResources()
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
            원가 없는 작업 셸
          </div>
        </header>

        <div className="q-workspace">
          <div className="q-tools">
            <button type="button" className="q-button" onClick={() => setEntry('diagram')}>
              구성도 JSON 열기
            </button>
            <button type="button" className="q-button" onClick={() => setEntry('picker')}>
              품목 직접 선택
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
            {/* 문서가 없으면 다운로드할 것이 없다 — 항상 비활성으로 시작한다. 실제
                활성화는 Task 6(출력)에서 준비된 문서가 있을 때만 켠다. */}
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
          {state.kind === 'ready' && (
            <>
              {!state.resources.catalog.pricesAvailable && (
                <p role="status" className="q-notice">
                  판매단가 파일이 없습니다({state.resources.catalog.pricesUnavailableReason}) — 모든
                  품목을 '미등록'으로 표시합니다.
                </p>
              )}
              {entry === 'diagram' && <DiagramInput />}
              {entry === 'picker' && <ProductPicker catalog={state.resources.catalog} />}
              {entry === null && (
                <p className="q-muted">왼쪽 위 버튼으로 구성도를 열거나 품목을 직접 고르세요.</p>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
