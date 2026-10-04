/**
 * 내 PC 원가 파일 확인 — 사내 전용(계획 Task5 "내 PC의 원가 파일과
 * 모델 확인"). 이번 분량은 집중 항목만 다룬다: 원가 파일 교체/문서
 * 교체 시 세션 폐기, 지연 응답 무효화. 열 매핑 확인 화면·통화/단위
 * 명시 입력·모델 후보 연결 UI는 Task5의 남은 체크리스트로 아직 이
 * 패널에 없다 — 지금은 실제 원가 파일의 고정 열 이름(품명/규격/
 * 매입단가/통화/단위)만 읽는다.
 *
 * 원가 서비스 계층(`services/private-cost/`)은 여기서만 들여온다 —
 * customer/shared/files 경로와 분리한다.
 */
import { useRef } from 'react';
import type { QuoteDocument } from '../../domain/quote/types';
import type { ColumnMapping } from '../../services/private-cost/parse';
import type { TableFormat } from '../../services/private-cost/readTable';
import { usePrivateCostController } from './usePrivateCostController';

const DEFAULT_MAPPING: ColumnMapping = {
  name: '품명',
  model: '규격',
  purchaseUnitPrice: '매입단가',
  currency: '통화',
  unit: '단위',
};

function formatOf(name: string): TableFormat | undefined {
  if (/\.csv$/i.test(name)) return 'csv';
  if (/\.xlsx$/i.test(name)) return 'xlsx';
  return undefined;
}

export function PrivateCostPanel({ document }: { document: QuoteDocument }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const controller = usePrivateCostController(document);
  const { status } = controller;

  return (
    <section className="q-card q-private-cost">
      <h3>내 PC 원가 파일 확인(사내 전용)</h3>
      <p className="q-muted">
        선택한 파일은 이 브라우저 메모리에서만 읽는다 — 서버로 올리거나 저장하지 않는다. 문서를
        바꾸거나 다른 작업 파일을 열면 지금 연결은 폐기된다.
      </p>
      <button type="button" className="q-button" onClick={() => inputRef.current?.click()}>
        원가 파일 선택
      </button>
      <input
        ref={inputRef}
        type="file"
        aria-label="원가 파일 선택"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // 같은 파일을 다시 선택해도 onChange가 또 나도록 즉시 비운다.
          event.target.value = '';
          if (file === undefined) return;
          const format = formatOf(file.name);
          if (format === undefined) {
            // 포맷을 모르면 읽지 않는다 — 추측하지 않는다.
            return;
          }
          controller.loadFile(file, format, DEFAULT_MAPPING);
        }}
      />
      {status.kind === 'loaded' && (
        <p role="status" className="q-muted">
          {status.fileName} — {status.count}줄 인식됨
        </p>
      )}
      {status.kind === 'rejected' && (
        <p role="alert" className="q-field-error">
          {status.fileName} — {status.message}
        </p>
      )}
      {status.kind === 'invalid' && (
        <div role="alert" className="q-field-error">
          <p>
            {status.fileName} — {status.errors.length}건의 오류가 있다.
          </p>
          <ul>
            {status.errors.map((error, index) => (
              <li key={index}>
                {error.row}행 — {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {controller.session !== undefined && status.kind !== 'loaded' && (
        <p role="status" className="q-muted">
          연결된 원가 — {controller.session.size}줄
        </p>
      )}
    </section>
  );
}
