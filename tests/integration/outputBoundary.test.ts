import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildGuideBasis } from '@/data/catalog/guideBasis';
import {
  GUIDE_IDS,
  readGuideTemplate,
  type GuideId,
  type GuideManifest,
  type GuideTemplateSet,
} from '@/export/ooxml/guideTemplate';
import { prepareQuote, type PreparedQuote } from '@/export/variants/prepare';
import { buildSharedProjection, type SharedNotes } from '@/export/shared/projection';
import { buildCustomerProjection } from '@/export/customer/projection';
import { pickedItemsToQuote } from '@/import/picker/toQuote';
import { buildCatalog } from '@/data/catalog/load';
import type { QuoteDocument } from '@/domain/quote/types';

/**
 * 출력 3종의 데이터 경계 (계획 2026-10-04 Task 4, 결정 D18).
 *
 * ```
 *            원가·이윤   설명   품셈   거래처·영업비고   AI 메모
 * 0 영업팀      O        O      O          O            O
 * 1 공유        X        O      O          O            X
 * 2 고객        X        X      X          X            X
 * ```
 *
 * 여기 값은 전부 **합성**이다. 실제 원가는 사용자 PC 에만 있다 (설계서 §8.4).
 */

const ROOT = resolve(__dirname, '../..');
const j = (name: string): unknown =>
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

const SENTINEL_SUPPLIER = 'SENTINEL_매입처_주식회사';
const SENTINEL_SALES = 'SENTINEL_영업메모';
const SENTINEL_DESCRIPTION = 'SENTINEL_제품설명';

function prepared(): PreparedQuote {
  const cat = buildCatalog(j('products.json'), j('prices.json'));
  const matrix = cat.products.find((p) => p.quoteSpec === 'XDM-12')!;
  const document = pickedItemsToQuote(
    {
      header: {
        quoteNumber: 'BD-1',
        quoteDate: '2026-10-04',
        customer: '합성 고객',
        projectName: '경계 검증',
        contact: '',
        conditions: [],
      },
      systems: [{ name: '회의실', items: [{ sku: matrix.sku, quantity: '2' }] }],
    },
    cat,
  ).document;

  // 설명 칸을 심는다 — 2단계에서 사라져야 한다.
  const withDescription: QuoteDocument = {
    ...document,
    rows: document.rows.map((row) =>
      row.type === 'item'
        ? { ...row, internalDescription: SENTINEL_DESCRIPTION }
        : row,
    ),
  };

  const basis = buildGuideBasis({
    laborItemsRaw: j('labor-items.json'),
    wageTableRaw: j('wage-table.json'),
    laborMappingsRaw: j('labor-mappings.json'),
    choice: { kind: 'guide', guide: guide('pumsem') },
  });

  return prepareQuote({
    document: withDescription,
    laborReference: basis.reference,
    basisVersions: basis.versions,
    guides: allGuides(),
    profileBySystem: new Map(withDescription.systems.map((s) => [s.systemId, 'general'])),
    importWarnings: [],
    wageMode: 'initialize-new',
  });
}

const notes = (rowId: string): SharedNotes => ({
  supplierByRow: new Map([[rowId, SENTINEL_SUPPLIER]]),
  salesRemarkByRow: new Map([[rowId, SENTINEL_SALES]]),
});

const firstItemRowId = (p: PreparedQuote): string =>
  p.document.rows.find((r) => r.type === 'item')!.rowId;

describe('2단계 고객용 — 설명·거래처·품셈이 없다', () => {
  it('설명이 들어가지 않는다', () => {
    const p = prepared();
    const customer = buildCustomerProjection(p.document, p.priced.calculation);
    expect(JSON.stringify(customer)).not.toContain(SENTINEL_DESCRIPTION);
  });

  it('거래처·영업비고가 들어가지 않는다 — 열 자체를 만들지 않는다', () => {
    const p = prepared();
    const customer = buildCustomerProjection(p.document, p.priced.calculation);
    const text = JSON.stringify(customer);
    expect(text).not.toContain(SENTINEL_SUPPLIER);
    expect(text).not.toContain(SENTINEL_SALES);
  });

  it('SKU·품셈 연결 id 가 들어가지 않는다', () => {
    const p = prepared();
    const customer = buildCustomerProjection(p.document, p.priced.calculation);
    const row = customer.systems[0]!.rows.find((r) => r.type === 'item')!;
    expect(row).not.toHaveProperty('sku');
    expect(row).not.toHaveProperty('laborMappingId');
    expect(row).not.toHaveProperty('internalDescription');
  });

  it('계산 기준 버전이 들어가지 않는다 — 내부 기록이다', () => {
    const p = prepared();
    const customer = buildCustomerProjection(p.document, p.priced.calculation);
    expect(customer).not.toHaveProperty('versions');
  });
});

describe('1단계 공유용 — 설명·품셈·거래처는 있고 원가는 없다', () => {
  it('고객용을 그대로 품고 설명을 더한다', () => {
    const p = prepared();
    const rowId = firstItemRowId(p);
    const shared = buildSharedProjection(p, notes(rowId));
    expect(shared.details.descriptionByRow.get(rowId)).toBe(SENTINEL_DESCRIPTION);
    expect(shared.customer.header.projectName).toBe('경계 검증');
  });

  it('품셈 근거를 계산 결과에서 가져온다 — 지어내지 않는다', () => {
    const p = prepared();
    const shared = buildSharedProjection(p, notes(firstItemRowId(p)));
    expect(shared.details.laborByRow.size).toBe(p.priced.laborBreakdowns.size);
    const breakdown = shared.details.laborByRow.get(firstItemRowId(p));
    expect(breakdown?.tradeAmounts.length).toBeGreaterThan(0);
  });

  it('거래처와 영업비고가 남는다 — 사용자 결정', () => {
    const p = prepared();
    const rowId = firstItemRowId(p);
    const shared = buildSharedProjection(p, notes(rowId));
    expect(shared.notes.supplierByRow.get(rowId)).toBe(SENTINEL_SUPPLIER);
    expect(shared.notes.salesRemarkByRow.get(rowId)).toBe(SENTINEL_SALES);
  });

  it('원가·이윤 필드가 아예 없다', () => {
    const p = prepared();
    const shared = buildSharedProjection(p, notes(firstItemRowId(p)));
    const text = JSON.stringify(shared, (_k, v) =>
      v instanceof Map ? Object.fromEntries(v) : v,
    );
    for (const word of ['purchaseUnitPrice', 'markupRate', 'marginRate', 'profitAmount']) {
      expect(text, word).not.toContain(word);
    }
  });

  it('허용되지 않은 필드를 넣어도 직렬화되지 않는다', () => {
    const p = prepared();
    const rowId = firstItemRowId(p);
    const dirty = {
      supplierByRow: new Map([[rowId, SENTINEL_SUPPLIER]]),
      salesRemarkByRow: new Map([[rowId, SENTINEL_SALES]]),
      // 런타임에 몰래 끼워 넣은 원가. 허용목록 복사라 통과하지 못한다.
      purchaseByRow: new Map([[rowId, '7777777']]),
    } as unknown as SharedNotes;
    const shared = buildSharedProjection(p, dirty);
    const text = JSON.stringify(shared, (_k, v) =>
      v instanceof Map ? Object.fromEntries(v) : v,
    );
    expect(text).not.toContain('7777777');
    expect(shared.notes).not.toHaveProperty('purchaseByRow');
  });
});

describe('자유 텍스트 — 구조로 못 막는 것은 알리기만 한다', () => {
  it('비고에 원가 냄새가 나면 알린다', () => {
    const p = prepared();
    const rowId = firstItemRowId(p);
    const shared = buildSharedProjection(p, {
      supplierByRow: new Map(),
      salesRemarkByRow: new Map([[rowId, '마진 40% 적용함']]),
    });
    expect(shared.suspiciousNotes).toHaveLength(1);
    expect(shared.suspiciousNotes[0]).toMatchObject({
      rowId,
      field: 'salesRemark',
      word: '마진',
    });
  });

  it('경고에 금액을 담지 않는다 (설계서 §8.4)', () => {
    const p = prepared();
    const rowId = firstItemRowId(p);
    const shared = buildSharedProjection(p, {
      supplierByRow: new Map(),
      salesRemarkByRow: new Map([[rowId, '매입 1,234,567원']]),
    });
    expect(JSON.stringify(shared.suspiciousNotes)).not.toContain('1,234,567');
  });

  it("'원가' 라는 낱말은 잡지 않는다 — 공사명에 들어간다", () => {
    const p = prepared();
    const rowId = firstItemRowId(p);
    const shared = buildSharedProjection(p, {
      supplierByRow: new Map(),
      salesRemarkByRow: new Map([[rowId, '원가 연결 시연']]),
    });
    expect(shared.suspiciousNotes).toEqual([]);
  });

  it('깨끗하면 비어 있다 — 다만 이것이 안전 보증은 아니다', () => {
    const p = prepared();
    const rowId = firstItemRowId(p);
    const shared = buildSharedProjection(p, {
      supplierByRow: new Map([[rowId, '세운상사']]),
      salesRemarkByRow: new Map([[rowId, '납기 3주']]),
    });
    expect(shared.suspiciousNotes).toEqual([]);
  });

  it('거래처 이름에 매입이 들어가도 알린다 — 열 이름이 아니라 내용을 본다', () => {
    const p = prepared();
    const rowId = firstItemRowId(p);
    // 시험용 sentinel 자체가 '매입'을 담고 있다. 실제로 걸리는 것이 맞다.
    const shared = buildSharedProjection(p, notes(rowId));
    expect(shared.suspiciousNotes.map((n) => n.field)).toContain('supplier');
  });
});
