/**
 * 모델명 기준 대조 4단계가 **호출부 네 곳**과 화면 표시까지 제대로 이어지는지
 * (계획 2026-10-06 Task 4).
 *
 * 호출부는 넷이다 — 장비(`devices.ts`) · 옵션(`devices.ts`) · 케이블(`cables.ts`) ·
 * 파생품(`derived.ts`). 4단계는 `product`를 채우지 않으므로 **붙는 제품과 단가는
 * 네 곳 모두에서 달라지지 않는다.** 달라지는 것은 `matchedBy` 와 새 후보 목록뿐이고,
 * 그 둘이 어디로 흘러가는지를 여기서 고정한다.
 */
import { describe, expect, it } from 'vitest';

import { buildDeviceLines } from '@/import/diagram/devices';
import { buildCableLines } from '@/import/diagram/cables';
import { diagramToQuote } from '@/import/diagram/toQuote';
import { buildCatalog, type Catalog, type CatalogProduct } from '@/data/catalog/load';
import { catalogProduct, diagram, edge, node } from '../fixtures/diagram';
import type { QuoteHeader } from '@/domain/quote/types';

const SHA = 'a'.repeat(64);

/** 설명 칸까지 채울 수 있는 제품. */
function productWithDescription(
  sku: string,
  quoteName: string,
  quoteSpec: string,
  description: string,
): CatalogProduct {
  return { ...catalogProduct(sku, quoteName, quoteSpec), options: { description } };
}

function catalogOf(products: CatalogProduct[], prices: Record<string, string> = {}): Catalog {
  return buildCatalog(
    { schemaVersion: 1, generatedOn: '2026-10-06', sourceSha256: SHA, products },
    {
      schemaVersion: 1,
      generatedOn: '2026-10-06',
      sourceSha256: SHA,
      currency: 'KRW',
      prices: Object.fromEntries(
        Object.entries(prices).map(([sku, v]) => [sku, { sellingUnitPrice: v, currency: 'KRW' }]),
      ),
    },
  );
}

/** 실물 카탈로그 VID-0006 의 값 그대로다. 사용자가 화면에서 막힌 바로 그 제품이다. */
const BRC = () => catalogOf([catalogProduct('VID-0006', 'PTZ 카메라', '12배줌, BRC-H800')], {
  'VID-0006': '7000000',
});

const header = (): QuoteHeader => ({
  quoteNumber: 'T-1',
  quoteDate: '2026-10-06',
  customer: '합성 고객',
  projectName: '모델명 대조',
  contact: '',
  conditions: [],
});

describe('호출부 1 — 장비 (devices.ts)', () => {
  it('4단계 후보를 경고에 실어 화면이 고를 수 있게 한다', () => {
    const built = buildDeviceLines(diagram([node('n1', 'PTZ 카메라', 'BRC-H800')]), BRC());

    const warning = built.warnings.find((w) => w.nodeId === 'n1');
    expect(warning?.blocking).toBe(true);
    // 화면의 `CandidateList`가 읽는 칸이다. 비어 있으면 검색창만 뜬다.
    expect(warning?.candidates).toEqual(['VID-0006']);
    // 맞은 칸과 맞은 글자도 함께 간다 — 사람이 판단할 근거다 (계획 §6).
    expect(warning?.modelSearchCandidates?.[0]?.matches.map((m) => m.field)).toEqual([
      'model',
      'quoteSpec',
    ]);
  });

  it('제품도 단가도 붙지 않는다 — 후보를 찾아도 자동 연결하지 않는다', () => {
    const built = buildDeviceLines(diagram([node('n1', 'PTZ 카메라', 'BRC-H800')]), BRC());

    const line = built.lines[0];
    expect(line?.sku).toBeUndefined();
    expect(line?.sellingUnitPrice).toBeUndefined();
    expect(line?.matchedBy).toBe('model-search');
  });

  it('설명 칸에서만 맞은 후보는 설명 칸에서 왔다는 사실이 함께 간다 (계획 §5)', () => {
    const catalog = catalogOf([
      productWithDescription('HEC-0031', 'CATV 분배기', '2분배기', 'WJD-2DV'),
    ]);

    const built = buildDeviceLines(diagram([node('n1', '분배기', 'WJD-2DV')]), catalog);

    const warning = built.warnings.find((w) => w.nodeId === 'n1');
    expect(warning?.candidates).toEqual(['HEC-0031']);
    expect(warning?.modelSearchCandidates?.[0]?.matches.map((m) => m.field)).toEqual(['description']);
  });

  it('후보가 없으면 지금처럼 빈 채로 둔다 — 추측하지 않는다', () => {
    const built = buildDeviceLines(diagram([node('n1', '없는 것', 'ZZZ-9999')]), BRC());

    const warning = built.warnings.find((w) => w.nodeId === 'n1');
    expect(warning?.code).toBe('device-not-in-catalog');
    expect(warning?.candidates).toBeUndefined();
    expect(warning?.modelSearchCandidates).toBeUndefined();
  });
});

describe('호출부 2 — 옵션 (devices.ts)', () => {
  it('옵션 카드도 4단계 후보를 경고에 싣는다', () => {
    const catalog = catalogOf([
      catalogProduct('VID-0009', 'HD PTZ Camera', 'SRG-X40UH'),
      catalogProduct('VID-0006', 'PTZ 카메라', '12배줌, BRC-H800'),
    ]);
    const built = buildDeviceLines(
      {
        ...diagram([
          node('n1', 'PTZ 카메라', 'SRG-X40UH', { selectedOptionQuantities: { opt1: 1 } }),
        ]),
        options: [{ id: 'opt1', name: '확장 카메라', model: 'BRC-H800' }],
      } as never,
      catalog,
    );

    const warning = built.warnings.find((w) => w.optionId !== undefined);
    expect(warning?.candidates).toEqual(['VID-0006']);
  });
});

describe('호출부 3 — 케이블 (cables.ts)', () => {
  it('케이블 후보 목록을 늘리지 않는다 — D30 의 후보 120건 문제를 키우지 않는다', () => {
    const catalog = catalogOf([
      catalogProduct('VID-0009', 'HD PTZ Camera', 'SRG-X40UH'),
      productWithDescription('CBL-0001', 'HDMI 케이블', '5M', 'UTP Cable (CAT6) 전용'),
    ]);
    const built = buildCableLines(
      diagram(
        [node('n1', 'PTZ 카메라', 'SRG-X40UH'), node('n2', 'PTZ 카메라', 'SRG-X40UH')],
        [
          edge('e1', 'n1', 'n2', 'network', {
            bomRows: [
              { cableType: 'manufactured', productName: 'UTP Cable (CAT6)', length: '12', quantity: '1' },
            ],
          } as never),
        ],
      ),
      catalog,
    );

    // 설명 칸에 `UTP Cable (CAT6)`를 품은 제품이 있어도 케이블 경고의 후보로 번지지 않는다.
    for (const warning of built.warnings) {
      expect(warning.modelSearchCandidates).toBeUndefined();
    }
  });
});

describe('견적서 비고 — 4단계 결과가 "확인 필요"를 잃지 않는다', () => {
  it('후보만 있고 연결되지 않은 행의 비고는 확인이 필요하다고 적는다', () => {
    const result = diagramToQuote(diagram([node('n1', 'PTZ 카메라', 'BRC-H800')]), BRC(), {
      header: header(),
      defaultSystemName: '회의실',
    });

    const row = result.document.rows.find((r) => r.type === 'item' && r.sku === undefined);
    expect(row).toBeDefined();
    // `matchedBy`가 'none'에서 'model-search'로 바뀌었다고 해서 "카탈로그 미등록"
    // 이라는 사실이 비고에서 사라지면 안 된다.
    expect((row as { remark?: string }).remark).toContain('확인 필요');
  });
});
