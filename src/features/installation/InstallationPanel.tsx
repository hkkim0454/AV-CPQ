/**
 * 배관 입력 패널 (계획 2026-10-04-quote-workspace-ui Task 3, 결정 D8
 * 보강·D22).
 *
 * 장비실→가장 먼 장비 거리와 줄 수(기본 3)만 받는다. 계산 근거를
 * 화면에 그대로 보여준다(`10m × 3줄 = 30m`) — 숨겨진 배수를 두지
 * 않는다(결정 D8). 배관 종류(후렉시블/CD관)와 기타자재 비율은
 * `domain/quote/installation.ts`의 기본값 규칙을 그대로 따른다.
 */
import { useState } from 'react';
import type { InstallationPatch } from '../../domain/quote/installation';
import { conduitRowSentinel, validateConduitRuns } from '../../domain/quote/installation';
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
          value={system.conduitRuns ?? '3'}
          validate={validateConduitRuns}
          onCommit={(conduitRuns) => onChange({ conduitRuns })}
        />
        <span role="radiogroup" aria-label={`${system.name} 배관 종류`}>
          <label className="q-grade-option">
            <input
              type="radio"
              name={`conduit-type-${system.systemId}`}
              checked={conduitType === 'flexible'}
              onChange={() => onChange({ conduitType: 'flexible' })}
            />
            후렉시블
          </label>
          <label className="q-grade-option">
            <input
              type="radio"
              name={`conduit-type-${system.systemId}`}
              checked={conduitType === 'cd'}
              onChange={() => onChange({ conduitType: 'cd' })}
            />
            CD관
          </label>
        </span>
        <DraftField
          key={`${conduitType}-${system.conduitMaterialRate ?? ''}`}
          label={`${system.name} 배관 기타자재 비율(%)`}
          value={system.conduitMaterialRate ?? ''}
          validate={(raw) => validateDecimalInput(raw, '비율')}
          onCommit={(conduitMaterialRate) => onChange({ conduitMaterialRate })}
        />
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
