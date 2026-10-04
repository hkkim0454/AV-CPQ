/**
 * 구성도 JSON 열기 — 주 입구 (계획 2026-10-04-quote-workspace-ui Task 2).
 *
 * 실제 변환 경로(parseDiagram → diagramToQuote)를 그대로 부른다 —
 * React에서 구성도 규칙을 다시 짜지 않는다.
 */
import { useRef, useState } from 'react';
import type { Catalog } from '../../data/catalog/load';
import { defaultHeader } from '../../app/defaultHeader';
import type { LoadedDocument } from '../../app/workspace';
import { parseDiagram } from '../../import/diagram/schema';
import { diagramToQuote } from '../../import/diagram/toQuote';

type FileStatus =
  | { kind: 'idle' }
  | { kind: 'loaded'; name: string }
  | { kind: 'error'; name: string; message: string };

export function DiagramInput({
  catalog,
  onLoaded,
}: {
  catalog: Catalog;
  onLoaded(input: LoadedDocument): void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<FileStatus>({ kind: 'idle' });
  // 파일을 고를 때마다 늘어난다. 파일 읽기는 비동기라 먼저 고른 큰 파일의
  // 결과가 나중에 고른 작은 파일보다 늦게 끝날 수 있다 — 이 값으로
  // "이게 아직 최신 선택인가"를 끝에서 확인해 늦게 끝난 이전 결과가
  // 최신 선택을 덮지 않게 한다.
  const requestRef = useRef(0);

  async function handleFile(file: File): Promise<void> {
    const requestId = ++requestRef.current;

    let text: string;
    try {
      text = await file.text();
    } catch {
      if (requestId === requestRef.current) {
        setStatus({ kind: 'error', name: file.name, message: '파일을 읽지 못했습니다.' });
      }
      return;
    }
    if (requestId !== requestRef.current) return; // 그 사이 다른 파일을 골랐다 — 이 결과는 버린다.

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      setStatus({ kind: 'error', name: file.name, message: 'JSON 형식이 아닙니다.' });
      return;
    }

    try {
      const diagram = parseDiagram(raw);
      const result = diagramToQuote(diagram, catalog, {
        header: defaultHeader(file.name.replace(/\.json$/i, '')),
        defaultSystemName: '시스템1',
      });
      setStatus({ kind: 'loaded', name: file.name });
      onLoaded({ document: result.document, importWarnings: result.warnings });
    } catch (err) {
      setStatus({
        kind: 'error',
        name: file.name,
        message: err instanceof Error ? err.message : '구성도를 읽지 못했습니다.',
      });
    }
  }

  return (
    <div className="q-card">
      <h3>구성도 JSON 열기</h3>
      <p className="q-muted">로컬 구성도 파일(.json)을 선택합니다.</p>
      <button type="button" className="q-button" onClick={() => inputRef.current?.click()}>
        파일 선택
      </button>
      <input
        ref={inputRef}
        type="file"
        aria-label="구성도 파일 선택"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // 같은 파일을 다시 선택해도 onChange가 또 나도록 즉시 비운다 —
          // 비우지 않으면 브라우저가 "값이 안 바뀌었다"며 이벤트를 안 낸다.
          event.target.value = '';
          if (file !== undefined) void handleFile(file);
        }}
      />
      {status.kind === 'loaded' && (
        <p role="status" className="q-muted">
          선택됨: {status.name}
        </p>
      )}
      {status.kind === 'error' && (
        <p role="alert" className="q-field-error">
          {status.name} — {status.message}
        </p>
      )}
    </div>
  );
}
