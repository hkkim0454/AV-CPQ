import { describe, expect, it } from 'vitest';
import type { CatalogProduct } from '@/data/catalog/load';
import { proposeSkuMigration } from '@/data/catalog/skuMigration';
import {
  classifyReviewReason,
  rankReviewCandidates,
  similarNameCandidates,
  renderPumsemReview,
} from '../../tools/probe_pumsem_review';

function product(sku: string, name: string, group: string, over: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    productId: sku, sku, brand: '', model: '', quoteName: name, quoteSpec: 'MODEL-1',
    unit: 'EA', options: { group }, currency: 'KRW', evidence: 'review-required', ...over,
  } as CatalogProduct;
}

describe('사람이 고르는 품셈 대응 검토 문서', () => {
  it('자동 보류 이유를 후보별 차이로 분류한다', () => {
    const old = product('OLD', '영상 장치', '옛 묶음');
    expect(classifyReviewReason(old, [product('NEW', '영상 장치', '새 묶음')])).toBe('묶음 이름만 다름');
    expect(classifyReviewReason(old, [
      product('NEW-1', '영상 장치', '새 묶음 1'),
      product('NEW-2', '영상 장치', '새 묶음 2'),
    ])).toBe('묶음 이름만 다름');
    expect(classifyReviewReason(old, [product('NEW', '영상 장치', '옛 묶음', { unit: 'SET' })]))
      .toBe('단위만 다름');
    expect(classifyReviewReason(old, [
      product('NEW-1', '영상 장치', '옛 묶음'),
      product('NEW-2', '영상 장치', '옛 묶음'),
    ])).toBe('신원이 같은 후보 여러 개');
    expect(classifyReviewReason(old, [
      product('NEW-1', '영상 장치', '새 묶음'),
      product('NEW-2', '영상 장치', '옛 묶음', { unit: 'SET' }),
    ])).toBe('후보마다 다른 항목이 다름');
  });

  it('후보가 없을 때 비슷한 이름만 참고로 고르고 무관한 이름은 빼낸다', () => {
    const old = product('OLD', 'Bridge UHD Matrix', '옛 묶음', { quoteSpec: 'BRIDGE-123' });
    const result = similarNameCandidates(old, [
      product('SIMILAR', 'Bridge UHD Matrix 2', '새 묶음', { quoteSpec: 'BRIDGE-123' }),
      product('OTHER', '천장 스피커', '새 묶음', { quoteSpec: 'SPEAKER-9' }),
    ]);
    expect(result.map((p) => p.sku)).toEqual(['SIMILAR']);
  });

  it('후보를 모두 유지하면서 규격·단위 차이가 작은 순서로 보여 준다', () => {
    const old = product('OLD', 'UHD Matrix Frame', '옛 묶음', { quoteSpec: 'XDM-12' });
    const far = product('FAR', 'UHD Matrix Frame', '새 묶음', { quoteSpec: 'XDM-36' });
    const close = product('CLOSE', 'UHD Matrix Frame', '새 묶음', { quoteSpec: 'XDM-12' });
    expect(rankReviewCandidates(old, [far, close]).map((p) => p.sku)).toEqual(['CLOSE', 'FAR']);
  });

  it('품명이 달라도 규격이 완전히 같은 참고 제품을 이름 유사 후보보다 먼저 보여 준다', () => {
    const old = product('OLD', '2채널 HD Video Switcher', '옛 묶음', { quoteSpec: 'V-02HD MKⅡ' });
    const result = similarNameCandidates(old, [
      product('NAME-1', '5채널 HD Video Switcher', '새 묶음', { quoteSpec: 'VS5' }),
      product('NAME-2', '10채널 HD Video Switcher', '새 묶음', { quoteSpec: 'VS10' }),
      product('NAME-3', 'HD Video Switcher', '새 묶음', { quoteSpec: 'V-02HD' }),
      product('SPEC', '전환 장치', '새 묶음', { quoteSpec: 'V-02HD MKⅡ' }),
    ]);
    expect(result.map((p) => p.sku)).toEqual(['SPEC', 'NAME-1', 'NAME-2']);
  });

  it('허용한 공개 필드만 보여 주고 0원과 미등록을 구분한다', () => {
    const old = {
      sourceSha256: 'a'.repeat(64),
      products: [
        product('OLD-1', '영상 장치', '옛 묶음', {
          options: { group: '옛 묶음', supplier: 'SENTINEL_PRIVATE_SUPPLIER', cost: 'SENTINEL_PRIVATE_COST' },
        }),
        product('OLD-2', 'Bridge UHD Matrix', '없어진 묶음', { quoteSpec: 'BRIDGE-123' }),
        product('CBL-1', '케이블', '케이블 묶음'),
        product('CBL-2', '케이블', '케이블 묶음'),
      ],
      prices: new Map([['OLD-1', '100'], ['CBL-1', '10'], ['CBL-2', '20']]),
    };
    const next = {
      sourceSha256: 'b'.repeat(64),
      products: [
        product('NEW-1', '영상 장치', '새 묶음'),
        product('NEW-2', 'Bridge UHD Matrix 2', '새 묶음', { quoteSpec: 'BRIDGE-123' }),
        product('CBL-9', '케이블', '케이블 묶음'),
      ],
      prices: new Map([['NEW-1', '0'], ['NEW-2', '200'], ['CBL-9', '30']]),
    };
    const table = proposeSkuMigration(old, next);
    const markdown = renderPumsemReview(old, next, table, new Set(['OLD-1']), new Set(['NEW-1']));

    expect(markdown).toContain('묶음 이름만 다름');
    expect(markdown).toContain('OLD-1');
    expect(markdown).toContain('NEW-1');
    expect(markdown).toContain('100원');
    expect(markdown).toContain('0원');
    expect(markdown).toContain('미등록');
    expect(markdown).toContain('Bridge UHD Matrix 2');
    expect(markdown).toContain('참고 이유: 규격 동일');
    expect(markdown).toContain('CBL-1');
    expect(markdown).toContain('CBL-2');
    expect(markdown).toContain('CBL-9');
    expect(markdown).not.toContain('SENTINEL_PRIVATE_SUPPLIER');
    expect(markdown).not.toContain('SENTINEL_PRIVATE_COST');
  });

  it('후보 번호가 자료에 없으면 조용히 빠뜨리지 않고 문서 생성을 멈춘다', () => {
    const old = { sourceSha256: 'a'.repeat(64), products: [product('OLD', '영상 장치', '옛 묶음')], prices: new Map() };
    const next = { sourceSha256: 'b'.repeat(64), products: [product('NEW', '영상 장치', '새 묶음')], prices: new Map() };
    const proposed = proposeSkuMigration(old, next);
    const table = {
      ...proposed,
      entries: [{ ...proposed.entries[0]!, status: 'undecided' as const, candidates: ['NEW', 'MISSING'] }],
    };
    expect(() => renderPumsemReview(old, next, table, new Set(), new Set()))
      .toThrow('후보 SKU MISSING');
  });
});
