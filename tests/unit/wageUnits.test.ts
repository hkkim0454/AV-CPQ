import { describe, it, expect } from 'vitest';
import { calculateLaborUnitPrice } from '@/domain/labor/calculateLabor';
import type { LaborItem, LaborMapping, WageTable } from '@/domain/labor/types';

/**
 * 노임 단위 (결정 문서 D1).
 *
 * 품셈 파일의 노임은 대부분 **M/D**(인·일)지만, CMS 시트 전용 4개 직종만 **M/M**(인·월)이다.
 * 섞으면 노무비가 약 20배 틀린다 (한 달 ≈ 20 일).
 *
 * 그래서 노임표는 단위를 함께 들고, 품셈 항목이 기대하는 단위와 다르면
 * **조용히 환산하지 않고 차단한다.** 환산은 사람이 지정한 `conversionFactor`로만 한다.
 */

const wages: WageTable = {
  wageTableId: 'w-2026H1',
  periodLabel: '2026 상반기',
  source: '합성 테스트 값',
  wages: {
    통신내선공: { amount: '200000', unit: 'M/D' },
    '응용SW개발자': { amount: '6000000', unit: 'M/M' },
  },
};

function item(trade: string, quantity: string, expectedUnit: 'M/D' | 'M/M'): LaborItem {
  return {
    laborItemId: 'L-1',
    code: 'T-1',
    description: '테스트',
    baseUnit: 'EA',
    source: '합성',
    revision: '2026 상반기',
    wageUnit: expectedUnit,
    trades: [{ trade, quantity }],
  };
}

const mapping: LaborMapping = {
  laborMappingId: 'm1',
  sku: 'SKU-1',
  laborItemId: 'L-1',
  conversionFactor: '1',
  surcharge: '0',
  itemRate: '1',
  confirmed: true,
  note: '',
};

describe('노임 단위 일치 검사', () => {
  it('단위가 맞으면 평소대로 계산한다', () => {
    const r = calculateLaborUnitPrice(item('통신내선공', '0.5', 'M/D'), mapping, wages);
    expect(r.standardUnitPrice.toFixed()).toBe('100000');
    expect(r.blocking).toBe(false);
  });

  it('M/M 노임도 단위가 맞으면 그대로 쓴다', () => {
    const r = calculateLaborUnitPrice(item('응용SW개발자', '0.5', 'M/M'), mapping, wages);
    expect(r.standardUnitPrice.toFixed()).toBe('3000000');
    expect(r.blocking).toBe(false);
  });

  it('품셈이 M/D를 기대하는데 노임이 M/M이면 차단한다 — 조용히 20배 틀리게 두지 않는다', () => {
    const r = calculateLaborUnitPrice(item('응용SW개발자', '0.5', 'M/D'), mapping, wages);
    expect(r.blocking).toBe(true);
    expect(r.warnings.some((w) => w.code === 'wage-unit-mismatch')).toBe(true);
    expect(r.warnings.find((w) => w.code === 'wage-unit-mismatch')?.message).toContain('M/M');
  });

  it('품셈이 M/M을 기대하는데 노임이 M/D여도 차단한다', () => {
    const r = calculateLaborUnitPrice(item('통신내선공', '0.5', 'M/M'), mapping, wages);
    expect(r.blocking).toBe(true);
    expect(r.warnings.some((w) => w.code === 'wage-unit-mismatch')).toBe(true);
  });

  it('단위가 어긋나도 임의로 환산하지 않는다 — 금액을 0으로 둔다', () => {
    const r = calculateLaborUnitPrice(item('응용SW개발자', '0.5', 'M/D'), mapping, wages);
    expect(r.standardUnitPrice.toFixed()).toBe('0');
    expect(r.appliedUnitPrice.toFixed()).toBe('0');
  });

  it('직종별 내역에 노임 단위를 표시한다 (설계서 §5.3 추적성)', () => {
    const r = calculateLaborUnitPrice(item('통신내선공', '0.5', 'M/D'), mapping, wages);
    expect(r.tradeAmounts[0]!.wageUnit).toBe('M/D');
    expect(r.wageUnit).toBe('M/D');
  });

  it('한 품셈 항목이 단위가 다른 직종을 섞으면 차단한다', () => {
    const mixed: LaborItem = {
      ...item('통신내선공', '0.5', 'M/D'),
      trades: [
        { trade: '통신내선공', quantity: '0.5' },
        { trade: '응용SW개발자', quantity: '0.1' },
      ],
    };
    const r = calculateLaborUnitPrice(mixed, mapping, wages);
    expect(r.blocking).toBe(true);
    expect(r.warnings.some((w) => w.code === 'wage-unit-mismatch')).toBe(true);
  });
});
