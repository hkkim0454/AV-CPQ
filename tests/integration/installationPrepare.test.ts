/**
 * 배관 경고가 실제 `prepareQuote`와 맞물려 `prepared.blocking`을 정확히
 * 유지/해제하는지 본다(독립 검토 지적 — 943238e 재검토).
 *
 * `computeInstallationWarnings`가 문서에서 매번 새로 파생하므로, 여기서
 * 보는 것은 "화면이 안 보여준다"가 아니라 workspace의 `prepareNow`가
 * 실제로 하는 일(`computeActiveWarnings` + `computeInstallationWarnings`를
 * 합쳐 `prepareQuote`에 넘긴다)과 같은 경로다. CD관처럼 후보가 없는
 * 차단은 `resolveConduitProduct`의 묶음 검증으로도 우회되지 않는다는
 * 것을, 화면의 WarningList/SearchResolve가 아니라 **도메인 경계** 자체로
 * 확인한다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildQuoteDocument } from '@/domain/quote/buildDocument';
import { computeActiveWarnings } from '@/domain/quote/activeWarnings';
import {
  applyInstallationPatch,
  computeInstallationWarnings,
  resolveConduitProduct,
} from '@/domain/quote/installation';
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
import type { Catalog, CatalogProduct } from '@/data/catalog/load';
import type { QuoteDocument } from '@/domain/quote/types';

const ROOT = resolve(__dirname, '../..');
const approved = (name: string): unknown => JSON.parse(readFileSync(resolve(ROOT, 'data/approved', name), 'utf8'));
const manifest = JSON.parse(
  readFileSync(resolve(ROOT, 'templates/sanitized/guide-manifest.json'), 'utf8'),
) as GuideManifest;
const guideOf = (id: GuideId) =>
  readGuideTemplate(id, new Uint8Array(readFileSync(resolve(ROOT, `templates/sanitized/guide-${id}.xlsx`))), manifest);
const guides = Object.fromEntries(GUIDE_IDS.map((id) => [id, guideOf(id)])) as GuideTemplateSet;

function product(partial: { sku: string; group: string }): CatalogProduct {
  return {
    productId: partial.sku,
    sku: partial.sku,
    brand: '',
    model: partial.sku,
    quoteName: `합성 ${partial.sku}`,
    quoteSpec: '',
    unit: '10M',
    options: { group: partial.group },
    currency: 'KRW',
    evidence: 'review-required',
  };
}

function catalogWithFlexibleOnly(): Catalog {
  return {
    sourceSha256: 'z'.repeat(64),
    products: [product({ sku: 'FLEX-1', group: '후렉시블' })],
    prices: new Map([['FLEX-1', '31000']]),
    pricesAvailable: true,
  };
}

function emptyDocument(): QuoteDocument {
  return buildQuoteDocument({
    header: { quoteNumber: 'IP-1', quoteDate: '2026-10-04', customer: '', projectName: '', contact: '', conditions: [] },
    systems: [{ name: '시스템1', lines: [] }],
    documentId: 'doc-ip-1',
    rowIdPrefix: 'ip',
  });
}

describe('배관 경고 × prepareQuote — 문서에서 파생한 경고가 실제 blocking을 맞춘다', () => {
  const basis = buildGuideBasis({
    laborItemsRaw: approved('labor-items.json'),
    wageTableRaw: approved('wage-table.json'),
    laborMappingsRaw: approved('labor-mappings.json'),
    choice: { kind: 'guide', guide: selectGuide(guides, 'general', false) },
  });

  function prepareFor(document: QuoteDocument, catalog: Catalog, firstCall: boolean) {
    return prepareQuote({
      document,
      laborReference: basis.reference,
      basisVersions: basis.versions,
      guides,
      profileBySystem: new Map(document.systems.map((s) => [s.systemId, 'general' as const])),
      importWarnings: [...computeActiveWarnings(document, []), ...computeInstallationWarnings(document, catalog)],
      wageMode: firstCall ? 'initialize-new' : 'preserve',
    });
  }

  it('CD관을 고르면 후보가 없어 blocking이 유지된다', () => {
    const catalog = catalogWithFlexibleOnly();
    const document = applyInstallationPatch(
      emptyDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'cd' },
      catalog,
    );
    const prepared = prepareFor(document, catalog, true);
    expect(prepared.blocking).toBe(true);
    expect(prepared.importWarnings.some((w) => w.installationSystemId === 'S1')).toBe(true);
  });

  it('후렉시블 SKU로 CD관 차단을 우회하려 해도 문서가 안 바뀌어 blocking이 그대로다', () => {
    const catalog = catalogWithFlexibleOnly();
    const document = applyInstallationPatch(
      emptyDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'cd' },
      catalog,
    );
    const seeded = prepareFor(document, catalog, true).document;

    // resolveConduitProduct로 우회를 시도한다 — 묶음이 CD관이 아니므로 거부돼야 한다.
    const attempted = resolveConduitProduct(seeded, 'S1', 'FLEX-1', catalog);
    const after = prepareFor(attempted, catalog, false);

    expect(after.blocking).toBe(true);
    expect(after.importWarnings.some((w) => w.installationSystemId === 'S1')).toBe(true);
  });

  it('종류를 후렉시블로 바꾸고 올바른 SKU를 고르면 blocking이 풀린다', () => {
    const catalog = catalogWithFlexibleOnly();
    const cdDocument = applyInstallationPatch(
      emptyDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'cd' },
      catalog,
    );
    const seeded = prepareFor(cdDocument, catalog, true).document;

    const switched = applyInstallationPatch(seeded, 'S1', { conduitType: 'flexible' }, catalog);
    const resolved = resolveConduitProduct(switched, 'S1', 'FLEX-1', catalog);
    // 배관 외 다른 blocking 원인(품셈 미연결 등)을 분리하려고 명시로 둔다.
    const resolvedWithLabor: QuoteDocument = {
      ...resolved,
      rows: resolved.rows.map((r) => (r.type === 'item' && r.sku === 'FLEX-1' ? { ...r, laborMode: 'not-applicable' } : r)),
    };

    const after = prepareFor(resolvedWithLabor, catalog, false);
    expect(after.importWarnings.some((w) => w.installationSystemId === 'S1')).toBe(false);
    expect(after.blocking).toBe(false);
  });
});
