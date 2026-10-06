/**
 * 품셈 교체 Task 2 보강 — 원본 수식에 박힌 **배율**을 자료 모델에 반영한다.
 *
 * 하반기 원본의 18행은 노무비 단가 수식 끝에 열에 없는 배율이 붙어 있다.
 *
 * ```
 * =INT(SUM((할증*표준단가),표준단가)*요율)*0.3     ← 케이블 길이 비례 16행
 * =INT(SUM((할증*표준단가),표준단가)*요율)*2       ← 스피커 2대 묶음 2행
 * ```
 *
 * 배율을 못 읽으면 노무비가 최대 3.3배 부풀어 견적에 들어간다.
 *
 * ⚠ **`INT` 는 배율보다 먼저다.** `INT(x) × 0.3` 이지 `INT(x × 0.3)` 이 아니다.
 * 실측(케이블 233행): `INT(1,078,772.68 × 0.63) = 679,626`, `× 0.3 = 203,887.8`
 * 이고 원본 노무비 칸이 정확히 `203887.8` 이다. 순서를 바꾸면 203,888 이 되어 틀린다.
 */
import { describe, it, expect } from 'vitest';
import { calculateLaborUnitPrice } from '@/domain/labor/calculateLabor';
import { verifyLaborRows } from '@/data/catalog/verifyLabor';
import { buildLabor } from '@/data/catalog/buildLabor';
import type { LaborItem, LaborMapping, WageTable } from '@/domain/labor/types';
import type { RawSheet } from '@/data/catalog/rawTypes';

// --- 실측값을 그대로 쓴다 (케이블 및 커넥터 233행) ---------------------------
// 표준단가 1,078,772.68 = 통신케이블공 공수 × 노임. 요율 0.63, 할증 없음.
const WAGES: WageTable = {
  wageTableId: 'WAGE-26년 하반기',
  periodLabel: '26년 하반기',
  source: '시험',
  wages: { 통신케이블공: { amount: '438070', unit: 'M/D' } },
};

/** 2.4624 × 438,070 = 1,078,772.568 … 실측 표준단가에 맞춘 합성 공수. */
const ITEM: LaborItem = {
  laborItemId: 'CBL-0233',
  code: '7-11-1-합성',
  description: '우레탄 Optical Cable SM 4C-30m',
  baseUnit: 'EA',
  source: '시험',
  revision: '26년 하반기',
  wageUnit: 'M/D',
  trades: [{ trade: '통신케이블공', quantity: '2' }],
};

function mapping(over: Partial<LaborMapping> = {}): LaborMapping {
  return {
    laborMappingId: 'CBL-0233',
    sku: 'CBL-0233',
    laborItemId: 'CBL-0233',
    conversionFactor: '1',
    surcharge: '0',
    itemRate: '0.63',
    confirmed: false,
    note: '시험',
    ...over,
  };
}

describe('calculateLaborUnitPrice — 배율은 INT 다음에 곱한다', () => {
  // 공수 2 × 438,070 = 876,140. × 0.63 = 551,968.2 → INT = 551,968.
  it('배율이 없으면 지금과 같다', () => {
    expect(calculateLaborUnitPrice(ITEM, mapping(), WAGES).appliedUnitPrice.toFixed()).toBe('551968');
  });

  it('배율을 INT 뒤에 곱한다 — 551,968 × 0.3 = 165,590.4', () => {
    const result = calculateLaborUnitPrice(ITEM, mapping({ multiplier: '0.3' }), WAGES);
    expect(result.appliedUnitPrice.toFixed()).toBe('165590.4');
  });

  it('⛔ INT 안에서 곱하지 않는다 — 그러면 165,590 이 되어 원본과 다르다', () => {
    const result = calculateLaborUnitPrice(ITEM, mapping({ multiplier: '0.3' }), WAGES);
    expect(result.appliedUnitPrice.toFixed()).not.toBe('165590');
  });

  it('1보다 큰 배율도 같은 자리에서 곱한다', () => {
    const result = calculateLaborUnitPrice(ITEM, mapping({ multiplier: '2' }), WAGES);
    expect(result.appliedUnitPrice.toFixed()).toBe('1103936');
  });

  it('배율을 근거에 담아 사람이 볼 수 있게 한다', () => {
    expect(calculateLaborUnitPrice(ITEM, mapping({ multiplier: '0.3' }), WAGES).multiplier?.toFixed()).toBe('0.3');
  });
});

// ---------------------------------------------------------------------------
const SHEET_WAGES: RawSheet['wages'] = [
  { trade: '통신케이블공', unit: 'M/D', amount: '438070', quantityColumn: 'W' },
];

function rawRow(over: Partial<RawSheet['rows'][number]> = {}): RawSheet['rows'][number] {
  return {
    row: 233,
    name: '우레탄 Optical Cable',
    spec: 'SM 4C-30m',
    unit: 'EA',
    materialUnitPrice: '100000',
    laborCode: '7-11-1-합성',
    itemRate: '0.63',
    laborUnitPrice: '551968',
    trades: [{ trade: '통신케이블공', quantity: '2' }],
    ...over,
  };
}

const sheetOf = (rows: RawSheet['rows']) => ({ name: '케이블 및 커넥터', wages: SHEET_WAGES, rows });

describe('역산 검증 — 배율을 적용해 대조한다', () => {
  it('배율이 있는 행은 배율까지 곱해 맞춘다', () => {
    const rows = [rawRow({ laborMultiplier: '0.3', laborUnitPrice: '165590.4' })];
    expect(verifyLaborRows([sheetOf(rows)]).counts.통과).toBe(1);
  });

  it('배율을 빼먹으면 불일치로 잡힌다 — 이 검증이 살아 있다는 증거', () => {
    const rows = [rawRow({ laborMultiplier: '0.3', laborUnitPrice: '551968' })];
    expect(verifyLaborRows([sheetOf(rows)]).counts.불일치).toBe(1);
  });

  it('배율이 없는 행은 그대로 맞는다', () => {
    expect(verifyLaborRows([sheetOf([rawRow()])]).counts.통과).toBe(1);
  });
});

describe('재현할 수 없는 행은 미검증이다 — 불일치로 세지 않는다', () => {
  it('노무비 수식이 아는 모양이 아니면 미검증이다 (실측: CMS 31·32행)', () => {
    const rows = [rawRow({ laborFormulaUnrecognized: true, laborUnitPrice: '0' })];
    const result = verifyLaborRows([sheetOf(rows)]);
    expect(result.counts.미검증).toBe(1);
    expect(result.counts.불일치).toBe(0);
    expect(Object.keys(result.unverifiedReasons)[0]).toContain('수식');
  });

  it('직종 금액 칸이 상수로 덮여 있으면 미검증이다 (실측: CMS 9행)', () => {
    const rows = [rawRow({ tradeAmountShape: 'constant', laborUnitPrice: '98417' })];
    const result = verifyLaborRows([sheetOf(rows)]);
    expect(result.counts.미검증).toBe(1);
    expect(result.counts.불일치).toBe(0);
    expect(Object.keys(result.unverifiedReasons)[0]).toContain('상수');
  });
});

describe('buildLabor — 배율을 매핑에 싣는다', () => {
  it('배율이 있으면 매핑에 담는다', () => {
    const { mappings } = buildLabor([sheetOf([rawRow({ laborMultiplier: '0.3' })])], { periodLabel: '26년 하반기' });
    expect(mappings[0]?.multiplier).toBe('0.3');
  });

  it('배율이 없으면 담지 않는다 — 1을 억지로 넣지 않는다', () => {
    const { mappings } = buildLabor([sheetOf([rawRow()])], { periodLabel: '26년 하반기' });
    expect(mappings[0]).not.toHaveProperty('multiplier');
  });
});

// ---------------------------------------------------------------------------
/**
 * 오디오 371행 — 그 행의 직종 금액 칸 3개만 `=INT(공수*노임)` 이다.
 * 실측 그대로 쓴다: 0.2×324,979 / 0.2×316,875 / 0.2×446,560, 요율 0.63.
 *
 * ```
 * 직종별 INT:  64,995 + 63,375 + 89,312 = 217,682 → INT(×0.63) = 137,139  ← 원본
 * 합산 후 INT: 217,682.8              → INT(×0.63) = 137,140  ← 1원 어긋난다
 * ```
 *
 * ⛔ **일반 규칙이 아니다.** 전수 3,239칸이 `=공수*노임` 이고 이 행만 예외다.
 * 전 행에 적용하면 통과가 1,354 → 753 으로 급감한다.
 */
const R371_WAGES: WageTable = {
  wageTableId: 'WAGE-26년 하반기',
  periodLabel: '26년 하반기',
  source: '시험',
  wages: {
    통신관련기사: { amount: '324979', unit: 'M/D' },
    통신설비공: { amount: '316875', unit: 'M/D' },
    'S/W시험사': { amount: '446560', unit: 'M/D' },
  },
};

const R371_ITEM: LaborItem = {
  laborItemId: 'AUD-0371',
  code: '7-11-1-합성',
  description: '버튼 Controller',
  baseUnit: 'EA',
  source: '시험',
  revision: '26년 하반기',
  wageUnit: 'M/D',
  trades: [
    { trade: '통신관련기사', quantity: '0.2' },
    { trade: '통신설비공', quantity: '0.2' },
    { trade: 'S/W시험사', quantity: '0.2' },
  ],
};

const r371Mapping: LaborMapping = {
  laborMappingId: 'AUD-0371', sku: 'AUD-0371', laborItemId: 'AUD-0371',
  conversionFactor: '1', surcharge: '0', itemRate: '0.63', confirmed: false, note: '시험',
};

describe('직종별 INT — 그 행의 수식 모양을 그대로 따른다', () => {
  it('표시가 없으면 지금처럼 합산 후 INT 한다', () => {
    expect(calculateLaborUnitPrice(R371_ITEM, r371Mapping, R371_WAGES).appliedUnitPrice.toFixed())
      .toBe('137140');
  });

  it("perTradeRounding='int' 이면 직종마다 INT 한 뒤 더한다 — 원본과 같은 137,139", () => {
    const item: LaborItem = { ...R371_ITEM, perTradeRounding: 'int' };
    expect(calculateLaborUnitPrice(item, r371Mapping, R371_WAGES).appliedUnitPrice.toFixed())
      .toBe('137139');
  });

  it('근거에 표준단가도 직종별 INT 로 담긴다', () => {
    const item: LaborItem = { ...R371_ITEM, perTradeRounding: 'int' };
    expect(calculateLaborUnitPrice(item, r371Mapping, R371_WAGES).standardUnitPrice.toFixed())
      .toBe('217682');
  });
});

const R371_SHEET_WAGES: RawSheet['wages'] = [
  { trade: '통신관련기사', unit: 'M/D', amount: '324979', quantityColumn: 'W' },
  { trade: '통신설비공', unit: 'M/D', amount: '316875', quantityColumn: 'AA' },
  { trade: 'S/W시험사', unit: 'M/D', amount: '446560', quantityColumn: 'AW' },
];

function r371Raw(over: Partial<RawSheet['rows'][number]> = {}): RawSheet['rows'][number] {
  return {
    row: 371, name: '버튼 Controller', spec: 'MXA MUTE', unit: 'EA',
    materialUnitPrice: '100000', laborCode: '7-11-1-합성', itemRate: '0.63',
    laborUnitPrice: '137139',
    trades: [
      { trade: '통신관련기사', quantity: '0.2' },
      { trade: '통신설비공', quantity: '0.2' },
      { trade: 'S/W시험사', quantity: '0.2' },
    ],
    ...over,
  };
}

const r371SheetOf = (rows: RawSheet['rows']) => ({ name: '오디오', wages: R371_SHEET_WAGES, rows });

describe('역산 검증 — 금액 칸 모양을 반영한다', () => {
  it("tradeAmountShape='int' 면 직종별 INT 로 대조해 통과한다", () => {
    const rows = [r371Raw({ tradeAmountShape: 'int' })];
    expect(verifyLaborRows([r371SheetOf(rows)]).counts.통과).toBe(1);
  });

  it('표시가 없으면 합산 후 INT 라서 1원 어긋나 불일치다 — 이 처리가 살아 있다는 증거', () => {
    expect(verifyLaborRows([r371SheetOf([r371Raw()])]).counts.불일치).toBe(1);
  });

  it("'mixed' 는 아는 모양이 아니므로 미검증이다", () => {
    const result = verifyLaborRows([r371SheetOf([r371Raw({ tradeAmountShape: 'mixed' })])]);
    expect(result.counts.미검증).toBe(1);
    expect(result.counts.불일치).toBe(0);
    expect(Object.keys(result.unverifiedReasons)[0]).toContain('섞여');
  });

  it("'constant' 는 상수로 덮인 것이므로 미검증이다", () => {
    const result = verifyLaborRows([r371SheetOf([r371Raw({ tradeAmountShape: 'constant' })])]);
    expect(result.counts.미검증).toBe(1);
    expect(Object.keys(result.unverifiedReasons)[0]).toContain('상수');
  });
});

describe('buildLabor — 금액 칸 모양을 품셈 항목에 싣는다', () => {
  it("'int' 면 품셈 항목에 perTradeRounding 을 담는다", () => {
    const { laborItems } = buildLabor([r371SheetOf([r371Raw({ tradeAmountShape: 'int' })])], { periodLabel: '26년 하반기' });
    expect(laborItems[0]?.perTradeRounding).toBe('int');
  });

  it('표시가 없으면 담지 않는다', () => {
    const { laborItems } = buildLabor([r371SheetOf([r371Raw()])], { periodLabel: '26년 하반기' });
    expect(laborItems[0]).not.toHaveProperty('perTradeRounding');
  });
});
