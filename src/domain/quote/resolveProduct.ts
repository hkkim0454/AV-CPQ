/**
 * 미해결 모델/옵션을 실제 카탈로그 제품으로 치환한다 (계획
 * 2026-10-04-quote-workspace-ui Task 2 독립 검토 지적).
 *
 * **제품에 종속된 칸을 먼저 전부 떼어낸 뒤** 고른 제품의 값만 다시
 * 채운다. 그냥 `{...row, ...새값}`으로 덮으면, 새 제품에 없는 칸은
 * **이전 제품의 값이 그대로 남는다** — 실제로 찾은 결함: 가격 없는
 * 제품으로 재연결해도 옛 가격이 남고, 품셈 연결 없는 제품으로
 * 재연결해도 옛 `laborMappingId`가 남았다.
 *
 * `productId`는 `sku`와 같다고 가정하지 않는다 — 카탈로그 스키마가
 * 둘을 별개 필드로 둔다(`CatalogProduct.productId`/`sku`).
 *
 * 수량·비고·rowId·sourceNodeIds·optionId는 그대로 둔다 — 카탈로그에서
 * 끌어오는 칸만 바꾼다. 설명(`internalDescription`)은 사람이 이미
 * 뭔가 적어 뒀으면 보존하고, 비어 있을 때만 새 제품의 카탈로그 설명을
 * 채운다.
 */
import type { CatalogProduct } from '../../data/catalog/load';
import type { DecimalText, SheetRow } from './types';

export type ItemRow = Extract<SheetRow, { type: 'item' }>;

/**
 * `price`가 `undefined`면 "미등록"이고, `'0'`이면 **명시적 0원**이다 —
 * 둘을 섞지 않는다(설계서 §5.6). 호출부가 `catalog.prices.get(sku)`를
 * 그대로 넘기면 이 구분이 자동으로 지켜진다.
 */
export function withResolvedProduct(row: ItemRow, product: CatalogProduct, price: DecimalText | undefined): ItemRow {
  const hadManualDescription = row.internalDescription !== undefined;
  const catalogDescription = product.options['description'];
  // "같은 제품을 다시 조회"(재계산 새로고침)인지, 실제로 **다른** 제품
  //으로 재연결하는 것인지는 sku만으로 가르지 않는다 — sku는 같은데
  // productId나 unit이 다르면 그것도 identity 변경이다(독립 검토
  // 지적: sku만 보면, 재조회인데도 laborMode가 mapped/unresolved로
  // 강제되면서 수동 단가·사유만 orphan으로 남는 중간 상태가 생겼다).
  // 재조회면 laborMode(사람이 고른 mapped/manual/not-applicable)와
  // 수동 단가·사유·확인을 전부 그대로 둔다. identity가 바뀌면 전부
  // 새로 정한다 — 중간 상태를 만들지 않는다.
  const identityUnchanged =
    row.sku !== undefined &&
    row.sku === product.sku &&
    row.productId === product.productId &&
    row.unit === product.unit;

  const {
    sku: _sku,
    productId: _productId,
    sellingUnitPrice: _price,
    internalDescription: _description,
    laborMode: _laborMode,
    laborMappingId: _laborMappingId,
    manualLaborUnitPrice: _manualLaborUnitPrice,
    overrideReason: _overrideReason,
    laborConfirmation: _laborConfirmation,
    ...rest
  } = row;

  return {
    ...rest,
    sku: product.sku,
    productId: product.productId,
    name: product.quoteName,
    specification: product.quoteSpec,
    unit: product.unit,
    ...(price !== undefined ? { sellingUnitPrice: price } : {}),
    ...(hadManualDescription
      ? { internalDescription: row.internalDescription }
      : catalogDescription !== undefined && catalogDescription !== ''
        ? { internalDescription: catalogDescription }
        : {}),
    ...(identityUnchanged
      ? {
          laborMode: row.laborMode,
          ...(product.laborMappingId !== undefined ? { laborMappingId: product.laborMappingId } : {}),
          ...(row.manualLaborUnitPrice !== undefined ? { manualLaborUnitPrice: row.manualLaborUnitPrice } : {}),
          ...(row.overrideReason !== undefined ? { overrideReason: row.overrideReason } : {}),
          ...(row.laborConfirmation !== undefined ? { laborConfirmation: row.laborConfirmation } : {}),
        }
      : product.laborMappingId !== undefined
        ? { laborMode: 'mapped' as const, laborMappingId: product.laborMappingId }
        : { laborMode: 'unresolved' as const }),
  };
}
