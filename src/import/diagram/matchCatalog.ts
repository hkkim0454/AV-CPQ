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
  /**
   * 1~3 단계가 모두 못 찾았을 때만 도는 **네 번째 단계**가 후보를 찾은 경우.
   * **연결이 아니라 제시다** — `product`도 `sellingUnitPrice`도 비어 있다.
   */
  | 'model-search'
  | 'none';

/** 4단계가 카탈로그의 어느 칸에서 모델명을 찾았는지. */
export type MatchedField = 'model' | 'quoteSpec' | 'quoteName' | 'description';

export interface ModelSearchMatch {
  readonly field: MatchedField;
  /** 그 칸에서 **실제로 맞은 글자**. 사람이 판단할 근거다 (계획 §6). */
  readonly text: string;
}

export interface ModelSearchCandidate {
  readonly sku: string;
  /**
   * 맞은 칸을 **전부** 보존한다 (계획 §4-4). 같은 제품이 규격에서도 설명에서도
   * 맞았다는 사실은 사람이 판단할 때 서로 다른 무게를 가지므로 하나로 줄이지 않는다.
   */
  readonly matches: readonly ModelSearchMatch[];
}

export interface MatchResult {
  readonly product?: CatalogProduct;
  /** 카탈로그에 없거나 단가가 미등록이면 `undefined`. **`0`으로 채우지 않는다.** */
  readonly sellingUnitPrice?: DecimalText;
  readonly matchedBy: MatchKind;
  /** 정규화 키가 여럿에 걸린 경우. 이때는 붙이지 않는다. */
  readonly ambiguousSkus?: readonly string[];
  /** `model-fragment`로 맞은 경우 어느 조각이 맞았는지. 사람이 검토할 근거다. */
  readonly matchedFragment?: string;
  /**
   * 4단계가 찾은 후보. **건수와 무관하게 전부 후보 제시다** (계획 §6) — 1건만
   * 맞아도 자동으로 연결하지 않는다. `24인치 모니터`처럼 모델명이 아니라 일반
   * 명칭인 값이 있어서, 1건 맞았다는 것이 그 제품이라는 근거가 되지 않는다.
   */
  readonly modelSearchCandidates?: readonly ModelSearchCandidate[];
}

/**
 * **설명 칸에서만** 맞은 후보인지. 설명 칸에는 *그 제품에 쓰는 다른 제품의
 * 모델명*이 적혀 있다 (`VID-0139` 설명 `XDM-12, 20, 36 동일 적용`). 부속품이
 * 본체로 연결되면 단가도 품셈도 전혀 다르므로, 호출부와 화면은 이 후보를
 * **경고와 함께** 보여준다 (계획 §5).
 */
export function isDescriptionOnlyCandidate(candidate: ModelSearchCandidate): boolean {
  return candidate.matches.every((m) => m.field === 'description');
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
  const fragment = matchFragment(trimmed, catalog, index);
  // 4) 1~3 이 **모두 후보를 못 찾았을 때만** 돈다 (계획 §3). 후보가 여럿 나온
  //    상태(`ambiguousSkus`)를 새 검색으로 하나로 좁히지 않는다 — 그 상태는
  //    지금처럼 사람에게 묻는다.
  if (fragment.matchedBy !== 'none' || fragment.ambiguousSkus !== undefined) return fragment;
  return searchCatalogByModel(trimmed, catalog);
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

/**
 * 모델명을 **덩어리 + 구분자** 패턴으로 바꾼다 (계획 §4-1).
 *
 * `BRC-H800` → `BRC` 와 `H800` 두 덩어리. 덩어리 **사이에만** 구분자를 허용하므로
 * `BRC-H800`·`BRC H800`·`BRCH800` 이 모두 맞는다. 구분자 목록은 `normalizeModel`이
 * 지우는 글자와 **같은 집합**이다 — 두 곳이 다르면 1~3 단계와 4 단계가 서로 다른
 * 글자를 같다고 보게 된다.
 */
/**
 * ⚠ 세 상수는 **문자열이 아니라 정규식 리터럴**의 `.source`다. 문자열로 적으면
 * `'\s'`가 JS 문자열 escape 단계에서 `'s'`로 줄어 `[s-_...]`라는 **다른 문자
 * 범위**가 되고, 정규식이 통째로 깨진다. 리터럴은 그 단계를 거치지 않는다.
 */
const SEPARATOR_CLASS = /[\s\-_\/().,"”“*#]/.source;

/** 덩어리는 영숫자와 한글이다. 쪼개는 기준은 그 외 **모든** 글자다. */
const CHUNK_PATTERN = /[0-9A-Za-z가-힣]+/g;

/**
 * 앞뒤 경계 (계획 §4-2).
 *
 * **하이픈과 언더스코어를 경계로 인정하지 않는다.** 인정하면 `MR-4S`가
 * `MR-4S-4K`에, `A40`이 `SRG-A40`에 걸린다 — 접두·접미가 붙은 **다른 제품**이다.
 *
 * 한글은 이 집합에 **들어가지 않는다.** 즉 `모니터`가 `대형모니터`에 걸린다.
 * 4단계는 후보만 제시하므로 과잉 후보의 비용은 사람의 검토 한 번이고, 반대로
 * 경계를 한글까지 넓히면 카탈로그가 구분자 없이 붙여 적은 참 후보를 놓친다.
 */
const BOUNDARY_BEFORE = /(?<![0-9A-Za-z\-_])/.source;
const BOUNDARY_AFTER = /(?![0-9A-Za-z\-_])/.source;

/**
 * 곱셈 기호 `×`(U+00D7)를 `X`로 바꾼다. **지우지 않는다** — 지우면 `9×3`이 `93`이
 * 되어 다른 수가 된다 (`normalizeModel`과 같은 이유다). 한 글자를 한 글자로
 * 바꾸므로 글자 위치가 그대로여서, 맞은 글자를 원본에서 그대로 떠낼 수 있다.
 */
function foldMultiplicationSign(value: string): string {
  return value.replace(/×/g, 'X');
}

function buildModelSearchPattern(model: string): RegExp | undefined {
  const chunks = foldMultiplicationSign(model).match(CHUNK_PATTERN);
  if (chunks === null || chunks.length === 0) return undefined;
  // `i` 플래그로 대소문자를 구분하지 않는다 — `normalizeModel`의 대문자화와 같다.
  return new RegExp(BOUNDARY_BEFORE + chunks.join(`${SEPARATOR_CLASS}*`) + BOUNDARY_AFTER, 'i');
}

const SEARCH_FIELDS: ReadonlyArray<{
  readonly field: MatchedField;
  readonly read: (product: CatalogProduct) => string | undefined;
}> = [
  { field: 'model', read: (p) => p.model },
  { field: 'quoteSpec', read: (p) => p.quoteSpec },
  { field: 'quoteName', read: (p) => p.quoteName },
  { field: 'description', read: (p) => p.options['description'] },
];

/**
 * **네 번째 단계** — av-builder 모델명을 열쇠로 카탈로그 네 칸 안을 찾는다.
 *
 * 품명에서 모델명을 **뽑아내지 않는다** (계획 §2). `BLU-101, AEC/Bluelink지원`은
 * 쉼표 앞이, `12배줌, BRC-H800`은 쉼표 뒤가 모델명이라 위치로도 구분자로도 규칙을
 * 세울 수 없다. 대신 확정 목록인 av-builder 모델명을 열쇠로 삼는다.
 *
 * ⛔ **찾아도 연결하지 않는다.** `product`를 비운 채 후보만 돌려준다 (계획 §6).
 */
function searchCatalogByModel(model: string, catalog: Catalog): MatchResult {
  const pattern = buildModelSearchPattern(model);
  if (pattern === undefined) return NO_MATCH;

  const candidates: ModelSearchCandidate[] = [];

  for (const product of catalog.products) {
    const matches: ModelSearchMatch[] = [];

    for (const { field, read } of SEARCH_FIELDS) {
      const original = read(product);
      if (original === undefined || original === '') continue;

      const found = pattern.exec(foldMultiplicationSign(original));
      if (found === null) continue;
      // 원본에서 떠낸다 — `×`를 `X`로 바꾼 사본이 아니라 사람이 실제로 보는 글자다.
      matches.push({ field, text: original.slice(found.index, found.index + found[0].length) });
    }

    // 같은 SKU 는 후보 목록에 **한 번만** 올리되, 맞은 칸은 전부 보존한다 (계획 §4-4).
    if (matches.length > 0) candidates.push({ sku: product.sku, matches });
  }

  if (candidates.length === 0) return NO_MATCH;
  return { matchedBy: 'model-search', modelSearchCandidates: candidates };
}
