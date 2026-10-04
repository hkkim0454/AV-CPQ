import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

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
import { pickedItemsToQuote } from '@/import/picker/toQuote';

/**
 * 가이드 템플릿으로 만든 **고객용** 통합문서 (계획 2026-10-04 Task 5·6).
 *
 * 여기서 보는 것은 **파일 안의 구조**다. "Excel 이 연다"는 이 테스트가
 * 증명하지 못한다 — ZIP 이 풀린다고 Excel 이 여는 것이 아니다.
 * 실제 Excel 검증은 `tools/verify_in_excel.ps1` 이 하고 기록은
 * `docs/template/verification.md` 에 있다.
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

function build(profile: IndirectProfileId, itemCount: number) {
  const catalog = buildCatalog(j('products.json'), j('prices.json'));
  const matrix = catalog.products.find((p) => p.quoteSpec === 'XDM-12')!;
  const rest = catalog.products
    .filter(
      (p) =>
        p.sku !== matrix.sku &&
        catalog.prices.has(p.sku) &&
        p.laborMappingId !== undefined,
    )
    .slice(0, itemCount - 1);

  const document = pickedItemsToQuote(
    {
      header: {
        quoteNumber: 'GW-1',
        quoteDate: '2026-10-04',
        customer: '합성 고객 주식회사',
        projectName: '합성 현장 A동',
        contact: '담당자',
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
    prepared,
    guide,
  };
}

const detailOf = (bytes: Uint8Array): string =>
  strFromU8(unzipSync(bytes)['xl/worksheets/sheet2.xml']!);
const coverOf = (bytes: Uint8Array): string =>
  strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']!);

describe('고객용 가이드 통합문서 — 구조', () => {
  it.each([
    ['general', 25],
    ['ds', 27],
  ] as const)('%s 프로파일의 합계 행이 %i 다 (품목 9줄)', (profile, grandTotal) => {
    const { result } = build(profile, 9);
    expect(result.layout.grandTotalRow).toBe(grandTotal);
  });

  it('품목이 늘면 합계 행과 인쇄 영역이 따라간다', () => {
    const small = build('general', 9).result;
    const large = build('general', 20).result;
    expect(large.layout.grandTotalRow).toBe(small.layout.grandTotalRow + 11);
    expect(large.layout.printArea).toBe(`A1:L${large.layout.grandTotalRow}`);

    const workbook = strFromU8(unzipSync(large.bytes)['xl/workbook.xml']!);
    expect(workbook).toContain(`$L$${large.layout.grandTotalRow}`);
  });

  it('병합도 함께 밀린다 — 직접비계 글자가 한 칸에만 남지 않는다', () => {
    const { result } = build('general', 20);
    const detail = detailOf(result.bytes);
    expect(detail).toContain(`<mergeCell ref="A${result.layout.directSubtotalRow}:C`);
    expect(detail).toContain(`<mergeCell ref="A${result.layout.grandTotalRow}:C`);
  });

  it('dimension 이 실제 마지막 행을 가리킨다', () => {
    const { result } = build('general', 9);
    const detail = detailOf(result.bytes);
    expect(detail).toMatch(
      new RegExp(`<dimension ref="A1:[A-Z]+${result.layout.grandTotalRow}"/>`),
    );
  });
});

describe('고객용 가이드 통합문서 — 금액은 수식이다', () => {
  it('행 금액·직접비계·간접비·합계가 전부 수식이다', () => {
    const { result } = build('general', 9);
    const detail = detailOf(result.bytes);
    const layout = result.layout;
    const total = layout.column('total');

    // 전부 상수로 박으면 Excel 에서 수량을 고쳐도 아무것도 안 바뀐다.
    for (const ref of [
      `${layout.column('material.amount')}${layout.firstBodyRow}`,
      `${layout.column('material.amount')}${layout.directSubtotalRow}`,
      `${total}${layout.indirectSubtotalRow}`,
      `${total}${layout.grandTotalRow}`,
    ]) {
      const cell = new RegExp(`<c r="${ref}"[^>]*>.*?</c>`, 's').exec(detail);
      expect(cell, `${ref} 가 없다`).not.toBeNull();
      expect(cell![0], `${ref} 가 수식이 아니다`).toMatch(/<f>/);
    }
  });

  it('갑지가 세부내역 합계를 가리킨다', () => {
    const { result, guide } = build('general', 20);
    expect(coverOf(result.bytes)).toContain(
      `${guide.sheets.detail}!${result.layout.column('total')}${result.layout.grandTotalRow}`,
    );
  });

  it('단가는 확정된 숫자다 — 원가에서 역산되는 수식을 남기지 않는다', () => {
    const { result } = build('general', 9);
    const detail = detailOf(result.bytes);
    const ref = `${result.layout.column('material.unit')}${result.layout.firstBodyRow}`;
    const cell = new RegExp(`<c r="${ref}"[^>]*>.*?</c>`, 's').exec(detail)!;
    expect(cell[0]).toMatch(/<v>/);
    expect(cell[0]).not.toMatch(/<f>/);
  });

  it('미적용 간접비는 상수 0 이다 — 원본이 그렇다', () => {
    const { result, prepared } = build('general', 9);
    const detail = detailOf(result.bytes);
    const rules = prepared.document.systems[0]!.indirectCosts;
    const unapplied = rules.findIndex((r) => !r.applied);
    expect(unapplied).toBeGreaterThanOrEqual(0);
    const ref = `${result.layout.column('total')}${result.layout.indirectRows[unapplied]!.row}`;
    const cell = new RegExp(`<c r="${ref}"[^>]*>.*?</c>`, 's').exec(detail)!;
    expect(cell[0]).toContain('<v>0</v>');
    expect(cell[0]).not.toMatch(/<f>/);
  });
});

describe('고객용 가이드 통합문서 — 경계', () => {
  it('플레이스홀더가 남지 않는다', () => {
    const { result } = build('general', 9);
    const cover = coverOf(result.bytes);
    // 템플릿의 '건명 타이틀' 같은 글자가 그대로 나가면 고객이 본다.
    for (const placeholder of ['건명 타이틀', '세부내역 요약', '건물이름']) {
      expect(cover, placeholder).not.toContain(placeholder);
    }
    expect(cover).toContain('회의실');
  });

  it('제조사/구매처·영업비고 칸에 값이 없다', () => {
    const { result } = build('general', 9);
    const detail = detailOf(result.bytes);
    const layout = result.layout;
    for (const role of ['supplier', 'salesRemark']) {
      for (const planned of layout.itemRows) {
        const ref = `${layout.column(role)}${planned.row}`;
        const cell = new RegExp(`<c r="${ref}"[^>]*/>|<c r="${ref}"[^>]*>.*?</c>`, 's').exec(
          detail,
        );
        if (cell === null) continue;
        expect(cell[0], `${ref} 에 값이 있다`).not.toMatch(/<v>|<is>/);
      }
    }
  });

  it('품셈 블록에 값이 없다', () => {
    const { result } = build('general', 9);
    const detail = detailOf(result.bytes);
    const layout = result.layout;
    const first = layout.column('tradeFirst');
    for (const planned of layout.itemRows) {
      const ref = `${first}${planned.row}`;
      const cell = new RegExp(`<c r="${ref}"[^>]*/>|<c r="${ref}"[^>]*>.*?</c>`, 's').exec(
        detail,
      );
      if (cell === null) continue;
      expect(cell[0], `${ref} 에 품이 있다`).not.toMatch(/<v>|<is>/);
    }
  });

  it('시스템이 둘이면 아직 막는다 — 조용히 하나만 내보내지 않는다', () => {
    const catalog = buildCatalog(j('products.json'), j('prices.json'));
    const matrix = catalog.products.find((p) => p.quoteSpec === 'XDM-12')!;
    const document = pickedItemsToQuote(
      {
        header: {
          quoteNumber: 'GW-2',
          quoteDate: '2026-10-04',
          customer: 'c',
          projectName: 'p',
          contact: '',
          conditions: [],
        },
        systems: [
          { name: '회의실', items: [{ sku: matrix.sku, quantity: '1' }] },
          { name: '대회의실', items: [{ sku: matrix.sku, quantity: '1' }] },
        ],
      },
      catalog,
    ).document;
    const guide = selectGuide(allGuides(), 'general', false);
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
      profileBySystem: new Map(document.systems.map((s) => [s.systemId, 'general'])),
      importWarnings: [],
      wageMode: 'initialize-new',
    });
    const projection = buildCustomerProjection(
      prepared.document,
      prepared.priced.calculation,
    );
    expect(() => buildCustomerGuideWorkbook(projection, guide)).toThrow(/시스템 1개만/);
  });
});
