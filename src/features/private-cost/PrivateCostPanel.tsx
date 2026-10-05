/**
 * 내 PC 원가 파일 확인 — 사내 전용(계획 Task5 "내 PC의 원가 파일과
 * 모델 확인"). CSV는 실제 원가 파일의 고정 모양(품명/규격/매입단가/
 * 통화/단위)을 그대로 읽는 간단 경로다. XLSX는 "갑지" 등 여러 시트를
 * 담거나 설명 제목 행이 머리글 위에 있을 수 있어, 시트·머리글 행·열
 * 매핑을 사람이 직접 확인한 뒤에만 읽는다(승인 필수 범위, 2026-10-05
 * 독립 검토 지적) — 시트는 workbook 관계·순서로 고르지, ZIP 파일
 * 이름 정렬로 고르지 않는다(`readTable.ts`).
 *
 * 통화·단위는 열이 아예 없거나 일부 줄만 비었을 때만 사람이 명시
 * 확인하는 입력을 보여준다 — 추측하지 않고, 열에 실제 값이 있으면 그
 * 값을 덮지 않는다(parse.ts의 `defaultCurrency`/`defaultUnit`).
 *
 * SKU가 견적 행에 있고 원가 파일에도 그 SKU가 있으면 자동으로
 * 연결된다(internalLines의 기존 규칙). 그 외의 행은 모델명 후보 중
 * 사람이 직접 골라 연결해야 한다 — 비슷한 모델이 여럿이면 전부
 * 보여주고 하나를 임의로 고르지 않는다. 행의 제품/SKU/규격/단위가
 * 바뀌면 옛 연결은 다시 확인받아야 한다(매 렌더 `linkStillValid`로
 * 재검증 — candidates.ts).
 *
 * 새 원가 파일을 고르면(성공이든 실패든, 지원하지 않는 확장자여도)
 * **선택한 순간** 옛 세션·연결·확인 대기·마법사를 전부 지운다 —
 * 실패해도 복구하지 않는다. "원가 비우기"로도 바로 지울 수 있다.
 * 문서가 **통째로 교체**(새 견적/작업 파일 열기)될 때만 세션이
 * 폐기된다 — 같은 문서를 수량·설명·요율만 고치면 세션은 그대로
 * 유지된다(`documentGeneration`, 독립 검토 지적 2026-10-05).
 *
 * 원가 단위·통화가 견적과 다르면 임의로 비교·변환하지 않고 계산을
 * 막는다(calculate.ts) — 자동 SKU 연결·수동 모델 연결 모두 같은
 * 규칙이다.
 *
 * 이 화면은 내부 확인용이다 — 여기서 만든 rowId→entryId 연결과 원가
 * 비교 숫자는 QuoteDocument에 들어가지 않고, 고객용/공유용 출력과도
 * 분리된 전용 경로로만 접근한다(Task6에서 영업팀용 출력만 연결 예정).
 *
 * 원가 서비스 계층(`services/private-cost/`)은 여기서만 들여온다 —
 * customer/shared/files 경로와 분리한다.
 */
import { useEffect, useRef, useState } from 'react';
import type { QuoteDocument } from '../../domain/quote/types';
import { columnLetter, type ColumnMapping } from '../../services/private-cost/parse';
import type { TableFormat } from '../../services/private-cost/readTable';
import { usePrivateCostController, type PrivateCostController, type XlsxWizard } from './usePrivateCostController';
import type { InternalLine } from '../../services/private-cost/calculate';
import type { UnresolvedRowCandidates } from '../../services/private-cost/candidates';

function formatOf(name: string): TableFormat | undefined {
  if (/\.csv$/i.test(name)) return 'csv';
  if (/\.xlsx$/i.test(name)) return 'xlsx';
  return undefined;
}

export function PrivateCostPanel({
  document,
  documentGeneration,
  onLinesChange,
}: {
  document: QuoteDocument;
  documentGeneration: number;
  /**
   * 영업팀용(0단계) 출력이 쓸 수 있도록 현재 원가 연결 결과를 부모로
   * 올린다(계획 Task6) — 이 화면 밖에서는 `lines`에 직접 접근할 길이
   * 없다. 세션이 없으면(비웠거나 문서가 바뀌었으면) 빈 배열로 알린다.
   */
  onLinesChange?: (lines: readonly InternalLine[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const controller = usePrivateCostController(document, documentGeneration);
  const { status } = controller;

  useEffect(() => {
    onLinesChange?.(controller.lines);
  }, [controller.lines, onLinesChange]);

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
          controller.loadFile(file, formatOf(file.name));
        }}
      />
      {controller.wizard !== undefined && (
        <XlsxWizardView wizard={controller.wizard} controller={controller} />
      )}
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

/** 열 이름 후보 중 정확히 같은 텍스트를 찾는다 — 추측이 아니라 편의상 미리 채우는 기본값이다(사람이 보고 바꿀 수 있다). */
function suggestColumn(header: readonly string[], candidates: readonly string[]): number | undefined {
  for (const candidate of candidates) {
    const at = header.findIndex((h) => h === candidate);
    if (at !== -1) return at;
  }
  return undefined;
}

function XlsxWizardView({ wizard, controller }: { wizard: XlsxWizard; controller: PrivateCostController }) {
  if (wizard.step === 'choosing-sheet') {
    return (
      <div role="alert" className="q-field-error">
        <p>{wizard.fileName} — 어느 시트를 읽을지 고르세요.</p>
        <ul className="q-resolve-candidates">
          {wizard.sheets.map((sheet) => (
            <li key={sheet.sheetPath}>
              <span>{sheet.name}</span>
              <button type="button" className="q-button" onClick={() => controller.chooseSheet(sheet.sheetPath)}>
                이 시트 선택
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="q-button" onClick={() => controller.cancelWizard()}>
          취소
        </button>
      </div>
    );
  }

  if (wizard.step === 'choosing-header-row') {
    return (
      <div role="alert" className="q-field-error">
        <p>
          {wizard.fileName} — {wizard.sheetName} 시트. 어느 행이 머리글(열 이름이 적힌 행)인지 고르세요.
        </p>
        <table className="q-quote-table">
          <tbody>
            {wizard.preview.map((row, index) => (
              <tr key={index}>
                <td>
                  <button
                    type="button"
                    className="q-button"
                    onClick={() => controller.chooseHeaderRow(index)}
                    aria-label={`${index + 1}행을 머리글로 선택`}
                  >
                    {index + 1}행 선택
                  </button>
                </td>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="q-button" onClick={() => controller.cancelWizard()}>
          취소
        </button>
      </div>
    );
  }

  if (wizard.step === 'choosing-data-start') {
    return (
      <div role="alert" className="q-field-error">
        <p>
          {wizard.fileName} — {wizard.sheetName} 시트. 품목이 어디서 시작하는지 고르세요 — 머리글이 여러 행에
          걸쳐 있거나(부제목·노임 설명 등) 빈 줄이 있으면, 진짜 첫 품목 행에서 "여기서 품목 시작"을
          누르세요. 머리글 바로 다음 행부터가 품목이면 아래 버튼으로 기본값을 쓰세요.
        </p>
        <button type="button" className="q-button" onClick={() => controller.chooseDataStart()}>
          기본값 사용(머리글 다음 행부터)
        </button>
        <table className="q-quote-table">
          <tbody>
            {wizard.rowsAfterHeader.map(({ rowIndex, cells }) => (
              <tr key={rowIndex}>
                <td>
                  <button
                    type="button"
                    className="q-button"
                    onClick={() => controller.chooseDataStart(rowIndex)}
                    aria-label={`${rowIndex + 1}행에서 품목 시작으로 선택`}
                  >
                    여기서 품목 시작
                  </button>
                </td>
                {cells.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="q-button" onClick={() => controller.cancelWizard()}>
          취소
        </button>
      </div>
    );
  }

  if (wizard.step === 'choosing-data-end') {
    return (
      <div role="alert" className="q-field-error">
        <p>
          {wizard.fileName} — {wizard.sheetName} 시트. 품목이 어디서 끝나는지 고르세요 — 잡자재비·합계 같은
          집계 행이 아래에 있으면 그 앞 행에서 "여기까지 품목"을 누르세요. 시트 끝까지 전부 품목이면
          아래 버튼으로 전체를 포함하세요.
        </p>
        <button type="button" className="q-button" onClick={() => controller.chooseDataEnd()}>
          전체 포함(끝까지)
        </button>
        <table className="q-quote-table">
          <tbody>
            {wizard.rowsFromDataStart.map(({ rowIndex, cells }) => (
              <tr key={rowIndex}>
                <td>
                  <button
                    type="button"
                    className="q-button"
                    onClick={() => controller.chooseDataEnd(rowIndex)}
                    aria-label={`${rowIndex + 1}행까지 품목으로 선택`}
                  >
                    여기까지 품목
                  </button>
                </td>
                {cells.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="q-button" onClick={() => controller.cancelWizard()}>
          취소
        </button>
      </div>
    );
  }

  return <MappingConfirmForm wizard={wizard} controller={controller} />;
}

function MappingConfirmForm({
  wizard,
  controller,
}: {
  wizard: Extract<XlsxWizard, { step: 'confirming-mapping' }>;
  controller: PrivateCostController;
}) {
  const header = wizard.header;
  const columnOptions = header.map((text, index) => ({ index, label: `${columnLetter(index)}: ${text}` }));

  const [nameIndex, setNameIndex] = useState<string>(() => indexToValue(suggestColumn(header, ['품명'])));
  const [modelIndex, setModelIndex] = useState<string>(() => indexToValue(suggestColumn(header, ['규격', '모델'])));
  const [skuIndex, setSkuIndex] = useState<string>(() => indexToValue(suggestColumn(header, ['SKU', '품번'])));
  const [priceIndex, setPriceIndex] = useState<string>(() => indexToValue(suggestColumn(header, ['매입단가'])));
  const [currencyIndex, setCurrencyIndex] = useState<string>(() => indexToValue(suggestColumn(header, ['통화'])));
  const [unitIndex, setUnitIndex] = useState<string>(() => indexToValue(suggestColumn(header, ['단위'])));

  const ready = priceIndex !== '' && (modelIndex !== '' || skuIndex !== '');

  // 이름이 아니라 **열 번호(좌표)**로 넘긴다 — 머리글 텍스트가
  // 중복·공백·병합이어도 사람이 화면에서 고른 그 열을 그대로 읽는다
  // (독립 검토 지적 2026-10-05: 이름으로 되돌리면 중복 머리글에서
  // 먼저 나오는 열을 읽어 버렸다).
  function indexOf(value: string): number | undefined {
    return value === '' ? undefined : Number(value);
  }

  return (
    <div role="alert" className="q-field-error">
      <p>
        {wizard.fileName} — {wizard.sheetName} 시트. 열 매핑을 확인하세요. H열 같은 총액 열은 매핑하지 않는다 —
        읽어도 쓰지 않는다(견적 수량으로 다시 계산한다).
      </p>
      <ColumnSelect label="품명" value={nameIndex} onChange={setNameIndex} options={columnOptions} allowNone />
      <ColumnSelect label="규격/모델" value={modelIndex} onChange={setModelIndex} options={columnOptions} allowNone />
      <ColumnSelect label="SKU" value={skuIndex} onChange={setSkuIndex} options={columnOptions} allowNone />
      <ColumnSelect label="매입단가" value={priceIndex} onChange={setPriceIndex} options={columnOptions} />
      <ColumnSelect label="통화" value={currencyIndex} onChange={setCurrencyIndex} options={columnOptions} allowNone />
      <ColumnSelect label="단위" value={unitIndex} onChange={setUnitIndex} options={columnOptions} allowNone />
      <button
        type="button"
        className="q-button"
        disabled={!ready}
        onClick={() => {
          const mapping: ColumnMapping = {
            purchaseUnitPrice: indexOf(priceIndex)!,
            ...(indexOf(nameIndex) !== undefined ? { name: indexOf(nameIndex)! } : {}),
            ...(indexOf(modelIndex) !== undefined ? { model: indexOf(modelIndex)! } : {}),
            ...(indexOf(skuIndex) !== undefined ? { sku: indexOf(skuIndex)! } : {}),
            ...(indexOf(currencyIndex) !== undefined ? { currency: indexOf(currencyIndex)! } : {}),
            ...(indexOf(unitIndex) !== undefined ? { unit: indexOf(unitIndex)! } : {}),
          };
          controller.confirmMapping(mapping);
        }}
      >
        확인
      </button>
      <button type="button" className="q-button" onClick={() => controller.cancelWizard()}>
        취소
      </button>
    </div>
  );
}

function indexToValue(index: number | undefined): string {
  return index === undefined ? '' : String(index);
}

function ColumnSelect({
  label,
  value,
  onChange,
  options,
  allowNone = false,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  options: readonly { index: number; label: string }[];
  allowNone?: boolean;
}) {
  return (
    <label>
      {label}
      <select aria-label={`열 매핑 — ${label}`} value={value} onChange={(event) => onChange(event.target.value)}>
        {allowNone && <option value="">(사용 안 함)</option>}
        {!allowNone && <option value="" disabled>
          선택하세요
        </option>}
        {options.map((option) => (
          <option key={option.index} value={option.index}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
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
  // 원가 단위·통화가 견적과 다르면 숫자를 보여주지 않는다 — 실제
  // 차단은 calculate.ts의 internalLines가 한다(line.costMismatch).
  // 이 화면은 그 결과를 그대로 보여줄 뿐 스스로 비교하지 않는다 —
  // 화면만 숨기고 계산 결과(Task6 등 다른 소비자가 읽는 값)에는
  // 막힘이 전달되지 않는 일을 막는다(독립 검토 지적 2026-10-05).
  return (
    <tr>
      <td>{line.name}</td>
      <td>{line.specification}</td>
      <td>
        {line.costRegistered && line.costLinkStale !== true ? (
          line.costMismatch !== undefined ? (
            <p role="alert" className="q-field-error">
              {line.costMismatch.costCurrency !== 'KRW'
                ? `통화가 다르다 — 원가 통화 ${line.costMismatch.costCurrency}. `
                : ''}
              {line.costMismatch.costUnit !== line.unit
                ? `단위가 다르다 — 원가 단위 ${line.costMismatch.costUnit}, 견적 단위 ${line.unit}. `
                : ''}
              임의로 바꿔 계산하지 않는다.
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
