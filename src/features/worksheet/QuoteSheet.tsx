/**
 * 견적 표 (계획 2026-10-04-quote-workspace-ui Task 2).
 *
 * 금액은 전부 `CalculationSnapshot`에서 읽는다 — React에서 다시 계산하지
 * 않는다. 수량·설명·비고만 로컬 입력 상태를 갖고, 올바른 값일 때만
 * `onCommit`으로 workspace reducer를 부른다(계획 §4.2 "원래 문서를
 * 덮어쓰지 않는다").
 */
import { Fragment, useEffect, useRef, useState } from 'react';
import { usePendingQuoteDraft } from '../../app/QuoteDrafts';
import type { CalculationSnapshot } from '../../domain/calculation/calculate';
import type { RowLaborBreakdown } from '../../domain/labor/calculateLabor';
import type { LaborWarning } from '../../domain/labor/types';
import type { LaborMode, QuoteDocument, SheetRow } from '../../domain/quote/types';
import { validateDecimalInput, validateQuantityInput, type DecimalValidation } from '../../domain/quote/validateInput';
import type { PreparedQuote } from '../../export/variants/prepare';
import { decideNavigation } from './reviewItems';

/**
 * 확인 목록에서 들어온 **이동 요청** (사용성 2차 Task B).
 *
 * `sourcePrepared` 는 사람이 누른 그 순간의 계산 결과다. 소비 직전과
 * 펼친 뒤 포커스 직전에 **지금 결과와 같은 참조인지** 확인한다. 그 사이
 * 문서가 바뀌었으면 요청을 버린다 — 배열 순서가 밀려서 **엉뚱한 행이
 * 열리는** 것을 막는다.
 *
 * `nonce` 는 같은 자리를 다시 눌렀을 때도 이동하게 한다.
 */
export interface RowNavigation {
  rowId: string;
  kind: 'labor' | 'quantity';
  sourcePrepared: PreparedQuote;
  nonce: number;
}

type ItemRow = Extract<SheetRow, { type: 'item' }>;

/**
 * 시스템 표 영역의 DOM id.
 *
 * 탐색 메뉴가 `getElementById` 로 찾는다. **선택자 문자열로 조합하지
 * 않는다** — systemId 에 따옴표나 공백이 들어가면 선택자가 깨지거나
 * 엉뚱한 요소를 고른다. `getElementById` 는 선택자를 파싱하지 않아
 * 어떤 문자열이든 그대로 안전하게 찾는다.
 */
export function systemSectionDomId(systemId: string): string {
  return `q-system-${systemId}`;
}

interface QuoteSheetProps {
  document: QuoteDocument;
  calculation: CalculationSnapshot;
  /** 행별 품셈 계산 근거 — 확인 패널이 그대로 보여준다(설계서 §5.3). */
  laborBreakdowns: ReadonlyMap<string, RowLaborBreakdown>;
  laborWarnings: readonly LaborWarning[];
  onQuantityChange(rowId: string, value: string): void;
  onDescriptionChange(rowId: string, value: string): void;
  onRemarkChange(rowId: string, value: string): void;
  onSupplierChange(rowId: string, value: string): void;
  onSalesRemarkChange(rowId: string, value: string): void;
  onRemoveRow(rowId: string): void;
  onLaborModeChange(rowId: string, mode: LaborMode): void;
  onManualLaborUnitPriceChange(rowId: string, value: string): void;
  onOverrideReasonChange(rowId: string, value: string): void;
  onConfirmLaborRow(rowId: string, displayedFingerprint: string): void;
  /** 확인 목록에서 온 이동 요청. 없으면 아무것도 하지 않는다. */
  navigation?: RowNavigation | undefined;
  /** 지금 계산 결과 — 요청이 낡았는지 **참조 동일성**으로 가른다. */
  prepared?: PreparedQuote | undefined;
  /** 요청 대상이 사라졌을 때 알린다. 다른 행을 대신 열지 않는다. */
  onNavigationMissed?: ((message: string) => void) | undefined;
}

/**
 * 검증을 거친 뒤에만 commit하는 입력칸 — 수량·직접 입력 금액이 함께
 * 쓴다. 타이핑 중간 상태(빈 문자열·'-'·'abc' 등)는 로컬 draft에만
 * 머무르고, 유효한 값일 때만 `onCommit`을 부른다(계획 §4.2 "원래
 * 문서를 덮어쓰지 않는다" — 계산 엔진에 잘못된 문자열이 넘어가는
 * 경로를 애초에 화면에서 막는다. 독립 검토 지적).
 */
function ValidatedDecimalCell({
  rowId,
  value,
  label,
  validate,
  onCommit,
  inputRef,
}: {
  rowId: string;
  value: string;
  label: string;
  validate(raw: string): DecimalValidation;
  onCommit(rowId: string, value: string): void;
  /** 확인 목록에서 이 입력으로 포커스를 옮길 때 쓴다. */
  inputRef?: ((el: HTMLInputElement | null) => void) | undefined;
}) {
  const [draft, setDraft] = useState(value);
  usePendingQuoteDraft(draft !== value);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setDraft(value);
    setError(undefined);
  }, [value]);

  function commit(): void {
    const result = validate(draft);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setError(undefined);
    setDraft(result.value);
    if (result.value !== value) onCommit(rowId, result.value);
  }

  return (
    <div>
      <input
        ref={inputRef}
        aria-label={label}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        aria-invalid={error !== undefined}
      />
      {error !== undefined && (
        <p role="alert" className="q-field-error">
          {error}
        </p>
      )}
    </div>
  );
}

function TextCell({
  rowId,
  value,
  label,
  onCommit,
}: {
  rowId: string;
  value: string;
  label: string;
  onCommit(rowId: string, value: string): void;
}) {
  const [draft, setDraft] = useState(value);
  usePendingQuoteDraft(draft !== value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <input
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(rowId, draft);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

/**
 * 행 하나의 노무 처리 근거·선택 패널(Task 6 노무 확인 보완 Task C).
 *
 * 세 가지 선택(mapped 확인함/manual 직접 입력/not-applicable 해당없음)을
 * 두되, `laborMappingId`가 없는 행은 "확인함"을 보여주지 않는다 —
 * 품셈이 없다는 이유로 자동으로 `not-applicable`이 되지 않는다(사람이
 * 고르기 전까지 `unresolved`로 남는다).
 *
 * 일괄 확인·전체 선택 UI는 여기 없다 — 행마다 따로 확인한다.
 */
function LaborBasisPanel({
  panelRef,
  row,
  breakdown,
  hasUnconfirmedWarning,
  columnCount,
  onLaborModeChange,
  onManualLaborUnitPriceChange,
  onOverrideReasonChange,
  onConfirmLaborRow,
}: {
  row: ItemRow;
  breakdown: RowLaborBreakdown | undefined;
  hasUnconfirmedWarning: boolean;
  /** 지금 **보이는** 열 수. 숨긴 열까지 세면 칸이 어긋난다. */
  columnCount: number;
  onLaborModeChange(rowId: string, mode: LaborMode): void;
  onManualLaborUnitPriceChange(rowId: string, value: string): void;
  onOverrideReasonChange(rowId: string, value: string): void;
  onConfirmLaborRow(rowId: string, displayedFingerprint: string): void;
  /** 이동 요청이 이 영역으로 포커스를 옮길 때 쓴다. */
  panelRef?: ((el: HTMLElement | null) => void) | undefined;
}) {
  const canBeMapped = row.laborMappingId !== undefined;
  const isConfirmed = row.laborConfirmation !== undefined && !hasUnconfirmedWarning;
  const wasInvalidated = row.laborConfirmation !== undefined && hasUnconfirmedWarning;

  return (
    <tr data-labor-basis-for={row.rowId}>
      <td colSpan={columnCount}>
        {/* 포커스를 받기 위해 tabIndex 를 둔다 — 키보드 사용자가 이동한 자리를 안다. */}
        <div className="q-labor-basis" ref={panelRef} tabIndex={-1}>
          <fieldset>
            <legend>노무 처리 방식 — {row.name}</legend>
            <label>
              <input
                type="radio"
                name={`labor-mode-${row.rowId}`}
                checked={row.laborMode === 'mapped'}
                disabled={!canBeMapped}
                onChange={() => onLaborModeChange(row.rowId, 'mapped')}
              />
              품셈 연결(확인 필요)
            </label>
            <label>
              <input
                type="radio"
                name={`labor-mode-${row.rowId}`}
                checked={row.laborMode === 'manual'}
                onChange={() => onLaborModeChange(row.rowId, 'manual')}
              />
              직접 입력
            </label>
            <label>
              <input
                type="radio"
                name={`labor-mode-${row.rowId}`}
                checked={row.laborMode === 'not-applicable'}
                onChange={() => onLaborModeChange(row.rowId, 'not-applicable')}
              />
              해당 없음
            </label>
          </fieldset>

          {row.laborMode === 'mapped' && breakdown !== undefined && (
            <div data-labor-mapped-basis>
              <table className="q-labor-basis-table">
                <thead>
                  <tr>
                    <th>직종</th>
                    <th>공수</th>
                    <th>노임</th>
                    <th>직종별 금액</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.tradeAmounts.map((t) => (
                    <tr key={t.trade}>
                      <td>{t.trade}</td>
                      <td>{t.quantity.toFixed()}</td>
                      <td>
                        {t.wage.toFixed()} ({t.wageUnit})
                      </td>
                      <td>{t.amount.toFixed()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="q-muted">
                표준 노무 단가 {breakdown.standardUnitPrice.toFixed()} × (1+{breakdown.surcharge.toFixed()}) ×
                요율 {breakdown.itemRate.toFixed()} × 환산 {breakdown.conversionFactor.toFixed()} → INT →{' '}
                <strong>적용 노무 단가 {breakdown.appliedUnitPrice.toFixed()}</strong> × 수량 {row.quantity}
              </p>
              <p className="q-muted">
                품셈 출처: {breakdown.source} ({breakdown.revision}) — 코드 {breakdown.code}
              </p>
              <p className="q-muted">
                적용 노임표: {breakdown.wageTableSource} ({breakdown.wagePeriod}, 표 {breakdown.wageTableId})
              </p>

              {isConfirmed && (
                <p role="status" data-labor-confirmed-at={row.laborConfirmation!.confirmedAt}>
                  이 근거를 {row.laborConfirmation!.confirmedAt}에 확인했습니다.
                </p>
              )}
              {wasInvalidated && (
                <p role="alert" className="q-notice">
                  계산 근거가 바뀌어 이전 확인이 더는 유효하지 않습니다. 위 내용을 다시 확인해 주세요.
                </p>
              )}
              {!isConfirmed && (
                <button
                  type="button"
                  className="q-button"
                  onClick={() => onConfirmLaborRow(row.rowId, breakdown.currentFingerprint)}
                >
                  확인함
                </button>
              )}
            </div>
          )}

          {row.laborMode === 'manual' && (
            <div data-labor-manual-basis>
              <label>
                견적 단위당 금액(KRW)
                <ValidatedDecimalCell
                  rowId={row.rowId}
                  value={row.manualLaborUnitPrice ?? ''}
                  label={`${row.name} 직접 입력 금액`}
                  validate={(raw) => validateDecimalInput(raw, '직접 입력 금액')}
                  onCommit={onManualLaborUnitPriceChange}
                />
              </label>
              <label>
                사유
                <TextCell
                  rowId={row.rowId}
                  value={row.overrideReason ?? ''}
                  label={`${row.name} 직접 입력 사유`}
                  onCommit={onOverrideReasonChange}
                />
              </label>
            </div>
          )}

          {row.laborMode === 'not-applicable' && (
            <div data-labor-not-applicable-basis>
              <label>
                사유
                <TextCell
                  rowId={row.rowId}
                  value={row.overrideReason ?? ''}
                  label={`${row.name} 해당 없음 사유`}
                  onCommit={onOverrideReasonChange}
                />
              </label>
            </div>
          )}

          {row.laborMode === 'unresolved' && (
            <p className="q-muted">노무비 처리 방식을 아직 고르지 않았습니다 — 위에서 하나를 선택하세요.</p>
          )}
        </div>
      </td>
    </tr>
  );
}

export function QuoteSheet({
  document,
  calculation,
  laborBreakdowns,
  laborWarnings,
  onQuantityChange,
  onDescriptionChange,
  onRemarkChange,
  onSupplierChange,
  onSalesRemarkChange,
  onRemoveRow,
  onLaborModeChange,
  onManualLaborUnitPriceChange,
  onOverrideReasonChange,
  onConfirmLaborRow,
  navigation,
  prepared,
  onNavigationMissed,
}: QuoteSheetProps) {
  // 상세 열(설명·비고·거래처·영업비고) 표시 여부. **열을 떼지 않고 CSS 로만
  // 감춘다** — 조건부 렌더로 없애면 사람이 치던 draft 와 미저장 표식이 사라진다.
  const [showDetailColumns, setShowDetailColumns] = useState(false);
  const detailClass = showDetailColumns ? undefined : 'q-detail-hidden';
  // 상세 4열을 감추면 **보이는 열이 8개**가 된다. `colSpan` 을 12로 고정해
  // 두면 숨긴 열까지 세어 합계 줄과 노무 근거 칸이 표와 어긋난다
  // (2026-10-12 독립 검토 지적).
  const hiddenDetailCount = showDetailColumns ? 4 : 0;
  const columnCount = 8 + hiddenDetailCount;
  const [expandedRowIds, setExpandedRowIds] = useState<ReadonlySet<string>>(new Set());
  const unconfirmedRowIds = new Set(
    laborWarnings.filter((w) => w.code === 'mapping-unconfirmed' && w.rowId !== undefined).map((w) => w.rowId!),
  );

  // --- 확인 목록에서 온 이동 요청 ---------------------------------------
  //
  // 두 단계다. (1) 노무 영역을 **열고** (2) 다음 렌더에서 포커스·스크롤한다.
  // 한 번에 하려고 하면 아직 DOM 에 없는 요소를 찾게 된다.
  const laborPanelRefs = useRef(new Map<string, HTMLElement>());
  const quantityRefs = useRef(new Map<string, HTMLInputElement>());
  const handledNonce = useRef<number | undefined>(undefined);
  const [pendingFocus, setPendingFocus] = useState<RowNavigation | undefined>(undefined);

  const rowExists = (rowId: string): boolean =>
    document.rows.some((r) => r.type === 'item' && r.rowId === rowId);

  /** 받아들일지 말지는 순수 함수가 정한다 — 그래야 직접 시험할 수 있다. */
  const decide = (request: RowNavigation) =>
    decideNavigation({
      sourcePrepared: request.sourcePrepared,
      currentPrepared: prepared,
      targetExists: rowExists(request.rowId),
    });

  useEffect(() => {
    if (navigation === undefined || navigation.nonce === handledNonce.current) return;
    handledNonce.current = navigation.nonce;

    const decision = decide(navigation);
    if (decision.kind !== 'go') {
      onNavigationMissed?.(decision.message);
      return;
    }
    if (navigation.kind === 'labor') {
      setExpandedRowIds((prev) => (prev.has(navigation.rowId) ? prev : new Set(prev).add(navigation.rowId)));
    }
    setPendingFocus(navigation);
    // `navigation` 외의 값은 그 시점 참조로 읽는다 — 요청마다 한 번만 돈다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  useEffect(() => {
    if (pendingFocus === undefined) return;
    setPendingFocus(undefined);
    // 열고 그리는 사이에 문서가 또 바뀌었을 수 있다 — 포커스 직전에 다시 본다.
    const stillOk = decide(pendingFocus);
    if (stillOk.kind !== 'go') {
      onNavigationMissed?.(stillOk.message);
      return;
    }
    const target =
      pendingFocus.kind === 'labor'
        ? laborPanelRefs.current.get(pendingFocus.rowId)
        : quantityRefs.current.get(pendingFocus.rowId);
    if (target === undefined) {
      onNavigationMissed?.('이동할 입력을 찾지 못했습니다. 확인 목록에서 다시 선택해 주세요.');
      return;
    }
    target.scrollIntoView({ block: 'center', behavior: 'auto' });
    target.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFocus]);

  function toggleExpanded(rowId: string): void {
    setExpandedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }
  const calcBySystem = new Map(calculation.systems.map((s) => [s.systemId, s]));

  return (
    <div className="q-card q-quote-sheet">
      <div className="q-sheet-tools">
        <button
          type="button"
          className="q-button"
          aria-expanded={showDetailColumns}
          onClick={() => setShowDetailColumns((v) => !v)}
        >
          {showDetailColumns ? '상세 열 숨기기' : '상세 열 표시'}
        </button>
      </div>
      {document.systems.map((system) => {
        const calc = calcBySystem.get(system.systemId);
        const rows = document.rows.filter((r) => r.systemId === system.systemId);

        return (
          <section
            key={system.systemId}
            className="q-quote-system"
            id={systemSectionDomId(system.systemId)}
            data-system-name={system.name}
            // 탐색 메뉴로 왔을 때 포커스를 받는다 — 키보드로도 자리를 안다.
            tabIndex={-1}
          >
            <h3>{system.name}</h3>
            <div className="q-table-wrap">
              <table className="q-quote-table">
                <thead>
                  <tr>
                    <th>품명</th>
                    <th>규격</th>
                    <th>단위</th>
                    <th>수량</th>
                    <th className={detailClass}>설명</th>
                    <th className={detailClass}>비고</th>
                    <th className={detailClass}>거래처</th>
                    <th className={detailClass}>영업비고</th>
                    <th>재료비</th>
                    <th>노무비</th>
                    <th>합계</th>
                    <th aria-label="삭제"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    if (row.type === 'display') {
                      return (
                        <tr key={row.rowId}>
                          <td colSpan={columnCount}>{row.name}</td>
                        </tr>
                      );
                    }

                    const rowCalc = calc?.rows.find((r) => r.rowId === row.rowId);
                    const materialText =
                      rowCalc?.materialAmount !== undefined ? rowCalc.materialAmount.toFixed() : '미등록';
                    const laborText =
                      row.laborMode === 'not-applicable'
                        ? '해당없음'
                        : rowCalc?.laborAmount !== undefined
                          ? rowCalc.laborAmount.toFixed()
                          : '미등록';
                    const totalText = rowCalc?.total !== undefined ? rowCalc.total.toFixed() : '미등록';

                    const isExpanded = expandedRowIds.has(row.rowId);

                    return (
                      <Fragment key={row.rowId}>
                      <tr data-row-id={row.rowId}>
                        <td>{row.name}</td>
                        <td>{row.specification}</td>
                        <td>{row.unit}</td>
                        <td>
                          <ValidatedDecimalCell
                            rowId={row.rowId}
                            value={row.quantity}
                            label={`${row.name} 수량`}
                            validate={validateQuantityInput}
                            onCommit={onQuantityChange}
                            inputRef={(el) => {
                              if (el === null) quantityRefs.current.delete(row.rowId);
                              else quantityRefs.current.set(row.rowId, el);
                            }}
                          />
                        </td>
                        <td className={detailClass}>
                          <TextCell
                            rowId={row.rowId}
                            value={row.internalDescription ?? ''}
                            label={`${row.name} 설명`}
                            onCommit={onDescriptionChange}
                          />
                          {row.conversionNote !== undefined && row.conversionNote !== '' && (
                            <p className="q-muted">자동 메모(참고): {row.conversionNote}</p>
                          )}
                        </td>
                        <td className={detailClass}>
                          <TextCell
                            rowId={row.rowId}
                            value={row.remark}
                            label={`${row.name} 비고`}
                            onCommit={onRemarkChange}
                          />
                        </td>
                        <td className={detailClass}>
                          <TextCell
                            rowId={row.rowId}
                            value={row.supplier ?? ''}
                            label={`${row.name} 거래처`}
                            onCommit={onSupplierChange}
                          />
                        </td>
                        <td className={detailClass}>
                          <TextCell
                            rowId={row.rowId}
                            value={row.salesRemark ?? ''}
                            label={`${row.name} 영업비고`}
                            onCommit={onSalesRemarkChange}
                          />
                        </td>
                        <td>{materialText}</td>
                        <td>
                          {laborText}{' '}
                          <button
                            type="button"
                            className="q-button"
                            aria-label={`${row.name} 노무 처리 ${isExpanded ? '접기' : '펼치기'}`}
                            onClick={() => toggleExpanded(row.rowId)}
                          >
                            {isExpanded ? '접기' : '펼치기'}
                          </button>
                        </td>
                        <td>{totalText}</td>
                        <td>
                          <button
                            type="button"
                            className="q-button"
                            aria-label={`${row.name} 삭제`}
                            onClick={() => onRemoveRow(row.rowId)}
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <LaborBasisPanel
                          panelRef={(el) => {
                            if (el === null) laborPanelRefs.current.delete(row.rowId);
                            else laborPanelRefs.current.set(row.rowId, el);
                          }}
                          row={row}
                          breakdown={laborBreakdowns.get(row.rowId)}
                          hasUnconfirmedWarning={unconfirmedRowIds.has(row.rowId)}
                          columnCount={columnCount}
                          onLaborModeChange={onLaborModeChange}
                          onManualLaborUnitPriceChange={onManualLaborUnitPriceChange}
                          onOverrideReasonChange={onOverrideReasonChange}
                          onConfirmLaborRow={onConfirmLaborRow}
                        />
                      )}
                      </Fragment>
                    );
                  })}
                  {document.derivedRows.filter(row => row.systemId === system.systemId).map(row => {
                    const rowCalc = calc?.rows.find(item => item.rowId === row.rowId);
                    return (
                      <tr key={row.rowId} data-row-id={row.rowId} data-derived="true">
                        <td>{row.name}</td><td>{row.specification}</td><td>{row.unit}</td><td>{row.quantity}</td>
                        <td className={detailClass}>{row.internalDescription ?? ''}</td>
                        <td className={detailClass}>{row.remark}</td>
                        <td className={detailClass}></td><td className={detailClass}></td>
                        <td>{rowCalc?.materialAmount?.toFixed() ?? '미등록'}</td>
                        <td>{row.laborMode === 'not-applicable' ? '해당없음' : rowCalc?.laborAmount?.toFixed() ?? '미등록'}</td>
                        <td>{rowCalc?.total?.toFixed() ?? '미등록'}</td><td></td>
                      </tr>
                    );
                  })}
                </tbody>
                {calc !== undefined && (
                  <tfoot>
                    <tr>
                      <td colSpan={4 + hiddenDetailCount}>직접비계</td>
                      <td>{calc.directMaterial.toFixed()}</td>
                      <td>{calc.directLabor.toFixed()}</td>
                      <td>{calc.directTotal.toFixed()}</td>
                      <td></td>
                    </tr>
                    <tr>
                      <td colSpan={6 + hiddenDetailCount}>간접비계</td>
                      <td>{calc.indirectTotal.toFixed()}</td>
                      <td></td>
                    </tr>
                    <tr>
                      <td colSpan={6 + hiddenDetailCount}>합계</td>
                      <td>{calc.systemTotal.toFixed()}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
        );
      })}
      <p className="q-muted">갑지 합계(절사): {calculation.cover.rounded.toFixed()}</p>
    </div>
  );
}
