import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';

import { pickedItemsToQuote } from '@/import/picker/toQuote';
import { priceQuote } from '@/domain/quote/priceQuote';
import { buildCatalog, buildLaborReference } from '@/data/catalog/load';
import { buildCustomerProjection } from '@/export/customer/projection';
import { buildQuoteWorkbook } from '@/export/ooxml/workbook';
import { TEMPLATE_PATH } from '@/export/ooxml/anchors';
import { scanCostLeak } from '../../tools/costLeakScan';

/**
 * B2 — **실물 고객용 산출물**에 유출 검사를 돌린다.
 *
 * 처음 판은 여기서 35종을 찾았고 전부 오경보였다. 그중 30종이
 * `theme1.xml` 색상값·`styles.xml` 서식 번호였다. 그래서 이 테스트는
 * **그 파일들의 숫자를 통째로 원가인 척** 넘긴다 — 가장 가혹한 조건이다.
 */

const ROOT = resolve(__dirname, '../..');
const json = (p: string): unknown =>
  JSON.parse(readFileSync(resolve(ROOT, 'data/approved', p), 'utf8'));

function customerWorkbook(): { bytes: Uint8Array; sellingValues: string[] } {
  const catalog = buildCatalog(json('products.json'), json('prices.json'));
  const labor = buildLaborReference(
    json('labor-items.json'),
    json('wage-table.json'),
    json('labor-mappings.json'),
  );
  const usable = catalog.products
    .filter((p) => catalog.prices.has(p.sku) && p.laborMappingId !== undefined)
    .slice(0, 6);

  const result = pickedItemsToQuote(
    {
      header: {
        quoteNumber: 'LEAK-1',
        // 공사명에 '원가'를 일부러 넣는다 — 단어 검사가 이걸 잡으면 안 된다.
        quoteDate: '2026-10-04',
        customer: '합성 고객',
        projectName: '원가 연결 시연',
        contact: '',
        conditions: [],
      },
      systems: [
        {
          name: '회의실',
          items: usable.map((p, i) => ({ sku: p.sku, quantity: String(i + 1) })),
        },
      ],
    },
    catalog,
  );
  const priced = priceQuote(result.document, labor);
  const projection = buildCustomerProjection(result.document, priced.calculation);
  const template = new Uint8Array(readFileSync(resolve(ROOT, TEMPLATE_PATH)));
  const workbook = buildQuoteWorkbook(projection, template);

  return {
    bytes: workbook.bytes,
    sellingValues: usable.map((p) => catalog.prices.get(p.sku)!),
  };
}

/** 생성물의 모든 셀 숫자. 정당하게 들어 있는 값의 상한이다. */
function allCellNumbers(bytes: Uint8Array): string[] {
  const files = unzipSync(bytes);
  const out: string[] = [];
  for (const [part, raw] of Object.entries(files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(part)) continue;
    const xml = strFromU8(raw);
    for (const m of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      if (/ t="/.test(m[1] ?? '')) continue;
      const v = /<v>([\s\S]*?)<\/v>/.exec(m[2] ?? '')?.[1];
      if (v !== undefined && /^-?\d+(\.\d+)?$/.test(v)) out.push(v);
    }
  }
  return out;
}

/** theme·styles 안의 숫자 전부. 처음 판에서 오경보 30종이 나온 자리다. */
function themeAndStyleNumbers(bytes: Uint8Array): string[] {
  const files = unzipSync(bytes);
  const out = new Set<string>();
  for (const [part, raw] of Object.entries(files)) {
    if (!/theme|styles/.test(part)) continue;
    for (const m of strFromU8(raw).matchAll(/\d{4,}/g)) out.add(m[0]);
  }
  return [...out];
}

describe('실물 고객용 산출물 유출 검사 (B2)', () => {
  it('theme·styles 숫자를 원가로 넘겨도 아무것도 나오지 않는다', () => {
    const { bytes } = customerWorkbook();
    const noise = themeAndStyleNumbers(bytes);
    expect(noise.length).toBeGreaterThan(0); // 검사가 실제로 뭔가를 밟는다
    const found = scanCostLeak(bytes, {
      costValues: noise,
      allowedValues: allCellNumbers(bytes),
    });
    expect(found).toEqual([]);
  });

  it('원가와 판매가가 같아도 나오지 않는다 — 마진 0 제품이다', () => {
    const { bytes, sellingValues } = customerWorkbook();
    const found = scanCostLeak(bytes, {
      costValues: sellingValues,
      allowedValues: allCellNumbers(bytes),
    });
    expect(found).toEqual([]);
  });

  it("공사명에 '원가'가 들어가도 나오지 않는다", () => {
    const { bytes } = customerWorkbook();
    const found = scanCostLeak(bytes, { costValues: [], allowedValues: [] });
    expect(found).toEqual([]);
  });

  it('진짜 원가가 셀에 들어가면 잡는다 — 검사가 죽어 있지 않다', () => {
    const { bytes } = customerWorkbook();
    const cells = allCellNumbers(bytes);
    expect(cells.length).toBeGreaterThan(0);
    // 정당한 값 목록에서 하나를 빼면 그 값은 '원가'가 된다.
    const planted = cells[0]!;
    const found = scanCostLeak(bytes, {
      costValues: [planted],
      allowedValues: cells.filter((v) => v !== planted),
    });
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]!.kind).toBe('cost-value');
    expect(found[0]!.ref).toMatch(/^[A-Z]+\d+$/);
  });
});
