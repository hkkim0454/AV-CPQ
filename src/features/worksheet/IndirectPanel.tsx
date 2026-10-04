/**
 * 간접비 패널 (계획 2026-10-04-quote-workspace-ui Task 2, 결정 D12).
 *
 * 항목별 조건 문구(conditionText)·기준 설명(basisLabel)·기준 금액을
 * 보여준다. 조건은 가이드에서 온 문구이며 현재 법령 판단으로 표현하지
 * 않는다. 적용 여부·요율은 사람이 명시적으로 바꿀 때만 바뀐다 —
 * 프로파일을 고른다고 자동으로 적용하지 않는다.
 *
 * 요율은 **%·소수 3자리**로 보여준다(결정 D12) — 내부 저장은 그대로
 * 소수 분수 문자열이다(`0.0486`). `RateInput`은 표시용 변환만 하고,
 * 저장은 사용자가 실제로 입력칸을 건드렸을 때만 한다 — 반올림된
 * 표시값을 아무 편집 없는 blur에서 그대로 되돌려 저장하면, 3자리보다
 * 정밀한 원본 요율이 조용히 깎인다.
 */
import { useEffect, useState } from 'react';
import type { SystemCalculation } from '../../domain/calculation/calculate';
import type { IndirectCostRule, QuoteSystem } from '../../domain/quote/types';
import type { IndirectProfileId } from '../../export/ooxml/guideTemplate';
import { validateDecimalInput } from '../../domain/quote/validateInput';
import { dec, text } from '../../domain/calculation/rounding';

interface IndirectPanelProps {
  system: QuoteSystem;
  calculation: SystemCalculation;
  onProfileChange(profile: IndirectProfileId): void;
  onToggleApplied(itemId: string, applied: boolean): void;
  onRateChange(itemId: string, rate: string): void;
}

const PERCENT_DECIMALS = 3;

function toPercentDisplay(rateFraction: string): string {
  return dec(rateFraction).times(100).toFixed(PERCENT_DECIMALS);
}

function toRateFraction(percentText: string): string {
  return text(dec(percentText).dividedBy(100));
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
  const [draft, setDraft] = useState(() => toPercentDisplay(rate));
  const [error, setError] = useState<string | undefined>(undefined);
  // 사용자가 실제로 입력칸을 고쳤는지 — "값이 바뀌었는지"가 아니다.
  // 표시값(%·3자리)은 원본 분수보다 자릿수가 적을 수 있어서, 아무것도
  // 안 고친 채 blur만 해도 반올림된 표시값을 되돌려 저장하면 더 정밀한
  // 원본 rate가 조용히 깎인다(독립 검토 지적). 포커스/blur만으로는
  // 절대 dirty가 되지 않는다 — 오직 onChange만 dirty를 켠다.
  const [dirty, setDirty] = useState(false);

  // 바깥에서 rate가 바뀌면(프로파일 전환, 실행취소/다시실행) 표시도
  // 다시 맞추고 dirty를 지운다 — 외부 변경은 사용자 입력이 아니다.
  useEffect(() => {
    setDraft(toPercentDisplay(rate));
    setError(undefined);
    setDirty(false);
  }, [rate]);

  return (
    <span className="q-rate-input">
      <input
        aria-label={`${itemId} 요율(%)`}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setDirty(true);
        }}
        onBlur={() => {
          if (!dirty) return; // 손대지 않았다 — 반올림된 표시값으로도 덮어쓰지 않는다.
          const result = validateDecimalInput(draft, '요율');
          if (!result.ok) {
            setError(result.reason);
            return;
          }
          setError(undefined);
          setDirty(false);
          const fraction = toRateFraction(result.value);
          if (fraction !== rate) onRateChange(itemId, fraction);
        }}
      />
      <span className="q-muted">%</span>
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
          value={system.indirectProfileId ?? 'ds'}
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
