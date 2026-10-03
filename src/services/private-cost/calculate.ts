/**
 * 내부용 원가 계산 (설계서 §8.7).
 *
 *   매입 원가 대비 가산율 = (판매가 - 원가) / 원가
 *   매출 기준 이익률     = (판매가 - 원가) / 판매가
 *
 * "두 값을 명확히 구분한다. 분모 0은 계산 불가로 표시한다."
 * 같은 숫자 쌍에서 두 값이 다르게 나오므로, 섞어 쓰면 마진을 잘못 읽는다.
 *
 * 이 모듈의 결과는 **내부용 출력에만** 쓴다. 고객용 projection은 이 타입을 모른다.
 */
import { Decimal, dec, decOrUndefined } from '../../domain/calculation/rounding';
import type { DecimalText } from '../../domain/quote/types';
import type { PrivateCostSession } from './session';

/** 가산율. 원가가 0이면 계산 불가(undefined). */
export function markupRate(
  sellingUnitPrice: DecimalText,
  purchaseUnitPrice: DecimalText,
): Decimal | undefined {
  const cost = dec(purchaseUnitPrice);
  if (cost.isZero()) return undefined;
  return dec(sellingUnitPrice).minus(cost).dividedBy(cost);
}

/** 이익률. 판매가가 0이면 계산 불가(undefined). */
export function marginRate(
  sellingUnitPrice: DecimalText,
  purchaseUnitPrice: DecimalText,
): Decimal | undefined {
  const selling = dec(sellingUnitPrice);
  if (selling.isZero()) return undefined;
  return selling.minus(dec(purchaseUnitPrice)).dividedBy(selling);
}

export interface InternalLineInput {
  rowId: string;
  sku?: string;
  quantity: DecimalText;
  sellingUnitPrice?: DecimalText;
}

export interface InternalLine {
  rowId: string;
  sku?: string;
  quantity: Decimal;
  /** 원가표에 이 SKU가 있었는지. `false`면 화면에 `미등록`으로 표시한다. */
  costRegistered: boolean;
  purchaseUnitPrice?: Decimal;
  purchaseAmount?: Decimal;
  sellingAmount?: Decimal;
  profitAmount?: Decimal;
  markupRate?: Decimal;
  marginRate?: Decimal;
  /** 원가표 단위와 견적 단위가 다를 수 있다 — 사람이 확인해야 한다. */
  costUnit?: string;
}

/**
 * 내부용 원가 대비 분석.
 *
 * 설계서 §5.6 / §8.3: 미등록 원가를 0으로 처리하지 않는다.
 * `costRegistered: false`로 구분해서 돌려주고, 금액 필드는 비운다.
 */
export function internalLines(
  rows: readonly InternalLineInput[],
  session: PrivateCostSession,
): InternalLine[] {
  return rows.map((row) => {
    const quantity = dec(row.quantity);
    const entry = row.sku === undefined ? undefined : session.lookup(row.sku);
    const selling = decOrUndefined(row.sellingUnitPrice);

    const line: InternalLine = {
      rowId: row.rowId,
      ...(row.sku !== undefined ? { sku: row.sku } : {}),
      quantity,
      costRegistered: entry !== undefined,
    };

    if (selling !== undefined) {
      line.sellingAmount = quantity.times(selling);
    }

    if (entry === undefined) return line;

    const cost = dec(entry.purchaseUnitPrice);
    line.purchaseUnitPrice = cost;
    line.purchaseAmount = quantity.times(cost);
    line.costUnit = entry.unit;

    if (selling !== undefined) {
      line.profitAmount = quantity.times(selling.minus(cost));
      const markup = markupRate(selling.toFixed(), cost.toFixed());
      if (markup !== undefined) line.markupRate = markup;
      const margin = marginRate(selling.toFixed(), cost.toFixed());
      if (margin !== undefined) line.marginRate = margin;
    }

    return line;
  });
}
