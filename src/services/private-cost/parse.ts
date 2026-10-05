/**
 * 원가표 열 매핑과 검증 (설계서 §8.2, §8.3).
 *
 * 설계서 §8.2: "매핑 설정에도 실제 원가 값은 저장하지 않는다."
 * `ColumnMapping`은 **열 이름만** 담는다. 사용자 설정으로 저장해도 안전하다.
 *
 * 설계서 §8.4: 오류 객체에 원가 값을 넣지 않는다. 좌표와 사유만 담는다.
 */
import { dec } from '../../domain/calculation/rounding';
import type { Table } from './readTable';

/**
 * 열을 가리키는 방법 — **이름**(CSV 간단 경로, 기존 그대로) 또는
 * **0부터 센 열 번호**(XLSX 열매핑 확인 화면).
 *
 * 머리글 텍스트는 중복되거나 비거나 병합돼 있을 수 있다(독립 검토
 * 지적 2026-10-05 — 실제 재현: D열·G열 머리글이 둘 다 "단가"일 때,
 * 이름으로 찾으면 사람이 화면에서 G를 골라도 먼저 나오는 D를 읽는다).
 * 그래서 사람이 화면에서 **열을 직접 고른 경우**(XLSX 마법사)는 그
 * 자리(인덱스)를 끝까지 그대로 들고 다녀야 한다 — 이름으로 되돌려
 * 변환하면 고른 좌표를 잃는다.
 */
export type ColumnRef = string | number;

/**
 * 열 매핑. 이름 또는 번호만 담는다 — 값은 담지 않는다. 그래서 저장해도
 * 원가가 새지 않는다.
 *
 * ## 총액 열이 없는 이유
 *
 * 실제 원가 파일에는 총액 칸(H열)이 있지만 **읽지 않는다.** 그건 그 파일을
 * 만들 때의 수량으로 계산된 값이다. 견적의 수량은 다르다. 매입단가만 읽고
 * **견적의 수량으로 다시 곱한다.**
 *
 * ## SKU 가 없을 수 있다
 *
 * 사용자의 원가 파일은 B열 품명, C열(머리글은 '규격'이지만 실제로는
 * 모델명, 예: `SRG-A40`), G열 매입단가 꼴이다. 내부 SKU 가 없다.
 * 그래서 `sku` 와 `model` 중 **하나만 있어도** 읽는다. 어느 견적 행에
 * 붙일지는 사람이 확인해 연결한다 — 여기서 추측하지 않는다.
 */
export interface ColumnMapping {
  /** 내부 SKU 열. 사용자 원가 파일에는 보통 없다. */
  sku?: ColumnRef;
  /** 모델명 열. 사용자 파일에서는 머리글이 '규격' 인 경우가 많다. */
  model?: ColumnRef;
  purchaseUnitPrice: ColumnRef;
  /** 통화 열. 파일에 이 열 자체가 없을 수 있다 — 그러면 `defaultCurrency`를 쓴다. */
  currency?: ColumnRef;
  /** 단위 열. 파일에 이 열 자체가 없을 수 있다 — 그러면 `defaultUnit`를 쓴다. */
  unit?: ColumnRef;
  /** 품명 열. 사람이 연결을 확인할 때 본다. */
  name?: ColumnRef;
  /** 선택 열 (설계서 §8.2). */
  brand?: ColumnRef;
  lengthM?: ColumnRef;
  effectiveDate?: ColumnRef;
  /**
   * 통화 열이 아예 없거나, 있어도 그 줄의 칸이 비었을 때만 채우는
   * **사용자 명시 확인값**이다. 자동으로 추측하지 않는다 — 화면에서
   * 사람이 "이 파일은 전부 KRW다"라고 확인한 값만 여기로 온다.
   *
   * 열에 **이미 있는 값은 덮지 않는다.** 그래서 통화가 섞인 파일에
   * 이 값을 줘도 `currency-mixed` 오류는 그대로 난다 — 확인값은
   * 누락만 채우지, 실제로 다른 값이 적힌 줄을 가리지 않는다.
   */
  defaultCurrency?: string;
  /** 단위 열의 같은 규칙 — `defaultCurrency` 설명을 그대로 따른다. */
  defaultUnit?: string;
}

export type PriceErrorCode =
  | 'column-missing'
  | 'key-column-missing'
  | 'sku-empty'
  | 'model-empty'
  | 'duplicate-model'
  | 'duplicate-sku'
  | 'price-empty'
  | 'price-formula'
  | 'price-not-numeric'
  | 'price-negative'
  | 'currency-empty'
  | 'currency-mixed'
  | 'unit-empty';

export interface PriceError {
  code: PriceErrorCode;
  /** 데이터 행 번호 (1부터). 머리글은 0. */
  row: number;
  /** 열 이름 또는 번호. 값은 담지 않는다. */
  column?: ColumnRef;
  message: string;
}

/** 0→A, 1→B, … 25→Z, 26→AA … — 번호로 가리킨 열을 오류 문구에 사람이 읽을 모양으로 보여줄 때 쓴다. */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function describeColumnRef(ref: ColumnRef): string {
  return typeof ref === 'number' ? `${columnLetter(ref)}열` : ref;
}

/**
 * 열 참조(이름 또는 번호)를 실제 열 번호로 바꾼다. 번호면 범위만
 * 확인하고 그대로 쓴다 — 이름으로 되돌리지 않는다(중복 머리글이어도
 * 고른 자리를 잃지 않는다). 이름이면 기존처럼 첫 일치를 찾는다(CSV
 * 간단 경로와 호환).
 */
export function resolveColumnRef(ref: ColumnRef, header: readonly string[]): number | undefined {
  if (typeof ref === 'number') {
    return ref >= 0 && ref < header.length ? ref : undefined;
  }
  const at = header.findIndex((h) => h === ref);
  return at === -1 ? undefined : at;
}

/** 원가 한 줄. **이 타입은 영속 객체에 들어가지 않는다** (설계서 §6.2). */
export interface PriceEntry {
  /**
   * 이 줄의 자리표. 원가 파일 안에서만 뜻이 있다 (`row-3` 꼴).
   *
   * 견적 행과 이어 주는 열쇠다. SKU 가 없는 파일도 있으므로 SKU 를
   * 열쇠로 쓸 수 없다.
   */
  entryId: string;
  /** 파일에 SKU 열이 없으면 없다. */
  sku?: string;
  /** 모델명. 사용자 파일의 '규격' 열이 여기로 온다. */
  model?: string;
  /** 품명. 사람이 연결을 확인할 때 본다. */
  name?: string;
  purchaseUnitPrice: string;
  currency: string;
  unit: string;
  brand?: string;
  lengthM?: string;
  effectiveDate?: string;
}

export interface ParseResult {
  entries: PriceEntry[];
  errors: PriceError[];
}

/** `"1,234,567"`, `"₩1,234"`, `"1 234"` → `"1234567"`. 숫자가 아니면 undefined. */
function normalizeNumber(raw: string): string | undefined {
  const cleaned = raw.replace(/[,\s₩$¥€]/g, '');
  if (cleaned === '') return undefined;
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return undefined;
  try {
    return dec(cleaned).toFixed();
  } catch {
    return undefined;
  }
}

export function parsePrivatePrices(table: Table, mapping: ColumnMapping): ParseResult {
  const errors: PriceError[] = [];

  // SKU 와 모델명 중 **하나는** 있어야 한다. 둘 다 없으면 어느 견적 행에
  // 붙일 건지 사람이 확인할 단서조차 없다.
  if (mapping.sku === undefined && mapping.model === undefined) {
    return {
      entries: [],
      errors: [
        {
          code: 'key-column-missing',
          row: 0,
          message: 'SKU 열과 모델명 열이 둘 다 없다. 하나는 지정해야 한다.',
        },
      ],
    };
  }

  const required: Array<[keyof ColumnMapping, ColumnRef]> = [
    ['purchaseUnitPrice', mapping.purchaseUnitPrice],
    ...(mapping.currency !== undefined
      ? ([['currency', mapping.currency]] as Array<[keyof ColumnMapping, ColumnRef]>)
      : []),
    ...(mapping.unit !== undefined
      ? ([['unit', mapping.unit]] as Array<[keyof ColumnMapping, ColumnRef]>)
      : []),
    ...(mapping.sku !== undefined
      ? ([['sku', mapping.sku]] as Array<[keyof ColumnMapping, ColumnRef]>)
      : []),
    ...(mapping.model !== undefined
      ? ([['model', mapping.model]] as Array<[keyof ColumnMapping, ColumnRef]>)
      : []),
  ];

  const columnIndex: Partial<Record<keyof ColumnMapping, number>> = {};
  for (const [key, ref] of required) {
    const at = resolveColumnRef(ref, table.header);
    if (at === undefined) {
      errors.push({
        code: 'column-missing',
        row: 0,
        column: ref,
        message: `필수 열 '${describeColumnRef(ref)}'을 찾을 수 없다. 열 매핑을 확인한다.`,
      });
    } else {
      columnIndex[key] = at;
    }
  }
  for (const key of ['brand', 'name', 'lengthM', 'effectiveDate'] as const) {
    const ref = mapping[key];
    if (ref === undefined) continue;
    const at = resolveColumnRef(ref, table.header);
    if (at !== undefined) columnIndex[key] = at;
  }

  if (errors.length > 0) return { entries: [], errors };

  const entries: PriceEntry[] = [];
  const seen = new Map<string, number>();
  let firstCurrency: string | undefined;

  table.rows.forEach((row, index) => {
    // 원본 시트 행 번호를 알면(XLSX 마법사가 시트/머리글/데이터 시작·
    // 끝을 명시 선택한 경로) 그 실제 주소를 쓴다 — 모르면(CSV 간단
    // 경로) 선택 범위 안에서 몇 번째 데이터 행인지로 돌아간다. 둘 다
    // "PriceError.row"로 그대로 나간다 — 거짓 주소를 주장하지 않는다
    // (독립 검토 지적 2026-10-05).
    const rowNumber = table.sourceRowNumbers?.[index] ?? index + 1;
    const cell = (key: keyof ColumnMapping): string => {
      const at = columnIndex[key];
      return at === undefined ? '' : (row[at] ?? '').trim();
    };

    const sku = mapping.sku === undefined ? '' : cell('sku');
    const model = mapping.model === undefined ? '' : cell('model');

    if (mapping.sku !== undefined && sku === '') {
      errors.push({
        code: 'sku-empty',
        row: rowNumber,
        column: mapping.sku,
        message: `${rowNumber}행: SKU가 비어 있다.`,
      });
      return;
    }
    if (mapping.sku === undefined && model === '') {
      errors.push({
        code: 'model-empty',
        row: rowNumber,
        ...(mapping.model !== undefined ? { column: mapping.model } : {}),
        message: `${rowNumber}행: 모델명이 비어 있다.`,
      });
      return;
    }

    // 중복은 **버리지 않고 알린다.** 같은 모델이 두 줄이면 어느 쪽 원가인지
    // 사람이 정해야 한다. 여기서 먼저 온 쪽을 고르면 조용히 틀린다.
    const key = sku !== '' ? `sku:${sku}` : `model:${model}`;
    const previous = seen.get(key);
    if (previous !== undefined) {
      errors.push({
        code: sku !== '' ? 'duplicate-sku' : 'duplicate-model',
        row: rowNumber,
        ...((sku !== '' ? mapping.sku : mapping.model) !== undefined
          ? { column: (sku !== '' ? mapping.sku : mapping.model)! }
          : {}),
        message:
          `${rowNumber}행: ${sku !== '' ? `SKU '${sku}'` : `모델명 '${model}'`}가 ` +
          `${previous}행과 중복이다. 어느 쪽 원가인지 사람이 정해야 한다.`,
      });
      return;
    }

    // 설계서 §8.3: 수식이 만든 가격을 그대로 믿지 않는다.
    // 검사는 **이 열에만** 건다 — 품셈 파일의 다른 수식은 원가와 무관하다.
    const priceColumn = columnIndex['purchaseUnitPrice'];
    if (
      priceColumn !== undefined &&
      table.formulaColumns[index]?.has(priceColumn) === true
    ) {
      errors.push({
        code: 'price-formula',
        row: rowNumber,
        column: mapping.purchaseUnitPrice,
        message:
          `${rowNumber}행: 매입단가가 수식 결과다. ` +
          '값으로 붙여넣어야 원가로 읽는다.',
      });
      return;
    }

    const rawPrice = cell('purchaseUnitPrice');
    if (rawPrice === '') {
      // 설계서 §8.3: 빈 가격은 오류다. 미등록은 0이 아니다.
      errors.push({
        code: 'price-empty',
        row: rowNumber,
        column: mapping.purchaseUnitPrice,
        message: `${rowNumber}행: 매입단가가 비어 있다.`,
      });
      return;
    }
    const price = normalizeNumber(rawPrice);
    if (price === undefined) {
      // 값 자체는 메시지에 넣지 않는다 (설계서 §8.4).
      errors.push({
        code: 'price-not-numeric',
        row: rowNumber,
        column: mapping.purchaseUnitPrice,
        message: `${rowNumber}행: 매입단가를 숫자로 읽을 수 없다.`,
      });
      return;
    }
    if (price.startsWith('-')) {
      errors.push({
        code: 'price-negative',
        row: rowNumber,
        column: mapping.purchaseUnitPrice,
        message: `${rowNumber}행: 매입단가가 음수다.`,
      });
      return;
    }

    // 열에 실제로 적힌 값이 있으면 그 값을 쓴다 — 확인값은 **비었을
    // 때만** 채운다. 그래서 통화가 섞인 파일에 확인값을 줘도 실제로
    // 적힌 다른 값을 가리지 않는다(currency-mixed는 그대로 난다).
    const currencyRaw = cell('currency');
    const currency = currencyRaw !== '' ? currencyRaw : mapping.defaultCurrency;
    if (currency === undefined || currency === '') {
      errors.push({
        code: 'currency-empty',
        row: rowNumber,
        ...(mapping.currency !== undefined ? { column: mapping.currency } : {}),
        message: `${rowNumber}행: 통화가 비어 있다.`,
      });
      return;
    }
    if (firstCurrency === undefined) {
      firstCurrency = currency;
    } else if (currency !== firstCurrency) {
      errors.push({
        code: 'currency-mixed',
        row: rowNumber,
        ...(mapping.currency !== undefined ? { column: mapping.currency } : {}),
        message: `${rowNumber}행: 통화 '${currency}'가 앞의 '${firstCurrency}'와 다르다. 한 파일에 한 통화만 받는다.`,
      });
      return;
    }

    const unitRaw = cell('unit');
    const unit = unitRaw !== '' ? unitRaw : mapping.defaultUnit;
    if (unit === undefined || unit === '') {
      errors.push({
        code: 'unit-empty',
        row: rowNumber,
        ...(mapping.unit !== undefined ? { column: mapping.unit } : {}),
        message: `${rowNumber}행: 단위가 비어 있다. 단위가 다르면 수량과 맞지 않는다.`,
      });
      return;
    }

    const brand = cell('brand');
    const name = cell('name');
    const lengthM = cell('lengthM');
    const effectiveDate = cell('effectiveDate');

    seen.set(key, rowNumber);
    entries.push({
      entryId: `row-${rowNumber}`,
      ...(sku !== '' ? { sku } : {}),
      ...(model !== '' ? { model } : {}),
      ...(name !== '' ? { name } : {}),
      purchaseUnitPrice: price,
      currency,
      unit,
      ...(brand !== '' ? { brand } : {}),
      ...(lengthM !== '' ? { lengthM } : {}),
      ...(effectiveDate !== '' ? { effectiveDate } : {}),
    });
  });

  return { entries, errors };
}
