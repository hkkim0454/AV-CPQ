/**
 * 갑지 머리글 — 현장·고객·작성일·견적번호·담당·조건 (계획
 * 2026-10-04-quote-workspace-ui Task 2).
 *
 * 다른 입력창과 같은 규칙이다: 로컬 입력 상태를 두고 포커스를 벗어날
 * 때만 workspace에 커밋한다(실행취소 이력에 쌓인다).
 */
import { useEffect, useState } from 'react';
import type { QuoteHeader } from '../../domain/quote/types';

interface CoverSheetProps {
  header: QuoteHeader;
  onChange(patch: Partial<QuoteHeader>): void;
}

function TextField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit(value: string): void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <label className="q-field">
      <span>{label}</span>
      <input
        aria-label={label}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function CoverSheet({ header, onChange }: CoverSheetProps) {
  const [newCondition, setNewCondition] = useState('');

  function addCondition(): void {
    const trimmed = newCondition.trim();
    if (trimmed === '') return;
    onChange({ conditions: [...header.conditions, trimmed] });
    setNewCondition('');
  }

  return (
    <div className="q-card q-cover-sheet">
      <h3>견적 정보</h3>
      <div className="q-cover-grid">
        <TextField label="견적번호" value={header.quoteNumber} onCommit={(v) => onChange({ quoteNumber: v })} />
        <TextField label="작성일" value={header.quoteDate} onCommit={(v) => onChange({ quoteDate: v })} />
        <TextField label="고객" value={header.customer} onCommit={(v) => onChange({ customer: v })} />
        <TextField
          label="현장/공사명"
          value={header.projectName}
          onCommit={(v) => onChange({ projectName: v })}
        />
        <TextField label="담당자" value={header.contact} onCommit={(v) => onChange({ contact: v })} />
      </div>

      <div className="q-cover-conditions">
        <h4>조건</h4>
        {header.conditions.length > 0 && (
          <ul>
            {header.conditions.map((condition, index) => (
              <li key={`${index}-${condition}`}>
                <span>{condition}</span>
                <button
                  type="button"
                  className="q-button"
                  onClick={() => onChange({ conditions: header.conditions.filter((_, i) => i !== index) })}
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="q-cover-condition-add">
          <input
            aria-label="조건 추가"
            value={newCondition}
            onChange={(event) => setNewCondition(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addCondition();
            }}
          />
          <button type="button" className="q-button" onClick={addCondition}>
            추가
          </button>
        </div>
      </div>
    </div>
  );
}
