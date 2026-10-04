import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync } from 'fflate';

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
import { buildCustomerGuideWorkbook } from '@/export/customer/guideWorkbook';
import { buildSharedProjection } from '@/export/shared/projection';
import { buildSharedGuideWorkbook } from '@/export/shared/workbook';
import {
  AI_NOTE_COLUMN,
  buildSalesGuideWorkbook,
} from '@/export/internal/guideWorkbook';
import { pickedItemsToQuote } from '@/import/picker/toQuote';
import { readTable } from '@/services/private-cost/readTable';
import { parsePrivatePrices } from '@/services/private-cost/parse';
import { createSession } from '@/services/private-cost/session';
import { internalLines } from '@/services/private-cost/calculate';
import type { OutputLevel } from '@/export/variants/fileName';

/**
 * 출력 3종 × 프로파일 2종 = **6조합**의 데이터 경계
 * (계획 2026-10-04 Task 6, 결정 D18).
 *
 * ```
 *            원가·이윤   설명   품셈   거래처   AI 메모
 * 0 영업팀      O        O      O       O        O
 * 1 공유        X        O      O       O        X
 * 2 고객        X        X      X       X        X
 * ```
 *
 * 원가는 **합성**이다. 실제 원가 파일은 사용자 PC 에만 있다 (설계서 §8.4).
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

const SENTINEL_SUPPLIER = 'SENTINEL거래처';
const SENTINEL_SALES = 'SENTINEL영업메모';
const SENTINEL_NOTE = 'SENTINEL변환메모';
const SENTINEL_COST = '7777777';

function buildVariant(profile: IndirectProfileId, level: OutputLevel) {
  const guides = allGuides();
  const catalog = buildCatalog(j('products.json'), j('prices.json'));
  const matrix = catalog.products.find((p) => p.quoteSpec === 'XDM-12')!;
  const rest = catalog.products
    .filter(
      (p) =>
        p.sku !== matrix.sku &&
        catalog.prices.has(p.sku) &&
        p.laborMappingId !== undefined,
    )
    .slice(0, 4);

  const raw = pickedItemsToQuote(
    {
      header: {
        quoteNumber: 'PV-1',
        quoteDate: '2026-10-04',
        customer: '합성 고객',
        projectName: '합성 현장',
        contact: '',
        conditions: [],
      },
      systems: [
        {
          name: '회의실',
          items: [matrix, ...rest].map((p, i) => ({
            sku: p.sku,
            quantity: String(i + 1),
          })),
        },
      ],
    },
    catalog,
  ).document;

  const document = {
    ...raw,
    rows: raw.rows.map((r) =>
      r.type === 'item' ? { ...r, internalDescription: `설명 ${r.name}` } : r,
    ),
  };

  const guide = selectGuide(guides, profile, level === 0);
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
    guides,
    profileBySystem: new Map(document.systems.map((s) => [s.systemId, profile])),
    importWarnings: [],
    wageMode: 'initialize-new',
  });

  const firstRowId = prepared.document.rows.find((r) => r.type === 'item')!.rowId;
  const notes = {
    supplierByRow: new Map([[firstRowId, SENTINEL_SUPPLIER]]),
    salesRemarkByRow: new Map([[firstRowId, SENTINEL_SALES]]),
  };
  const shared = buildSharedProjection(prepared, notes);

  if (level === 2) {
    const projection = buildCustomerProjection(
      prepared.document,
      prepared.priced.calculation,
    );
    return {
      result: buildCustomerGuideWorkbook(projection, guide),
      guide,
      firstRowId,
      shared,
    };
  }
  if (level === 1) {
    return {
      result: buildSharedGuideWorkbook({ shared, guide }),
      guide,
      firstRowId,
      shared,
    };
  }

  // 0단계 — **합성** 원가를 메모리 세션으로 붙인다.
  const items = prepared.document.rows.filter((r) => r.type === 'item');
  const csv = [
    '품명,규격,매입단가,통화,단위',
    ...items.map((_, i) => `합성${i},MODEL-${i},${SENTINEL_COST},KRW,EA`),
  ].join(String.fromCharCode(10));
  const parsed = parsePrivatePrices(readTable(strToU8(csv), 'csv'), {
    model: '규격',
    name: '품명',
    purchaseUnitPrice: '매입단가',
    currency: '통화',
    unit: '단위',
  });
  const session = createSession(parsed.entries);
  const lines = internalLines(
    items.map((row, i) => {
      const entry = session.candidatesByModel(`MODEL-${i}`)[0];
      return {
        rowId: row.rowId,
        ...(entry !== undefined ? { costEntryId: entry.entryId } : {}),
        quantity: row.quantity,
      };
    }),
    session,
  );

  const salesResult = {
    result: buildSalesGuideWorkbook({
      shared,
      extras: {
        ...notes,
        lines,
        aiNotesByRow: new Map([[firstRowId, SENTINEL_NOTE]]),
      },
      guide,
      baseGuide: selectGuide(guides, profile, false),
    }),
    guide,
    firstRowId,
    shared,
  };
  return salesResult;
}

/** 통합문서 안의 모든 XML 을 이어 붙인다. 인쇄 영역 밖도 본다. */
function allXml(bytes: Uint8Array): string {
  let out = '';
  for (const [path, part] of Object.entries(unzipSync(bytes))) {
    if (path.endsWith('.xml')) out += strFromU8(part);
  }
  return out;
}

const COMBOS: Array<[IndirectProfileId, OutputLevel]> = [
  ['general', 0],
  ['general', 1],
  ['general', 2],
  ['ds', 0],
  ['ds', 1],
  ['ds', 2],
];

describe('6조합 — 전부 만들어진다', () => {
  it.each(COMBOS)('%s 프로파일 %i단계', (profile, level) => {
    const { result } = buildVariant(profile, level);
    expect(result.bytes.byteLength).toBeGreaterThan(10_000);
    // ZIP 이 풀린다는 것일 뿐 **Excel 이 연다는 증명은 아니다.**
    // 실제 Excel 검증은 verify_in_excel.ps1 이 하고 기록은 verification.md 에 있다.
    expect(Object.keys(unzipSync(result.bytes))).toContain('xl/worksheets/sheet2.xml');
  });
});

describe('2단계 고객용 — 아무것도 남지 않는다', () => {
  it.each([['general'], ['ds']] as const)('%s', (profile) => {
    const { result } = buildVariant(profile, 2);
    const xml = allXml(result.bytes);
    for (const sentinel of [
      SENTINEL_COST,
      SENTINEL_SUPPLIER,
      SENTINEL_SALES,
      SENTINEL_NOTE,
    ]) {
      expect(xml, sentinel).not.toContain(sentinel);
    }
    expect(xml, '설명').not.toContain('설명 ');
  });

  it.each([['general'], ['ds']] as const)('%s 품셈 블록이 **지워졌다**', (profile) => {
    const { result } = buildVariant(profile, 2);
    const sheet = strFromU8(unzipSync(result.bytes)['xl/worksheets/sheet2.xml']!);

    // 비어 있는 게 아니라 **없다.** 머리글과 3행 노임이 남으면 인쇄 영역
    // 밖이라 눈에 안 보일 뿐 파일에는 있다.
    for (const header of ['제조사/구매처', '영업비고', '통신관련기사', '설   명']) {
      expect(sheet, header).not.toContain(header);
    }
    for (const wage of ['324979', '172698']) {
      expect(sheet, `노임 ${wage}`).not.toContain(wage);
    }
    for (const role of ['supplier', 'pumsemCode', 'tradeFirst']) {
      expect(() => result.layout.column(role), role).toThrow(/지워졌다/);
    }
  });
});

describe('1단계 공유용 — 설명·품셈·거래처는 있고 원가는 없다', () => {
  it.each([['general'], ['ds']] as const)('%s', (profile) => {
    const { result } = buildVariant(profile, 1);
    const xml = allXml(result.bytes);
    expect(xml).toContain(SENTINEL_SUPPLIER);
    expect(xml).toContain(SENTINEL_SALES);
    expect(xml).toContain('설명 ');
    // 원가와 AI 메모는 없다.
    expect(xml).not.toContain(SENTINEL_COST);
    expect(xml).not.toContain(SENTINEL_NOTE);
  });

  it.each([['general'], ['ds']] as const)('%s 에는 원가 열 자체가 없다', (profile) => {
    const { guide } = buildVariant(profile, 1);
    expect(guide.hasCost).toBe(false);
    expect(() => guide.columns.get('cost.unit')).not.toThrow();
    expect(guide.columns.get('cost.unit')).toBeUndefined();
    expect(guide.columns.get('profit')).toBeUndefined();
  });

  it('원가 열이 있는 템플릿을 공유용에 주면 막는다', () => {
    // 0단계 조합에서 만든 **진짜** 공유 자료를 쓰고, 템플릿만 바꿔 준다.
    const { shared } = buildVariant('general', 0);
    expect(() =>
      buildSharedGuideWorkbook({ shared, guide: allGuides()['won'] }),
    ).toThrow(/원가 열이 없는 템플릿/);
  });
});

describe('0단계 영업팀용 — 원가와 AI 메모가 여기에만', () => {
  it.each([['general'], ['ds']] as const)('%s', (profile) => {
    const { result } = buildVariant(profile, 0);
    const xml = allXml(result.bytes);
    expect(xml).toContain(SENTINEL_COST);
    expect(xml).toContain(SENTINEL_NOTE);
    expect(xml).toContain(SENTINEL_SUPPLIER);
  });

  it('AI 메모가 BF 열이고 인쇄 영역 밖이다', () => {
    const { result } = buildVariant('general', 0);
    const sheet = strFromU8(unzipSync(result.bytes)['xl/worksheets/sheet2.xml']!);
    const row = result.layout.itemRows[0]!.row;
    const cell = new RegExp(
      `<c r="${AI_NOTE_COLUMN}${row}"[^>]*>[\\s\\S]*?</c>`,
    ).exec(sheet);
    expect(cell, `${AI_NOTE_COLUMN}${row} 가 없다`).not.toBeNull();
    expect(cell![0]).toContain(SENTINEL_NOTE);

    const printLast = result.layout.printArea.split(':')[1]!.replace(/\d+$/, '');
    const index = (letter: string): number =>
      [...letter].reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
    expect(index(AI_NOTE_COLUMN)).toBeGreaterThan(index(printLast));
  });

  it('원가 금액과 이윤율이 수식이다 — 수량을 고치면 따라온다', () => {
    const { result } = buildVariant('general', 0);
    const sheet = strFromU8(unzipSync(result.bytes)['xl/worksheets/sheet2.xml']!);
    const row = result.layout.itemRows[0]!.row;
    for (const role of ['cost.amount', 'profit']) {
      const ref = `${result.layout.column(role)}${row}`;
      const cell = new RegExp(`<c r="${ref}"[^>]*>[\\s\\S]*?</c>`).exec(sheet);
      expect(cell, ref).not.toBeNull();
      expect(cell![0], ref).toMatch(/<f>/);
    }
  });

  it('원가 열이 없는 템플릿을 주면 막는다', () => {
    const guides = allGuides();
    const { result } = buildVariant('general', 2);
    void result;
    expect(() =>
      buildSalesGuideWorkbook({
        shared: {
          customer: { systems: [] },
          details: { descriptionByRow: new Map(), laborByRow: new Map() },
          notes: { supplierByRow: new Map(), salesRemarkByRow: new Map() },
          suspiciousNotes: [],
        } as never,
        extras: {
          lines: [],
          aiNotesByRow: new Map(),
          supplierByRow: new Map(),
          salesRemarkByRow: new Map(),
        },
        guide: guides['pumsem'],
        baseGuide: guides['pumsem'],
      }),
    ).toThrow(/원가 열이 있는 템플릿/);
  });
});
