/**
 * 견적 표 (계획 2026-10-04-quote-workspace-ui Task 2).
 *
 * 금액은 전부 `CalculationSnapshot`에서 읽는다 — React에서 다시 계산하지
 * 않는다. 수량·설명·비고만 로컬 입력 상태를 갖고, 올바른 값일 때만
 * `onCommit`으로 workspace reducer를 부른다(계획 §4.2 "원래 문서를
 * 덮어쓰지 않는다").
 */
import { useEffect, useState } from 'react';
import type { CalculationSnapshot } from '../../domain/calculation/calculate';
import type { QuoteDocument } from '../../domain/quote/types';
import { validateQuantityInput } from '../../domain/quote/validateInput';

interface QuoteSheetProps {
  document: QuoteDocument;
  calculation: CalculationSnapshot;
  onQuantityChange(rowId: string, value: string): void;
  onDescriptionChange(rowId: string, value: string): void;
  onRemarkChange(rowId: string, value: string): void;
}

function QuantityCell({
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
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setDraft(value);
    setError(undefined);
  }, [value]);

  function commit(): void {
    const result = validateQuantityInput(draft);
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

export function QuoteSheet({
  document,
  calculation,
  onQuantityChange,
  onDescriptionChange,
  onRemarkChange,
}: QuoteSheetProps) {
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
                    <th>재료비</th>
                    <th>노무비</th>
                    <th>합계</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    if (row.type === 'display') {
                      return (
                        <tr key={row.rowId}>
                          <td colSpan={9}>{row.name}</td>
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

                    return (
                      <tr key={row.rowId}>
                        <td>{row.name}</td>
                        <td>{row.specification}</td>
                        <td>{row.unit}</td>
                        <td>
                          <QuantityCell
                            rowId={row.rowId}
                            value={row.quantity}
                            label={`${row.name} 수량`}
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
                        <td>{materialText}</td>
                        <td>{laborText}</td>
                        <td>{totalText}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {calc !== undefined && (
                  <tfoot>
                    <tr>
                      <td colSpan={6}>직접비계</td>
                      <td>{calc.directMaterial.toFixed()}</td>
                      <td>{calc.directLabor.toFixed()}</td>
                      <td>{calc.directTotal.toFixed()}</td>
                    </tr>
                    <tr>
                      <td colSpan={8}>간접비계</td>
                      <td>{calc.indirectTotal.toFixed()}</td>
                    </tr>
                    <tr>
                      <td colSpan={8}>합계</td>
                      <td>{calc.systemTotal.toFixed()}</td>
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
