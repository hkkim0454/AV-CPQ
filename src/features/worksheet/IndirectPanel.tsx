/**
 * 간접비 패널 (계획 2026-10-04-quote-workspace-ui Task 2).
 *
 * 항목별 조건 문구(conditionText)·기준 설명(basisLabel)·기준 금액을
 * 보여준다. 조건은 가이드에서 온 문구이며 현재 법령 판단으로 표현하지
 * 않는다. 적용 여부·요율은 사람이 명시적으로 바꿀 때만 바뀐다 —
 * 프로파일을 고른다고 자동으로 적용하지 않는다.
 */
import { useState } from 'react';
import type { SystemCalculation } from '../../domain/calculation/calculate';
import type { IndirectCostRule, QuoteSystem } from '../../domain/quote/types';
import type { IndirectProfileId } from '../../export/ooxml/guideTemplate';
import { validateDecimalInput } from '../../domain/quote/validateInput';

interface IndirectPanelProps {
  system: QuoteSystem;
  calculation: SystemCalculation;
  onProfileChange(profile: IndirectProfileId): void;
  onToggleApplied(itemId: string, applied: boolean): void;
  onRateChange(itemId: string, rate: string): void;
}

function RateInput({
  itemId,
  rate,
  onRateChange,
}: {
  itemId: string;
  rate: string;
  onRateChange(itemId: string, rate: string): void;
}) {
  const [draft, setDraft] = useState(rate);
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <span>
      <input
        aria-label={`${itemId} 요율`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const result = validateDecimalInput(draft, '요율');
          if (!result.ok) {
            setError(result.reason);
            return;
          }
          setError(undefined);
          if (result.value !== rate) onRateChange(itemId, result.value);
        }}
      />
      {error !== undefined && (
        <span role="alert" className="q-field-error">
          {error}
        </span>
      )}
    </span>
  );
}

export function IndirectPanel({
  system,
  calculation,
  onProfileChange,
  onToggleApplied,
  onRateChange,
}: IndirectPanelProps) {
  const calcByItemId = new Map(calculation.indirect.map((item) => [item.itemId, item]));

  return (
    <div className="q-card q-indirect-panel">
      <h3>간접비 — {system.name}</h3>
      <label className="q-grade-option">
        프로파일
        <select
          aria-label={`${system.name} 간접비 프로파일`}
          value={system.indirectProfileId ?? 'general'}
          onChange={(event) => onProfileChange(event.target.value as IndirectProfileId)}
        >
          <option value="general">일반</option>
          <option value="ds">DS</option>
        </select>
      </label>
      <table className="q-indirect-table">
        <thead>
          <tr>
            <th>항목</th>
            <th>기준</th>
            <th>조건</th>
            <th>적용</th>
            <th>요율</th>
            <th>기준금액</th>
            <th>금액</th>
          </tr>
        </thead>
        <tbody>
          {system.indirectCosts.map((rule: IndirectCostRule) => {
            const calc = calcByItemId.get(rule.itemId);
            const basisRuleNote =
              rule.basis.kind === 'item' ? calcByItemId.get(rule.basis.itemId) : undefined;
            const zeroChained =
              rule.applied && basisRuleNote !== undefined && basisRuleNote.amount.isZero();
            return (
              <tr key={rule.itemId}>
                <td>{rule.name}</td>
                <td>{rule.basisLabel}</td>
                <td className="q-muted">{rule.conditionText ?? '—'}</td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${rule.name} 적용`}
                    checked={rule.applied}
                    onChange={(event) => onToggleApplied(rule.itemId, event.target.checked)}
                  />
                </td>
                <td>
                  <RateInput itemId={rule.itemId} rate={rule.rate} onRateChange={onRateChange} />
                </td>
                <td>{calc?.basisAmount.toFixed() ?? '0'}</td>
                <td>
                  {calc?.amount.toFixed() ?? '0'}
                  {zeroChained && (
                    <p role="status" className="q-muted">
                      기준인 {basisRuleNote.name}이(가) 0원이라 이 항목도 0원입니다.
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
