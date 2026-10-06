/**
 * 명시적 재계산에서 **이미 품목을 고른 행**을 지금 카탈로그 값으로 다시 찾는다.
 *
 * `workspace.ts` 안에 있던 함수를 꺼내 왔다 — React 훅 안에 있으면 jsdom 없이
 * 단위 시험을 할 수 없는데, 여기서 내리는 판단(어떤 행을 치환하고 어떤 행을
 * 막을지)은 **견적서의 제품이 조용히 바뀌는지**를 가르는 자리라 시험이 꼭
 * 필요하다(품셈 교체 계획 Task 4).
 *
 * ## SKU 만으로 치환하지 않는다
 *
 * SKU 는 `시트코드-원본행번호`다. 품셈 파일을 새 판으로 바꾸면 행이 밀려
 * **같은 번호가 다른 제품**을 가리킨다(실측 84%). 그래서 치환 전에
 * `resolveSku` 로 기준을 확인한다.
 *
 * ```
 * 저장 지문 == 지금 지문      →  SKU 로 찾는다
 * 지문이 다르고 대응표 있음    →  대응표를 통과한 것만 치환한다
 * 지문이 다르고 대응표 없음    →  그 번호의 제품이 이 행과 **같은 제품임이
 *                              증명될 때만** 치환한다(품명·규격·단위 일치)
 * 그 밖                     →  치환하지 않고 미해결로 되돌린다
 * ```
 *
 * 셋째 갈래가 있는 이유: 지문은 **일상적인 갱신**(단가 수정·제품 추가)에도
 * 바뀐다. 그때까지 전부 막으면 멀쩡한 견적서가 통째로 미해결이 된다.
 * 실측상 이 판정이 위험한 경우의 98.7%(1,029건 중 1,016건)를 잡고,
 * 못 잡는 13건은 전부 같은 제품이었다(묶음 오타 수정·설명 보강).
 *
 * ⛔ **옛 SKU 로 되돌아가는 fallback 이 없다.** 치환하지 못한 행은 품목·단가·
 * 품셈 연결을 지우고 `laborMode: 'unresolved'` 로 되돌려 **출력을 막는다.**
 * 옛 단가를 지금 기준인 것처럼 쓰지 않는다.
 */
import type { Catalog, CatalogProduct } from '../../data/catalog/load';
import { resolveSku, type SkuMigrationTable } from '../../data/catalog/skuMigration';
import type { ImportWarning } from '../../import/diagram/devices';
import type { QuoteDocument } from './types';
import { withResolvedProduct } from './resolveProduct';

export interface RefreshContext {
  /** 저장 당시 카탈로그 지문(`document.versions.catalog`). */
  savedFingerprint: string;
  /** 지금 카탈로그 지문. */
  currentFingerprint: string;
  table?: SkuMigrationTable;
  /** 배관 행인지 가려내고, 그 시스템의 지금 배관 묶음과 맞는지 확인한다. */
  conduitGroupOf(row: { sourceNodeIds?: readonly string[] }): string | undefined;
}

export interface RefreshResult {
  document: QuoteDocument;
  removedWarnings: readonly ImportWarning[];
}

export function refreshResolvedRows(
  document: QuoteDocument,
  catalog: Catalog,
  context: RefreshContext,
): RefreshResult {
  const productBySku = (sku: string): CatalogProduct | undefined =>
    catalog.products.find((p) => p.sku === sku);

  const removedWarnings: ImportWarning[] = [];

  const rows = document.rows.map((r) => {
    if (r.type !== 'item' || r.sku === undefined) return r;

    const resolution = resolveSku(r.sku, {
      savedFingerprint: context.savedFingerprint,
      currentFingerprint: context.currentFingerprint,
      ...(context.table === undefined ? {} : { table: context.table }),
      // 이 행이 기억하는 제품 모습 — 대응표가 없을 때 "같은 제품인가"를
      // 증명하는 유일한 근거다.
      rowIdentity: { name: r.name, specification: r.specification, unit: r.unit },
      productBySku,
    });

    // 치환해도 되는 경우에만 쓸 번호. `blocked` 면 아예 쓰지 않는다.
    const effectiveSku =
      resolution.kind === 'same-basis'
        ? r.sku
        : resolution.kind === 'substitute'
          ? resolution.targetSku
          : undefined;

    const conduitGroup = context.conduitGroupOf(r);
    if (conduitGroup !== undefined) {
      // 배관 행은 **그 시스템의 지금 배관 묶음과 맞을 때만** 갱신한다.
      // 맞지 않으면 건드리지 않고 그대로 둔다 — 뒤이어 도는
      // `applyInstallationPatch`/`computeInstallationWarnings` 가 스스로 다시
      // 검증해 미해결·차단으로 되돌린다(배관에는 이미 그 장치가 있다).
      if (effectiveSku === undefined) return r;
      const product = productBySku(effectiveSku);
      if (product !== undefined && product.options['group'] === conduitGroup) {
        return withResolvedProduct(r, product, catalog.prices.get(effectiveSku));
      }
      return r;
    }

    if (effectiveSku !== undefined) {
      const product = productBySku(effectiveSku);
      if (product !== undefined) {
        return withResolvedProduct(r, product, catalog.prices.get(effectiveSku));
      }
    }

    // 여기부터는 **치환하지 않는다.** 품목이 사라졌거나(기준이 같은데 번호가
    // 없다), 기준이 달라 대응표를 통과하지 못했다. 둘 다 사람이 다시 골라야
    // 한다 — 사유만 다르다.
    const removedSku = r.sku;
    const {
      sku: _sku,
      productId: _productId,
      sellingUnitPrice: _price,
      laborMappingId: _laborMappingId,
      ...rest
    } = r;
    removedWarnings.push({
      code: 'catalog-item-removed',
      blocking: true,
      message:
        resolution.kind === 'blocked'
          ? `행 '${r.name}'(${removedSku})을 지금 카탈로그로 옮길 수 없다 — ${resolution.reason}. 다시 골라야 한다.`
          : `행 '${r.name}'(${removedSku})이 지금 카탈로그에 없다 — 다시 골라야 한다.`,
      rowId: r.rowId,
    });
    return { ...rest, laborMode: 'unresolved' as const };
  });

  return { document: { ...document, rows }, removedWarnings };
}
