import { describe, it, expect } from 'vitest';
import { buildProducts, sheetCode } from '@/data/catalog/buildProducts';
import type { RawSheet } from '@/data/catalog/rawTypes';

/** 계획 Task 3. 결정 D3: `products.json`과 `prices.json`을 반드시 분리한다. */

function sheet(name: string, rows: RawSheet['rows']): RawSheet {
  return { name, wages: [], rows };
}

const cctv = sheet('CCTV', [
  { row: 4, name: '[ CCTV ]' },
  { row: 5, name: '한화테크윈_CCTV' },
  { row: 6, name: 'IP카메라', spec: 'XNP-6040H', unit: 'EA', materialUnitPrice: '654000' },
  { row: 7, name: '- 벽부 브라켓', spec: 'SBP-300WM1', unit: 'EA', materialUnitPrice: '38600' },
  { row: 8, name: '광 케이블 시험/측정', spec: 'S/M', unit: 'CORE' }, // 단가 없음
]);

describe('sheetCode — 시트 이름 → SKU 접두사', () => {
  it('알려진 시트에 고정 코드를 준다', () => {
    expect(sheetCode('CCTV')).toBe('CCT');
    expect(sheetCode('케이블 및 커넥터')).toBe('CBL');
    expect(sheetCode('전원, 랙, 판넬, 몰드 및 보양')).toBe('PWR');
  });

  it('모르는 시트에도 결정적인 코드를 준다', () => {
    const a = sheetCode('새로운 분류');
    const b = sheetCode('새로운 분류');
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Z0-9]{3}$/);
  });

  it('다른 시트는 다른 코드를 받는다', () => {
    const codes = [
      '케이블 및 커넥터', '오디오', '영상', 'TV', 'Head-End, CATV', '제어',
      '전원, 랙, 판넬, 몰드 및 보양', '화상회의', '프로젝터,스크린', 'CMS',
      'CCTV', '기타 유통제품',
    ].map(sheetCode);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('buildProducts — 제품', () => {
  it('제품만 만들고 머리글은 만들지 않는다', () => {
    const { products } = buildProducts([cctv]);
    expect(products).toHaveLength(3);
    expect(products.map((p) => p.quoteName)).toEqual([
      'IP카메라',
      '- 벽부 브라켓',
      '광 케이블 시험/측정',
    ]);
  });

  it('SKU는 시트 코드 + 원본 행 번호다 — 같은 품명이 여러 번 나와도 충돌하지 않는다', () => {
    const dup = sheet('케이블 및 커넥터', [
      { row: 6, name: 'DP to HDMI 변환젠더', spec: '4K 60p 지원', unit: 'EA', materialUnitPrice: '23000' },
      { row: 7, name: 'DP to HDMI 변환젠더', spec: '4K 60p 지원', unit: 'EA', materialUnitPrice: '25000' },
      { row: 8, name: 'DP to HDMI 변환젠더', spec: '4K 60p 지원', unit: 'EA', materialUnitPrice: '27000' },
    ]);
    const { products } = buildProducts([dup]);
    expect(products.map((p) => p.sku)).toEqual(['CBL-0006', 'CBL-0007', 'CBL-0008']);
    expect(new Set(products.map((p) => p.sku)).size).toBe(3);
  });

  it('여러 시트에 같은 품명이 있어도 SKU가 다르다 (Review Focus 3)', () => {
    const a = sheet('영상', [
      { row: 10, name: 'HDMI 케이블', spec: '5m', unit: 'EA', materialUnitPrice: '30000' },
    ]);
    const b = sheet('케이블 및 커넥터', [
      { row: 10, name: 'HDMI 케이블', spec: '5m', unit: 'EA', materialUnitPrice: '28000' },
    ]);
    const { products } = buildProducts([a, b]);
    expect(products[0]!.sku).not.toBe(products[1]!.sku);
  });

  it('분류와 품목 그룹을 붙인다', () => {
    const { products } = buildProducts([cctv]);
    expect(products[0]!.options['group']).toBe('한화테크윈_CCTV');
    expect(products[0]!.options['category']).toBe('CCTV');
    expect(products[0]!.options['sheet']).toBe('CCTV');
  });

  it('브랜드를 비워 둔다 — 원본에 브랜드 열이 없다. 추측하지 않는다', () => {
    const { products } = buildProducts([cctv]);
    expect(products.every((p) => p.brand === '')).toBe(true);
  });

  it('규격을 모델명과 견적 규격 양쪽에 쓴다', () => {
    const { products } = buildProducts([cctv]);
    expect(products[0]!.model).toBe('XNP-6040H');
    expect(products[0]!.quoteSpec).toBe('XNP-6040H');
  });

  it('근거 상태를 review-required로 둔다 — 자동 추출을 확인 완료로 올리지 않는다', () => {
    const { products } = buildProducts([cctv]);
    expect(products.every((p) => p.evidence === 'review-required')).toBe(true);
  });
});

describe('buildProducts — 가격 분리 (결정 D3)', () => {
  it('제품에는 판매단가 필드가 없다', () => {
    const { products } = buildProducts([cctv]);
    for (const product of products) {
      expect(product).not.toHaveProperty('sellingUnitPrice');
      expect(JSON.stringify(product)).not.toContain('654000');
    }
  });

  it('가격은 별도 맵으로 나온다', () => {
    const { prices } = buildProducts([cctv]);
    expect(prices['CCT-0006']).toEqual({ sellingUnitPrice: '654000', currency: 'KRW' });
    expect(prices['CCT-0007']).toEqual({ sellingUnitPrice: '38600', currency: 'KRW' });
  });

  it('단가가 없는 제품은 가격 맵에 **없다** — 0을 넣지 않는다 (설계서 §5.6)', () => {
    const { prices, products } = buildProducts([cctv]);
    expect(products.some((p) => p.sku === 'CCT-0008')).toBe(true);
    expect(prices['CCT-0008']).toBeUndefined();
    expect(Object.keys(prices)).toHaveLength(2);
  });

  it('명시적인 0원은 유효한 가격으로 담는다', () => {
    const zero = sheet('CCTV', [
      { row: 6, name: '무상 제공품', unit: 'EA', materialUnitPrice: '0' },
    ]);
    const { prices } = buildProducts([zero]);
    expect(prices['CCT-0006']?.sellingUnitPrice).toBe('0');
  });

  it('파생 단가 제품은 가격 맵에 넣지 않는다', () => {
    const derived = sheet('케이블 및 커넥터', [
      {
        row: 269,
        name: '배관 기타자재',
        spec: '배관자재20%',
        unit: '식',
        materialUnitPriceFormula: '=INT(H268*20%)',
      },
    ]);
    const { products, prices } = buildProducts([derived]);
    expect(products[0]!.options['pricing']).toBe('derived');
    expect(prices['CBL-0269']).toBeUndefined();
  });
});

describe('buildProducts — 통계', () => {
  it('시트별 집계를 낸다', () => {
    const { stats } = buildProducts([cctv]);
    expect(stats.bySheet['CCTV']).toMatchObject({ products: 3, priced: 2 });
    expect(stats.totalProducts).toBe(3);
    expect(stats.totalPriced).toBe(2);
  });

  it('SKU 중복이 생기면 보고한다', () => {
    const broken = sheet('CCTV', [
      { row: 6, name: 'A', unit: 'EA' },
      { row: 6, name: 'B', unit: 'EA' },
    ]);
    const { stats } = buildProducts([broken]);
    expect(stats.duplicateSkus).toContain('CCT-0006');
  });
});
