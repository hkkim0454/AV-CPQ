import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildGuideBasis } from '@/data/catalog/guideBasis';
import { buildCatalog } from '@/data/catalog/load';
import {
  GUIDE_IDS,
  readGuideTemplate,
  selectGuide,
  type GuideId,
  type GuideManifest,
  type GuideTemplateSet,
  type IndirectProfileId,
} from '@/export/ooxml/guideTemplate';
import { prepareQuote } from '@/export/variants/prepare';
import { buildCustomerProjection } from '@/export/customer/projection';
import {
  buildCustomerGuideWorkbook,
  type GuideWorkbookResult,
} from '@/export/customer/guideWorkbook';
import { pickedItemsToQuote } from '@/import/picker/toQuote';
import { strFromU8, unzipSync } from 'fflate';
import { scanCostLeak } from '../../tools/costLeakScan';

/**
 * 실물 고객용 산출물에 원가가 섞였는지 (계획 2026-10-04 B2, Task 6).
 *
 * ## 값이 아니라 칸으로 가린다
 *
 * 처음 판은 "정당하게 들어갈 수 있는 값"이면 어디에 있든 봐주었다.
 * 독립 검토에서 **같은 숫자를 판매 칸과 금지 칸에 둘 다 넣으면 둘 다
 * 통과**하는 것이 재현됐다. 이제 어느 칸이 판매측인지를 받는다.
 *
 * 원가는 **합성**이다. 실제 원가 파일은 쓰지 않는다 (설계서 §8.4).
 */

const ROOT = resolve(__dirname, '../..');
const j = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(ROOT, 'data/approved', name), 'utf8'));

const manifest = (): GuideManifest =>
  JSON.parse(
    readFileSync(resolve(ROOT, 'templates/sanitized/guide-manifest.json'), 'utf8'),
  ) as GuideManifest;

const guideOf = (id: GuideId) =>
  readGuideTemplate(
    id,
    new Uint8Array(readFileSync(resolve(ROOT, `templates/sanitized/guide-${id}.xlsx`))),
    manifest(),
  );

const allGuides = (): GuideTemplateSet =>
  Object.fromEntries(GUIDE_IDS.map((id) => [id, guideOf(id)])) as GuideTemplateSet;

function build(profile: IndirectProfileId): {
  result: GuideWorkbookResult;
  sellingValues: string[];
} {
  const catalog = buildCatalog(j('products.json'), j('prices.json'));
  const matrix = catalog.products.find((p) => p.quoteSpec === 'XDM-12')!;
  const rest = catalog.products
    .filter(
      (p) =>
        p.sku !== matrix.sku &&
        catalog.prices.has(p.sku) &&
        p.laborMappingId !== undefined,
    )
    .slice(0, 5);
  const picked = [matrix, ...rest];

  const document = pickedItemsToQuote(
    {
      header: {
        quoteNumber: 'CL-1',
        quoteDate: '2026-10-04',
        customer: '합성 고객',
        // 공사명에 '원가'를 일부러 넣는다 — 단어 검사가 이걸 잡으면 안 된다.
        projectName: '원가 연결 시연',
        contact: '',
        conditions: [],
      },
      systems: [
        {
          name: '회의실',
          items: picked.map((p, i) => ({ sku: p.sku, quantity: String(i + 1) })),
        },
      ],
    },
    catalog,
  ).document;

  const guide = selectGuide(allGuides(), profile, false);
  const basis = buildGuideBasis({
    laborItemsRaw: j('labor-items.json'),
    wageTableRaw: j('wage-table.json'),
    laborMappingsRaw: j('labor-mappings.json'),
    choice: { kind: 'guide', guide },
  });
  const prepared = prepareQuote({
    document,
    laborReference: basis.reference,
    basisVersions: basis.versions,
    guides: allGuides(),
    profileBySystem: new Map(document.systems.map((s) => [s.systemId, profile])),
    importWarnings: [],
    wageMode: 'initialize-new',
  });
  const projection = buildCustomerProjection(
    prepared.document,
    prepared.priced.calculation,
  );
  return {
    result: buildCustomerGuideWorkbook(projection, guide),
    sellingValues: picked.map((p) => catalog.prices.get(p.sku)!),
  };
}

/**
 * **판매측 숫자가 정당하게 들어가는 칸.**
 *
 * 손으로 다시 적지 않는다 — 생성기가 **자기가 쓴 칸**을 알려준다.
 * 손으로 적으면 빠뜨린 칸이 유출로 잡히고, 그걸 맞추다 보면 결국
 * "값으로 봐주기"로 되돌아간다.
 */
function sellingCells(result: GuideWorkbookResult): ReadonlySet<string> {
  return result.writtenCells;
}

/** theme·styles 안의 숫자. 처음 판에서 오경보 30종이 나온 자리다. */
function noiseValues(result: GuideWorkbookResult): string[] {
  const out = new Set<string>();
  for (const [part, bytes] of Object.entries(unzipSync(result.bytes))) {
    if (!/theme|styles/.test(part)) continue;
    for (const m of strFromU8(bytes).matchAll(/\d{4,}/g)) out.add(m[0]);
  }
  return [...out];
}

describe('실물 고객용 산출물 — 칸 출처로 가린다', () => {
  it.each([['general'], ['ds']] as const)(
    '%s: theme·styles 숫자를 원가로 넘겨도 아무것도 안 나온다',
    (profile) => {
      const { result } = build(profile);
      const noise = noiseValues(result);
      expect(noise.length).toBeGreaterThan(0);
      expect(
        scanCostLeak(result.bytes, {
          costValues: noise,
          allowedCells: sellingCells(result),
        }),
      ).toEqual([]);
    },
  );

  it.each([['general'], ['ds']] as const)(
    '%s: 원가가 판매가와 같아도 판매 칸이면 통과한다',
    (profile) => {
      const { result, sellingValues } = build(profile);
      expect(
        scanCostLeak(result.bytes, {
          costValues: sellingValues,
          allowedCells: sellingCells(result),
        }),
      ).toEqual([]);
    },
  );

  it("공사명에 '원가'가 들어가도 안 나온다", () => {
    const { result } = build('general');
    const found = scanCostLeak(result.bytes, {
      costValues: [],
      allowedCells: sellingCells(result),
    });
    expect(found).toEqual([]);
  });

  it('판매 칸 목록을 비우면 같은 값이 전부 걸린다 — 검사가 죽어 있지 않다', () => {
    const { result, sellingValues } = build('general');
    const found = scanCostLeak(result.bytes, {
      costValues: sellingValues,
      allowedCells: new Set<string>(),
    });
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]!.kind).toBe('cost-value');
  });

  it('고객용에 있으면 안 되는 파트가 없다', () => {
    const { result } = build('general');
    const found = scanCostLeak(result.bytes, {
      costValues: [],
      allowedCells: new Set<string>(),
    });
    expect(found.filter((f) => f.kind === 'forbidden-part')).toEqual([]);
  });
});
