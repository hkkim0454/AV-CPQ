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
  // 같은 SKU로 "다시 연결"하는 것은 재조회·새로고침이지 재연결이 아니다 —
  // 사람이 수동으로 입력한 단가·사유·노무 확인은 그대로 둔다. SKU가
  // 바뀌면 그 값들은 더 이상 이 제품을 근거로 하지 않으므로 명시로
  // 지운다(독립 검토 지적 — `...rest` 스프레드가 이 칸들을 가리지 않아
  // 재연결 후에도 살아남았다).
  const isSameSku = row.sku !== undefined && row.sku === product.sku;
  const {
    sku: _sku,
    productId: _productId,
    sellingUnitPrice: _price,
    laborMappingId: _laborMappingId,
    internalDescription: _description,
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
    ...(product.laborMappingId !== undefined
      ? { laborMode: 'mapped' as const, laborMappingId: product.laborMappingId }
      : { laborMode: 'unresolved' as const }),
    ...(isSameSku && row.manualLaborUnitPrice !== undefined ? { manualLaborUnitPrice: row.manualLaborUnitPrice } : {}),
    ...(isSameSku && row.overrideReason !== undefined ? { overrideReason: row.overrideReason } : {}),
    ...(isSameSku && row.laborConfirmation !== undefined ? { laborConfirmation: row.laborConfirmation } : {}),
  };
}
