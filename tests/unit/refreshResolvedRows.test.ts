/**
 * 품셈 교체 Task 4 — 재계산이 행을 다시 찾는 자리.
 *
 * `workspace.ts` 안에 있던 함수를 꺼내 와 직접 시험한다. 여기가
 * **견적서의 제품이 조용히 바뀌는지**를 가르는 자리다.
 */
import { describe, it, expect } from 'vitest';
import { refreshResolvedRows } from '@/domain/quote/refreshResolvedRows';
import { identityOf, type SkuMigrationTable } from '@/data/catalog/skuMigration';
import type { Catalog, CatalogProduct } from '@/data/catalog/load';
import type { QuoteDocument, SheetRow } from '@/domain/quote/types';
import { makeDocument, itemRow, system } from '../fixtures/document';

const OLD = 'a'.repeat(64);
const NEW = 'f'.repeat(64);

function product(sku: string, over: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    productId: sku, sku, brand: '', model: sku,
    quoteName: '합성 품목', quoteSpec: 'SPEC-1', unit: 'EA',
    options: { group: '합성 묶음' }, currency: 'KRW', evidence: 'verified',
    ...over,
  } as CatalogProduct;
}

function catalog(products: CatalogProduct[], prices: Record<string, string> = {}): Catalog {
  return {
    sourceSha256: NEW,
    products,
    prices: new Map(Object.entries(prices)),
    pricesAvailable: true,
  };
}

function docWith(rows: SheetRow[], savedCatalog = OLD): QuoteDocument {
  const d = makeDocument({ systems: [system('S1', { indirect: [] })], rows });
  return { ...d, versions: { ...d.versions, catalog: savedCatalog } };
}

/** 기본값은 `product()` 가 만드는 제품과 **같은 신원**이다(품명·규격·단위). */
function row(sku: string, over: object = {}): SheetRow {
  return {
    ...itemRow('r1', 'S1', { quantity: '1', price: '10000', name: '합성 품목' }),
    specification: 'SPEC-1',
    sku,
    productId: sku,
    ...over,
  } as SheetRow;
}

const noConduit = () => undefined;

// ---------------------------------------------------------------------------
describe('지문이 같으면 지금처럼 SKU 로 찾는다', () => {
  it('단가를 갱신한다', () => {
    const result = refreshResolvedRows(
      docWith([row('VID-0138')], OLD),
      { ...catalog([product('VID-0138')], { 'VID-0138': '20000' }), sourceSha256: OLD },
      { savedFingerprint: OLD, currentFingerprint: OLD, conduitGroupOf: noConduit },
    );
    expect(result.removedWarnings).toHaveLength(0);
    expect(result.document.rows[0]).toMatchObject({ sku: 'VID-0138', sellingUnitPrice: '20000' });
  });

  it('번호가 사라졌으면 미해결로 되돌린다 — 기존 동작', () => {
    const result = refreshResolvedRows(
      docWith([row('VID-0138')], OLD),
      { ...catalog([]), sourceSha256: OLD },
      { savedFingerprint: OLD, currentFingerprint: OLD, conduitGroupOf: noConduit },
    );
    expect(result.removedWarnings).toHaveLength(1);
    expect(result.document.rows[0]).toMatchObject({ laborMode: 'unresolved' });
    expect(result.document.rows[0]).not.toHaveProperty('sku');
  });
});

// ---------------------------------------------------------------------------
describe('지문이 다르면 대응표를 통과한 것만 바꾼다', () => {
  it('⛔ 대응표가 없으면 같은 번호라도 치환하지 않는다', () => {
    const swapped = product('VID-0138', { quoteName: '전혀 다른 제품', unit: 'SET' });
    const result = refreshResolvedRows(
      docWith([row('VID-0138')], OLD),
      catalog([swapped], { 'VID-0138': '999000' }),
      { savedFingerprint: OLD, currentFingerprint: NEW, conduitGroupOf: noConduit },
    );
    expect(result.document.rows[0]).toMatchObject({ laborMode: 'unresolved' });
    expect(result.document.rows[0]).not.toHaveProperty('sku');
    expect(JSON.stringify(result.document.rows[0])).not.toContain('전혀 다른 제품');
    expect(JSON.stringify(result.document.rows[0])).not.toContain('999000');
    expect(result.removedWarnings[0]!.message).toContain('다른 제품이고');
  });

  it('대응표가 없어도 그 번호의 제품이 이 행과 같은 제품이면 치환한다 — 일상 갱신 경로', () => {
    // 지문만 바뀌고 제품은 그대로인 경우(단가 수정 등). 품명·규격·단위가 같다.
    const result = refreshResolvedRows(
      docWith([row('VID-0138')], OLD),
      catalog([product('VID-0138')], { 'VID-0138': '20000' }),
      { savedFingerprint: OLD, currentFingerprint: NEW, conduitGroupOf: noConduit },
    );
    expect(result.removedWarnings).toHaveLength(0);
    expect(result.document.rows[0]).toMatchObject({ sku: 'VID-0138', sellingUnitPrice: '20000' });
  });

  it('단위만 달라도 같은 제품으로 보지 않는다', () => {
    const result = refreshResolvedRows(
      docWith([row('VID-0138')], OLD),
      catalog([product('VID-0138', { unit: 'SET' })]),
      { savedFingerprint: OLD, currentFingerprint: NEW, conduitGroupOf: noConduit },
    );
    expect(result.document.rows[0]).toMatchObject({ laborMode: 'unresolved' });
  });

  it('대응표가 있으면 신원이 같아도 대응표가 우선이다 — 미정이면 막는다', () => {
    const table: SkuMigrationTable = {
      sourceCatalogFingerprint: OLD,
      targetCatalogFingerprint: NEW,
      entries: [{ sourceSku: 'VID-0138', status: 'undecided', decidedBy: 'auto', note: '' }],
    };
    const result = refreshResolvedRows(
      docWith([row('VID-0138')], OLD),
      catalog([product('VID-0138')]),  // 신원은 그대로다
      { savedFingerprint: OLD, currentFingerprint: NEW, table, conduitGroupOf: noConduit },
    );
    expect(result.document.rows[0]).toMatchObject({ laborMode: 'unresolved' });
  });

  it('대응표가 정해 준 제품으로 바꾼다', () => {
    const target = product('VID-0211', { quoteName: '옮겨 간 제품' });
    const table: SkuMigrationTable = {
      sourceCatalogFingerprint: OLD,
      targetCatalogFingerprint: NEW,
      entries: [{
        sourceSku: 'VID-0138', status: 'mapped', targetSku: 'VID-0211',
        targetIdentity: identityOf(target), decidedBy: 'human', note: '사람이 골랐다',
      }],
    };
    const result = refreshResolvedRows(
      docWith([row('VID-0138')], OLD),
      catalog([target], { 'VID-0211': '30000' }),
      { savedFingerprint: OLD, currentFingerprint: NEW, table, conduitGroupOf: noConduit },
    );
    expect(result.removedWarnings).toHaveLength(0);
    expect(result.document.rows[0]).toMatchObject({
      sku: 'VID-0211', name: '옮겨 간 제품', sellingUnitPrice: '30000',
    });
  });

  it('막힌 행은 왜 막혔는지를 경고에 적는다', () => {
    const table: SkuMigrationTable = {
      sourceCatalogFingerprint: OLD,
      targetCatalogFingerprint: NEW,
      entries: [{ sourceSku: 'VID-0138', status: 'undecided', candidates: ['VID-0211'], decidedBy: 'auto', note: '' }],
    };
    const result = refreshResolvedRows(
      docWith([row('VID-0138')], OLD),
      catalog([product('VID-0211')]),
      { savedFingerprint: OLD, currentFingerprint: NEW, table, conduitGroupOf: noConduit },
    );
    expect(result.removedWarnings[0]!.message).toContain('아직 고르지 않았다');
    expect(result.removedWarnings[0]!.blocking).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('품셈 연결도 같은 경로를 탄다', () => {
  it('치환이 막히면 laborMappingId 가 남지 않는다 — 옛 품셈이 새 제품에 붙지 않는다', () => {
    const result = refreshResolvedRows(
      docWith([row('VID-0138', { laborMode: 'mapped', laborMappingId: 'VID-0138' })], OLD),
      catalog([product('VID-0138', { quoteName: '다른 제품' })]),
      { savedFingerprint: OLD, currentFingerprint: NEW, conduitGroupOf: noConduit },
    );
    expect(result.document.rows[0]).not.toHaveProperty('laborMappingId');
    expect(result.document.rows[0]).toMatchObject({ laborMode: 'unresolved' });
  });

  it('치환하면 새 제품의 품셈 연결을 쓴다 — 옛 연결을 끌고 가지 않는다', () => {
    const target = product('VID-0211', { laborMappingId: 'VID-0211' } as Partial<CatalogProduct>);
    const table: SkuMigrationTable = {
      sourceCatalogFingerprint: OLD,
      targetCatalogFingerprint: NEW,
      entries: [{
        sourceSku: 'VID-0138', status: 'mapped', targetSku: 'VID-0211',
        targetIdentity: identityOf(target), decidedBy: 'human', note: '',
      }],
    };
    const result = refreshResolvedRows(
      docWith([row('VID-0138', { laborMode: 'mapped', laborMappingId: 'VID-0138' })], OLD),
      catalog([target]),
      { savedFingerprint: OLD, currentFingerprint: NEW, table, conduitGroupOf: noConduit },
    );
    expect(result.document.rows[0]).toMatchObject({ laborMappingId: 'VID-0211' });
  });
});

// ---------------------------------------------------------------------------
describe('배관 행도 같은 경로를 탄다', () => {
  const conduitGroupOf = () => '후렉시블';

  it('지문이 달라 막히면 배관 행을 건드리지 않는다 — 배관은 자기 검증으로 되돌린다', () => {
    const before = row('CBL-0001', { name: '후렉시블 배관' });
    const result = refreshResolvedRows(
      docWith([before], OLD),
      catalog([product('CBL-0001', { options: { group: '후렉시블' } })]),
      { savedFingerprint: OLD, currentFingerprint: NEW, conduitGroupOf },
    );
    // 배관은 미해결로 되돌리지 않고 **그대로 둔다**(기존 정책).
    expect(result.document.rows[0]).toBe(before);
    expect(result.removedWarnings).toHaveLength(0);
  });

  it('지문이 같고 묶음이 맞으면 갱신한다', () => {
    const result = refreshResolvedRows(
      docWith([row('CBL-0001')], OLD),
      { ...catalog([product('CBL-0001', { options: { group: '후렉시블' } })], { 'CBL-0001': '5000' }), sourceSha256: OLD },
      { savedFingerprint: OLD, currentFingerprint: OLD, conduitGroupOf },
    );
    expect(result.document.rows[0]).toMatchObject({ sellingUnitPrice: '5000' });
  });

  it('묶음이 바뀌었으면 갱신하지 않는다 — 기존 동작', () => {
    const before = row('CBL-0001');
    const result = refreshResolvedRows(
      docWith([before], OLD),
      { ...catalog([product('CBL-0001', { options: { group: '다른 배관' } })]), sourceSha256: OLD },
      { savedFingerprint: OLD, currentFingerprint: OLD, conduitGroupOf },
    );
    expect(result.document.rows[0]).toBe(before);
  });
});

// ---------------------------------------------------------------------------
describe('품목을 고르지 않은 행은 건드리지 않는다', () => {
  it('sku 가 없는 행은 그대로다', () => {
    const before = itemRow('r9', 'S1', { quantity: '1' });
    const result = refreshResolvedRows(
      docWith([before], OLD),
      catalog([]),
      { savedFingerprint: OLD, currentFingerprint: NEW, conduitGroupOf: noConduit },
    );
    expect(result.document.rows[0]).toBe(before);
    expect(result.removedWarnings).toHaveLength(0);
  });
});
