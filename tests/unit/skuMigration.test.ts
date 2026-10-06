/**
 * 품셈 교체 Task 4 — SKU 대응 계약.
 *
 * SKU 는 `시트코드-원본행번호`라서 품셈 파일을 바꾸면 **같은 번호가 다른
 * 제품**을 가리킨다(실측 84%). 치환을 허락하는 길이 둘뿐인지, 그리고
 * 옛 SKU 로 되돌아가는 샛길이 없는지 본다.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveSku,
  proposeSkuMigration,
  summarizeSkuMigration,
  identityOf,
  identityEquals,
  type SkuMigrationTable,
} from '@/data/catalog/skuMigration';
import type { CatalogProduct } from '@/data/catalog/load';

const OLD = 'a'.repeat(64);
const NEW = 'f'.repeat(64);

function product(sku: string, over: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    productId: sku,
    sku,
    brand: '',
    model: sku,
    quoteName: '합성 품목',
    quoteSpec: 'SPEC-1',
    unit: 'EA',
    options: { group: '합성 묶음' },
    currency: 'KRW',
    evidence: 'verified',
    ...over,
  } as CatalogProduct;
}

const catalogOf = (products: CatalogProduct[]) => ({
  productBySku: (sku: string) => products.find((p) => p.sku === sku),
});

const table = (over: Partial<SkuMigrationTable> = {}): SkuMigrationTable => ({
  sourceCatalogFingerprint: OLD,
  targetCatalogFingerprint: NEW,
  entries: [],
  ...over,
});

// ---------------------------------------------------------------------------
describe('두 경로 — 기준이 같거나, 대응표를 통과하거나', () => {
  it('지문이 같으면 SKU 로 찾아도 된다', () => {
    const result = resolveSku('VID-0138', {
      savedFingerprint: OLD,
      currentFingerprint: OLD,
      ...catalogOf([product('VID-0138')]),
    });
    expect(result).toEqual({ kind: 'same-basis' });
  });

  it('지문이 다르고 대응표가 없으면 치환하지 않는다', () => {
    const result = resolveSku('VID-0138', {
      savedFingerprint: OLD,
      currentFingerprint: NEW,
      ...catalogOf([product('VID-0138')]),
    });
    expect(result.kind).toBe('blocked');
  });

  it('대응표를 통과하면 그 제품으로 바꾼다', () => {
    const target = product('VID-0211');
    const result = resolveSku('VID-0138', {
      savedFingerprint: OLD,
      currentFingerprint: NEW,
      table: table({
        entries: [{
          sourceSku: 'VID-0138', status: 'mapped', targetSku: 'VID-0211',
          targetIdentity: identityOf(target), decidedBy: 'human', note: '사람이 골랐다',
        }],
      }),
      ...catalogOf([target]),
    });
    expect(result).toEqual({ kind: 'substitute', targetSku: 'VID-0211' });
  });

  it('대응표에 없으면 치환하지 않는다 — 번호가 살아 있어도 마찬가지다', () => {
    const result = resolveSku('VID-0138', {
      savedFingerprint: OLD,
      currentFingerprint: NEW,
      table: table({ entries: [] }),
      ...catalogOf([product('VID-0138')]), // 번호는 지금 카탈로그에도 있다
    });
    expect(result.kind).toBe('blocked');
    if (result.kind !== 'blocked') return;
    expect(result.reason).toContain('대응표에 이 SKU 가 없다');
  });
});

// ---------------------------------------------------------------------------
describe('열쇠는 세 값이다 — 지금 지문을 빼면 안 된다', () => {
  const entries = [{
    sourceSku: 'VID-0138', status: 'mapped' as const, targetSku: 'VID-0211',
    decidedBy: 'auto' as const, note: '',
  }];

  it('대응표가 겨냥한 판이 지금 카탈로그가 아니면 거부한다', () => {
    const OTHER = 'c'.repeat(64);
    const result = resolveSku('VID-0138', {
      savedFingerprint: OLD,
      currentFingerprint: NEW,
      table: table({ targetCatalogFingerprint: OTHER, entries }),
      ...catalogOf([product('VID-0211')]),
    });
    expect(result.kind).toBe('blocked');
    if (result.kind !== 'blocked') return;
    expect(result.reason).toContain('다른 판');
  });

  it('대응표의 출처가 이 문서의 저장 기준이 아니면 거부한다', () => {
    const result = resolveSku('VID-0138', {
      savedFingerprint: 'd'.repeat(64),
      currentFingerprint: NEW,
      table: table({ entries }),
      ...catalogOf([product('VID-0211')]),
    });
    expect(result.kind).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
describe('지문을 모르면 같다고 보지 않는다', () => {
  it.each(['unknown', ''])('저장 지문이 %s 이면 같은 기준으로 치지 않는다', (saved) => {
    const result = resolveSku('VID-0138', {
      savedFingerprint: saved,
      currentFingerprint: OLD,
      ...catalogOf([product('VID-0138')]),
    });
    expect(result.kind).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
describe('신원 확인 — 대응표가 낡으면 거부한다', () => {
  it('대응을 만들 때 본 제품과 지금 그 번호의 제품이 다르면 거부한다', () => {
    const whenDecided = product('VID-0211', { quoteName: '그때 그 제품' });
    const nowThere = product('VID-0211', { quoteName: '지금은 다른 제품' });
    const result = resolveSku('VID-0138', {
      savedFingerprint: OLD,
      currentFingerprint: NEW,
      table: table({
        entries: [{
          sourceSku: 'VID-0138', status: 'mapped', targetSku: 'VID-0211',
          targetIdentity: identityOf(whenDecided), decidedBy: 'human', note: '',
        }],
      }),
      ...catalogOf([nowThere]),
    });
    expect(result.kind).toBe('blocked');
    if (result.kind !== 'blocked') return;
    expect(result.reason).toContain('확인한 제품과');
  });

  it('대응표가 가리키는 제품이 아예 없으면 거부한다', () => {
    const result = resolveSku('VID-0138', {
      savedFingerprint: OLD,
      currentFingerprint: NEW,
      table: table({
        entries: [{ sourceSku: 'VID-0138', status: 'mapped', targetSku: '없는SKU', decidedBy: 'human', note: '' }],
      }),
      ...catalogOf([]),
    });
    expect(result.kind).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
describe('"고르지 않음"과 "고를 수 없음"을 가른다', () => {
  const resolve = (status: 'undecided' | 'unmappable') =>
    resolveSku('VID-0138', {
      savedFingerprint: OLD,
      currentFingerprint: NEW,
      table: table({ entries: [{ sourceSku: 'VID-0138', status, decidedBy: 'auto', note: '' }] }),
      ...catalogOf([product('VID-0138')]),
    });

  it('고르지 않음 — 사람이 손대면 풀린다', () => {
    const result = resolve('undecided');
    expect(result.kind).toBe('blocked');
    if (result.kind !== 'blocked') return;
    expect(result.reason).toContain('아직 고르지 않았다');
  });

  it('고를 수 없음 — 옮길 제품 자체가 없다', () => {
    const result = resolve('unmappable');
    expect(result.kind).toBe('blocked');
    if (result.kind !== 'blocked') return;
    expect(result.reason).toContain('찾지 못했다');
  });

  it('⛔ 어느 쪽도 옛 SKU 로 되돌아가지 않는다', () => {
    for (const status of ['undecided', 'unmappable'] as const) {
      const result = resolve(status);
      expect(result.kind).not.toBe('substitute');
      expect(JSON.stringify(result)).not.toContain('VID-0138');
    }
  });
});

// ---------------------------------------------------------------------------
describe('대응표 초안 — 품명·규격만으로 판정하지 않는다', () => {
  it('신원 다섯 값이 전부 같으면 번호가 달라도 자동으로 잇는다', () => {
    const t = proposeSkuMigration(
      { sourceSha256: OLD, products: [product('VID-0138')] },
      { sourceSha256: NEW, products: [product('VID-0211')] },
    );
    expect(t.entries[0]).toMatchObject({
      sourceSku: 'VID-0138', status: 'mapped', targetSku: 'VID-0211', decidedBy: 'auto',
    });
    expect(t.sourceCatalogFingerprint).toBe(OLD);
    expect(t.targetCatalogFingerprint).toBe(NEW);
  });

  it('단위만 달라도 자동으로 잇지 않는다 — Bridge UHD M_OTR 의 EA/SET 사례', () => {
    const t = proposeSkuMigration(
      { sourceSha256: OLD, products: [product('VID-0138', { quoteName: 'Bridge UHD M_OTR', unit: 'EA' })] },
      { sourceSha256: NEW, products: [product('VID-0211', { quoteName: 'Bridge UHD M_OTR', unit: 'SET' })] },
    );
    expect(t.entries[0]).toMatchObject({ status: 'undecided', candidates: ['VID-0211'] });
  });

  it('설명만 달라도 자동으로 잇지 않는다 — V-160HD 의 아이패드 제외/포함 사례', () => {
    const t = proposeSkuMigration(
      { sourceSha256: OLD, products: [product('AUD-0001', { quoteName: 'V-160HD', options: { group: 'g', description: '아이패드 제외' } })] },
      { sourceSha256: NEW, products: [product('AUD-0009', { quoteName: 'V-160HD', options: { group: 'g', description: '아이패드 포함' } })] },
    );
    expect(t.entries[0]!.status).toBe('undecided');
  });

  it('신원이 같은 후보가 둘이면 자동으로 고르지 않는다', () => {
    const t = proposeSkuMigration(
      { sourceSha256: OLD, products: [product('VID-0138')] },
      { sourceSha256: NEW, products: [product('VID-0211'), product('VID-0212')] },
    );
    expect(t.entries[0]).toMatchObject({ status: 'undecided', candidates: ['VID-0211', 'VID-0212'] });
  });

  it('같은 품명이 아예 없으면 고를 수 없음이다', () => {
    const t = proposeSkuMigration(
      { sourceSha256: OLD, products: [product('VID-0138', { quoteName: '사라진 제품' })] },
      { sourceSha256: NEW, products: [product('VID-0211')] },
    );
    expect(t.entries[0]!.status).toBe('unmappable');
  });

  it('초안은 사람이 고른 것과 섞이지 않는다 — 전부 auto 로 적힌다', () => {
    const t = proposeSkuMigration(
      { sourceSha256: OLD, products: [product('VID-0138'), product('VID-0139', { quoteName: '없는 것' })] },
      { sourceSha256: NEW, products: [product('VID-0211')] },
    );
    expect(t.entries.every((e) => e.decidedBy === 'auto')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('요약 — 번호 재사용의 크기를 센다', () => {
  it('같은 번호가 다른 제품을 가리키는 수를 따로 센다', () => {
    const source = [product('VID-0001'), product('VID-0002', { quoteName: '둘째' })];
    const target = [product('VID-0001'), product('VID-0002', { quoteName: '완전히 다른 것' })];
    const t = proposeSkuMigration({ sourceSha256: OLD, products: source }, { sourceSha256: NEW, products: target });
    const summary = summarizeSkuMigration(t, { products: source }, { products: target });
    expect(summary.reusedNumberDifferentProduct).toBe(1);
    expect(summary.mapped + summary.undecided + summary.unmappable).toBe(source.length);
  });
});

describe('identityEquals', () => {
  it('다섯 값 중 하나라도 다르면 다른 제품이다', () => {
    const base = identityOf(product('X'));
    expect(identityEquals(base, { ...base })).toBe(true);
    for (const key of ['quoteName', 'quoteSpec', 'unit', 'description', 'group'] as const) {
      expect(identityEquals(base, { ...base, [key]: '달라진 값' })).toBe(false);
    }
  });
});
