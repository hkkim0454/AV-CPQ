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
import { pickedItemsToQuote } from '@/import/picker/toQuote';
import { buildCatalog } from '@/data/catalog/load';
import {
  buildCustomerDownload,
  buildSharedDownload,
  assertExportAllowed,
  ExportBlockedError,
} from '@/export/variants/download';
import { buildSalesDownload } from '@/export/internal/salesExportAction';
import type { SharedNotes } from '@/export/shared/projection';

/**
 * 공통 출력 경계 — blocking인 prepared는 등급과 무관하게 전부 거부한다
 * (2026-10-05 독립 검토 지적: `buildCustomerDownload`/`buildSharedDownload`/
 * `buildSalesDownload`는 그룹 완전성만 확인하고 `prepared.blocking`은
 * 전혀 보지 않았다 — 화면 버튼의 disabled 속성만이 유일한 방어선이었다).
 *
 * **실제 승인 카탈로그로 만든 prepared를 직접 호출한다** — UI/버튼을 전혀
 * 거치지 않는다. 그래야 "버튼이 막아서 호출이 안 된 것"과 "이 함수
 * 자신이 막은 것"이 섞이지 않는다.
 */

const ROOT = resolve(__dirname, '../..');
const j = (name: string): unknown => JSON.parse(readFileSync(resolve(ROOT, 'data/approved', name), 'utf8'));
const manifest = (): GuideManifest =>
  JSON.parse(readFileSync(resolve(ROOT, 'templates/sanitized/guide-manifest.json'), 'utf8')) as GuideManifest;
const guide = (id: GuideId) =>
  readGuideTemplate(id, new Uint8Array(readFileSync(resolve(ROOT, `templates/sanitized/guide-${id}.xlsx`))), manifest());
const allGuides = (): GuideTemplateSet => Object.fromEntries(GUIDE_IDS.map((id) => [id, guide(id)])) as GuideTemplateSet;

const EMPTY_NOTES: SharedNotes = { supplierByRow: new Map(), salesRemarkByRow: new Map() };

/** 실제 승인 카탈로그(품셈 confirmed:false 정책)로 만든 문서 — 자연히 blocking이다. */
function realPrepared(): PreparedQuote {
  const cat = buildCatalog(j('products.json'), j('prices.json'));
  const matrix = cat.products.find((p) => p.quoteSpec === 'XDM-12')!;
  const document = pickedItemsToQuote(
    {
      header: {
        quoteNumber: 'GATE-1',
        quoteDate: '2026-10-05',
        customer: '합성 고객',
        projectName: '출력 경계 시험',
        contact: '',
        conditions: [],
      },
      systems: [{ name: '회의실', items: [{ sku: matrix.sku, quantity: '1' }] }],
    },
    cat,
  ).document;

  const basis = buildGuideBasis({
    laborItemsRaw: j('labor-items.json'),
    wageTableRaw: j('wage-table.json'),
    laborMappingsRaw: j('labor-mappings.json'),
    choice: { kind: 'guide', guide: guide('pumsem') },
  });

  return prepareQuote({
    document,
    laborReference: basis.reference,
    basisVersions: basis.versions,
    guides: allGuides(),
    profileBySystem: new Map(document.systems.map((s) => [s.systemId, 'general'])),
    importWarnings: [],
    wageMode: 'initialize-new',
  });
}

describe('실제 승인 카탈로그 전제 확인', () => {
  it('품셈 매핑은 confirmed:false 정책상, 실제 카탈로그로 만든 문서는 항상 blocking이다', () => {
    // 이 전제가 깨지면(언젠가 confirmed:true 매핑이 섞이면) 아래 시험들의
    // "자연히 blocking" 가정도 다시 봐야 한다 — 그래서 별도로 확인해 둔다.
    expect(realPrepared().blocking).toBe(true);
  });
});

describe('assertExportAllowed — 공통 출력 경계의 단일 게이트', () => {
  it('blocking이면 던진다', () => {
    expect(() => assertExportAllowed({ blocking: true } as PreparedQuote)).toThrow(ExportBlockedError);
  });

  it('blocking이 아니면 통과한다', () => {
    expect(() => assertExportAllowed({ blocking: false } as PreparedQuote)).not.toThrow();
  });
});

describe('blocking인 prepared는 0/1/2 세 등급 전부가 거부한다 — UI를 거치지 않고 직접 호출', () => {
  it('고객용(2단계)이 거부한다', () => {
    const p = realPrepared();
    expect(() => buildCustomerDownload(p, allGuides())).toThrow(ExportBlockedError);
  });

  it('공유용(1단계)이 거부한다', () => {
    const p = realPrepared();
    expect(() => buildSharedDownload(p, allGuides(), EMPTY_NOTES)).toThrow(ExportBlockedError);
  });

  it('영업팀용(0단계)이 거부한다', () => {
    const p = realPrepared();
    expect(() => buildSalesDownload(p, allGuides(), EMPTY_NOTES, [], new Map())).toThrow(ExportBlockedError);
  });

  it('blocking이 아니면(가정) 실제로 바이트를 만든다 — 차단이 전부를 막는 게 아니라 이 조건만 가린다는 증거', () => {
    const p = { ...realPrepared(), blocking: false };
    const file = buildCustomerDownload(p, allGuides());
    expect(file.bytes.length).toBeGreaterThan(0);
  });
});
