import { describe, expect, it } from 'vitest';
import {
  applyInstallationPatch,
  calcConduitMeters,
  calcRouteMeters,
  ceilPurchaseUnits,
  conduitRowSentinel,
  isConduitGroup,
  purchaseUnitMetersForGroup,
  validateConduitRuns,
  type RouteInput,
} from '@/domain/quote/installation';
import { buildQuoteDocument } from '@/domain/quote/buildDocument';
import type { Catalog, CatalogProduct } from '@/data/catalog/load';
import type { QuoteDocument } from '@/domain/quote/types';

function product(partial: { sku: string; group: string; quoteName?: string; quoteSpec?: string }): CatalogProduct {
  return {
    productId: partial.sku,
    sku: partial.sku,
    brand: '',
    model: partial.sku,
    quoteName: partial.quoteName ?? partial.sku,
    quoteSpec: partial.quoteSpec ?? '',
    unit: '10M',
    options: { group: partial.group },
    currency: 'KRW',
    evidence: 'review-required',
  };
}

function catalogWithFlexibleOnly(): Catalog {
  return {
    sourceSha256: 'x'.repeat(64),
    products: [
      product({ sku: 'CBL-F16', group: '후렉시블', quoteSpec: '16㎜' }),
      product({ sku: 'CBL-F28', group: '후렉시블', quoteSpec: '28㎜' }),
    ],
    prices: new Map(),
    pricesAvailable: true,
  };
}

function baseDocument(): QuoteDocument {
  return buildQuoteDocument({
    header: { quoteNumber: 'IN-1', quoteDate: '2026-10-04', customer: '', projectName: '', contact: '', conditions: [] },
    systems: [{ name: '시스템1', lines: [] }],
    documentId: 'doc-in-1',
    rowIdPrefix: 'in',
  });
}

describe('calcRouteMeters', () => {
  it('measured-route는 (수평+입상+입하)×1.3이다', () => {
    const route: RouteInput = {
      edgeId: 'e1',
      systemId: 's1',
      source: 'measured-route',
      horizontalMeters: '10',
      riseMeters: '2',
      dropMeters: '2',
    };
    expect(calcRouteMeters(route)).toBe('18.2');
  });

  it('confirmed-total은 그대로 쓴다 — 수평/입상/입하가 같이 있어도 재보정하지 않는다', () => {
    const route: RouteInput = {
      edgeId: 'e1',
      systemId: 's1',
      source: 'confirmed-total',
      confirmedTotalMeters: '18.2',
      horizontalMeters: '999',
      riseMeters: '999',
      dropMeters: '999',
    };
    expect(calcRouteMeters(route)).toBe('18.2');
  });

  it('measured-route에 값이 비면 undefined다 — 0으로 메우지 않는다', () => {
    expect(
      calcRouteMeters({ edgeId: 'e1', systemId: 's1', source: 'measured-route', horizontalMeters: '10' }),
    ).toBeUndefined();
  });

  it('confirmed-total에 값이 없으면 undefined다', () => {
    expect(calcRouteMeters({ edgeId: 'e1', systemId: 's1', source: 'confirmed-total' })).toBeUndefined();
  });
});

describe('calcConduitMeters — 배관은 거리×줄 수, ×2·×1.3 없음', () => {
  it('10m × 3줄 = 30m', () => {
    expect(calcConduitMeters('10', '3')).toBe('30');
  });

  it('줄 수를 바꾸면 그대로 반영된다 — 숨겨진 배수가 없다', () => {
    expect(calcConduitMeters('10', '2')).toBe('20');
  });

  it('거리나 줄 수가 없으면 undefined다', () => {
    expect(calcConduitMeters(undefined, '3')).toBeUndefined();
    expect(calcConduitMeters('10', undefined)).toBeUndefined();
  });
});

describe('validateConduitRuns', () => {
  it('양의 정수만 허용한다', () => {
    expect(validateConduitRuns('3').ok).toBe(true);
  });
  it('소수 줄 수를 거부한다', () => {
    expect(validateConduitRuns('2.5').ok).toBe(false);
  });
  it('음수를 거부한다', () => {
    expect(validateConduitRuns('-1').ok).toBe(false);
  });
  it('0을 거부한다', () => {
    expect(validateConduitRuns('0').ok).toBe(false);
  });
});

describe('ceilPurchaseUnits — O26: 구매 묶음과 무관하게 10M 단위 올림', () => {
  it('20m → 2', () => {
    expect(ceilPurchaseUnits('20', 10)).toBe(2);
  });
  it('21m → 3', () => {
    expect(ceilPurchaseUnits('21', 10)).toBe(3);
  });
  it('트레이는 3M 단위다 — 같은 길이도 수량이 다르다', () => {
    expect(ceilPurchaseUnits('7', 3)).toBe(3);
    expect(ceilPurchaseUnits('7', 10)).toBe(1);
  });
});

describe('묶음(options.group) 기반 배관 분류 — 품명 문자열 검사가 아니다', () => {
  it('후렉시블·케이블 트레이는 배관이다', () => {
    expect(isConduitGroup('후렉시블')).toBe(true);
    expect(isConduitGroup('케이블 트레이')).toBe(true);
  });
  it('관계없는 묶음은 배관이 아니다', () => {
    expect(isConduitGroup('오디오 케이블')).toBe(false);
    expect(isConduitGroup(undefined)).toBe(false);
  });
  it('트레이는 10M이 아니라 3M 단위다', () => {
    expect(purchaseUnitMetersForGroup('케이블 트레이')).toBe(3);
    expect(purchaseUnitMetersForGroup('후렉시블')).toBe(10);
  });
});

describe('applyInstallationPatch — 배관 재산출: 교체, 중복 추가 없음', () => {
  it('거리·줄 수가 아직 없으면 행을 만들지 않는다', () => {
    const result = applyInstallationPatch(baseDocument(), 'S1', { conduitType: 'flexible' }, catalogWithFlexibleOnly());
    expect(result.warning).toBeUndefined();
    expect(result.document.rows.some((r) => r.type === 'item' && r.sourceNodeIds?.includes(conduitRowSentinel('S1')))).toBe(
      false,
    );
  });

  it('거리·줄 수를 채우면 배관 행과 배관 기타자재 파생행이 생긴다 — 근거 문구를 그대로 보여준다', () => {
    const result = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'flexible' },
      catalogWithFlexibleOnly(),
    );
    const row = result.document.rows.find(
      (r) => r.type === 'item' && r.sourceNodeIds?.includes(conduitRowSentinel('S1')),
    );
    expect(row).toBeDefined();
    expect(row).toMatchObject({ quantity: '3', remark: '10m × 3줄 = 30m', unit: '10M' });

    const derived = result.document.derivedRows.find((d) => d.systemId === 'S1');
    expect(derived).toMatchObject({ derived: { kind: 'single-row-material', sourceRowId: row!.rowId }, rate: '0.2' });

    expect(result.warning).toMatchObject({ nodeId: conduitRowSentinel('S1'), blocking: true });
    expect(result.warning!.candidates).toEqual(['CBL-F16', 'CBL-F28']);
  });

  it('줄 수만 바꿔 재산출하면 같은 행을 교체한다 — 누적 추가하지 않는다', () => {
    const first = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'flexible' },
      catalogWithFlexibleOnly(),
    );
    const second = applyInstallationPatch(first.document, 'S1', { conduitRuns: '2' }, catalogWithFlexibleOnly());

    const conduitRows = second.document.rows.filter(
      (r) => r.type === 'item' && r.sourceNodeIds?.includes(conduitRowSentinel('S1')),
    );
    expect(conduitRows).toHaveLength(1);
    expect(conduitRows[0]).toMatchObject({ quantity: '2', remark: '10m × 2줄 = 20m' });

    const derivedRows = second.document.derivedRows.filter((d) => d.systemId === 'S1');
    expect(derivedRows).toHaveLength(1);
  });

  it('이미 고른 SKU는 같은 종류로 재산출해도 그대로 둔다 — 수량만 갱신한다', () => {
    const first = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'flexible' },
      catalogWithFlexibleOnly(),
    );
    const rowId = first.document.rows.find((r) => r.type === 'item' && r.sourceNodeIds?.includes(conduitRowSentinel('S1')))!
      .rowId;
    // 사람이 WarningList에서 CBL-F16을 골랐다고 가정한다.
    const resolved: QuoteDocument = {
      ...first.document,
      rows: first.document.rows.map((r) =>
        r.rowId === rowId ? { ...r, sku: 'CBL-F16', productId: 'CBL-F16', sellingUnitPrice: '50000' } : r,
      ),
    };

    const second = applyInstallationPatch(resolved, 'S1', { conduitRuns: '2' }, catalogWithFlexibleOnly());
    const row = second.document.rows.find((r) => r.rowId === rowId);
    expect(row).toMatchObject({ sku: 'CBL-F16', sellingUnitPrice: '50000', quantity: '2' });
  });

  it('배관 종류를 바꾸면 더는 맞지 않는 기존 SKU를 지운다', () => {
    const first = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'flexible' },
      catalogWithFlexibleOnly(),
    );
    const rowId = first.document.rows.find((r) => r.type === 'item' && r.sourceNodeIds?.includes(conduitRowSentinel('S1')))!
      .rowId;
    const resolved: QuoteDocument = {
      ...first.document,
      rows: first.document.rows.map((r) => (r.rowId === rowId ? { ...r, sku: 'CBL-F16', sellingUnitPrice: '50000' } : r)),
    };

    const switched = applyInstallationPatch(resolved, 'S1', { conduitType: 'cd' }, catalogWithFlexibleOnly());
    const row = switched.document.rows.find(
      (r): r is Extract<QuoteDocument['rows'][number], { type: 'item' }> => r.rowId === rowId && r.type === 'item',
    );
    expect(row?.sku).toBeUndefined();
  });

  it('CD관 품목이 품셈에 없으면 후보 0건으로 차단한다 — 0원·후렉시블로 대신 채우지 않는다', () => {
    const result = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'cd' },
      catalogWithFlexibleOnly(),
    );
    expect(result.warning).toMatchObject({ blocking: true, candidates: [] });
    expect(result.warning!.message).toContain('CD관 품목이 없습니다');
    const row = result.document.rows.find(
      (r): r is Extract<QuoteDocument['rows'][number], { type: 'item' }> =>
        r.type === 'item' && (r.sourceNodeIds?.includes(conduitRowSentinel('S1')) ?? false),
    );
    expect(row?.sku).toBeUndefined();
    expect(row?.sellingUnitPrice).toBeUndefined();
  });

  it('종류를 바꾸면 손대지 않은 비율은 새 종류의 기본값을 따라간다', () => {
    const first = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'flexible' },
      catalogWithFlexibleOnly(),
    );
    expect(first.document.systems[0]!.conduitMaterialRate).toBe('20');

    const switched = applyInstallationPatch(first.document, 'S1', { conduitType: 'cd' }, catalogWithFlexibleOnly());
    expect(switched.document.systems[0]!.conduitMaterialRate).toBe('40');
    const derived = switched.document.derivedRows.find((d) => d.systemId === 'S1');
    expect(derived).toMatchObject({ rate: '0.4', specification: '배관자재40%' });
  });

  it('사용자가 비율을 손봤으면 종류를 바꿔도 그대로 둔다', () => {
    const first = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'flexible', conduitMaterialRate: '25' },
      catalogWithFlexibleOnly(),
    );
    expect(first.document.systems[0]!.conduitMaterialRate).toBe('25');

    const switched = applyInstallationPatch(first.document, 'S1', { conduitType: 'cd' }, catalogWithFlexibleOnly());
    expect(switched.document.systems[0]!.conduitMaterialRate).toBe('25');
  });
});
