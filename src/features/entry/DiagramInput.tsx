/**
 * 구성도 JSON 열기 — 주 입구 (계획 2026-10-04-quote-workspace-ui Task 1).
 *
 * 로컬 파일을 읽어 JSON 형식인지만 확인한다. 실제 구성도→견적 변환
 * (parseDiagram/diagramToQuote 연결)은 Task 2 범위다 — 여기서 앞질러
 * 만들지 않는다.
 */
import { useRef, useState } from 'react';

type FileStatus = { kind: 'idle' } | { kind: 'read'; name: string; valid: boolean };

export function DiagramInput() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<FileStatus>({ kind: 'idle' });

  async function handleFile(file: File): Promise<void> {
    const text = await file.text();
    let valid = true;
    try {
      JSON.parse(text);
    } catch {
      valid = false;
    }
    setStatus({ kind: 'read', name: file.name, valid });
  }

  return (
    <div className="q-card">
      <h3>구성도 JSON 열기</h3>
      <p className="q-muted">
        로컬 구성도 파일(.json)을 선택합니다. 견적으로 바꾸는 다음 단계는 이어서 만듭니다.
      </p>
      <button type="button" className="q-button" onClick={() => inputRef.current?.click()}>
        파일 선택
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void handleFile(file);
        }}
      />
      {status.kind === 'read' && (
        <p role="status" className="q-muted">
          {status.valid ? `선택됨: ${status.name}` : `${status.name} — JSON 형식이 아닙니다.`}
        </p>
      )}
    </div>
  );
}
