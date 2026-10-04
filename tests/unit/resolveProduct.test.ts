import { describe, expect, it } from 'vitest';
import { withResolvedProduct, type ItemRow } from '@/domain/quote/resolveProduct';
import type { CatalogProduct } from '@/data/catalog/load';

function row(partial: Partial<ItemRow> = {}): ItemRow {
  return {
    type: 'item',
    rowId: 'r1',
    systemId: 'S1',
    name: '미해결',
    specification: '',
    unit: 'EA',
    quantity: '2',
    laborMode: 'unresolved',
    remark: '구성도 — 확인 필요',
    origin: 'rule',
    sourceNodeIds: ['n1'],
    ...partial,
  };
}

function product(partial: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    productId: 'PID-1',
    sku: 'SKU-1',
    brand: '',
    model: 'M-1',
    quoteName: '새 제품',
    quoteSpec: 'SPEC-1',
    unit: 'EA',
    options: {},
    currency: 'KRW',
    evidence: 'verified',
    ...partial,
  };
}

describe('withResolvedProduct', () => {
  it('rowId·systemId·수량·비고·sourceNodeIds는 그대로 둔다', () => {
    const resolved = withResolvedProduct(row(), product(), '1000');
    expect(resolved.rowId).toBe('r1');
    expect(resolved.systemId).toBe('S1');
    expect(resolved.quantity).toBe('2');
    expect(resolved.remark).toBe('구성도 — 확인 필요');
    expect(resolved.sourceNodeIds).toEqual(['n1']);
  });

  it('productId는 product.productId를 쓴다 — sku와 같다고 가정하지 않는다', () => {
    const resolved = withResolvedProduct(row(), product({ productId: 'PID-DIFFERENT', sku: 'SKU-1' }), '1000');
    expect(resolved.productId).toBe('PID-DIFFERENT');
    expect(resolved.sku).toBe('SKU-1');
  });

  it('옛 판매단가가 있던 행을 가격 없는 제품으로 재연결하면 옛 가격이 남지 않는다', () => {
    const resolvedFirst = withResolvedProduct(row(), product({ sku: 'OLD', productId: 'OLD' }), '99999');
    expect(resolvedFirst.sellingUnitPrice).toBe('99999');

    // 다시 미등록 제품으로 재연결한다 — price를 undefined로 넘긴다.
    const resolvedSecond = withResolvedProduct(resolvedFirst, product({ sku: 'NEW', productId: 'NEW' }), undefined);
    expect(resolvedSecond.sellingUnitPrice).toBeUndefined();
  });

  it('명시적 0원은 미등록과 다르게 그대로 유지한다', () => {
    const resolved = withResolvedProduct(row(), product(), '0');
    expect(resolved.sellingUnitPrice).toBe('0');
  });

  it('옛 품셈 연결이 있던 행을 매핑 없는 제품으로 재연결하면 옛 laborMappingId가 남지 않는다', () => {
    const resolvedFirst = withResolvedProduct(
      row(),
      product({ sku: 'OLD', productId: 'OLD', laborMappingId: 'LM-OLD' }),
      '1000',
    );
    expect(resolvedFirst.laborMode).toBe('mapped');
    expect(resolvedFirst.laborMappingId).toBe('LM-OLD');

    const resolvedSecond = withResolvedProduct(resolvedFirst, product({ sku: 'NEW', productId: 'NEW' }), '2000');
    expect(resolvedSecond.laborMode).toBe('unresolved');
    expect(resolvedSecond.laborMappingId).toBeUndefined();
  });

  it('사람이 이미 적은 설명은 보존하고, 비어 있을 때만 카탈로그 설명을 채운다', () => {
    const withManualDescription = row({ internalDescription: '사람이 적은 설명' });
    const resolved = withResolvedProduct(
      withManualDescription,
      product({ options: { description: '카탈로그 설명' } }),
      '1000',
    );
    expect(resolved.internalDescription).toBe('사람이 적은 설명');

    const withoutDescription = row();
    const resolved2 = withResolvedProduct(
      withoutDescription,
      product({ options: { description: '카탈로그 설명' } }),
      '1000',
    );
    expect(resolved2.internalDescription).toBe('카탈로그 설명');
  });
});
