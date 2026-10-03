/**
 * 구성도 장비 → 카탈로그 조회 (계획 2026-10-04 Task 2).
 *
 * 구성도는 `model`을 들고 있고(`SRG-A40`, `XDM-12`), 카탈로그는 그 모델명을
 * `quoteSpec`(규격)에 담고 있다. 실측 매칭률 **554/674 = 82%**.
 *
 * ## 붙이지 않는 것
 *
 * **부분일치를 하지 않는다.** `MR-4S`가 `MR-4S-4K`에 붙으면 **다른 제품**이고,
 * 단가도 품셈도 틀린다. 틀린 값이 조용히 들어가는 것이 빈칸보다 나쁘다
 * (설계서 §7.5: 미확인을 확인 완료로 바꾸지 않는다).
 *
 * **너무 짧은 모델명도 붙이지 않는다.** `A1` 같은 두 글자는 우연히 맞을 수 있다.
 *
 * ## 못 찾았을 때
 *
 * 행을 만들지 말지는 **호출부가 정한다.** 여기서는 `product: undefined`만 돌려준다.
 * 구성도에 있는 장비를 견적에서 빼면 안 되므로, 호출부는 행을 만들고
 * 단가를 비운 뒤 경고를 세운다 (설계서 §5.6).
 */
import type { DecimalText } from '../../domain/quote/types';
import type { Catalog, CatalogProduct } from '../../data/catalog/load';

export type MatchKind =
  | 'model-exact'
  | 'model-normalized'
  /** `98인치 / LH98QMCEBGCXKR`처럼 `/`로 묶인 값에서 한 조각이 정확히 맞은 경우. */
  | 'model-fragment'
  | 'none';

export interface MatchResult {
  readonly product?: CatalogProduct;
  /** 카탈로그에 없거나 단가가 미등록이면 `undefined`. **`0`으로 채우지 않는다.** */
  readonly sellingUnitPrice?: DecimalText;
  readonly matchedBy: MatchKind;
  /** 정규화 키가 여럿에 걸린 경우. 이때는 붙이지 않는다. */
  readonly ambiguousSkus?: readonly string[];
  /** `model-fragment`로 맞은 경우 어느 조각이 맞았는지. 사람이 검토할 근거다. */
  readonly matchedFragment?: string;
}

/**
 * 모델명 정규화.
 *
 * 대문자화 후 구분 기호를 없앤다. `XDM-CTR100`과 `XDMCTR100`과 `xdm ctr 100`이
 * 같아진다. 원본 카탈로그와 구성도가 같은 제품을 다르게 적는 경우가 실제로 있다.
 *
 * **`X`는 지우지 않는다.** 계획서가 제거 목록에 `× x *`를 적었는데, 글자 `x`까지
 * 지우면 `XDM-12`가 `DM12`가 되고 `XRN-820S`가 `RN820S`가 된다. 실물 카탈로그의
 * 모델명 상당수가 X로 시작한다.
 *
 * 곱셈 기호 `×`(U+00D7)는 **지우지 않고 `X`로 바꾼다.** 한쪽이 `9×3`, 다른 쪽이
 * `9X3`으로 적는 경우를 맞추기 위해서다. 지워 버리면 `93`이 되어 다른 수가 된다.
 */
export function normalizeModel(value: string): string {
  return value
    .toUpperCase()
    .replace(/×/g, 'X')
    .replace(/[\s\-_/().,"”“*#]/g, '')
    .trim();
}

/** 정규화 키가 이보다 짧으면 매칭하지 않는다. 우연히 맞을 수 있다. */
const MIN_KEY_LENGTH = 5;

interface CatalogIndex {
  exact: Map<string, CatalogProduct[]>;
  normalized: Map<string, CatalogProduct[]>;
}

const indexCache = new WeakMap<Catalog, CatalogIndex>();

function buildIndex(catalog: Catalog): CatalogIndex {
  const cached = indexCache.get(catalog);
  if (cached !== undefined) return cached;

  const exact = new Map<string, CatalogProduct[]>();
  const normalized = new Map<string, CatalogProduct[]>();

  const add = (map: Map<string, CatalogProduct[]>, key: string, product: CatalogProduct) => {
    if (key === '') return;
    const list = map.get(key);
    if (list === undefined) map.set(key, [product]);
    else if (!list.includes(product)) list.push(product);
  };

  for (const product of catalog.products) {
    // 카탈로그는 모델명을 `quoteSpec`(규격)에 담는다. `model`도 같은 값이지만
    // 비어 있을 수 있어 둘 다 색인한다.
    for (const raw of [product.quoteSpec, product.model]) {
      const trimmed = raw?.trim() ?? '';
      if (trimmed === '') continue;
      add(exact, trimmed, product);
      const key = normalizeModel(trimmed);
      if (key.length >= MIN_KEY_LENGTH) add(normalized, key, product);
    }
  }

  const index = { exact, normalized };
  indexCache.set(catalog, index);
  return index;
}

const NO_MATCH: MatchResult = { matchedBy: 'none' };

function resolve(
  product: CatalogProduct,
  catalog: Catalog,
  matchedBy: MatchKind,
): MatchResult {
  const price = catalog.prices.get(product.sku);
  return {
    product,
    ...(price !== undefined ? { sellingUnitPrice: price } : {}),
    matchedBy,
  };
}

export function matchByModel(model: string | undefined, catalog: Catalog): MatchResult {
  const trimmed = model?.trim() ?? '';
  if (trimmed === '') return NO_MATCH;

  const index = buildIndex(catalog);

  // 1) 글자 그대로 같은 것
  const exact = index.exact.get(trimmed);
  if (exact !== undefined && exact.length === 1) {
    return resolve(exact[0]!, catalog, 'model-exact');
  }
  if (exact !== undefined && exact.length > 1) {
    // 같은 모델명이 여러 제품에 걸렸다. 어느 쪽인지 사람이 정해야 한다.
    return { matchedBy: 'none', ambiguousSkus: exact.map((p) => p.sku) };
  }

  // 2) 구분 기호를 무시하고 같은 것
  const key = normalizeModel(trimmed);
  if (key.length < MIN_KEY_LENGTH) return NO_MATCH;

  const normalized = index.normalized.get(key);
  if (normalized !== undefined) {
    if (normalized.length > 1) {
      return { matchedBy: 'none', ambiguousSkus: normalized.map((p) => p.sku) };
    }
    return resolve(normalized[0]!, catalog, 'model-normalized');
  }

  // 3) `/`로 묶인 값에서 조각 하나가 정확히 맞는 경우
  return matchFragment(trimmed, catalog, index);
}

/**
 * `98인치 / LH98QMCEBGCXKR`처럼 **두 정보를 `/`로 묶어 적은** 모델명을 다룬다.
 *
 * 실측: 미매칭 109건 중 **35건에 `/`가 있고, 그중 22건이 조각 하나로 정확히 맞는다.**
 * 조각 둘 이상이 서로 다른 제품에 맞는 **위험 사례는 0건**이었다.
 * 전부 삼성 LFD 디스플레이이고, 디스플레이는 모든 구성도에 나온다.
 *
 * **이것은 부분일치가 아니다.** 명시적 구분자로 나눈 뒤 각 조각을 **통째로** 맞춘다.
 * `MR-4S`는 `/`가 없어 나뉘지 않으므로 `MR-4S-4K`에 여전히 붙지 않는다.
 *
 * 안전 장치: 맞는 조각이 **정확히 하나일 때만** 받는다. 0개면 미매칭, 2개 이상이면
 * 어느 쪽인지 알 수 없으므로 미매칭이다.
 */
function matchFragment(
  model: string,
  catalog: Catalog,
  index: CatalogIndex,
): MatchResult {
  if (!model.includes('/')) return NO_MATCH;

  const hits: Array<{ fragment: string; product: CatalogProduct; kind: MatchKind }> = [];

  for (const rawFragment of model.split('/')) {
    const fragment = rawFragment.trim();
    // 조각은 짧아도 받지 않는다. 전체 모델명과 달리 **어느 조각이 모델인지 모르는**
    // 상태라, 두세 글자가 우연히 맞을 위험이 더 크다.
    if (normalizeModel(fragment).length < MIN_KEY_LENGTH) continue;

    const exact = index.exact.get(fragment);
    if (exact !== undefined && exact.length === 1) {
      hits.push({ fragment, product: exact[0]!, kind: 'model-exact' });
      continue;
    }
    const key = normalizeModel(fragment);
    if (key.length < MIN_KEY_LENGTH) continue;
    const normalized = index.normalized.get(key);
    if (normalized !== undefined && normalized.length === 1) {
      hits.push({ fragment, product: normalized[0]!, kind: 'model-normalized' });
    }
  }

  // 서로 다른 제품에 맞은 조각이 둘 이상이면 어느 쪽인지 알 수 없다.
  const distinct = [...new Set(hits.map((h) => h.product.sku))];
  if (distinct.length !== 1) {
    return distinct.length > 1
      ? { matchedBy: 'none', ambiguousSkus: distinct }
      : NO_MATCH;
  }

  const hit = hits[0]!;
  return { ...resolve(hit.product, catalog, 'model-fragment'), matchedFragment: hit.fragment };
}
