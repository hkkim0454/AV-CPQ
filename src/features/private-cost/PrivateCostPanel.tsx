/**
 * 내 PC 원가 파일 확인 — 사내 전용(계획 Task5 "내 PC의 원가 파일과
 * 모델 확인"). 열 이름은 실제 원가 파일의 고정 모양(품명/규격/
 * 매입단가/통화/단위)을 그대로 쓴다. 통화·단위 열이 머리글에 아예
 * 없으면(예: 파일에 늘 KRW뿐이라 적어 둔 적이 없다) 사람이 명시
 * 확인하는 입력을 보여준다 — 추측하지 않고, 열에 실제 값이 있으면
 * 그 값을 덮지 않는다(parse.ts의 `defaultCurrency`/`defaultUnit`).
 *
 * 모델 후보 연결 UI(중복 후보 중 사람이 골라 rowId에 잇는 화면)는
 * Task5의 남은 체크리스트로 아직 이 패널에 없다.
 *
 * 원가 서비스 계층(`services/private-cost/`)은 여기서만 들여온다 —
 * customer/shared/files 경로와 분리한다.
 */
import { useRef, useState } from 'react';
import type { QuoteDocument } from '../../domain/quote/types';
import type { ColumnMapping } from '../../services/private-cost/parse';
import type { TableFormat } from '../../services/private-cost/readTable';
import { usePrivateCostController, type PrivateCostController } from './usePrivateCostController';

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
      {status.kind === 'needs-defaults' && (
        <DefaultsConfirmForm
          fileName={status.fileName}
          missing={status.missing}
          onConfirm={controller.confirmDefaults}
        />
      )}
      {controller.session !== undefined && status.kind !== 'loaded' && (
        <p role="status" className="q-muted">
          연결된 원가 — {controller.session.size}줄
        </p>
      )}
    </section>
  );
}

function DefaultsConfirmForm({
  fileName,
  missing,
  onConfirm,
}: {
  fileName: string;
  missing: { currency: boolean; unit: boolean };
  onConfirm: PrivateCostController['confirmDefaults'];
}) {
  // 추측하지 않는다 — 빈 채로 시작해 사람이 직접 입력해야 한다.
  const [currency, setCurrency] = useState('');
  const [unit, setUnit] = useState('');
  const ready = (!missing.currency || currency.trim() !== '') && (!missing.unit || unit.trim() !== '');

  return (
    <div role="alert" className="q-field-error">
      <p>
        {fileName} — {missing.currency && missing.unit
          ? '통화·단위 열이 없다.'
          : missing.currency
            ? '통화 열이 없다.'
            : '단위 열이 없다.'}{' '}
        이 파일 전체에 적용할 값을 직접 확인해 입력해야 한다.
      </p>
      {missing.currency && (
        <label>
          통화(예: KRW)
          <input
            type="text"
            aria-label="원가 파일 통화 확인"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
          />
        </label>
      )}
      {missing.unit && (
        <label>
          단위(예: EA)
          <input
            type="text"
            aria-label="원가 파일 단위 확인"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
          />
        </label>
      )}
      <button
        type="button"
        className="q-button"
        disabled={!ready}
        onClick={() =>
          onConfirm({
            ...(missing.currency ? { currency: currency.trim() } : {}),
            ...(missing.unit ? { unit: unit.trim() } : {}),
          })
        }
      >
        확인
      </button>
    </div>
  );
}
