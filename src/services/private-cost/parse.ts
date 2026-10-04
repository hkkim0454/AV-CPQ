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
 * 열 이름 매핑. 값이 아니라 **이름**만 담는다 — 저장해도 원가가 새지 않는다.
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
  sku?: string;
  /** 모델명 열. 사용자 파일에서는 머리글이 '규격' 인 경우가 많다. */
  model?: string;
  purchaseUnitPrice: string;
  currency: string;
  unit: string;
  /** 품명 열. 사람이 연결을 확인할 때 본다. */
  name?: string;
  /** 선택 열 (설계서 §8.2). */
  brand?: string;
  lengthM?: string;
  effectiveDate?: string;
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
  /** 열 이름. 값은 담지 않는다. */
  column?: string;
  message: string;
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

  const indexOf = (name: string): number =>
    table.header.findIndex((h) => h === name);

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

  const required: Array<[keyof ColumnMapping, string]> = [
    ['purchaseUnitPrice', mapping.purchaseUnitPrice],
    ['currency', mapping.currency],
    ['unit', mapping.unit],
    ...(mapping.sku !== undefined
      ? ([['sku', mapping.sku]] as Array<[keyof ColumnMapping, string]>)
      : []),
    ...(mapping.model !== undefined
      ? ([['model', mapping.model]] as Array<[keyof ColumnMapping, string]>)
      : []),
  ];

  const columnIndex: Partial<Record<keyof ColumnMapping, number>> = {};
  for (const [key, name] of required) {
    const at = indexOf(name);
    if (at === -1) {
      errors.push({
        code: 'column-missing',
        row: 0,
        column: name,
        message: `필수 열 '${name}'을 찾을 수 없다. 열 매핑을 확인한다.`,
      });
    } else {
      columnIndex[key] = at;
    }
  }
  for (const key of ['brand', 'name', 'lengthM', 'effectiveDate'] as const) {
    const name = mapping[key];
    if (name === undefined) continue;
    const at = indexOf(name);
    if (at !== -1) columnIndex[key] = at;
  }

  if (errors.length > 0) return { entries: [], errors };

  const entries: PriceEntry[] = [];
  const seen = new Map<string, number>();
  let firstCurrency: string | undefined;

  table.rows.forEach((row, index) => {
    const rowNumber = index + 1;
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

    const currency = cell('currency');
    if (currency === '') {
      errors.push({
        code: 'currency-empty',
        row: rowNumber,
        column: mapping.currency,
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
        column: mapping.currency,
        message: `${rowNumber}행: 통화 '${currency}'가 앞의 '${firstCurrency}'와 다르다. 한 파일에 한 통화만 받는다.`,
      });
      return;
    }

    const unit = cell('unit');
    if (unit === '') {
      errors.push({
        code: 'unit-empty',
        row: rowNumber,
        column: mapping.unit,
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
