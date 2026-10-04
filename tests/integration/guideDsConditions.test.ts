import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

import { buildQuoteDocument } from '@/domain/quote/buildDocument';
import { calculateQuote } from '@/domain/calculation/calculate';
import { indirectCostsFor } from '@/export/ooxml/guideTemplate';
import { buildCustomerProjection } from '@/export/customer/projection';
import { buildGuideBase, buildCustomerGuideWorkbook } from '@/export/customer/guideWorkbook';
import {
  GUIDE_IDS,
  readGuideTemplate,
  selectGuide,
  type GuideId,
  type GuideManifest,
  type GuideTemplateSet,
} from '@/export/ooxml/guideTemplate';
import type { QuoteHeader } from '@/domain/quote/types';
import { scanCostLeak } from '../../tools/costLeakScan';

/**
 * P2-2 후속 — DS 도형의 "기축건물/신축건물"·"계약금액 구간" 정보를
 * conditionText 로 옮겨 적은 것(manifest)과, 갑지 비고란을
 * `header.conditions` 로 항상 정하는 것(마감 전 플레이스홀더가 고객에게
 * 나가지 않도록)을 고정한다.
 */

const ROOT = resolve(__dirname, '../..');
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

const header = (conditions: string[] = []): QuoteHeader => ({
  quoteNumber: 'DS-COND-1',
  quoteDate: '2026-10-04',
  customer: '합성 고객',
  projectName: 'DS 조건 검증',
  contact: '',
  conditions,
});

function documentWithConditions(conditions: string[]) {
  const base = buildQuoteDocument({
    header: header(conditions),
    systems: [
      {
        name: '회의실',
        lines: [{ name: 'DS 품목', specification: 'spec', unit: 'EA', quantity: '1' }],
      },
    ],
    documentId: 'doc-ds-cond',
    rowIdPrefix: 'dc',
  });
  const rows = base.rows.map((row) =>
    row.type === 'item'
      ? { ...row, sellingUnitPrice: '100000', laborMode: 'not-applicable' as const }
      : row,
  );
  const systems = base.systems.map((system) => ({
    ...system,
    indirectCosts: indirectCostsFor('ds', allGuides()),
  }));
  return { ...base, rows, systems };
}

const detailOf = (bytes: Uint8Array): string =>
  strFromU8(unzipSync(bytes)['xl/worksheets/sheet2.xml']!);
const coverOf = (bytes: Uint8Array): string =>
  strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']!);
function cellOf(sheet: string, ref: string): string | undefined {
  return new RegExp(`<c r="${ref}"[^>]*/>|<c r="${ref}"[^>]*>[\\s\\S]*?</c>`).exec(sheet)?.[0];
}

describe('DS 설명 도형 → conditionText 로 옮긴 내용이 실제로 나간다', () => {
  it('간접노무비·산업안전보건관리비 행에 기축/신축·계약금액 구간 조건이 적힌다', () => {
    const document = documentWithConditions([]);
    const calculation = calculateQuote(document);
    const projection = buildCustomerProjection(document, calculation);
    const guide = selectGuide(allGuides(), 'ds', true); // 0단계(원가 포함) — supplier 열이 살아있다.
    const result = buildGuideBase(projection, guide);
    const sheet = detailOf(result.bytes);
    const layout = result.layout;

    const indirectRows = layout.indirectRows;
    // 이름으로 찾는다 — 순서가 바뀌어도 안전하다.
    const rules = projection.systems[0]!.indirectCosts;
    const laborIndex = rules.findIndex((r) => r.name === '간접노무비');
    const safetyIndex = rules.findIndex((r) => r.name === '산업안전보건관리비');
    expect(laborIndex).toBeGreaterThanOrEqual(0);
    expect(safetyIndex).toBeGreaterThanOrEqual(0);

    const laborCell = cellOf(sheet, `${layout.column('supplier')}${indirectRows[laborIndex]!.row}`);
    const safetyCell = cellOf(sheet, `${layout.column('supplier')}${indirectRows[safetyIndex]!.row}`);
    expect(laborCell, '간접노무비 비고').toContain('기축건물');
    expect(safetyCell, '산업안전보건관리비 비고').toContain('5억');
  });

  it('도형 참조(<drawing>)가 단일 시스템 DS 산출물에서 뗀다', () => {
    const document = documentWithConditions([]);
    const calculation = calculateQuote(document);
    const projection = buildCustomerProjection(document, calculation);
    const guide = selectGuide(allGuides(), 'ds', false);
    const result = buildGuideBase(projection, guide);
    expect(detailOf(result.bytes)).not.toContain('<drawing ');
  });

  it('고객용(2단계)에는 간접비 조건 비고가 애초에 안 나간다 — supplier 열이 지워진다', () => {
    const document = documentWithConditions([]);
    const calculation = calculateQuote(document);
    const projection = buildCustomerProjection(document, calculation);
    const guide = selectGuide(allGuides(), 'ds', false);
    const result = buildCustomerGuideWorkbook(projection, guide);
    expect(() => result.layout.column('supplier')).toThrow(/지워졌다/);
    const sheet = detailOf(result.bytes);
    expect(sheet).not.toContain('기축건물');
    expect(sheet).not.toContain('5억');
  });

  it('B2 — 옮겨 적은 조건 문구가 금지 단어를 포함하지 않는다', () => {
    const document = documentWithConditions([]);
    const calculation = calculateQuote(document);
    const projection = buildCustomerProjection(document, calculation);
    const guide = selectGuide(allGuides(), 'ds', false);
    const result = buildCustomerGuideWorkbook(projection, guide);
    const found = scanCostLeak(result.bytes, { costValues: [], allowedCells: result.writtenCells });
    expect(found.filter((f) => f.kind === 'forbidden-word')).toEqual([]);
  });
});

describe('갑지 비고(C19·C20) — header.conditions 로 항상 정한다', () => {
  it('conditions 가 있으면 그 글자가 나간다', () => {
    const document = documentWithConditions(['첫째 줄 조건', '둘째 줄 조건']);
    const calculation = calculateQuote(document);
    const projection = buildCustomerProjection(document, calculation);
    const guide = selectGuide(allGuides(), 'ds', false);
    const result = buildGuideBase(projection, guide);
    const cover = coverOf(result.bytes);
    expect(cellOf(cover, 'C19')).toContain('첫째 줄 조건');
    expect(cellOf(cover, 'C20')).toContain('둘째 줄 조건');
  });

  it('conditions 가 비면 DS 템플릿의 마감 전 플레이스홀더 문구가 나가지 않는다', () => {
    const document = documentWithConditions([]);
    const calculation = calculateQuote(document);
    const projection = buildCustomerProjection(document, calculation);
    const guide = selectGuide(allGuides(), 'ds', false);
    const result = buildGuideBase(projection, guide);
    const cover = coverOf(result.bytes);
    expect(cover).not.toContain('비고내용 작성');
    expect(cover).not.toContain('네트워크 포설');
    // 칸 자체는 비어 있다 — 값도 수식도 없다.
    const c19 = cellOf(cover, 'C19');
    if (c19 !== undefined) expect(c19).not.toMatch(/<v>|<is>/);
  });
});
