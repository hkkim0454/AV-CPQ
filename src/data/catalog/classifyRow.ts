/**
 * 원본 행 분류 (계획 Task 2).
 *
 * 품셈 파일 B열에는 세 가지가 섞여 있다.
 *   `[ CCTV ]`        분류 머리글
 *   `한화테크윈_CCTV`   품목 그룹 머리글
 *   `IP카메라`         제품
 *
 * **판별 기준은 단위(E열)다.** 단가가 아니다 — 단가 없이 품셈만 있는 제품이 실제로 있고
 * (`광 케이블 시험/측정`), 단가가 있는데 단위가 없는 머리글도 있다.
 * 단위를 기준으로 하면 원본 1,468행이 정확히 제품으로 나온다 (2026-10-03 실측).
 *
 * 설계서 §5.6: 단가 미등록을 0원으로 처리하지 않는다. 여기서도 같다 —
 * 단가가 없으면 필드를 **비운다**. `0`을 넣지 않는다.
 */
import type { DecimalText } from '../../domain/quote/types';
import type { RawRow } from './rawTypes';

export type RowKind =
  /** `[ … ]` 분류 머리글. */
  | 'category'
  /**
   * 단위가 없는 이름 행 — **품목 그룹 머리글**.
   *
   * 브랜드가 아니다. 실제 값은 `DP to HDMI 케이블&젠더`, `Jumper Cord`, `후렉시블`,
   * `비디오 스위처` 같은 품목 묶음 이름이다 (289종 실측). 일부에 제조사 이름이
   * 섞여 있지만(`야마하_Digital Mixer`) 규칙이 없어서 브랜드로 해석하지 않는다.
   * 설계서 §7.5와 같은 원칙 — 추측하지 않는다.
   */
  | 'group'
  /** 단위가 없는데 품셈만 있는 행. 견적에 넣을 수 없다. */
  | 'labor-reference'
  /** 단위가 있는 행 = 제품. */
  | 'product'
  /** 이름이 없는 행. */
  | 'ignore';

export interface ClassifiedRow {
  kind: RowKind;
  row: number;
  /** 정리된 표시 이름. 분류 머리글은 대괄호를 벗긴다. */
  label?: string;
  unit?: string;
  spec?: string;
  description?: string;
  remark?: string;
  /** 고정 판매단가. 미등록이면 **없다**. 0을 넣지 않는다. */
  sellingUnitPrice?: DecimalText;
  /**
   * 단가가 다른 행에서 계산되는 행 (`배관 기타자재` = `INT(직전 재료비×20%)`).
   * 고정 단가를 붙이지 않고 견적 시점에 계산한다.
   */
  derivedPricing?: boolean;
  laborCode?: string;
  itemRate?: DecimalText;
  surcharge?: DecimalText;
  /** 원본 노무비 수식에 박혀 있던 배율. `INT` 다음에 곱한다(품셈 교체 Task 2 보강). */
  laborMultiplier?: DecimalText;
  /** 직종 금액 칸의 수식 모양. `'int'` 면 그 행만 직종별로 INT 한다. */
  tradeAmountShape?: 'int' | 'constant' | 'mixed';
  trades?: Array<{ trade: string; quantity: DecimalText }>;
}

const CATEGORY_PATTERN = /^\[\s*(.*?)\s*\]$/;

export function classifyRow(raw: RawRow): ClassifiedRow {
  const name = raw.name?.trim();
  if (name === undefined || name === '') {
    return { kind: 'ignore', row: raw.row };
  }

  const categoryMatch = CATEGORY_PATTERN.exec(name);
  if (categoryMatch !== null) {
    // 캡처 그룹은 `.*?`라 항상 잡히지만, `[ ]`처럼 비면 시트 이름을 쓰도록 둔다.
    return { kind: 'category', row: raw.row, label: categoryMatch[1] ?? '' };
  }

  const unit = raw.unit?.trim();
  if (unit === undefined || unit === '') {
    // 단위가 없으면 견적 행으로 쓸 수 없다. 품셈만 있으면 참고 항목으로 구분한다.
    const hasLabor = raw.laborCode !== undefined || (raw.trades?.length ?? 0) > 0;
    return { kind: hasLabor ? 'labor-reference' : 'group', row: raw.row, label: name };
  }

  const derivedPricing = raw.materialUnitPriceFormula !== undefined;

  return {
    kind: 'product',
    row: raw.row,
    label: name,
    unit,
    ...(raw.spec !== undefined ? { spec: raw.spec } : {}),
    ...(raw.description !== undefined ? { description: raw.description } : {}),
    ...(raw.remark !== undefined ? { remark: raw.remark } : {}),
    // 파생 단가 행에는 고정 단가를 붙이지 않는다.
    ...(!derivedPricing && raw.materialUnitPrice !== undefined
      ? { sellingUnitPrice: raw.materialUnitPrice }
      : {}),
    ...(derivedPricing ? { derivedPricing: true } : {}),
    ...(raw.laborCode !== undefined ? { laborCode: raw.laborCode } : {}),
    ...(raw.itemRate !== undefined ? { itemRate: raw.itemRate } : {}),
    ...(raw.surcharge !== undefined ? { surcharge: raw.surcharge } : {}),
    ...(raw.laborMultiplier !== undefined ? { laborMultiplier: raw.laborMultiplier } : {}),
    ...(raw.tradeAmountShape !== undefined ? { tradeAmountShape: raw.tradeAmountShape } : {}),
    ...(raw.trades !== undefined ? { trades: raw.trades } : {}),
  };
}

export interface ClassifiedProduct extends ClassifiedRow {
  kind: 'product';
  /** 직전 `[ … ]` 머리글. 없으면 시트 이름이 분류다. */
  category: string;
  /** 직전 품목 그룹 머리글. 분류 머리글이 나오면 지워진다. */
  group?: string;
}

export interface ClassifiedSheet {
  sheetCategory: string;
  products: ClassifiedProduct[];
  counts: Record<RowKind, number>;
}

/**
 * 시트 하나를 훑으며 분류·그룹 맥락을 제품에 붙인다.
 *
 * 분류 머리글이 나오면 그룹 맥락을 **지운다** — 새 분류의 첫 제품이 앞 분류의
 * 그룹을 물려받으면 안 된다.
 */
export function classifySheet(sheetName: string, rows: readonly RawRow[]): ClassifiedSheet {
  const products: ClassifiedProduct[] = [];
  const counts: Record<RowKind, number> = {
    category: 0,
    group: 0,
    'labor-reference': 0,
    product: 0,
    ignore: 0,
  };

  let category = sheetName;
  let group: string | undefined;

  for (const raw of rows) {
    const classified = classifyRow(raw);
    counts[classified.kind] += 1;

    switch (classified.kind) {
      case 'category':
        category = classified.label ?? sheetName;
        group = undefined;
        break;
      case 'group':
        group = classified.label;
        break;
      case 'product':
        products.push({
          ...classified,
          kind: 'product',
          category,
          ...(group !== undefined ? { group } : {}),
        });
        break;
      case 'labor-reference':
      case 'ignore':
        break;
    }
  }

  return { sheetCategory: sheetName, products, counts };
}
