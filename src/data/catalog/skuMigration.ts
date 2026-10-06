/**
 * SKU 대응 계약 (품셈 교체 계획 Task 4).
 *
 * ## 왜 필요한가
 *
 * SKU 는 `시트코드-원본행번호`다(`VID-0138` = 영상 시트 138행). 품셈 파일을
 * 새 판으로 바꾸면 행이 밀려서 **같은 번호가 다른 제품**을 가리킨다.
 *
 * 실측(2026-10-06, 상반기 ↔ 하반기):
 *
 * ```
 * 공통 SKU 1,212  →  같은 제품 188 · 다른 제품 1,024 (84%)
 * ```
 *
 * 저장된 견적서를 다시 열어 재계산하면 예전에는 SKU 로 제품을 찾아 **그대로
 * 치환했다.** 번호가 살아 있기만 하면 `catalog-item-removed` 경고조차 나지
 * 않아서, 견적서의 제품이 조용히 바뀌었다(실제 브라우저로 재현함 —
 * `tests/e2e/sku-migration.spec.ts`).
 *
 * ## 계약
 *
 * 대응의 열쇠는 **세 값**이다.
 *
 * ```
 * (저장 당시 카탈로그 지문, 옛 SKU, 지금 카탈로그 지문)  →  새 SKU · 신원
 * ```
 *
 * 지금 지문을 빼면 안 된다. 다음 교체 때 같은 번호가 또 재사용되어 **옛 대응이
 * 엉뚱한 곳을 가리킨다.**
 *
 * ## 두 경로
 *
 * ```
 * 저장 지문 == 지금 지문   →  SKU 로 찾아도 된다 (같은 카탈로그다)
 * 지문이 다르다           →  대응표를 통과한 것만 치환한다
 * 대응표에 없다           →  치환하지 않는다 (사람이 다시 고른다)
 * ```
 *
 * ⛔ **옛 SKU 로 되돌아가는 fallback 을 만들지 않는다.** 치환하지 못하면
 * 미해결로 되돌릴 뿐, 옛 제품을 그대로 쓰지 않는다.
 */
import type { CatalogProduct } from './load';

/**
 * 제품의 **신원**. 대응이 옳은지 확인하는 근거다.
 *
 * ⛔ **품명·규격만으로 판정하지 않는다.** 실측 반례:
 * `V-160HD` 가 `아이패드 제외`/`아이패드 포함` 두 줄(설명이 다르다),
 * `Bridge UHD M_OTR` 이 `EA`/`SET` 두 줄(단위가 다르다)이다.
 * 둘 다 품명·규격은 같지만 **다른 제품**이다.
 */
export interface SkuIdentity {
  quoteName: string;
  quoteSpec: string;
  unit: string;
  description: string;
  group: string;
}

export function identityOf(product: CatalogProduct): SkuIdentity {
  return {
    quoteName: product.quoteName,
    quoteSpec: product.quoteSpec,
    unit: product.unit,
    description: product.options['description'] ?? '',
    group: product.options['group'] ?? '',
  };
}

export function identityEquals(a: SkuIdentity, b: SkuIdentity): boolean {
  return (
    a.quoteName === b.quoteName &&
    a.quoteSpec === b.quoteSpec &&
    a.unit === b.unit &&
    a.description === b.description &&
    a.group === b.group
  );
}

/**
 * 대응 한 건의 상태.
 *
 * `undecided` 와 `unmappable` 을 **가른다** — "고르지 않음"과 "고를 수 없음"은
 * 다르다. 앞은 사람이 손대면 풀리고, 뒤는 새 제품을 카탈로그에 넣어야 풀린다.
 */
export type SkuMigrationStatus =
  /** 옮길 곳을 정했다. */
  | 'mapped'
  /** 후보는 있는데 **사람이 아직 고르지 않았다.** */
  | 'undecided'
  /** 옮길 곳이 **없다** — 후보조차 찾지 못했다. */
  | 'unmappable';

export interface SkuMigrationEntry {
  sourceSku: string;
  status: SkuMigrationStatus;
  /** `mapped` 일 때만 있다. */
  targetSku?: string | undefined;
  /**
   * 대응을 정할 때 확인한 **대상 제품의 신원**. 그 뒤 카탈로그가 또 바뀌어
   * 같은 번호가 또 다른 제품이 됐으면 이 값이 달라져 치환을 거부한다.
   */
  targetIdentity?: SkuIdentity | undefined;
  /** `undecided` 일 때 사람에게 보여 줄 후보. */
  candidates?: readonly string[] | undefined;
  /** 자동으로 찾았나, 사람이 골랐나. 섞어서 기록하지 않는다. */
  decidedBy: 'auto' | 'human';
  /** 왜 이 대응인가, 또는 왜 정하지 못했는가. */
  note: string;
}

export interface SkuMigrationTable {
  /** 저장 당시 카탈로그 지문. */
  sourceCatalogFingerprint: string;
  /** 옮겨 갈 카탈로그 지문. **이 값이 열쇠의 일부다.** */
  targetCatalogFingerprint: string;
  entries: readonly SkuMigrationEntry[];
}

export type SkuResolution =
  /** 저장 기준과 지금 기준이 같다 — SKU 로 찾아도 된다. */
  | { kind: 'same-basis' }
  /** 대응표가 정해 준 제품으로 바꾼다. */
  | { kind: 'substitute'; targetSku: string }
  /** 바꾸지 않는다. 사람이 다시 골라야 한다. */
  | { kind: 'blocked'; reason: string };

function known(fingerprint: string | undefined): string | undefined {
  return fingerprint === undefined || fingerprint === '' || fingerprint === 'unknown'
    ? undefined
    : fingerprint;
}

/**
 * 저장된 행이 **스스로 기억하는** 제품 모습. 사람이 견적서를 만들 때 눈으로 본 값이다.
 *
 * 설명(`description`)은 **비교하지 않는다.** 실측에서 같은 제품의 설명이
 * 길어지기만 한 사례가 있었다(`삼성 46인치 비디오월` 의 치수·무게 추가).
 * 그것까지 "다른 제품"으로 보면 멀쩡한 행을 막는다.
 */
export interface RowIdentity {
  name: string;
  specification: string;
  unit: string;
}

/** 딸림 품목은 품명 앞에 `- ` 가 붙는다(`buildDocument.toRow`). 비교 전에 뗀다. */
function bareName(name: string): string {
  return name.replace(/^-\s*/, '');
}

export function rowMatchesProduct(row: RowIdentity, product: CatalogProduct): boolean {
  return (
    bareName(row.name) === bareName(product.quoteName) &&
    row.specification === product.quoteSpec &&
    row.unit === product.unit
  );
}

export interface SkuResolutionContext {
  savedFingerprint: string;
  currentFingerprint: string;
  table?: SkuMigrationTable;
  /** 이 행이 기억하는 제품 모습. 없으면 증명할 수 없으므로 막는다. */
  rowIdentity?: RowIdentity;
  productBySku(sku: string): CatalogProduct | undefined;
}

/**
 * 이 SKU 를 지금 카탈로그에서 어떻게 다룰지 정한다.
 *
 * **치환을 허락하는 길은 두 가지뿐이다** — 기준이 같거나, 대응표를 통과하거나.
 * 그 밖에는 전부 `blocked` 다.
 */
export function resolveSku(sku: string, context: SkuResolutionContext): SkuResolution {
  const saved = known(context.savedFingerprint);
  const current = known(context.currentFingerprint);

  // 둘 다 알고 있고 같으면 같은 카탈로그다. 하나라도 모르면 같다고 보지 않는다
  // — `'unknown'` 은 "확인된 적 없음"이지 "같음"이 아니다.
  if (saved !== undefined && current !== undefined && saved === current) {
    return { kind: 'same-basis' };
  }

  const table = context.table;
  if (table === undefined) {
    // 대응표가 없다 — 교체를 준비하지 않은 **일상적인 카탈로그 갱신**일 수 있다
    // (단가 수정, 제품 추가 등). 그때도 무조건 막으면 멀쩡한 견적서가 통째로
    // 미해결이 된다.
    //
    // 그래서 **증명되면** 통과시킨다: 그 번호의 제품이 이 행이 기억하는
    // 품명·규격·단위와 같으면 "같은 제품"이다. 사람이 견적서에서 본 것이 지금도
    // 그대로라는 뜻이라, 바꿔도 바뀌는 것이 없다.
    //
    // 실측(상반기 → 하반기)으로 이 판정의 힘을 쟀다:
    //
    // ```
    // 공통 SKU 1,212  →  제품 그대로 183 · 다른 제품 1,029
    //                    그중 품명·규격·단위로 잡히는 것 1,016 (98.7%)
    //                    못 잡는 13건은 전부 같은 제품이었다
    //                    (묶음 오타 EVER→AVER, 설명이 길어진 것)
    // ```
    //
    // ⛔ 이것은 "대응을 못 찾으면 옛 SKU 로 되돌아간다"는 fallback 이 **아니다.**
    // 증거(신원 일치)가 있을 때만 통과시키고, 없으면 막는다.
    const product = context.productBySku(sku);
    if (product === undefined) {
      return { kind: 'blocked', reason: '카탈로그 기준이 달라졌고 이 번호가 지금 카탈로그에 없다' };
    }
    if (context.rowIdentity !== undefined && rowMatchesProduct(context.rowIdentity, product)) {
      return { kind: 'substitute', targetSku: sku };
    }
    return {
      kind: 'blocked',
      reason: '카탈로그 기준이 달라졌는데 그 번호의 제품이 이 행과 다른 제품이고, SKU 대응표도 없다',
    };
  }
  if (table.sourceCatalogFingerprint !== context.savedFingerprint) {
    return { kind: 'blocked', reason: '대응표가 이 문서의 저장 당시 카탈로그에서 만들어진 것이 아니다' };
  }
  if (table.targetCatalogFingerprint !== context.currentFingerprint) {
    // 다음 교체 때 같은 번호가 또 재사용되면 옛 대응이 엉뚱한 곳을 가리킨다.
    return { kind: 'blocked', reason: '대응표가 지금 카탈로그가 아닌 다른 판을 겨냥하고 있다' };
  }

  const entry = table.entries.find((e) => e.sourceSku === sku);
  if (entry === undefined) {
    return { kind: 'blocked', reason: '대응표에 이 SKU 가 없다' };
  }
  if (entry.status === 'undecided') {
    return { kind: 'blocked', reason: '어느 제품으로 옮길지 아직 고르지 않았다' };
  }
  if (entry.status === 'unmappable') {
    return { kind: 'blocked', reason: '옮길 제품을 찾지 못했다' };
  }
  if (entry.targetSku === undefined) {
    return { kind: 'blocked', reason: '대응표가 옮길 곳을 적지 않았다' };
  }

  const product = context.productBySku(entry.targetSku);
  if (product === undefined) {
    return { kind: 'blocked', reason: '대응표가 가리키는 제품이 지금 카탈로그에 없다' };
  }
  // 대응을 만들 때 본 제품과 지금 제품이 같은지 **신원으로** 확인한다.
  if (entry.targetIdentity !== undefined && !identityEquals(identityOf(product), entry.targetIdentity)) {
    return { kind: 'blocked', reason: '대응표를 만들 때 확인한 제품과 지금 그 번호의 제품이 다르다' };
  }
  return { kind: 'substitute', targetSku: entry.targetSku };
}

/**
 * 두 카탈로그를 대조해 **대응표 초안**을 만든다.
 *
 * ⛔ **신원 다섯 값이 전부 같을 때만** 자동으로 정한다(`decidedBy: 'auto'`).
 * 하나라도 다르면 사람에게 넘긴다 — 품명·규격만 같고 단위나 설명이 다른 것은
 * 다른 제품이다.
 *
 * 자동으로 정한 것도 `targetIdentity` 를 함께 적어, 다음에 카탈로그가 또
 * 바뀌면 그 대응이 저절로 무효가 되게 한다.
 */
export function proposeSkuMigration(
  source: { sourceSha256: string; products: readonly CatalogProduct[] },
  target: { sourceSha256: string; products: readonly CatalogProduct[] },
): SkuMigrationTable {
  const targetBySku = new Map(target.products.map((p) => [p.sku, p]));
  // 신원 → 그 신원을 가진 대상 SKU들. 하나뿐일 때만 자동으로 정한다.
  const targetByIdentity = new Map<string, string[]>();
  for (const product of target.products) {
    const key = JSON.stringify(identityOf(product));
    const bucket = targetByIdentity.get(key);
    if (bucket === undefined) targetByIdentity.set(key, [product.sku]);
    else bucket.push(product.sku);
  }
  // 품명이 같은 후보 — **판정 근거가 아니라** 사람에게 보여 줄 목록이다.
  const targetByName = new Map<string, string[]>();
  for (const product of target.products) {
    const bucket = targetByName.get(product.quoteName);
    if (bucket === undefined) targetByName.set(product.quoteName, [product.sku]);
    else bucket.push(product.sku);
  }

  const entries: SkuMigrationEntry[] = [];
  for (const product of source.products) {
    const identity = identityOf(product);
    const exact = targetByIdentity.get(JSON.stringify(identity)) ?? [];

    if (exact.length === 1) {
      const targetSku = exact[0]!;
      entries.push({
        sourceSku: product.sku,
        status: 'mapped',
        targetSku,
        targetIdentity: identityOf(targetBySku.get(targetSku)!),
        decidedBy: 'auto',
        note:
          targetSku === product.sku
            ? '번호와 제품이 모두 그대로다'
            : '품명·규격·단위·설명·묶음이 전부 같은 제품을 새 번호에서 찾았다',
      });
      continue;
    }
    if (exact.length > 1) {
      entries.push({
        sourceSku: product.sku,
        status: 'undecided',
        candidates: exact,
        decidedBy: 'auto',
        note: `신원이 같은 제품이 ${exact.length}건이라 자동으로 고르지 않는다`,
      });
      continue;
    }

    const byName = targetByName.get(product.quoteName) ?? [];
    if (byName.length > 0) {
      entries.push({
        sourceSku: product.sku,
        status: 'undecided',
        candidates: byName,
        decidedBy: 'auto',
        note: '품명은 같지만 규격·단위·설명·묶음 중 하나가 달라 사람이 확인해야 한다',
      });
      continue;
    }

    entries.push({
      sourceSku: product.sku,
      status: 'unmappable',
      decidedBy: 'auto',
      note: '같은 품명의 제품이 새 카탈로그에 없다',
    });
  }

  return {
    sourceCatalogFingerprint: source.sourceSha256,
    targetCatalogFingerprint: target.sourceSha256,
    entries,
  };
}

export interface SkuMigrationSummary {
  mapped: number;
  undecided: number;
  unmappable: number;
  /** 번호는 같은데 제품이 바뀐 것 — 조용히 치환되면 가장 위험한 축이다. */
  reusedNumberDifferentProduct: number;
}

export function summarizeSkuMigration(
  table: SkuMigrationTable,
  source: { products: readonly CatalogProduct[] },
  target: { products: readonly CatalogProduct[] },
): SkuMigrationSummary {
  const sourceBySku = new Map(source.products.map((p) => [p.sku, p]));
  const targetBySku = new Map(target.products.map((p) => [p.sku, p]));
  let reused = 0;
  for (const [sku, product] of sourceBySku) {
    const sameNumber = targetBySku.get(sku);
    if (sameNumber !== undefined && !identityEquals(identityOf(product), identityOf(sameNumber))) {
      reused += 1;
    }
  }
  return {
    mapped: table.entries.filter((e) => e.status === 'mapped').length,
    undecided: table.entries.filter((e) => e.status === 'undecided').length,
    unmappable: table.entries.filter((e) => e.status === 'unmappable').length,
    reusedNumberDifferentProduct: reused,
  };
}
