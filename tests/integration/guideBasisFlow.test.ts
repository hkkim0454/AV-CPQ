import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertGuidesAgree,
  buildGuideBasis,
  GuideBasisError,
  wageContentFingerprint,
} from '@/data/catalog/guideBasis';
import {
  GUIDE_IDS,
  guideTemplateFingerprint,
  readGuideTemplate,
  type GuideId,
  type GuideManifest,
  type GuideTemplateSet,
} from '@/export/ooxml/guideTemplate';
import { prepareQuote, type WageMode } from '@/export/variants/prepare';
import { pickedItemsToQuote } from '@/import/picker/toQuote';
import { buildCatalog } from '@/data/catalog/load';
import type { QuoteDocument, QuoteHeader } from '@/domain/quote/types';

const ROOT = resolve(__dirname, '../..');
const approvedJson = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(ROOT, 'data/approved', name), 'utf8'));

const manifest = (): GuideManifest =>
  JSON.parse(
    readFileSync(resolve(ROOT, 'templates/sanitized/guide-manifest.json'), 'utf8'),
  ) as GuideManifest;

const guide = (id: GuideId) =>
  readGuideTemplate(
    id,
    new Uint8Array(readFileSync(resolve(ROOT, `templates/sanitized/guide-${id}.xlsx`))),
    manifest(),
  );

const allGuides = (): GuideTemplateSet =>
  Object.fromEntries(GUIDE_IDS.map((id) => [id, guide(id)])) as GuideTemplateSet;

const raws = () => ({
  laborItemsRaw: approvedJson('labor-items.json'),
  wageTableRaw: approvedJson('wage-table.json'),
  laborMappingsRaw: approvedJson('labor-mappings.json'),
});

const catalog = () =>
  buildCatalog(approvedJson('products.json'), approvedJson('prices.json'));

const header = (): QuoteHeader => ({
  quoteNumber: 'B-1',
  quoteDate: '2026-10-04',
  customer: '합성 고객',
  projectName: '기준 검증',
  contact: '',
  conditions: [],
});

/**
 * 단가와 품셈이 둘 다 있는 제품으로 만든 평범한 견적.
 *
 * 목록 앞쪽은 전부 1m 짜리 HDMI 케이블이고, 품이 작아 `INT()` 에서 노무비가
 * 0 으로 떨어진다. 틀린 게 아니라 1m 케이블의 설치 품이 실제로 그만큼 작은
 * 것이다. **노무비가 들어가는지 보려면 장비를 골라야 한다.**
 */
function ordinaryQuote(count = 3): QuoteDocument {
  const cat = catalog();
  const matrix = cat.products.find((p) => p.quoteSpec === 'XDM-12');
  expect(matrix, '기준 제품 XDM-12 가 카탈로그에 있어야 한다').toBeDefined();
  const rest = cat.products
    .filter(
      (p) =>
        p.sku !== matrix!.sku &&
        cat.prices.has(p.sku) &&
        p.laborMappingId !== undefined,
    )
    .slice(0, count - 1);
  const usable = [matrix!, ...rest];
  expect(usable.length).toBe(count);
  return pickedItemsToQuote(
    {
      header: header(),
      systems: [
        {
          name: '회의실',
          items: usable.map((p, i) => ({ sku: p.sku, quantity: String(i + 1) })),
        },
      ],
    },
    cat,
  ).document;
}

function prepare(document: QuoteDocument, wageMode: WageMode, strictUnknown = false) {
  const basis = buildGuideBasis({
    ...raws(),
    choice: { kind: 'guide', guide: guide('pumsem') },
  });
  return prepareQuote({
    document,
    laborReference: basis.reference,
    basisVersions: basis.versions,
    guides: allGuides(),
    profileBySystem: new Map(document.systems.map((s) => [s.systemId, 'general'])),
    importWarnings: [],
    wageMode,
    strictUnknown,
  });
}

describe('노임 내용 지문 — 파일 SHA 가 아니라 값을 본다', () => {
  it('단가를 하나 고치면 지문이 바뀐다 — sourceSha256 이 같아도', () => {
    const data = raws();
    const before = buildGuideBasis({ ...data, choice: { kind: 'approved' } });

    const tampered = JSON.parse(JSON.stringify(data.wageTableRaw)) as {
      sourceSha256: string;
      wageTable: { wages: Record<string, { amount: string; unit: string }> };
    };
    // 파일 SHA 는 그대로 두고 단가만 고친다. 사용자가 관리 화면에서
    // 노임을 직접 고치면 정확히 이 상황이 된다.
    tampered.wageTable.wages['보통인부']!.amount = '999999';
    const after = buildGuideBasis({
      ...data,
      wageTableRaw: tampered,
      choice: { kind: 'approved' },
    });

    expect(after.versions.labor).toBe(before.versions.labor);
    expect(after.versions.wage).not.toBe(before.versions.wage);
  });

  it('직종 순서가 달라도 같은 지문이다', () => {
    const table = guide('won').wages;
    const reordered = {
      ...table,
      wages: Object.fromEntries(Object.entries(table.wages).reverse()),
    };
    expect(wageContentFingerprint(reordered)).toBe(wageContentFingerprint(table));
  });

  it('네 가이드의 노임이 같은 표다', () => {
    expect(() => assertGuidesAgree(Object.values(allGuides()))).not.toThrow();
  });

  it('가이드 하나만 다른 반기로 바뀌면 막는다', () => {
    const guides = Object.values(allGuides());
    const odd = {
      ...guides[0]!,
      wages: {
        ...guides[0]!.wages,
        wages: {
          ...guides[0]!.wages.wages,
          보통인부: { amount: '1', unit: 'M/D' as const },
        },
      },
    };
    expect(() => assertGuidesAgree([odd, ...guides.slice(1)])).toThrow(/서로 다르다/);
  });
});

describe('prepareQuote — 기존 기준을 조용히 최신화하지 않는다', () => {
  it('새 문서는 initialize-new 로 열고 기준이 적힌다', () => {
    const prepared = prepare(ordinaryQuote(), 'initialize-new');
    expect(prepared.document.versions.wage).toMatch(/^WAGE-26년 하반기:/);
    expect(prepared.document.versions.labor).not.toBe('unknown');
  });

  it('기준이 적힌 문서를 initialize-new 로 열면 막는다', () => {
    const first = prepare(ordinaryQuote(), 'initialize-new');
    expect(() => prepare(first.document, 'initialize-new')).toThrow(
      /새 문서용 경로로 열 수 없다/,
    );
  });

  it('기준이 없는 문서를 preserve 로 열면 막는다 — 비었다고 채우지 않는다', () => {
    const document = ordinaryQuote();
    const old: QuoteDocument = {
      ...document,
      versions: { ...document.versions, wage: 'unknown', labor: 'unknown' },
    };
    expect(() => prepare(old, 'preserve')).toThrow(/적혀 있지 않다/);
  });

  it('기준이 다른 문서를 preserve 로 열면 막는다', () => {
    const document = ordinaryQuote();
    const other: QuoteDocument = {
      ...document,
      versions: {
        ...document.versions,
        wage: 'WAGE-26년 상반기:deadbeefdeadbeef',
        labor: 'something-else',
      },
    };
    expect(() => prepare(other, 'preserve')).toThrow(GuideBasisError);
  });

  it('같은 기준이면 preserve 가 통과한다', () => {
    const first = prepare(ordinaryQuote(), 'initialize-new');
    expect(() => prepare(first.document, 'preserve')).not.toThrow();
  });

  it('explicit-recalculate 는 기준이 달라도 바꾼다 — 사용자가 고른 것이다', () => {
    const document = ordinaryQuote();
    const other: QuoteDocument = {
      ...document,
      versions: { ...document.versions, wage: 'WAGE-26년 상반기:0000', labor: 'old' },
    };
    const prepared = prepare(other, 'explicit-recalculate');
    expect(prepared.document.versions.wage).toMatch(/^WAGE-26년 하반기:/);
  });

  it('가이드 템플릿 지문도 initialize-new 때 적힌다(독립 검토 지적: 날짜 문자열 상수가 아니라 실제 내용 지문)', () => {
    const prepared = prepare(ordinaryQuote(), 'initialize-new');
    expect(prepared.document.versions.template).not.toBe('unknown');
    expect(prepared.document.versions.template).toBe(guideTemplateFingerprint(allGuides()));
  });

  it('가이드 템플릿 지문이 저장 당시와 다르면 preserve 가 막는다', () => {
    const first = prepare(ordinaryQuote(), 'initialize-new');
    const stale: QuoteDocument = {
      ...first.document,
      versions: { ...first.document.versions, template: '예전-다른-지문' },
    };
    expect(() => prepare(stale, 'preserve')).toThrow(/가이드 템플릿 기준으로 계산됐다/);
  });

  it('explicit-recalculate 는 템플릿 지문도 지금 값으로 다시 적는다', () => {
    const first = prepare(ordinaryQuote(), 'initialize-new');
    const stale: QuoteDocument = {
      ...first.document,
      versions: { ...first.document.versions, template: '예전-다른-지문' },
    };
    const prepared = prepare(stale, 'explicit-recalculate');
    expect(prepared.document.versions.template).toBe(guideTemplateFingerprint(allGuides()));
  });

  describe('strictUnknown(재열기) — labor/wage/template 중 하나만 unknown이어도 막는다(독립 검토 지적)', () => {
    it('labor만 unknown이면(wage·template은 멀쩡) preserve가 막는다', () => {
      const first = prepare(ordinaryQuote(), 'initialize-new');
      const partiallyUnknown: QuoteDocument = {
        ...first.document,
        versions: { ...first.document.versions, labor: 'unknown' },
      };
      expect(() => prepare(partiallyUnknown, 'preserve', true)).toThrow(/기준이 적혀 있지 않다/);
    });

    it('wage만 unknown이면(labor·template은 멀쩡) preserve가 막는다', () => {
      const first = prepare(ordinaryQuote(), 'initialize-new');
      const partiallyUnknown: QuoteDocument = {
        ...first.document,
        versions: { ...first.document.versions, wage: 'unknown' },
      };
      expect(() => prepare(partiallyUnknown, 'preserve', true)).toThrow(/기준이 적혀 있지 않다/);
    });

    it('template만 unknown이면(labor·wage는 멀쩡) preserve가 막는다 — 예전엔 이 틈으로 통과했다', () => {
      const first = prepare(ordinaryQuote(), 'initialize-new');
      const partiallyUnknown: QuoteDocument = {
        ...first.document,
        versions: { ...first.document.versions, template: 'unknown' },
      };
      expect(() => prepare(partiallyUnknown, 'preserve', true)).toThrow(/기준이 적혀 있지 않다/);
    });

    it('셋 다 멀쩡하면(strictUnknown이어도) preserve가 통과한다', () => {
      const first = prepare(ordinaryQuote(), 'initialize-new');
      expect(() => prepare(first.document, 'preserve', true)).not.toThrow();
    });

    it('새 문서(initialize-new)는 strictUnknown이어도 영향 없다 — 아직 아무 기준도 없는 게 정상이다', () => {
      expect(() => prepare(ordinaryQuote(), 'initialize-new', true)).not.toThrow();
    });
  });

  it('preserve 에서는 절사 자릿수를 현재 가이드값으로 덮어쓰지 않는다(독립 검토 지적)', () => {
    const first = prepare(ordinaryQuote(), 'initialize-new');
    const withStaleRounding: QuoteDocument = {
      ...first.document,
      rounding: { coverTotalDigits: -1 },
    };
    const prepared = prepare(withStaleRounding, 'preserve');
    expect(prepared.document.rounding.coverTotalDigits).toBe(-1);
  });

  it('explicit-recalculate 에서는 절사 자릿수를 현재 가이드값으로 다시 맞춘다', () => {
    const first = prepare(ordinaryQuote(), 'initialize-new');
    const withStaleRounding: QuoteDocument = {
      ...first.document,
      rounding: { coverTotalDigits: -1 },
    };
    const prepared = prepare(withStaleRounding, 'explicit-recalculate');
    expect(prepared.document.rounding.coverTotalDigits).not.toBe(-1);
  });

  it('입력 문서를 건드리지 않는다', () => {
    const document = ordinaryQuote();
    const before = JSON.stringify(document);
    prepare(document, 'initialize-new');
    expect(JSON.stringify(document)).toBe(before);
  });
});

describe('prepareQuote — 간접비 프로파일', () => {
  it('프로파일에 맞는 간접비를 심는다', () => {
    const document = ordinaryQuote();
    const basis = buildGuideBasis({
      ...raws(),
      choice: { kind: 'guide', guide: guide('ds') },
    });
    const prepared = prepareQuote({
      document,
      laborReference: basis.reference,
      basisVersions: basis.versions,
      guides: allGuides(),
      profileBySystem: new Map([[document.systems[0]!.systemId, 'ds']]),
      importWarnings: [],
      wageMode: 'initialize-new',
    });
    expect(prepared.document.systems[0]!.indirectCosts).toHaveLength(9);
    expect(prepared.document.systems[0]!.indirectProfileId).toBe('ds');
  });

  it('같은 프로파일을 다시 계산해도 사용자가 고친 요율을 되돌리지 않는다', () => {
    const first = prepare(ordinaryQuote(), 'initialize-new');
    const edited: QuoteDocument = {
      ...first.document,
      systems: first.document.systems.map((s) => ({
        ...s,
        indirectCosts: s.indirectCosts.map((rule, index) =>
          index === 0 ? { ...rule, rate: '0.07', applied: true } : rule,
        ),
      })),
    };
    const again = prepare(edited, 'preserve');
    expect(again.document.systems[0]!.indirectCosts[0]!.rate).toBe('0.07');
  });

  it('explicit-recalculate(저장 파일 기준 재계산)도 같은 프로파일이면 사용자가 고친 요율을 되돌리지 않는다(독립 검토 지적)', () => {
    const first = prepare(ordinaryQuote(), 'initialize-new');
    const edited: QuoteDocument = {
      ...first.document,
      systems: first.document.systems.map((s) => ({
        ...s,
        indirectCosts: s.indirectCosts.map((rule, index) =>
          index === 0 ? { ...rule, rate: '0.07', applied: true } : rule,
        ),
      })),
    };
    const recalculated = prepare(edited, 'explicit-recalculate');
    expect(recalculated.document.systems[0]!.indirectCosts[0]!.rate).toBe('0.07');
  });
});

describe('prepareQuote — 가이드가 못 다루는 품셈', () => {
  /**
   * 배포 품셈 2건이 가이드에 없는 M/M 직종을 쓴다. 그 품셈이 붙은 행이 있으면
   * 계산에서 막히고 출력까지 막혀야 한다. 나머지 제품으로 만드는 평범한
   * 견적은 그대로 통과해야 한다.
   */
  const unsupportedItems = () => {
    const items = approvedJson('labor-items.json') as {
      laborItems: Array<{ laborItemId: string; trades: Array<{ trade: string }> }>;
    };
    const guideTrades = new Set(guide('pumsem').trades);
    return items.laborItems.filter((item) =>
      item.trades.some((t) => !guideTrades.has(t.trade)),
    );
  };

  it('그런 품셈이 실제로 있다 — 전제가 사라지면 이 시험이 무의미해진다', () => {
    expect(unsupportedItems().length).toBeGreaterThan(0);
  });

  it('그 품셈이 붙은 행은 계산에서 막히고 출력까지 막힌다', () => {
    const cat = catalog();
    const blockedIds = new Set(unsupportedItems().map((i) => i.laborItemId));
    const mappings = approvedJson('labor-mappings.json') as {
      mappings: Array<{ laborMappingId: string; laborItemId: string; sku: string }>;
    };
    const badMapping = mappings.mappings.find((m) => blockedIds.has(m.laborItemId));
    if (badMapping === undefined) {
      // 그 품셈을 쓰는 제품이 아직 없다. 합성으로 만들지 않는다 —
      // 없는 상황을 지어내면 무엇을 지키는 시험인지 흐려진다.
      expect(unsupportedItems().length).toBeGreaterThan(0);
      return;
    }
    const product = cat.products.find((p) => p.sku === badMapping.sku);
    expect(product, '그 매핑이 붙은 제품이 있어야 한다').toBeDefined();

    const document = pickedItemsToQuote(
      {
        header: header(),
        systems: [{ name: '회의실', items: [{ sku: product!.sku, quantity: '1' }] }],
      },
      cat,
    ).document;

    const prepared = prepare(document, 'initialize-new');
    expect(prepared.blocking, '출력이 막혀야 한다').toBe(true);
    expect(
      prepared.priced.laborWarnings.some((w) => w.code === 'wage-missing'),
      '노임 없음 경고가 서야 한다',
    ).toBe(true);
  });

  it('평범한 견적은 노임이 들어가고 간접비도 붙는다', () => {
    const prepared = prepare(ordinaryQuote(5), 'initialize-new');
    const system = prepared.priced.calculation.systems[0]!;
    expect(system.directMaterial.isZero()).toBe(false);
    expect(system.directLabor.isZero()).toBe(false);
    expect(system.indirectTotal.isZero()).toBe(false);
    expect(prepared.priced.laborWarnings.some((w) => w.code === 'wage-missing')).toBe(
      false,
    );
  });
});
