import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  productsFileSchema,
  pricesFileSchema,
  laborItemsFileSchema,
  wageTableFileSchema,
  laborMappingsFileSchema,
} from '@/data/catalog/schema';
import { auditApprovedPayload } from '@/data/catalog/audit';
import { calculateLaborUnitPrice } from '@/domain/labor/calculateLabor';

/**
 * 배포 데이터 검증 (계획 Task 5).
 *
 * 이 테스트는 **커밋된 산출물**을 본다. 원본 xlsx가 없어도 돈다.
 * `npx vite-node tools/build-approved.ts`가 만든 결과가 계약을 지키는지 고정한다.
 */

const DIR = resolve(__dirname, '../../data/approved');
const FILES = [
  'products.json',
  'prices.json',
  'labor-items.json',
  'wage-table.json',
  'labor-mappings.json',
] as const;

function load(name: string): unknown {
  return JSON.parse(readFileSync(resolve(DIR, name), 'utf8'));
}

let raw: Record<string, unknown>;

beforeAll(() => {
  raw = Object.fromEntries(FILES.map((name) => [name, load(name)]));
});

describe('배포 데이터 — 파일 존재와 스키마', () => {
  it('다섯 파일이 모두 있다', () => {
    for (const name of FILES) {
      expect(existsSync(resolve(DIR, name)), `${name}이 있어야 한다`).toBe(true);
    }
  });

  it('products.json이 스키마를 지킨다', () => {
    expect(() => productsFileSchema.parse(raw['products.json'])).not.toThrow();
  });

  it('prices.json이 스키마를 지킨다', () => {
    expect(() => pricesFileSchema.parse(raw['prices.json'])).not.toThrow();
  });

  it('labor-items.json이 스키마를 지킨다', () => {
    expect(() => laborItemsFileSchema.parse(raw['labor-items.json'])).not.toThrow();
  });

  it('wage-table.json이 스키마를 지킨다', () => {
    expect(() => wageTableFileSchema.parse(raw['wage-table.json'])).not.toThrow();
  });

  it('labor-mappings.json이 스키마를 지킨다', () => {
    expect(() => laborMappingsFileSchema.parse(raw['labor-mappings.json'])).not.toThrow();
  });

  it('다섯 파일이 같은 원본에서 나왔다', () => {
    const hashes = new Set(
      FILES.map((n) => (raw[n] as { sourceSha256: string }).sourceSha256),
    );
    expect(hashes.size).toBe(1);
  });
});

describe('배포 데이터 — 민감정보 감사 게이트 (설계서 §8.1, 결정 D1)', () => {
  it('어떤 파일에도 매입처·경로·URL·이메일이 없다', () => {
    expect(auditApprovedPayload(raw)).toEqual([]);
  });

  it('M열(제조사/구매처)·N열(영업비고) 머리글 문구가 없다', () => {
    const text = JSON.stringify(raw);
    expect(text).not.toContain('제조사/구매처');
    expect(text).not.toContain('영업비고');
  });

  it('숨김 시트의 이름이 없다 — 추출에서 제외했다', () => {
    const text = JSON.stringify(raw);
    expect(text).not.toContain('LED전광판 계산');
    expect(text).not.toContain('단종, 미사용 제품');
  });

  it('범위 밖 간접비 시트가 섞이지 않았다', () => {
    const text = JSON.stringify(raw);
    expect(text).not.toContain('간접비_DS');
    expect(text).not.toContain('간접비_SDC');
  });
});

describe('배포 데이터 — 결정 D3 가격 분리', () => {
  it('products.json에 가격이 없다', () => {
    const products = productsFileSchema.parse(raw['products.json']).products;
    for (const product of products) {
      expect(Object.keys(product)).not.toContain('sellingUnitPrice');
    }
  });

  it('prices.json에는 SKU와 숫자만 있다 — 제품명이 없다', () => {
    const prices = pricesFileSchema.parse(raw['prices.json']);
    for (const [sku, entry] of Object.entries(prices.prices)) {
      expect(sku).toMatch(/^[A-Z0-9]{3}-\d{4}$/);
      expect(Object.keys(entry).sort()).toEqual(['currency', 'sellingUnitPrice']);
    }
  });

  it('가격의 모든 SKU가 제품에 있다 — 고아 가격이 없다', () => {
    const products = productsFileSchema.parse(raw['products.json']).products;
    const prices = pricesFileSchema.parse(raw['prices.json']);
    const known = new Set(products.map((p) => p.sku));
    for (const sku of Object.keys(prices.prices)) {
      expect(known.has(sku), `${sku}에 해당하는 제품이 없다`).toBe(true);
    }
  });

  it('prices.json을 빼도 products.json이 혼자 유효하다 (결정 D3의 전제)', () => {
    // 가격 파일 없이 제품만으로 스키마가 통과해야 "배포에서 빼기만 하면 된다"가 성립한다.
    expect(() => productsFileSchema.parse(raw['products.json'])).not.toThrow();
  });
});

describe('배포 데이터 — 불변식', () => {
  it('SKU가 유일하다', () => {
    const products = productsFileSchema.parse(raw['products.json']).products;
    expect(new Set(products.map((p) => p.sku)).size).toBe(products.length);
  });

  it('모든 제품에 단위가 있다 — 단위가 제품의 판별 기준이었다', () => {
    const products = productsFileSchema.parse(raw['products.json']).products;
    expect(products.every((p) => p.unit.trim() !== '')).toBe(true);
  });

  it('모든 제품의 근거가 review-required다 — 자동 추출을 확인 완료로 올리지 않았다', () => {
    const products = productsFileSchema.parse(raw['products.json']).products;
    expect(products.every((p) => p.evidence === 'review-required')).toBe(true);
  });

  it('브랜드를 추측하지 않았다 — 원본에 브랜드 열이 없다', () => {
    const products = productsFileSchema.parse(raw['products.json']).products;
    expect(products.every((p) => p.brand === '')).toBe(true);
    // 대신 품목 그룹을 options에 남겼다.
    expect(products.some((p) => p.options['group'] !== undefined)).toBe(true);
  });

  it('모든 매핑이 confirmed: false다 (설계서 §5.3)', () => {
    const mappings = laborMappingsFileSchema.parse(raw['labor-mappings.json']).mappings;
    expect(mappings.every((m) => m.confirmed === false)).toBe(true);
  });

  it('매핑의 SKU와 품셈 항목이 실재한다', () => {
    const products = productsFileSchema.parse(raw['products.json']).products;
    const items = laborItemsFileSchema.parse(raw['labor-items.json']).laborItems;
    const mappings = laborMappingsFileSchema.parse(raw['labor-mappings.json']).mappings;
    const skus = new Set(products.map((p) => p.sku));
    const itemIds = new Set(items.map((i) => i.laborItemId));
    for (const mapping of mappings) {
      expect(skus.has(mapping.sku), `${mapping.sku} 제품 없음`).toBe(true);
      expect(itemIds.has(mapping.laborItemId), `${mapping.laborItemId} 품셈 없음`).toBe(true);
    }
  });

  it('품셈 항목의 모든 직종이 노임표에 있다', () => {
    const items = laborItemsFileSchema.parse(raw['labor-items.json']).laborItems;
    const wages = wageTableFileSchema.parse(raw['wage-table.json']).wageTable.wages;
    for (const item of items) {
      for (const trade of item.trades) {
        expect(wages[trade.trade], `${item.code}의 직종 '${trade.trade}'`).toBeDefined();
      }
    }
  });

  it('한 품셈 항목이 M/D와 M/M을 섞지 않는다 (결정 D1 — 약 20배 오차)', () => {
    const items = laborItemsFileSchema.parse(raw['labor-items.json']).laborItems;
    const wages = wageTableFileSchema.parse(raw['wage-table.json']).wageTable.wages;
    for (const item of items) {
      const units = new Set(item.trades.map((t) => wages[t.trade]!.unit));
      expect(units.size, `${item.code}가 단위를 섞었다`).toBe(1);
      expect([...units][0]).toBe(item.wageUnit);
    }
  });

  it('노임표에 21개 직종이 있고 M/M은 CMS 전용 4개뿐이다', () => {
    const wages = wageTableFileSchema.parse(raw['wage-table.json']).wageTable.wages;
    expect(Object.keys(wages)).toHaveLength(21);
    const monthly = Object.entries(wages)
      .filter(([, w]) => w.unit === 'M/M')
      .map(([t]) => t);
    expect(monthly.sort()).toEqual(
      ['NW엔지니어', '데이터베이스 운용자', '응용 SW개발자', '임베디드 SW개발자'].sort(),
    );
  });

  it('매핑 없는 SKU도 제품에 실재한다 — 숨기지 않고 함께 배포한다', () => {
    const products = productsFileSchema.parse(raw['products.json']).products;
    const unmapped = laborMappingsFileSchema.parse(raw['labor-mappings.json']).unmappedSkus;
    const skus = new Set(products.map((p) => p.sku));
    for (const sku of unmapped) expect(skus.has(sku)).toBe(true);
  });
});

describe('배포 데이터 — 계산 엔진에 그대로 물린다', () => {
  it('실제 품셈·노임으로 노무 단가가 나온다', () => {
    const items = laborItemsFileSchema.parse(raw['labor-items.json']).laborItems;
    const mappings = laborMappingsFileSchema.parse(raw['labor-mappings.json']).mappings;
    const wageTable = wageTableFileSchema.parse(raw['wage-table.json']).wageTable;

    const byItemId = new Map(items.map((i) => [i.laborItemId, i]));
    let computed = 0;

    for (const mapping of mappings.slice(0, 200)) {
      const item = byItemId.get(mapping.laborItemId);
      if (item === undefined) continue;
      const breakdown = calculateLaborUnitPrice(item, mapping, wageTable);
      // 단위 불일치가 없어야 한다. 미확인 매핑 경고만 있어야 한다.
      expect(
        breakdown.warnings.filter((w) => w.code !== 'mapping-unconfirmed'),
        `${mapping.sku}: ${JSON.stringify(breakdown.warnings)}`,
      ).toEqual([]);
      expect(breakdown.appliedUnitPrice.isNegative()).toBe(false);
      computed += 1;
    }
    expect(computed).toBeGreaterThan(100);
  });

  it('자동 매핑이라 전부 확정이 막힌다', () => {
    const items = laborItemsFileSchema.parse(raw['labor-items.json']).laborItems;
    const mappings = laborMappingsFileSchema.parse(raw['labor-mappings.json']).mappings;
    const wageTable = wageTableFileSchema.parse(raw['wage-table.json']).wageTable;
    const byItemId = new Map(items.map((i) => [i.laborItemId, i]));

    const mapping = mappings[0]!;
    const breakdown = calculateLaborUnitPrice(
      byItemId.get(mapping.laborItemId)!,
      mapping,
      wageTable,
    );
    expect(breakdown.blocking).toBe(true);
  });
});
