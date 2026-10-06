/**
 * Task 3·4 잔여 1번 — 완제품 케이블의 집계 키에 길이가 들어가 있어
 * 경로 거리를 고치면 "다른 행"이 되는지 확인한다.
 */
import { describe, expect, it } from 'vitest';
import { diagramToQuote } from '@/import/diagram/toQuote';
import { regenerateCables } from '@/import/diagram/regenerateCables';
import { rebuildCableRows } from '@/domain/quote/cableRebuild';
import type { RouteInput } from '@/domain/quote/installation';
import type { Catalog, CatalogProduct } from '@/data/catalog/load';
import type { QuoteDocument, SheetRow } from '@/domain/quote/types';
import { cat, diagram, edge, node } from '../fixtures/diagram';

function familyCatalog(): Catalog {
  const family = (sku: string, meters: string): CatalogProduct => ({
    productId: sku,
    sku,
    brand: '',
    model: sku,
    quoteName: 'HDMI Cable',
    quoteSpec: `${meters}M`,
    unit: 'EA',
    options: { group: 'CS_HDMI 케이블' },
    currency: 'KRW',
    evidence: 'review-required',
  });
  return cat(
    [family('HDMI-1', '1'), family('HDMI-3', '3'), family('HDMI-5', '5'), family('HDMI-10', '10')],
    { 'HDMI-1': '10000', 'HDMI-3': '15000', 'HDMI-5': '20000', 'HDMI-10': '30000' },
  );
}

const header = {
  quoteNumber: 'Q-1',
  projectName: '시험 현장',
  customerName: '합성 거래처',
  quoteDate: '2026-10-06',
  validityDays: 30,
} as never;

function total(edgeId: string, meters: string): RouteInput {
  return { edgeId, systemId: 'S1', source: 'confirmed-total', confirmedTotalMeters: meters };
}

function importOne(edgeIds: string[]): QuoteDocument {
  const d = diagram(
    [node('n1', 'A', 'SRG-X40UH'), node('n2', 'B', 'XDM-12')],
    edgeIds.map((id) =>
      edge(id, 'n1', 'n2', 'video', {
        bomRows: [{ cableType: 'ready-made', productName: 'HDMI-1', length: '1', quantity: '1' }],
      }),
    ),
  );
  return diagramToQuote(d, familyCatalog(), { header, defaultSystemName: '시험' }).document;
}

function cableRows(rows: readonly SheetRow[]): SheetRow[] {
  return rows.filter((r) => r.type === 'item' && r.ruleInstanceId === 'diagram-cables-v1');
}

/** 경로를 적용해 한 번 재산출하고, 적용된 문서를 돌려준다. */
function applyRoutes(document: QuoteDocument, routes: RouteInput[]): {
  document: QuoteDocument;
  canApply: boolean;
  conflicts: readonly { message: string }[];
} {
  const generated = regenerateCables({ ...document, cableRoutes: routes }, familyCatalog(), routes);
  const result = rebuildCableRows(document, document.cableBaseline ?? [], generated.rows, {});
  return {
    document: {
      ...document,
      rows: result.rows,
      cableRoutes: routes,
      cableBaseline: result.nextBaselineRows,
    },
    canApply: result.canApply,
    conflicts: result.conflicts,
  };
}

describe('완제품 케이블 — 경로 거리를 고쳐도 같은 행으로 추적된다', () => {
  it('손으로 고친 수량이 거리 변경 뒤에도 남는다', () => {
    const imported = importOne(['e1']);
    // 경로 2m(→3m 계단)를 먼저 적용한다.
    const first = applyRoutes(imported, [total('e1', '3')]);
    expect(first.canApply).toBe(true);
    const row = cableRows(first.document.rows)[0]!;
    expect(row.type === 'item' && row.sku).toBe('HDMI-3');

    // 사람이 수량을 3으로 고친다.
    const edited: QuoteDocument = {
      ...first.document,
      rows: first.document.rows.map((r) => (r.rowId === row.rowId ? { ...r, quantity: '3' } : r)),
    };

    // 경로를 4m(→5m 계단)로 고친다. 같은 구간의 같은 BOM 품목이므로
    // **같은 행**이어야 하고, 손으로 고친 수량이 남아야 한다.
    const second = applyRoutes(edited, [total('e1', '4')]);
    const after = cableRows(second.document.rows);
    expect(after).toHaveLength(1);
    expect(after[0]!.rowId).toBe(row.rowId);
    expect(after[0]!.type === 'item' && after[0]!.quantity).toBe('3');
    expect(after[0]!.type === 'item' && after[0]!.sku).toBe('HDMI-5');
  });

  it('길이가 같은 여러 구간은 여전히 한 행으로 합쳐진다', () => {
    const imported = importOne(['e1', 'e2']);
    const applied = applyRoutes(imported, [total('e1', '3'), total('e2', '3')]);
    const rows = cableRows(applied.document.rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type === 'item' && rows[0]!.quantity).toBe('2');
  });

  it('길이가 다른 구간은 서로 다른 행으로 남는다 — 10m 자리에 3m가 나가면 안 된다', () => {
    const imported = importOne(['e1', 'e2']);
    const applied = applyRoutes(imported, [total('e1', '3'), total('e2', '9')]);
    const rows = cableRows(applied.document.rows);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => (r.type === 'item' ? r.sku : undefined)).sort()).toEqual(['HDMI-10', 'HDMI-3']);
  });

  it('합쳐져 있던 행이 한 구간의 거리 변경으로 갈라지면, 손으로 고친 값을 말없이 버리지 않는다', () => {
    const imported = importOne(['e1', 'e2']);
    const first = applyRoutes(imported, [total('e1', '3'), total('e2', '3')]);
    const merged = cableRows(first.document.rows)[0]!;
    const edited: QuoteDocument = {
      ...first.document,
      rows: first.document.rows.map((r) => (r.rowId === merged.rowId ? { ...r, quantity: '7' } : r)),
    };
    // e2만 9m(→10m 계단)로 바뀌면 다른 제품이 되어 행이 갈라진다.
    const second = applyRoutes(edited, [total('e1', '3'), total('e2', '9')]);
    expect(second.canApply).toBe(false);
    expect(second.conflicts.length).toBeGreaterThan(0);
  });

  it('경로 입력 미완성에서 완성으로 넘어가도 같은 행으로 이어진다', () => {
    const imported = importOne(['e1']);
    const incomplete: RouteInput = { edgeId: 'e1', systemId: 'S1', source: 'confirmed-total' };
    const first = applyRoutes(imported, [incomplete]);
    const pending = cableRows(first.document.rows)[0]!;
    const second = applyRoutes(first.document, [total('e1', '3')]);
    const after = cableRows(second.document.rows);
    expect(after).toHaveLength(1);
    expect(after[0]!.rowId).toBe(pending.rowId);
  });
});
