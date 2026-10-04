/**
 * `computeActiveWarnings`가 실제 `prepareQuote`와 맞물려 "해소된 원인은
 * 빠지고, 나머지 원인은 blocking을 유지한다"는 것을 확인한다 (계획
 * 2026-10-04-quote-workspace-ui Task 2 독립 검토 지적).
 *
 * `WarningList`에서 경고가 안 보인다는 것만으로는 부족하다 — 화면이
 * 쓰는 것과 **같은 경로**(workspace의 `prepareNow`가 그대로 하는 일)로
 * `prepared.importWarnings`/`prepared.blocking`까지 실제로 바뀌는지
 * 본다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildQuoteDocument } from '@/domain/quote/buildDocument';
import { computeActiveWarnings } from '@/domain/quote/activeWarnings';
import { prepareQuote } from '@/export/variants/prepare';
import { buildGuideBasis } from '@/data/catalog/guideBasis';
import {
  GUIDE_IDS,
  readGuideTemplate,
  selectGuide,
  type GuideId,
  type GuideManifest,
  type GuideTemplateSet,
} from '@/export/ooxml/guideTemplate';
import type { ImportWarning } from '@/import/diagram/devices';
import type { QuoteDocument } from '@/domain/quote/types';

const ROOT = resolve(__dirname, '../..');
const approved = (name: string): unknown => JSON.parse(readFileSync(resolve(ROOT, 'data/approved', name), 'utf8'));
const manifest = JSON.parse(
  readFileSync(resolve(ROOT, 'templates/sanitized/guide-manifest.json'), 'utf8'),
) as GuideManifest;
const guideOf = (id: GuideId) =>
  readGuideTemplate(id, new Uint8Array(readFileSync(resolve(ROOT, `templates/sanitized/guide-${id}.xlsx`))), manifest);
const guides = Object.fromEntries(GUIDE_IDS.map((id) => [id, guideOf(id)])) as GuideTemplateSet;

function documentWithUnresolvedRow(): QuoteDocument {
  return buildQuoteDocument({
    header: {
      quoteNumber: 'AWP-1',
      quoteDate: '2026-10-04',
      customer: '',
      projectName: '',
      contact: '',
      conditions: [],
    },
    systems: [
      {
        name: '시스템1',
        lines: [{ name: '미해결 장비', specification: '', unit: 'EA', quantity: '1', sourceNodeIds: ['n1'] }],
      },
    ],
    documentId: 'doc-awp-1',
    rowIdPrefix: 'awp',
  });
}

describe('computeActiveWarnings × prepareQuote — 해소된 원인 제거, 나머지 원인 유지', () => {
  const basis = buildGuideBasis({
    laborItemsRaw: approved('labor-items.json'),
    wageTableRaw: approved('wage-table.json'),
    laborMappingsRaw: approved('labor-mappings.json'),
    choice: { kind: 'guide', guide: selectGuide(guides, 'general', false) },
  });

  function prepareFor(document: QuoteDocument, allWarnings: readonly ImportWarning[], firstCall: boolean) {
    return prepareQuote({
      document,
      laborReference: basis.reference,
      basisVersions: basis.versions,
      guides,
      profileBySystem: new Map(document.systems.map((s) => [s.systemId, 'general' as const])),
      importWarnings: computeActiveWarnings(document, allWarnings),
      wageMode: firstCall ? 'initialize-new' : 'preserve',
    });
  }

  it('해소 전에는 두 경고 다 있고 blocking이다', () => {
    const document = documentWithUnresolvedRow();
    const warnings: ImportWarning[] = [
      { code: 'device-not-in-catalog', blocking: true, message: '미해결', nodeId: 'n1' },
      { code: 'price-not-registered', blocking: true, message: '무관한 경고', nodeId: 'other' },
    ];

    const prepared = prepareFor(document, warnings, true);
    expect(prepared.importWarnings).toHaveLength(2);
    expect(prepared.blocking).toBe(true);
  });

  it('해당 행만 해소하면 그 경고는 빠지지만, 무관한 경고가 남아 blocking을 유지한다', () => {
    const document = documentWithUnresolvedRow();
    const warnings: ImportWarning[] = [
      { code: 'device-not-in-catalog', blocking: true, message: '미해결', nodeId: 'n1' },
      { code: 'price-not-registered', blocking: true, message: '무관한 경고', nodeId: 'other' },
    ];
    // 기준을 문서에 찍어 둔다(이후 호출은 'preserve'를 쓸 수 있어야 한다).
    const seeded = prepareFor(document, warnings, true).document;

    // 실제로 해소 — sku/판매단가를 채운다(workspace의 resolveDevice가
    // withResolvedProduct로 하는 일과 같은 결과).
    const resolvedDocument: QuoteDocument = {
      ...seeded,
      rows: seeded.rows.map((r) =>
        r.type === 'item' && r.sourceNodeIds?.includes('n1') ? { ...r, sku: 'X', sellingUnitPrice: '1000' } : r,
      ),
    };

    const after = prepareFor(resolvedDocument, warnings, false);

    // n1 경고는 사라졌다.
    expect(after.importWarnings.some((w) => w.nodeId === 'n1')).toBe(false);
    // 무관한 경고(other)는 그대로 남는다 — 같이 조용히 지워지지 않는다.
    expect(after.importWarnings).toHaveLength(1);
    expect(after.importWarnings[0]!.nodeId).toBe('other');
    // 남은 원인이 있으므로 blocking은 여전히 유지된다.
    expect(after.blocking).toBe(true);
  });

  it('모든 원인이 해소되면 blocking이 풀린다', () => {
    const document = documentWithUnresolvedRow();
    const onlyN1: ImportWarning[] = [{ code: 'device-not-in-catalog', blocking: true, message: '미해결', nodeId: 'n1' }];
    const seeded = prepareFor(document, onlyN1, true).document;

    const resolvedDocument: QuoteDocument = {
      ...seeded,
      rows: seeded.rows.map((r) =>
        r.type === 'item' && r.sourceNodeIds?.includes('n1')
          ? // sku/판매단가 외에 laborMode도 바꾼다 — 품셈 미해결
            // (`unresolved`)은 계산 엔진 쪽 별개의 blocking 원인이다.
            // 이 시험은 "구성도 경고"쪽 blocking만 보려는 것이므로,
            // 그 축만 따로 isolate한다(실제 resolveDevice도 품셈
            // 연결이 있는 제품이면 laborMode:'mapped'로 바꾼다 — 여기선
            // 품셈 축 자체를 시험 밖에 두려고 'not-applicable'을 쓴다).
            { ...r, sku: 'X', sellingUnitPrice: '1000', laborMode: 'not-applicable' as const }
          : r,
      ),
    };

    const after = prepareFor(resolvedDocument, onlyN1, false);
    expect(after.importWarnings).toHaveLength(0);
    expect(after.blocking).toBe(false);
  });
});
