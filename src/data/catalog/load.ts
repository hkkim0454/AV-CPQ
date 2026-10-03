/**
 * 배포 카탈로그 읽기 (결정 D3).
 *
 * `products.json`과 `prices.json`을 **따로** 읽는다. 가격 파일은 없을 수 있다 —
 * 결정 D3가 "판매가를 가리려면 배포에서 빼기만 하면 된다"로 정해 두었고,
 * 2026-10-04 보강으로 실제로 인증 뒤에 두기로 했다.
 *
 * 그래서 **가격이 없는 상태가 정상 경로다.** 404도, 깨진 JSON도, 스키마 불일치도
 * 던지지 않고 `pricesAvailable: false`로 떨어진다. 앱은 단가를 `미등록`으로
 * 표시하고 확정을 막는다 (설계서 §5.6).
 *
 * 반대로 `products.json`이 없으면 **던진다.** 제품 목록 없이는 아무것도 못 한다.
 */
import { z } from 'zod';
import type { DecimalText } from '../../domain/quote/types';
import type { LaborItem, LaborMapping, WageTable } from '../../domain/labor/types';
import {
  productsFileSchema,
  pricesFileSchema,
  laborItemsFileSchema,
  wageTableFileSchema,
  laborMappingsFileSchema,
} from './schema';

export type CatalogProduct = z.infer<typeof productsFileSchema>['products'][number];

export interface Catalog {
  /** 어느 원본에서 나왔는지. 가격 파일과 일치해야 한다. */
  sourceSha256: string;
  products: CatalogProduct[];
  /** SKU → 판매단가. **미등록 제품은 키가 없다.** */
  prices: Map<string, DecimalText>;
  /** 가격 파일을 실제로 읽었는지. `false`면 전 품목이 미등록이다. */
  pricesAvailable: boolean;
  /** 가격을 못 읽은 이유. 화면에 그대로 보여준다. */
  pricesUnavailableReason?: string;
}

/** 이미 파싱한 JSON에서 카탈로그를 만든다. 네트워크를 타지 않아 테스트가 쉽다. */
export function buildCatalog(productsRaw: unknown, pricesRaw?: unknown): Catalog {
  const products = productsFileSchema.parse(productsRaw);

  const catalog: Catalog = {
    sourceSha256: products.sourceSha256,
    products: products.products,
    prices: new Map(),
    pricesAvailable: false,
  };

  if (pricesRaw === undefined) {
    catalog.pricesUnavailableReason = '가격 파일이 배포에 없다 (결정 D3).';
    return catalog;
  }

  const parsed = pricesFileSchema.safeParse(pricesRaw);
  if (!parsed.success) {
    // 던지지 않는다. 가격이 없는 것은 정상 경로다.
    catalog.pricesUnavailableReason = '가격 파일의 형식이 맞지 않는다.';
    return catalog;
  }

  // 설계서 §6.3: 조용한 가격 변경을 막는다.
  // 제품과 가격이 다른 원본에서 나왔으면 섞어 쓰지 않는다.
  if (parsed.data.sourceSha256 !== products.sourceSha256) {
    catalog.pricesUnavailableReason =
      '제품 파일과 가격 파일이 서로 다른 원본에서 나왔다. 섞어 쓰지 않는다.';
    return catalog;
  }

  for (const [sku, entry] of Object.entries(parsed.data.prices)) {
    catalog.prices.set(sku, entry.sellingUnitPrice);
  }
  catalog.pricesAvailable = true;
  return catalog;
}

/** SKU의 판매단가. 미등록이면 `undefined` — **`0`이 아니다** (설계서 §5.6). */
export function priceOf(catalog: Catalog, sku: string): DecimalText | undefined {
  return catalog.prices.get(sku);
}

export interface LoadCatalogOptions {
  /** `import.meta.env.BASE_URL`. 끝에 `/`가 있어야 한다. */
  baseUrl?: string;
  /** 테스트에서 갈아끼운다. */
  fetchImpl?: typeof fetch;
}

/**
 * 배포 데이터를 읽는다.
 *
 * 같은 origin의 정적 파일만 읽는다. 문서 상태를 바깥으로 보내지 않는다
 * (설계서 §8.4). 빌드 타임 `import`를 쓰지 않는 이유는 결정 D3다 —
 * 번들에 박으면 가격 파일을 빼는 것만으로 되돌릴 수 없다.
 */
export async function loadCatalog(options: LoadCatalogOptions = {}): Promise<Catalog> {
  const base = options.baseUrl ?? '/';
  const get = options.fetchImpl ?? fetch;

  const productsResponse = await get(`${base}data/approved/products.json`);
  if (!productsResponse.ok) {
    throw new Error(
      `제품 목록을 읽을 수 없다 (HTTP ${productsResponse.status}). ` +
        '`npm run build:approved`로 배포 데이터를 만들었는지 확인한다.',
    );
  }
  const productsRaw: unknown = await productsResponse.json();

  let pricesRaw: unknown;
  try {
    const pricesResponse = await get(`${base}data/approved/prices.json`);
    if (pricesResponse.ok) {
      pricesRaw = await pricesResponse.json();
    }
  } catch {
    // 네트워크 오류도 "가격 없음"으로 본다. 제품 목록은 이미 읽었다.
    pricesRaw = undefined;
  }

  return buildCatalog(productsRaw, pricesRaw);
}


// ---------------------------------------------------------------------------
// 품셈·노임
// ---------------------------------------------------------------------------

export interface LaborReference {
  items: LaborItem[];
  mappings: LaborMapping[];
  wages: WageTable;
  /** 품셈을 붙일 수 없는 SKU. 숨기지 않고 함께 들고 다닌다. */
  unmappedSkus: string[];
}

/**
 * 품셈 세 파일을 읽는다.
 *
 * 가격과 달리 **셋 다 필수다.** 품셈이 없으면 노무비가 0이 되고, 간접비가
 * 노무비 대비로 계산되므로 간접비까지 0이 된다. 조용히 틀린 견적이 나간다.
 */
export function buildLaborReference(
  itemsRaw: unknown,
  wageRaw: unknown,
  mappingsRaw: unknown,
): LaborReference {
  const items = laborItemsFileSchema.parse(itemsRaw);
  const wage = wageTableFileSchema.parse(wageRaw);
  const mappings = laborMappingsFileSchema.parse(mappingsRaw);

  if (
    items.sourceSha256 !== wage.sourceSha256 ||
    items.sourceSha256 !== mappings.sourceSha256
  ) {
    throw new Error(
      '품셈·노임·매핑이 서로 다른 원본에서 나왔다. 섞어 쓰면 노무비가 틀린다.',
    );
  }

  return {
    items: items.laborItems,
    mappings: mappings.mappings,
    wages: wage.wageTable,
    unmappedSkus: mappings.unmappedSkus,
  };
}
