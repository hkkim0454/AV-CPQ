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
  /**
   * 사람이 확인해 연결한 원가 줄의 자리표.
   *
   * 사용자의 원가 파일에는 내부 SKU 가 없다. 품명과 모델명을 보고 **사람이**
   * 어느 견적 행에 붙일지 정한 결과가 여기로 온다. 있으면 SKU 조회보다
   * 우선한다 — 사람이 정한 것을 코드가 뒤집지 않는다.
   *
   * 비슷한 모델명으로 자동 연결하지 않는다. 그건 조용히 틀린 원가를 붙인다.
   */
  costEntryId?: string;
  /** 견적서 B열. 내부용 표에 그대로 싣는다. */
  name?: string;
  /** 견적서 C열. */
  specification?: string;
  unit?: string;
  quantity: DecimalText;
  sellingUnitPrice?: DecimalText;
}

export interface InternalLine {
  rowId: string;
  sku?: string;
  name: string;
  specification: string;
  unit: string;
  quantity: Decimal;
  /** 원가표에 이 SKU가 있었는지. `false`면 화면에 `미등록`으로 표시한다. */
  costRegistered: boolean;
  /**
   * 연결은 있는데 **이 원가 파일의 것이 아니다.**
   *
   * 원가 파일을 바꾸면 옛 연결이 전부 여기로 떨어진다. 화면은
   * "미등록"이 아니라 "다시 연결하세요"를 띄워야 한다.
   */
  costLinkStale?: boolean;
  /**
   * 원가 단위·통화가 견적과 달라 계산을 막았다(독립 검토 지적
   * 2026-10-05) — 임의로 비교·변환하지 않는다. 이 값이 있으면
   * 아래 금액·요율 필드는 전부 비어 있다. 화면뿐 아니라 이 결과를
   * 그대로 읽는 소비자(Task6 등)도 숫자 대신 이 표식으로 "계산되지
   * 않았다"를 알 수 있다 — 화면이 숫자를 숨기는 것만으로는 다른
   * 소비자가 잘못된 단가를 실수로 쓰는 것을 막지 못한다.
   */
  costMismatch?: { costUnit: string; costCurrency: string };
  /** 견적의 판매 단가. 미등록이면 없다. */
  sellingUnitPrice?: Decimal;
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
    // 사람이 확인한 연결이 있으면 그것을 쓴다. 없으면 SKU 정확 일치.
    const stale =
      row.costEntryId !== undefined && !session.ownsEntryId(row.costEntryId);
    const entry =
      row.costEntryId !== undefined
        ? session.byEntryId(row.costEntryId)
        : row.sku === undefined
          ? undefined
          : session.lookup(row.sku);
    const selling = decOrUndefined(row.sellingUnitPrice);

    const line: InternalLine = {
      rowId: row.rowId,
      ...(row.sku !== undefined ? { sku: row.sku } : {}),
      name: row.name ?? '',
      specification: row.specification ?? '',
      unit: row.unit ?? '',
      quantity,
      costRegistered: entry !== undefined,
      ...(stale ? { costLinkStale: true } : {}),
    };

    if (selling !== undefined) {
      line.sellingUnitPrice = selling;
      line.sellingAmount = quantity.times(selling);
    }

    if (entry === undefined) return line;

    // 단위·통화가 견적과 다르면 임의로 비교·변환해 계산하지 않는다 —
    // 자동 SKU 연결·수동 모델 연결 모두 같은 규칙이다. 견적 쪽 통화는
    // 시스템 전체가 KRW 고정이다(domain/quote/types.ts의
    // `ProductVariant.currency: 'KRW'`). 행에 단위를 아예 안 줬으면
    // (호출부가 생략) 비교할 수 없으니 막지 않는다.
    const unitMismatch = line.unit !== '' && entry.unit !== line.unit;
    const currencyMismatch = entry.currency !== 'KRW';
    if (unitMismatch || currencyMismatch) {
      line.costUnit = entry.unit;
      line.costMismatch = { costUnit: entry.unit, costCurrency: entry.currency };
      return line;
    }

    const cost = dec(entry.purchaseUnitPrice);
    line.purchaseUnitPrice = cost;
    // **원가 파일의 총액 칸을 읽지 않는다.** 그건 그 파일을 만들 때의 수량으로
    // 계산된 값이다. 견적의 수량으로 다시 곱한다.
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
