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

/** 열 이름 매핑. 값이 아니라 **이름**만 담는다 — 저장해도 원가가 새지 않는다. */
export interface ColumnMapping {
  sku: string;
  purchaseUnitPrice: string;
  currency: string;
  unit: string;
  /** 선택 열 (설계서 §8.2). */
  brand?: string;
  model?: string;
  lengthM?: string;
  effectiveDate?: string;
}

export type PriceErrorCode =
  | 'column-missing'
  | 'sku-empty'
  | 'duplicate-sku'
  | 'price-empty'
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
  sku: string;
  purchaseUnitPrice: string;
  currency: string;
  unit: string;
  brand?: string;
  model?: string;
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

  const required: Array<[keyof ColumnMapping, string]> = [
    ['sku', mapping.sku],
    ['purchaseUnitPrice', mapping.purchaseUnitPrice],
    ['currency', mapping.currency],
    ['unit', mapping.unit],
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
  for (const key of ['brand', 'model', 'lengthM', 'effectiveDate'] as const) {
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

    const sku = cell('sku');
    if (sku === '') {
      errors.push({
        code: 'sku-empty',
        row: rowNumber,
        column: mapping.sku,
        message: `${rowNumber}행: SKU가 비어 있다.`,
      });
      return;
    }
    const previous = seen.get(sku);
    if (previous !== undefined) {
      errors.push({
        code: 'duplicate-sku',
        row: rowNumber,
        column: mapping.sku,
        message: `${rowNumber}행: SKU '${sku}'가 ${previous}행과 중복이다.`,
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
    const model = cell('model');
    const lengthM = cell('lengthM');
    const effectiveDate = cell('effectiveDate');

    seen.set(sku, rowNumber);
    entries.push({
      sku,
      purchaseUnitPrice: price,
      currency,
      unit,
      ...(brand !== '' ? { brand } : {}),
      ...(model !== '' ? { model } : {}),
      ...(lengthM !== '' ? { lengthM } : {}),
      ...(effectiveDate !== '' ? { effectiveDate } : {}),
    });
  });

  return { entries, errors };
}
