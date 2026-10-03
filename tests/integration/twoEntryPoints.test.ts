import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { diagramToQuote } from '@/import/diagram/toQuote';
import { pickedItemsToQuote } from '@/import/picker/toQuote';
import { priceQuote } from '@/domain/quote/priceQuote';
import { buildCatalog, buildLaborReference } from '@/data/catalog/load';
import { buildCustomerProjection } from '@/export/customer/projection';
import { buildQuoteWorkbook } from '@/export/ooxml/workbook';
import { TEMPLATE_PATH } from '@/export/ooxml/anchors';
import { cat, diagram, node } from '../fixtures/diagram';
import type { QuoteHeader } from '@/domain/quote/types';

/**
 * 결정 D7 보강 — 견적을 만드는 입구가 둘이다.
 *
 * ```
 * 구성도 JSON  ─┐
 *               ├──→ buildQuoteDocument ──→ priceQuote ──→ Excel
 * 품목 직접선택 ─┘
 * ```
 *
 * 이 테스트가 지키는 것: **두 입구가 같은 곳으로 모인다.**
 * 한쪽만 고쳐져 달라지면 여기서 걸린다.
 */

const ROOT = resolve(__dirname, '../..');
const OUT_DIR = resolve(ROOT, 'tests/fixtures/out');

const header = (): QuoteHeader => ({
  quoteNumber: 'T-2',
  quoteDate: '2026-10-04',
  customer: '합성 고객',
  projectName: '두 입구 검증',
  contact: '',
  conditions: [],
});

describe('품목 직접 선택 — 간단한 견적 (PC + 프로젝터)', () => {
  it('고른 품목이 견적 행이 된다', () => {
    const result = pickedItemsToQuote(
      {
        header: header(),
        systems: [
          {
            name: '소회의실',
            items: [
              { sku: 'VID-0138', quantity: '1' },
              { sku: 'TVD-0029', quantity: '2' },
            ],
          },
        ],
      },
      cat(),
    );
    const rows = result.document.rows.filter(
      (r): r is typeof r & { type: 'item' } => r.type === 'item',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      sku: 'VID-0138',
      name: 'UHD Matrix Frame',
      quantity: '1',
    });
    expect(rows[1]!.quantity).toBe('2');
  });

  it('카탈로그 단가를 붙인다', () => {
    const result = pickedItemsToQuote(
      { header: header(), systems: [{ name: 'A', items: [{ sku: 'VID-0138', quantity: '1' }] }] },
      cat(),
    );
    const row = result.document.rows[0] as { sellingUnitPrice?: string };
    expect(row.sellingUnitPrice).toBe('5300000');
  });

  it('단가 미등록은 0으로 채우지 않고 막는다 (설계서 §5.6)', () => {
    const result = pickedItemsToQuote(
      { header: header(), systems: [{ name: 'A', items: [{ sku: 'VID-0009', quantity: '1' }] }] },
      cat(),
    );
    const row = result.document.rows[0] as { sellingUnitPrice?: string };
    expect(row.sellingUnitPrice).toBeUndefined();
    expect(result.blocking).toBe(true);
    expect(result.warnings.some((w) => w.code === 'price-not-registered')).toBe(true);
  });

  it('없는 SKU를 골라도 행은 만들고 막는다 — 고른 품목이 사라지면 안 된다', () => {
    const result = pickedItemsToQuote(
      { header: header(), systems: [{ name: 'A', items: [{ sku: 'ZZZ-9999', quantity: '1' }] }] },
      cat(),
    );
    expect(result.document.rows).toHaveLength(1);
    expect(result.blocking).toBe(true);
    expect(result.warnings.some((w) => w.code === 'device-not-in-catalog')).toBe(true);
  });

  it('시스템을 여럿 만들 수 있다', () => {
    const result = pickedItemsToQuote(
      {
        header: header(),
        systems: [
          { name: '소회의실', items: [{ sku: 'VID-0138', quantity: '1' }] },
          { name: '대회의실', items: [{ sku: 'TVD-0029', quantity: '1' }] },
        ],
      },
      cat(),
    );
    expect(result.document.systems.map((s) => s.name)).toEqual(['소회의실', '대회의실']);
  });

  it('간접비 9항목이 붙는다 — 구성도 경로와 같다', () => {
    const result = pickedItemsToQuote(
      { header: header(), systems: [{ name: 'A', items: [{ sku: 'VID-0138', quantity: '1' }] }] },
      cat(),
    );
    expect(result.document.systems[0]!.indirectCosts).toHaveLength(9);
  });
});

describe('두 입구가 같은 문서 모양으로 모인다', () => {
  const picked = () =>
    pickedItemsToQuote(
      { header: header(), systems: [{ name: '회의실', items: [{ sku: 'VID-0138', quantity: '1' }] }] },
      cat(),
    ).document;

  const fromDiagram = () =>
    diagramToQuote(diagram([node('m1', '매트릭스', 'XDM-12')]), cat(), {
      header: header(),
      defaultSystemName: '회의실',
    }).document;

  it('같은 제품 하나면 행 내용이 같다 — 비고와 행 id만 다르다', () => {
    const a = picked().rows[0] as unknown as Record<string, unknown>;
    const b = fromDiagram().rows[0] as unknown as Record<string, unknown>;
    for (const key of [
      'sku',
      'productId',
      'name',
      'specification',
      'unit',
      'quantity',
      'sellingUnitPrice',
      'laborMode',
      'laborMappingId',
    ]) {
      expect(a[key], `${key}가 다르다`).toEqual(b[key]);
    }
  });

  it('행 id 접두사로 어느 입구에서 왔는지 구분된다', () => {
    expect((picked().rows[0] as { rowId: string }).rowId).toMatch(/^pk-/);
    expect((fromDiagram().rows[0] as { rowId: string }).rowId).toMatch(/^dg-/);
  });

  it('간접비·절사·갑지 구조가 같다', () => {
    const a = picked();
    const b = fromDiagram();
    expect(a.systems[0]!.indirectCosts).toEqual(b.systems[0]!.indirectCosts);
    expect(a.rounding).toEqual(b.rounding);
    expect(a.coverGroups[0]!.marker).toBe(b.coverGroups[0]!.marker);
  });

  it('두 입구 모두 품셈이 없으면 unresolved다 — not-applicable로 두지 않는다', () => {
    for (const document of [picked(), fromDiagram()]) {
      const row = document.rows[0] as { laborMode: string };
      expect(row.laborMode).not.toBe('not-applicable');
    }
  });
});

describe('priceQuote — 노무비 연결을 빼먹을 수 없다', () => {
  const laborReference = () =>
    buildLaborReference(
      JSON.parse(readFileSync(resolve(ROOT, 'data/approved/labor-items.json'), 'utf8')),
      JSON.parse(readFileSync(resolve(ROOT, 'data/approved/wage-table.json'), 'utf8')),
      JSON.parse(
        readFileSync(resolve(ROOT, 'data/approved/labor-mappings.json'), 'utf8'),
      ),
    );

  const realCatalog = () =>
    buildCatalog(
      JSON.parse(readFileSync(resolve(ROOT, 'data/approved/products.json'), 'utf8')),
      JSON.parse(readFileSync(resolve(ROOT, 'data/approved/prices.json'), 'utf8')),
    );

  it('품셈을 넘기면 노무비와 간접비가 들어간다', () => {
    const catalog = realCatalog();
    const matrix = catalog.products.find((p) => p.quoteSpec === 'XDM-12')!;
    const result = pickedItemsToQuote(
      {
        header: header(),
        systems: [{ name: '회의실', items: [{ sku: matrix.sku, quantity: '2' }] }],
      },
      catalog,
    );
    const priced = priceQuote(result.document, laborReference());
    const system = priced.calculation.systems[0]!;

    expect(system.directMaterial.isZero()).toBe(false);
    expect(system.directLabor.isZero()).toBe(false);
    // 간접비는 노무비 대비다. 노무비가 0이면 간접비도 0이 된다.
    expect(system.indirectTotal.isZero()).toBe(false);
  });

  it('품셈을 안 넘기면 막는다 — 조용히 0이 되지 않는다', () => {
    const catalog = realCatalog();
    const matrix = catalog.products.find((p) => p.quoteSpec === 'XDM-12')!;
    const result = pickedItemsToQuote(
      {
        header: header(),
        systems: [{ name: '회의실', items: [{ sku: matrix.sku, quantity: '1' }] }],
      },
      catalog,
    );
    const priced = priceQuote(result.document);
    expect(priced.blocking).toBe(true);
    expect(
      priced.calculation.warnings.some((w) => w.code === 'labor-mapping-missing'),
    ).toBe(true);
  });

  it('일위대가 근거를 행별로 돌려준다 (설계서 §5.3)', () => {
    const catalog = realCatalog();
    const matrix = catalog.products.find((p) => p.quoteSpec === 'XDM-12')!;
    const result = pickedItemsToQuote(
      {
        header: header(),
        systems: [{ name: '회의실', items: [{ sku: matrix.sku, quantity: '1' }] }],
      },
      catalog,
    );
    const priced = priceQuote(result.document, laborReference());
    const rowId = (result.document.rows[0] as { rowId: string }).rowId;
    const breakdown = priced.laborBreakdowns.get(rowId)!;
    expect(breakdown.code).not.toBe('');
    expect(breakdown.tradeAmounts.length).toBeGreaterThan(0);
    expect(breakdown.roundingMethod).toBe('INT');
  });

  it('자동 품셈 매핑은 미확인이라 확정을 막는다 (설계서 §5.3)', () => {
    const catalog = realCatalog();
    const matrix = catalog.products.find((p) => p.quoteSpec === 'XDM-12')!;
    const result = pickedItemsToQuote(
      {
        header: header(),
        systems: [{ name: '회의실', items: [{ sku: matrix.sku, quantity: '1' }] }],
      },
      catalog,
    );
    const priced = priceQuote(result.document, laborReference());
    expect(priced.blocking).toBe(true);
    expect(priced.laborWarnings.some((w) => w.code === 'mapping-unconfirmed')).toBe(true);
  });
});

describe('품목 선택 → Excel 까지', () => {
  it('PC + 프로젝터 같은 간단한 견적이 Excel로 나온다', () => {
    const catalog = buildCatalog(
      JSON.parse(readFileSync(resolve(ROOT, 'data/approved/products.json'), 'utf8')),
      JSON.parse(readFileSync(resolve(ROOT, 'data/approved/prices.json'), 'utf8')),
    );
    const labor = buildLaborReference(
      JSON.parse(readFileSync(resolve(ROOT, 'data/approved/labor-items.json'), 'utf8')),
      JSON.parse(readFileSync(resolve(ROOT, 'data/approved/wage-table.json'), 'utf8')),
      JSON.parse(
        readFileSync(resolve(ROOT, 'data/approved/labor-mappings.json'), 'utf8'),
      ),
    );

    // 단가와 품셈이 둘 다 있는 제품 3개를 고른다
    const usable = catalog.products
      .filter(
        (p) => catalog.prices.has(p.sku) && p.laborMappingId !== undefined,
      )
      .slice(0, 3);
    expect(usable.length).toBe(3);

    const result = pickedItemsToQuote(
      {
        header: { ...header(), projectName: '소회의실 AV 설치' },
        systems: [
          {
            name: '소회의실',
            items: usable.map((p, i) => ({ sku: p.sku, quantity: String(i + 1) })),
          },
        ],
      },
      catalog,
    );
    expect(result.blocking).toBe(false);

    const priced = priceQuote(result.document, labor);
    const projection = buildCustomerProjection(result.document, priced.calculation);
    const template = new Uint8Array(readFileSync(resolve(ROOT, TEMPLATE_PATH)));
    const workbook = buildQuoteWorkbook(projection, template);

    expect(workbook.sheetNames).toEqual(['갑지', '소회의실']);
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(resolve(OUT_DIR, 'picked-quote.xlsx'), workbook.bytes);
    expect(existsSync(resolve(OUT_DIR, 'picked-quote.xlsx'))).toBe(true);
  });
});
