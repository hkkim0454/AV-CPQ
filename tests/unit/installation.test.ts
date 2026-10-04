import { describe, expect, it } from 'vitest';
import {
  applyInstallationPatch,
  calcConduitMeters,
  calcRouteMeters,
  ceilPurchaseUnits,
  computeInstallationWarnings,
  conduitLabel,
  conduitRowSentinel,
  DEFAULT_CONDUIT_MATERIAL_RATE,
  DEFAULT_CONDUIT_MATERIAL_RATE_SOURCE,
  isConduitGroup,
  isConduitSentinel,
  purchaseUnitMetersForGroup,
  resolveConduitProduct,
  validateConduitRuns,
  type RouteInput,
} from '@/domain/quote/installation';
import { buildQuoteDocument } from '@/domain/quote/buildDocument';
import type { Catalog, CatalogProduct } from '@/data/catalog/load';
import type { QuoteDocument, SheetRow } from '@/domain/quote/types';

type ItemRow = Extract<SheetRow, { type: 'item' }>;

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
    prices: new Map([['CBL-F16', '31000']]),
    pricesAvailable: true,
  };
}

function catalogWithTrayOnly(): Catalog {
  return {
    sourceSha256: 'x'.repeat(64),
    products: [product({ sku: 'TRAY-100', group: '케이블 트레이', quoteSpec: '100mm x 100mm' })],
    prices: new Map([['TRAY-100', '12000']]),
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

function conduitRowOf(document: QuoteDocument, systemId: string): ItemRow | undefined {
  const sentinel = conduitRowSentinel(systemId);
  return document.rows.find(
    (r): r is ItemRow => r.type === 'item' && (r.sourceNodeIds?.includes(sentinel) ?? false),
  );
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
    const document = applyInstallationPatch(baseDocument(), 'S1', { conduitType: 'flexible' }, catalogWithFlexibleOnly());
    expect(conduitRowOf(document, 'S1')).toBeUndefined();
  });

  it('거리·줄 수를 채우면 배관 행과 배관 기타자재 파생행이 생긴다 — 근거 문구를 그대로 보여준다', () => {
    const document = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'flexible' },
      catalogWithFlexibleOnly(),
    );
    const row = conduitRowOf(document, 'S1');
    expect(row).toBeDefined();
    expect(row).toMatchObject({ quantity: '3', remark: '10m × 3줄 = 30m', unit: '10M' });

    const derived = document.derivedRows.find((d) => d.systemId === 'S1');
    expect(derived).toMatchObject({ derived: { kind: 'single-row-material', sourceRowId: row!.rowId }, rate: '0.2' });
  });

  it('줄 수만 바꿔 재산출하면 같은 행을 교체한다 — 누적 추가하지 않는다', () => {
    const first = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'flexible' },
      catalogWithFlexibleOnly(),
    );
    const second = applyInstallationPatch(first, 'S1', { conduitRuns: '2' }, catalogWithFlexibleOnly());

    const conduitRows = second.rows.filter(
      (r) => r.type === 'item' && r.sourceNodeIds?.includes(conduitRowSentinel('S1')),
    );
    expect(conduitRows).toHaveLength(1);
    expect(conduitRows[0]).toMatchObject({ quantity: '2', remark: '10m × 2줄 = 20m' });

    const derivedRows = second.derivedRows.filter((d) => d.systemId === 'S1');
    expect(derivedRows).toHaveLength(1);
  });

  it('이미 고른 SKU는 같은 종류로 재산출해도 그대로 둔다 — 수량만 갱신한다', () => {
    const first = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'flexible' },
      catalogWithFlexibleOnly(),
    );
    const rowId = conduitRowOf(first, 'S1')!.rowId;
    const resolved = resolveConduitProduct(first, 'S1', 'CBL-F16', catalogWithFlexibleOnly());

    const second = applyInstallationPatch(resolved, 'S1', { conduitRuns: '2' }, catalogWithFlexibleOnly());
    const row = second.rows.find((r) => r.rowId === rowId);
    expect(row).toMatchObject({ sku: 'CBL-F16', sellingUnitPrice: '31000', quantity: '2' });
  });

  it('배관 종류를 바꾸면 더는 맞지 않는 기존 SKU를 지운다', () => {
    const first = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'flexible' },
      catalogWithFlexibleOnly(),
    );
    const rowId = conduitRowOf(first, 'S1')!.rowId;
    const resolved = resolveConduitProduct(first, 'S1', 'CBL-F16', catalogWithFlexibleOnly());

    const switched = applyInstallationPatch(resolved, 'S1', { conduitType: 'cd' }, catalogWithFlexibleOnly());
    const row = switched.rows.find((r): r is ItemRow => r.type === 'item' && r.rowId === rowId);
    expect(row?.sku).toBeUndefined();
  });

  it('종류를 바꾸면 손대지 않은 비율은 새 종류의 기본값을 따라간다', () => {
    const first = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'flexible' },
      catalogWithFlexibleOnly(),
    );
    expect(first.systems[0]!.conduitMaterialRate).toBe('20');
    expect(first.systems[0]!.conduitMaterialRateManual).toBe(false);

    const switched = applyInstallationPatch(first, 'S1', { conduitType: 'cd' }, catalogWithFlexibleOnly());
    expect(switched.systems[0]!.conduitMaterialRate).toBe('40');
    const derived = switched.derivedRows.find((d) => d.systemId === 'S1');
    expect(derived).toMatchObject({ rate: '0.4', specification: '배관자재40%' });
  });

  it('사용자가 비율을 손봤으면 종류를 바꿔도 그대로 둔다', () => {
    const first = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'flexible', conduitMaterialRate: '25' },
      catalogWithFlexibleOnly(),
    );
    expect(first.systems[0]!.conduitMaterialRate).toBe('25');
    expect(first.systems[0]!.conduitMaterialRateManual).toBe(true);

    const switched = applyInstallationPatch(first, 'S1', { conduitType: 'cd' }, catalogWithFlexibleOnly());
    expect(switched.systems[0]!.conduitMaterialRate).toBe('25');
  });

  it('사용자가 기본값과 우연히 같은 값을 명시로 지정해도 "손댄 값"으로 취급한다', () => {
    // 후렉시블 기본값은 20% — 사용자가 그 값을 "명시로" 다시 입력해도
    // 출처는 manual이어야 한다. 값만 보고 추정하면 이 경우를 "아직
    // 안 건드렸다"로 잘못 판단한다(독립 검토 지적).
    const first = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'flexible', conduitMaterialRate: '20' },
      catalogWithFlexibleOnly(),
    );
    expect(first.systems[0]!.conduitMaterialRateManual).toBe(true);

    const switched = applyInstallationPatch(first, 'S1', { conduitType: 'cd' }, catalogWithFlexibleOnly());
    expect(switched.systems[0]!.conduitMaterialRate).toBe('20'); // CD 기본값(40%)으로 안 바뀐다
  });

  it('"직접 지정"만 명시로 켜면(값을 아직 안 줘도) manual=true로 기록된다 — 화면의 방식 전환용', () => {
    const first = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'flexible' },
      catalogWithFlexibleOnly(),
    );
    expect(first.systems[0]!.conduitMaterialRateManual).toBe(false);

    const switchedToManual = applyInstallationPatch(first, 'S1', { conduitMaterialRateManual: true }, catalogWithFlexibleOnly());
    expect(switchedToManual.systems[0]!.conduitMaterialRateManual).toBe(true);
    expect(switchedToManual.systems[0]!.conduitMaterialRate).toBe('20'); // 기존 표시값을 그대로 들고 간다

    // manual 상태에서 종류를 바꿔도 더는 기본값을 따라가지 않는다.
    const switchedType = applyInstallationPatch(switchedToManual, 'S1', { conduitType: 'cd' }, catalogWithFlexibleOnly());
    expect(switchedType.systems[0]!.conduitMaterialRate).toBe('20');
  });

  it('"기본값 사용"을 명시로 선택하면(conduitMaterialRateManual: false) 현재 종류의 기본값으로 되돌아간다', () => {
    const manual = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'flexible', conduitMaterialRate: '25' },
      catalogWithFlexibleOnly(),
    );
    expect(manual.systems[0]!.conduitMaterialRate).toBe('25');
    expect(manual.systems[0]!.conduitMaterialRateManual).toBe(true);

    const resetToDefault = applyInstallationPatch(
      manual,
      'S1',
      { conduitMaterialRateManual: false },
      catalogWithFlexibleOnly(),
    );
    expect(resetToDefault.systems[0]!.conduitMaterialRate).toBe('20');
    expect(resetToDefault.systems[0]!.conduitMaterialRateManual).toBe(false);

    // 되돌린 뒤에는 다시 "손 안 댄 기본값" 취급이라, 종류를 바꾸면
    // 또 그 종류의 기본값을 따라간다.
    const switchedType = applyInstallationPatch(resetToDefault, 'S1', { conduitType: 'cd' }, catalogWithFlexibleOnly());
    expect(switchedType.systems[0]!.conduitMaterialRate).toBe('40');
  });
});

describe('computeInstallationWarnings — 문서에서 매번 새로 파생한다(undo/redo와 항상 일치)', () => {
  it('배관 행이 없으면 경고도 없다', () => {
    expect(computeInstallationWarnings(baseDocument(), catalogWithFlexibleOnly())).toHaveLength(0);
  });

  it('배관 행이 미해결이면 경고가 있고, 그 시스템 종류에 맞는 후보만 담는다', () => {
    const document = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'flexible' },
      catalogWithFlexibleOnly(),
    );
    const warnings = computeInstallationWarnings(document, catalogWithFlexibleOnly());
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ installationSystemId: 'S1', blocking: true });
    expect(warnings[0]!.candidates).toEqual(['CBL-F16', 'CBL-F28']);
  });

  it('해소되면 경고가 사라진다 — 문서만 보고 판단한다', () => {
    const document = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'flexible' },
      catalogWithFlexibleOnly(),
    );
    const resolved = resolveConduitProduct(document, 'S1', 'CBL-F16', catalogWithFlexibleOnly());
    expect(computeInstallationWarnings(resolved, catalogWithFlexibleOnly())).toHaveLength(0);
  });

  it('undo로 배관 행이 통째로 사라진 문서를 주면(실제 undo를 흉내낸다) 경고도 사라진다', () => {
    const beforeAnyInput = baseDocument(); // "실행취소"로 돌아간 상태를 흉내낸다
    expect(computeInstallationWarnings(beforeAnyInput, catalogWithFlexibleOnly())).toHaveLength(0);
  });

  it('CD관은 후보 0건으로 차단 메시지를 낸다', () => {
    const document = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'cd' },
      catalogWithFlexibleOnly(),
    );
    const warnings = computeInstallationWarnings(document, catalogWithFlexibleOnly());
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.candidates).toEqual([]);
    expect(warnings[0]!.message).toContain('CD관 품목이 없습니다');
  });
});

describe('resolveConduitProduct — 현재 배관 종류의 묶음과 맞는 SKU만 받는다(일반 검색으로 우회 금지)', () => {
  it('맞는 묶음의 SKU는 해소된다', () => {
    const document = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'flexible' },
      catalogWithFlexibleOnly(),
    );
    const resolved = resolveConduitProduct(document, 'S1', 'CBL-F16', catalogWithFlexibleOnly());
    expect(conduitRowOf(resolved, 'S1')).toMatchObject({ sku: 'CBL-F16', sellingUnitPrice: '31000' });
  });

  it('CD관으로 골라 둔 상태에서 후렉시블 SKU를 붙이려 하면 거부한다', () => {
    const document = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'cd' },
      catalogWithFlexibleOnly(),
    );
    const attempted = resolveConduitProduct(document, 'S1', 'CBL-F16', catalogWithFlexibleOnly());
    // 문서가 전혀 안 바뀐다 — CD관 차단을 후렉시블 제품으로 우회할 수 없다.
    expect(attempted).toEqual(document);
    expect(conduitRowOf(attempted, 'S1')?.sku).toBeUndefined();
  });

  it('배관이 아닌 일반 장비 SKU로는 연결할 수 없다 — 묶음이 다르다', () => {
    const catalog: Catalog = {
      sourceSha256: 'y'.repeat(64),
      products: [
        ...catalogWithFlexibleOnly().products,
        product({ sku: 'DEV-001', group: '일반장비', quoteName: '무관한 장비' }),
      ],
      prices: new Map([['DEV-001', '999999']]),
      pricesAvailable: true,
    };
    const document = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'flexible' },
      catalog,
    );
    const attempted = resolveConduitProduct(document, 'S1', 'DEV-001', catalog);
    expect(conduitRowOf(attempted, 'S1')?.sku).toBeUndefined();
  });

  it('카탈로그에 없는 SKU는 무시한다', () => {
    const document = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'flexible' },
      catalogWithFlexibleOnly(),
    );
    const attempted = resolveConduitProduct(document, 'S1', 'NOPE', catalogWithFlexibleOnly());
    expect(attempted).toEqual(document);
  });
});

describe('isConduitSentinel — 일반 resolveDevice가 배관 행을 건드리지 못하게 막는 경계(독립 검토 지적)', () => {
  it('conduitRowSentinel이 만든 id를 알아본다', () => {
    expect(isConduitSentinel(conduitRowSentinel('S1'))).toBe(true);
  });
  it('구성도의 일반 노드 id는 아니다', () => {
    expect(isConduitSentinel('eq-xlsx-451')).toBe(false);
  });
});

describe('computeInstallationWarnings — sku+price만으로 해소를 단정하지 않는다(독립 검토 지적)', () => {
  it('묶음이 다른 제품으로 채워진 행(일반 resolveDevice 우회·저장 문서 복원 등 상정)은 경고가 남는다', () => {
    const document = applyInstallationPatch(
      baseDocument(),
      'S1',
      { farthestDeviceMeters: '10', conduitRuns: '3', conduitType: 'cd' },
      catalogWithFlexibleOnly(),
    );
    const sentinel = conduitRowSentinel('S1');
    // resolveConduitProduct를 거치지 않고(검증을 우회해) 후렉시블
    // 제품을 CD관 행에 직접 끼워 넣은 상태를 흉내낸다.
    const bypassed: QuoteDocument = {
      ...document,
      rows: document.rows.map((r) =>
        r.type === 'item' && r.sourceNodeIds?.includes(sentinel)
          ? { ...r, sku: 'CBL-F16', sellingUnitPrice: '31000' }
          : r,
      ),
    };
    const warnings = computeInstallationWarnings(bypassed, catalogWithFlexibleOnly());
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ installationSystemId: 'S1' });
  });
});

describe('케이블 트레이(tray) — O25 닫힘: 기타자재 30%는 품셈이 아니라 사용자 구술 출처다', () => {
  it('기본값 30%, 출처는 품셈이 아니라고 명시한다', () => {
    expect(DEFAULT_CONDUIT_MATERIAL_RATE.tray).toBe('30');
    expect(DEFAULT_CONDUIT_MATERIAL_RATE_SOURCE.tray).toContain('사용자');
    expect(DEFAULT_CONDUIT_MATERIAL_RATE_SOURCE.tray).toContain('품셈 근거 아님');
    expect(DEFAULT_CONDUIT_MATERIAL_RATE_SOURCE.flexible).toContain('품셈');
    expect(DEFAULT_CONDUIT_MATERIAL_RATE_SOURCE.cd).toContain('품셈');
  });

  it('표시 이름은 "케이블 트레이"다', () => {
    expect(conduitLabel('tray')).toBe('케이블 트레이');
  });

  it('수량은 10M이 아니라 3M 단위로 올림하고, 단위는 EA로 표시한다', () => {
    const document = applyInstallationPatch(
      baseDocument(), 'S1', { farthestDeviceMeters: '7', conduitRuns: '1', conduitType: 'tray' }, catalogWithTrayOnly(),
    );
    const row = conduitRowOf(document, 'S1')!;
    // 7m × 1줄 = 7m → 3M 단위 올림 = 3개
    expect(row.quantity).toBe('3');
    expect(row.unit).toBe('EA');
  });

  it('기본값을 쓰면 배관 기타자재 파생행의 비율이 30%다', () => {
    const document = applyInstallationPatch(
      baseDocument(), 'S1', { farthestDeviceMeters: '7', conduitRuns: '1', conduitType: 'tray' }, catalogWithTrayOnly(),
    );
    const materialRow = document.derivedRows.find((d) => d.rowId === 'derived-conduitmat-S1')!;
    expect(materialRow.specification).toBe('배관자재30%');
    expect(materialRow.rate).toBe('0.3');
  });

  it('resolveConduitProduct는 "케이블 트레이" 묶음 제품만 받는다', () => {
    const document = applyInstallationPatch(
      baseDocument(), 'S1', { farthestDeviceMeters: '7', conduitRuns: '1', conduitType: 'tray' }, catalogWithTrayOnly(),
    );
    // 후렉시블 제품으로는 트레이 행을 해소할 수 없다.
    const rejected = resolveConduitProduct(document, 'S1', 'CBL-F16', { ...catalogWithTrayOnly(), products: [...catalogWithTrayOnly().products, ...catalogWithFlexibleOnly().products] });
    expect(conduitRowOf(rejected, 'S1')?.sku).toBeUndefined();
    const resolved = resolveConduitProduct(document, 'S1', 'TRAY-100', catalogWithTrayOnly());
    expect(conduitRowOf(resolved, 'S1')?.sku).toBe('TRAY-100');
  });

  it('후렉시블→트레이로 종류를 바꾸면 수량·단위가 트레이 기준으로 다시 산출된다', () => {
    const first = applyInstallationPatch(
      baseDocument(), 'S1', { farthestDeviceMeters: '7', conduitRuns: '1', conduitType: 'flexible' }, catalogWithFlexibleOnly(),
    );
    expect(conduitRowOf(first, 'S1')!.unit).toBe('10M');
    const switched = applyInstallationPatch(first, 'S1', { conduitType: 'tray' }, catalogWithTrayOnly());
    const row = conduitRowOf(switched, 'S1')!;
    expect(row.unit).toBe('EA');
    expect(row.quantity).toBe('3');
  });
});
