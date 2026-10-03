import { describe, it, expect } from 'vitest';
import {
  calculateLaborUnitPrice,
  calculateLaborForRows,
} from '@/domain/labor/calculateLabor';
import type { LaborItem, LaborMapping, WageTable } from '@/domain/labor/types';

/** 설계서 §5.6: 합성 품셈·노임. 회사 자료가 아니다. */
const wages: WageTable = {
  wageTableId: 'w-test',
  periodLabel: '테스트 반기',
  source: '합성 테스트 값',
  wages: {
    '통신내선공': '200000',
    '통신설비공': '100000',
  },
};

const item: LaborItem = {
  laborItemId: 'L-001',
  code: 'TEST-01',
  description: '테스트 설치 품셈',
  baseUnit: 'EA',
  source: '합성 테스트 값',
  revision: '2026 상반기',
  trades: [
    { trade: '통신내선공', quantity: '0.06' },
    { trade: '통신설비공', quantity: '0.03' },
  ],
};

describe('calculateLaborUnitPrice — 설계서 §5.2, §5.6', () => {
  it('표준 노무 단가 = Σ(직종별 품 × 노임) → 15,000', () => {
    const mapping: LaborMapping = {
      laborMappingId: 'm1',
      sku: 'SKU-1',
      laborItemId: 'L-001',
      conversionFactor: '1',
      surcharge: '0',
      itemRate: '1',
      confirmed: true,
      note: '',
    };
    const r = calculateLaborUnitPrice(item, mapping, wages);
    expect(r.standardUnitPrice.toFixed()).toBe('15000');
    expect(r.tradeAmounts.map((t) => t.amount.toFixed())).toEqual(['12000', '3000']);
  });

  it('적용 노무 단가 = INT(표준 × (1+할증) × 요율) → 15,000 × 1.1 × 1.2 = 19,800', () => {
    const mapping: LaborMapping = {
      laborMappingId: 'm1',
      sku: 'SKU-1',
      laborItemId: 'L-001',
      conversionFactor: '1',
      surcharge: '0.1',
      itemRate: '1.2',
      confirmed: true,
      note: '',
    };
    const r = calculateLaborUnitPrice(item, mapping, wages);
    expect(r.appliedUnitPrice.toFixed()).toBe('19800');
  });

  it('INT가 소수를 버린다', () => {
    const mapping: LaborMapping = {
      laborMappingId: 'm1',
      sku: 'SKU-1',
      laborItemId: 'L-001',
      conversionFactor: '1',
      surcharge: '0.07',
      itemRate: '1.13',
      confirmed: true,
      note: '',
    };
    const r = calculateLaborUnitPrice(item, mapping, wages);
    // 15000 * 1.07 * 1.13 = 18136.5 → INT → 18136
    expect(r.appliedUnitPrice.toFixed()).toBe('18136');
  });

  it('품셈 기준 단위와 판매 단위가 다르면 환산 계수를 곱한다', () => {
    const mapping: LaborMapping = {
      laborMappingId: 'm1',
      sku: 'SKU-1',
      laborItemId: 'L-001',
      // 품셈은 EA 기준, 판매는 10EA 묶음 → 10배
      conversionFactor: '10',
      surcharge: '0',
      itemRate: '1',
      confirmed: true,
      note: '10EA 묶음 판매',
    };
    const r = calculateLaborUnitPrice(item, mapping, wages);
    expect(r.appliedUnitPrice.toFixed()).toBe('150000');
    expect(r.conversionFactor.toFixed()).toBe('10');
  });

  it('노임표에 없는 직종은 던지지 않고 경고로 남기고 확정을 막는다', () => {
    const badItem: LaborItem = {
      ...item,
      trades: [{ trade: '존재하지않는직종', quantity: '0.5' }],
    };
    const mapping: LaborMapping = {
      laborMappingId: 'm1',
      sku: 'SKU-1',
      laborItemId: 'L-001',
      conversionFactor: '1',
      surcharge: '0',
      itemRate: '1',
      confirmed: true,
      note: '',
    };
    const r = calculateLaborUnitPrice(badItem, mapping, wages);
    expect(r.warnings.some((w) => w.code === 'wage-missing')).toBe(true);
    expect(r.blocking).toBe(true);
  });

  it('미확인 매핑은 계산하되 확정을 막는다 — 설계서 §5.3', () => {
    const mapping: LaborMapping = {
      laborMappingId: 'm1',
      sku: 'SKU-1',
      laborItemId: 'L-001',
      conversionFactor: '1',
      surcharge: '0',
      itemRate: '1',
      confirmed: false,
      note: '자동 매칭, 미확인',
    };
    const r = calculateLaborUnitPrice(item, mapping, wages);
    expect(r.appliedUnitPrice.toFixed()).toBe('15000');
    expect(r.warnings.some((w) => w.code === 'mapping-unconfirmed')).toBe(true);
    expect(r.blocking).toBe(true);
  });

  it('근거 추적 정보를 전부 내놓는다 — 설계서 §5.3 표시 항목', () => {
    const mapping: LaborMapping = {
      laborMappingId: 'm1',
      sku: 'SKU-1',
      laborItemId: 'L-001',
      conversionFactor: '1',
      surcharge: '0.1',
      itemRate: '1.2',
      confirmed: true,
      note: '',
    };
    const r = calculateLaborUnitPrice(item, mapping, wages);
    expect(r.code).toBe('TEST-01');
    expect(r.description).toBe('테스트 설치 품셈');
    expect(r.baseUnit).toBe('EA');
    expect(r.source).toBe('합성 테스트 값');
    expect(r.revision).toBe('2026 상반기');
    expect(r.wagePeriod).toBe('테스트 반기');
    expect(r.roundingMethod).toBe('INT');
    expect(r.tradeAmounts[0]).toMatchObject({ trade: '통신내선공' });
    expect(r.tradeAmounts[0]!.wage.toFixed()).toBe('200000');
    expect(r.tradeAmounts[0]!.quantity.toFixed()).toBe('0.06');
  });
});

describe('calculateLaborForRows — 행별 노무 단가 주입', () => {
  it('mapped 행의 단가를 rowId 기준으로 돌려준다', () => {
    const mapping: LaborMapping = {
      laborMappingId: 'm1',
      sku: 'SKU-1',
      laborItemId: 'L-001',
      conversionFactor: '1',
      surcharge: '0.1',
      itemRate: '1.2',
      confirmed: true,
      note: '',
    };
    const result = calculateLaborForRows(
      [{ rowId: 'r1', laborMappingId: 'm1' }],
      { items: [item], mappings: [mapping], wages },
    );
    expect(result.unitPrices.get('r1')?.toFixed()).toBe('19800');
  });

  it('존재하지 않는 매핑 id는 경고로 남기고 단가를 만들지 않는다', () => {
    const result = calculateLaborForRows(
      [{ rowId: 'r1', laborMappingId: 'nope' }],
      { items: [item], mappings: [], wages },
    );
    expect(result.unitPrices.has('r1')).toBe(false);
    expect(result.warnings.some((w) => w.code === 'mapping-missing')).toBe(true);
  });
});
