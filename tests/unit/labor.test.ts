import { describe, it, expect } from 'vitest';
import {
  calculateLaborUnitPrice,
  calculateLaborForRows,
  computeRowConfirmationFingerprint,
  type LaborRowRequest,
} from '@/domain/labor/calculateLabor';
import { computeLaborConfirmationFingerprint } from '@/domain/labor/laborConfirmation';
import type { LaborItem, LaborMapping, WageTable } from '@/domain/labor/types';

/** 설계서 §5.6: 합성 품셈·노임. 회사 자료가 아니다. */
const wages: WageTable = {
  wageTableId: 'w-test',
  periodLabel: '테스트 반기',
  source: '합성 테스트 값',
  wages: {
    통신내선공: { amount: '200000', unit: 'M/D' },
    통신설비공: { amount: '100000', unit: 'M/D' },
  },
};

const item: LaborItem = {
  laborItemId: 'L-001',
  code: 'TEST-01',
  description: '테스트 설치 품셈',
  baseUnit: 'EA',
  source: '합성 테스트 값',
  revision: '2026 상반기',
  wageUnit: 'M/D',
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
    expect(r.tradeAmounts[0]!.wageUnit).toBe('M/D');
    expect(r.tradeAmounts[0]!.quantity.toFixed()).toBe('0.06');
  });

  /**
   * 독립 검토 지적: 화면이 `breakdown.source`를 "노임 출처"라는 이름으로
   * 보여주고 있었다. `source`는 **품셈 항목**(`item.source`)의 출처다 —
   * 적용된 노임표(`WageTable.source`/`wageTableId`)와는 다른 축이다.
   * `buildGuideBasis`가 노임만 가이드 것으로 바꾸고 품셈은 배포본
   * 그대로 두므로, 실제로는 둘이 다른 값일 때가 흔하다. 두 출처가
   * 서로 다른 합성 값일 때도 섞이지 않고 각자 제 값을 내놓는지 본다.
   */
  it('품셈 출처와 적용 노임표 출처는 서로 다른 축이다 — 섞어서 내놓지 않는다', () => {
    const itemWithOwnSource: LaborItem = { ...item, source: '품셈 전용 출처 — A' };
    const wagesWithOwnSource: WageTable = { ...wages, wageTableId: 'WAGE-다른-출처', source: '노임표 전용 출처 — B' };
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
    const r = calculateLaborUnitPrice(itemWithOwnSource, mapping, wagesWithOwnSource);
    expect(r.source).toBe('품셈 전용 출처 — A');
    expect(r.wageTableSource).toBe('노임표 전용 출처 — B');
    expect(r.wageTableId).toBe('WAGE-다른-출처');
    expect(r.source).not.toBe(r.wageTableSource);
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
      [{ rowId: 'r1', laborMappingId: 'm1', identity: { unit: 'EA', quantity: '1', ruleVersion: 'rule-v1' } }],
      { items: [item], mappings: [mapping], wages },
    );
    expect(result.unitPrices.get('r1')?.toFixed()).toBe('19800');
  });

  it('존재하지 않는 매핑 id는 경고로 남기고 단가를 만들지 않는다', () => {
    const result = calculateLaborForRows(
      [{ rowId: 'r1', laborMappingId: 'nope', identity: { unit: 'EA', quantity: '1', ruleVersion: 'rule-v1' } }],
      { items: [item], mappings: [], wages },
    );
    expect(result.unitPrices.has('r1')).toBe(false);
    expect(result.warnings.some((w) => w.code === 'mapping-missing')).toBe(true);
  });

  describe('노무 확인(Task 6 보완 Task B) — 같은 매핑을 쓰는 행 중 확인된 행만 선별 해제', () => {
    const unconfirmedMapping: LaborMapping = {
      laborMappingId: 'm1',
      sku: 'SKU-1',
      laborItemId: 'L-001',
      conversionFactor: '1',
      surcharge: '0',
      itemRate: '1',
      confirmed: false,
      note: '자동 매칭, 미확인',
    };
    const reference = { items: [item], mappings: [unconfirmedMapping], wages };

    function fingerprintFor(rowId: string, overrides: Partial<Parameters<typeof computeLaborConfirmationFingerprint>[0]> = {}): string {
      return computeLaborConfirmationFingerprint({
        rowId,
        laborMappingId: 'm1',
        laborItemId: 'L-001',
        code: 'TEST-01',
        trades: item.trades,
        tradeWages: [
          { trade: '통신내선공', amount: '200000', unit: 'M/D' },
          { trade: '통신설비공', amount: '100000', unit: 'M/D' },
        ],
        wageTableId: 'w-test',
        wageUnit: 'M/D',
        baseUnit: 'EA',
        rowUnit: 'EA',
        itemRate: '1',
        surcharge: '0',
        conversionFactor: '1',
        quantity: '1',
        ruleVersion: 'rule-v1',
        ...overrides,
      });
    }

    const identity = { unit: 'EA', quantity: '1', ruleVersion: 'rule-v1' };

    it('같은 매핑을 쓰는 두 행 중 한 행만 확인하면 다른 행은 여전히 막힌다', () => {
      const requests: LaborRowRequest[] = [
        {
          rowId: 'r1',
          laborMappingId: 'm1',
          identity,
          existingConfirmation: { basisFingerprint: fingerprintFor('r1'), confirmedAt: '2026-10-05' },
        },
        { rowId: 'r2', laborMappingId: 'm1', identity },
      ];
      const result = calculateLaborForRows(requests, reference);

      const r1 = result.breakdowns.get('r1')!;
      const r2 = result.breakdowns.get('r2')!;
      expect(r1.warnings.some((w) => w.code === 'mapping-unconfirmed')).toBe(false);
      expect(r1.blocking).toBe(false);
      expect(r2.warnings.some((w) => w.code === 'mapping-unconfirmed')).toBe(true);
      expect(r2.blocking).toBe(true);
      expect(result.warnings.filter((w) => w.rowId === 'r1' && w.code === 'mapping-unconfirmed')).toHaveLength(0);
      expect(result.warnings.some((w) => w.rowId === 'r2' && w.code === 'mapping-unconfirmed')).toBe(true);
    });

    it('지문이 현재 근거와 다르면(노임 등이 바뀌었으면) 확인은 무효 — 여전히 막힌다', () => {
      const requests: LaborRowRequest[] = [
        {
          rowId: 'r1',
          laborMappingId: 'm1',
          identity,
          existingConfirmation: { basisFingerprint: fingerprintFor('r1', { quantity: '999' }), confirmedAt: '2026-10-05' },
        },
      ];
      const result = calculateLaborForRows(requests, reference);
      const r1 = result.breakdowns.get('r1')!;
      expect(r1.warnings.some((w) => w.code === 'mapping-unconfirmed')).toBe(true);
      expect(r1.blocking).toBe(true);
    });

    it('breakdown.currentFingerprint는 확인 여부와 무관하게 항상 있다 — 화면이 처음 확인할 때도 쓸 수 있다', () => {
      const result = calculateLaborForRows([{ rowId: 'r1', laborMappingId: 'm1', identity }], reference);
      const r1 = result.breakdowns.get('r1')!;
      expect(r1.currentFingerprint).toBe(fingerprintFor('r1'));
      expect(r1.blocking).toBe(true); // 아직 확인 전이니 막혀 있다 — 지문만 먼저 계산된다.
    });

    it('computeRowConfirmationFingerprint가 만든 지문을 그대로 확인에 쓰면 그 행만 풀린다 — 화면 "확인함" 버튼이 쓸 계산과 재검증이 같은 결과를 낸다', () => {
      const fingerprint = computeRowConfirmationFingerprint('r1', 'm1', reference, identity);
      expect(fingerprint).toBe(fingerprintFor('r1'));

      const result = calculateLaborForRows(
        [
          {
            rowId: 'r1',
            laborMappingId: 'm1',
            identity,
            existingConfirmation: { basisFingerprint: fingerprint!, confirmedAt: '2026-10-05' },
          },
        ],
        reference,
      );
      expect(result.breakdowns.get('r1')!.blocking).toBe(false);
    });

    it('존재하지 않는 매핑으로는 지문을 계산할 수 없다 — undefined를 돌려준다', () => {
      const fingerprint = computeRowConfirmationFingerprint('r1', 'nope', reference, {
        unit: 'EA',
        quantity: '1',
        ruleVersion: 'rule-v1',
      });
      expect(fingerprint).toBeUndefined();
    });
  });
});
