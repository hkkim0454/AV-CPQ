/**
 * 내 PC 원가 파일 확인 — 사내 전용(계획 Task5 "내 PC의 원가 파일과
 * 모델 확인"). 열 이름은 실제 원가 파일의 고정 모양(품명/규격/
 * 매입단가/통화/단위)을 그대로 쓴다. 통화·단위는 열이 아예 없거나
 * 일부 줄만 비었을 때만 사람이 명시 확인하는 입력을 보여준다 —
 * 추측하지 않고, 열에 실제 값이 있으면 그 값을 덮지 않는다(parse.ts의
 * `defaultCurrency`/`defaultUnit`).
 *
 * SKU가 견적 행에 있고 원가 파일에도 그 SKU가 있으면 자동으로
 * 연결된다(internalLines의 기존 규칙). 그 외의 행은 모델명 후보 중
 * 사람이 직접 골라 연결해야 한다 — 비슷한 모델이 여럿이면 전부
 * 보여주고 하나를 임의로 고르지 않는다. 행의 제품/SKU/규격이 바뀌면
 * 옛 연결은 다시 확인받아야 한다(매 렌더 `matchesModel`로 재검증).
 *
 * 새 원가 파일을 고르면(성공이든 실패든, 지원하지 않는 확장자여도)
 * **선택한 순간** 옛 세션·연결·확인 대기를 전부 지운다 — 실패해도
 * 복구하지 않는다. "원가 비우기"로도 바로 지울 수 있다. 문서가
 * **통째로 교체**(새 견적/작업 파일 열기)될 때만 세션이 폐기된다 —
 * 같은 문서를 수량·설명·요율만 고치면 세션은 그대로 유지된다
 * (`documentGeneration`, 독립 검토 지적 2026-10-05).
 *
 * 원가 단위와 견적 단위가 다르면 임의로 비교·변환하지 않고 계산을
 * 막는다 — 자동 SKU 연결·수동 모델 연결 모두 같은 규칙이다.
 *
 * 이 화면은 내부 확인용이다 — 여기서 만든 rowId→entryId 연결과 원가
 * 비교 숫자는 QuoteDocument에 들어가지 않고, 고객용/공유용 출력과도
 * 분리된 전용 경로로만 접근한다(Task6에서 영업팀용 출력만 연결 예정,
 * 열·시트 선택을 포함한 전체 매핑 미리보기 화면은 아직 남은 작업이다
 * — 지금은 실제 원가 파일의 고정 열 이름만 읽는다).
 *
 * 원가 서비스 계층(`services/private-cost/`)은 여기서만 들여온다 —
 * customer/shared/files 경로와 분리한다.
 */
import { useRef, useState } from 'react';
import type { QuoteDocument } from '../../domain/quote/types';
import type { ColumnMapping } from '../../services/private-cost/parse';
import type { TableFormat } from '../../services/private-cost/readTable';
import { usePrivateCostController, type PrivateCostController } from './usePrivateCostController';
import type { InternalLine } from '../../services/private-cost/calculate';
import type { UnresolvedRowCandidates } from '../../services/private-cost/candidates';

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

export function PrivateCostPanel({
  document,
  documentGeneration,
}: {
  document: QuoteDocument;
  documentGeneration: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const controller = usePrivateCostController(document, documentGeneration);
  const { status } = controller;

  return (
    <section className="q-card q-private-cost">
      <h3>내 PC 원가 파일 확인(사내 전용)</h3>
      <p className="q-muted">
        선택한 파일은 이 브라우저 메모리에서만 읽는다 — 서버로 올리거나 저장하지 않는다. 새 원가
        파일을 고르면(실패해도) 지금 연결은 즉시 폐기된다. 다른 문서를 열면 세션이 폐기되지만,
        같은 문서의 수량·설명·요율만 고치면 세션은 그대로 유지된다.
      </p>
      <button type="button" className="q-button" onClick={() => inputRef.current?.click()}>
        원가 파일 선택
      </button>
      <button type="button" className="q-button" onClick={() => controller.clearCost()}>
        원가 비우기
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
          // 확장자를 몰라도 loadFile을 그대로 부른다 — 선택한 순간
          // 옛 세션을 지우는 것은 확장자 지원 여부와 무관해야 한다
          // (독립 검토 지적 2026-10-05). 형식 자체는 추측하지 않는다.
          controller.loadFile(file, formatOf(file.name), DEFAULT_MAPPING);
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
      {controller.session !== undefined && controller.lines.length > 0 && (
        <table className="q-quote-table">
          <thead>
            <tr>
              <th>품명</th>
              <th>규격</th>
              <th>원가 대비</th>
            </tr>
          </thead>
          <tbody>
            {controller.lines.map((line) => (
              <CostLineRow
                key={line.rowId}
                line={line}
                unresolved={controller.unresolved.find((u) => u.rowId === line.rowId)}
                onConfirmLink={(entryId) => controller.confirmLink(line.rowId, entryId)}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function CostLineRow({
  line,
  unresolved,
  onConfirmLink,
}: {
  line: InternalLine;
  unresolved: UnresolvedRowCandidates | undefined;
  onConfirmLink(entryId: string): void;
}) {
  // 원가 단위와 견적 단위가 다르면 숫자만 그럴듯하게 보여주고 끝낼 수
  // 없다 — 임의로 비교·변환하지 않고 계산 자체를 막는다. 자동 SKU
  // 연결이든 수동 모델 연결이든 같은 규칙이다(독립 검토 지적
  // 2026-10-05).
  const unitMismatch =
    line.costRegistered && line.costLinkStale !== true && line.costUnit !== undefined && line.costUnit !== line.unit;

  return (
    <tr>
      <td>{line.name}</td>
      <td>{line.specification}</td>
      <td>
        {line.costRegistered && line.costLinkStale !== true ? (
          unitMismatch ? (
            <p role="alert" className="q-field-error">
              단위가 다르다 — 원가 단위 {line.costUnit}, 견적 단위 {line.unit}. 임의로 바꿔 계산하지 않는다.
            </p>
          ) : (
            <span>
              원가 {line.purchaseUnitPrice?.toFixed()} · 가산율{' '}
              {line.markupRate !== undefined ? `${line.markupRate.times(100).toFixed(1)}%` : '계산 불가'} · 이익률{' '}
              {line.marginRate !== undefined ? `${line.marginRate.times(100).toFixed(1)}%` : '계산 불가'}
            </span>
          )
        ) : (
          <>
            {line.costLinkStale === true && (
              <p role="alert" className="q-field-error">
                이 연결은 더 이상 유효하지 않다 — 원가 파일이 바뀌었거나 품목이 바뀌었다. 다시
                연결하세요.
              </p>
            )}
            {unresolved === undefined ? (
              <span className="q-muted">미등록</span>
            ) : unresolved.candidates.length === 0 ? (
              <span className="q-muted">후보 없음 — 미등록</span>
            ) : (
              <ul className="q-resolve-candidates">
                {unresolved.candidates.map((candidate) => (
                  <li key={candidate.entryId}>
                    {candidate.name ?? candidate.model} ({candidate.unit})
                    <button type="button" className="q-button" onClick={() => onConfirmLink(candidate.entryId)}>
                      연결
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </td>
    </tr>
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
          ? '통화·단위 확인이 필요하다.'
          : missing.currency
            ? '통화 확인이 필요하다.'
            : '단위 확인이 필요하다.'}{' '}
        열이 없거나 일부 줄이 비어 있다 — 이 파일에 적용할 값을 직접 확인해 입력해야 한다. 열에
        이미 적힌 값은 덮지 않는다.
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
