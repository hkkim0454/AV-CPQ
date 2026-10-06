/**
 * 견적 표 (계획 2026-10-04-quote-workspace-ui Task 2).
 *
 * 금액은 전부 `CalculationSnapshot`에서 읽는다 — React에서 다시 계산하지
 * 않는다. 수량·설명·비고만 로컬 입력 상태를 갖고, 올바른 값일 때만
 * `onCommit`으로 workspace reducer를 부른다(계획 §4.2 "원래 문서를
 * 덮어쓰지 않는다").
 */
import { Fragment, useEffect, useState } from 'react';
import type { CalculationSnapshot } from '../../domain/calculation/calculate';
import type { RowLaborBreakdown } from '../../domain/labor/calculateLabor';
import type { LaborWarning } from '../../domain/labor/types';
import type { LaborMode, QuoteDocument, SheetRow } from '../../domain/quote/types';
import { validateDecimalInput, validateQuantityInput, type DecimalValidation } from '../../domain/quote/validateInput';

type ItemRow = Extract<SheetRow, { type: 'item' }>;

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
}: {
  rowId: string;
  value: string;
  label: string;
  validate(raw: string): DecimalValidation;
  onCommit(rowId: string, value: string): void;
}) {
  const [draft, setDraft] = useState(value);
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
    if (result.value !== value) onCommit(rowId, result.value);
  }

  return (
    <div>
      <input
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
  row,
  breakdown,
  hasUnconfirmedWarning,
  onLaborModeChange,
  onManualLaborUnitPriceChange,
  onOverrideReasonChange,
  onConfirmLaborRow,
}: {
  row: ItemRow;
  breakdown: RowLaborBreakdown | undefined;
  hasUnconfirmedWarning: boolean;
  onLaborModeChange(rowId: string, mode: LaborMode): void;
  onManualLaborUnitPriceChange(rowId: string, value: string): void;
  onOverrideReasonChange(rowId: string, value: string): void;
  onConfirmLaborRow(rowId: string, displayedFingerprint: string): void;
}) {
  const canBeMapped = row.laborMappingId !== undefined;
  const isConfirmed = row.laborConfirmation !== undefined && !hasUnconfirmedWarning;
  const wasInvalidated = row.laborConfirmation !== undefined && hasUnconfirmedWarning;

  return (
    <tr data-labor-basis-for={row.rowId}>
      <td colSpan={12}>
        <div className="q-labor-basis">
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
}: QuoteSheetProps) {
  const [expandedRowIds, setExpandedRowIds] = useState<ReadonlySet<string>>(new Set());
  const unconfirmedRowIds = new Set(
    laborWarnings.filter((w) => w.code === 'mapping-unconfirmed' && w.rowId !== undefined).map((w) => w.rowId!),
  );

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
      {document.systems.map((system) => {
        const calc = calcBySystem.get(system.systemId);
        const rows = document.rows.filter((r) => r.systemId === system.systemId);

        return (
          <section key={system.systemId} className="q-quote-system">
            <h3>{system.name}</h3>
            <div className="q-table-wrap">
              <table className="q-quote-table">
                <thead>
                  <tr>
                    <th>품명</th>
                    <th>규격</th>
                    <th>단위</th>
                    <th>수량</th>
                    <th>설명</th>
                    <th>비고</th>
                    <th>거래처</th>
                    <th>영업비고</th>
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
                          <td colSpan={12}>{row.name}</td>
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
                          />
                        </td>
                        <td>
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
                        <td>
                          <TextCell
                            rowId={row.rowId}
                            value={row.remark}
                            label={`${row.name} 비고`}
                            onCommit={onRemarkChange}
                          />
                        </td>
                        <td>
                          <TextCell
                            rowId={row.rowId}
                            value={row.supplier ?? ''}
                            label={`${row.name} 거래처`}
                            onCommit={onSupplierChange}
                          />
                        </td>
                        <td>
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
                          row={row}
                          breakdown={laborBreakdowns.get(row.rowId)}
                          hasUnconfirmedWarning={unconfirmedRowIds.has(row.rowId)}
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
                        <td>{row.internalDescription ?? ''}</td><td>{row.remark}</td>
                        <td></td><td></td>
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
                      <td colSpan={8}>직접비계</td>
                      <td>{calc.directMaterial.toFixed()}</td>
                      <td>{calc.directLabor.toFixed()}</td>
                      <td>{calc.directTotal.toFixed()}</td>
                      <td></td>
                    </tr>
                    <tr>
                      <td colSpan={10}>간접비계</td>
                      <td>{calc.indirectTotal.toFixed()}</td>
                      <td></td>
                    </tr>
                    <tr>
                      <td colSpan={10}>합계</td>
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
