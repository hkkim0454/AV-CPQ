/**
 * 배관 입력 패널 (계획 2026-10-04-quote-workspace-ui Task 3, 결정 D8
 * 보강·D22).
 *
 * 장비실→가장 먼 장비 거리와 줄 수(기본 3)만 받는다. 계산 근거를
 * 화면에 그대로 보여준다(`10m × 3줄 = 30m`) — 숨겨진 배수를 두지
 * 않는다(결정 D8). 배관 종류(후렉시블/CD관)와 기타자재 비율은
 * `domain/quote/installation.ts`의 기본값 규칙을 그대로 따른다.
 */
import { useEffect, useState } from 'react';
import type { InstallationPatch } from '../../domain/quote/installation';
import {
  DEFAULT_CONDUIT_MATERIAL_RATE,
  DEFAULT_CONDUIT_MATERIAL_RATE_SOURCE,
  DEFAULT_CONDUIT_RUNS,
  conduitLabel,
  conduitRowSentinel,
  validateConduitRuns,
} from '../../domain/quote/installation';
import { validateDecimalInput } from '../../domain/quote/validateInput';
import type { ConduitType, QuoteDocument, QuoteSystem } from '../../domain/quote/types';

interface InstallationPanelProps {
  system: QuoteSystem;
  document: QuoteDocument;
  onChange(patch: InstallationPatch): void;
}

function DraftField({
  label,
  value,
  validate,
  onCommit,
}: {
  label: string;
  value: string;
  validate(raw: string): { ok: boolean; reason?: string };
  onCommit(value: string): void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | undefined>(undefined);

  // 바깥에서 값이 바뀌면(실행취소/다시실행, 다른 입력이 간접적으로
  // 이 값을 바꾼 경우) 입력칸도 따라간다 — `useState(value)`는 처음
  // 마운트될 때만 쓰이므로, 이 효과가 없으면 undo/redo를 눌러도 칸에
  // 남은 글자는 그대로다(독립 검토 지적).
  useEffect(() => {
    setDraft(value);
    setError(undefined);
  }, [value]);

  return (
    <label className="q-grade-option">
      {label}
      <input
        aria-label={label}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const result = validate(draft);
          if (!result.ok) {
            setError(result.reason);
            return;
          }
          setError(undefined);
          if (draft !== value) onCommit(draft);
        }}
      />
      {error !== undefined && (
        <span role="alert" className="q-field-error">
          {error}
        </span>
      )}
    </label>
  );
}

export function InstallationPanel({ system, document: doc, onChange }: InstallationPanelProps) {
  const conduitType: ConduitType = system.conduitType ?? 'flexible';
  const manualRate = system.conduitMaterialRateManual ?? false;
  const sentinel = conduitRowSentinel(system.systemId);
  const conduitRow = doc.rows.find(
    (r): r is Extract<QuoteDocument['rows'][number], { type: 'item' }> =>
      r.type === 'item' && (r.sourceNodeIds?.includes(sentinel) ?? false),
  );

  return (
    <div className="q-card q-installation-panel">
      <h3>설치 입력 — {system.name}</h3>
      <div className="q-grade">
        <DraftField
          label={`${system.name} 장비실→가장 먼 장비 거리(m)`}
          value={system.farthestDeviceMeters ?? ''}
          validate={(raw) => validateDecimalInput(raw, '거리')}
          onCommit={(farthestDeviceMeters) => onChange({ farthestDeviceMeters })}
        />
        <DraftField
          label={`${system.name} 배관 줄 수`}
          value={system.conduitRuns ?? DEFAULT_CONDUIT_RUNS}
          validate={validateConduitRuns}
          onCommit={(conduitRuns) => onChange({ conduitRuns })}
        />
        <span role="radiogroup" aria-label={`${system.name} 배관 종류`}>
          {(['flexible', 'cd', 'tray'] as const).map((type) => (
            <label key={type} className="q-grade-option">
              <input
                type="radio"
                name={`conduit-type-${system.systemId}`}
                checked={conduitType === type}
                onChange={() => onChange({ conduitType: type })}
              />
              {conduitLabel(type)}
            </label>
          ))}
        </span>
        <span className="q-rate-mode">
          <span role="radiogroup" aria-label={`${system.name} 배관 기타자재 비율 방식`}>
            <label className="q-grade-option">
              <input
                type="radio"
                name={`conduit-rate-mode-${system.systemId}`}
                checked={!manualRate}
                onChange={() => onChange({ conduitMaterialRateManual: false })}
              />
              기본값 사용 ({DEFAULT_CONDUIT_MATERIAL_RATE[conduitType]}%)
            </label>
            <label className="q-grade-option">
              <input
                type="radio"
                name={`conduit-rate-mode-${system.systemId}`}
                checked={manualRate}
                onChange={() => onChange({ conduitMaterialRateManual: true })}
              />
              직접 지정
            </label>
          </span>
          {!manualRate && (
            <span className="q-muted">출처: {DEFAULT_CONDUIT_MATERIAL_RATE_SOURCE[conduitType]}</span>
          )}
          {manualRate && (
            <DraftField
              label={`${system.name} 배관 기타자재 비율(%)`}
              value={system.conduitMaterialRate ?? DEFAULT_CONDUIT_MATERIAL_RATE[conduitType]}
              validate={(raw) => validateDecimalInput(raw, '비율')}
              onCommit={(conduitMaterialRate) => onChange({ conduitMaterialRate, conduitMaterialRateManual: true })}
            />
          )}
        </span>
      </div>
      <p role="status" className="q-muted">
        {conduitRow !== undefined
          ? `배관 ${conduitRow.quantity}${conduitRow.unit} — ${conduitRow.remark}${
              conduitRow.sku === undefined ? ' (품목 미정 — 아래 확인 목록에서 고르세요)' : ''
            }`
          : '장비실→가장 먼 장비 거리와 줄 수를 입력하면 배관 수량을 계산합니다.'}
      </p>
    </div>
  );
}
