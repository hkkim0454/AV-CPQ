import { describe, expect, it } from 'vitest';
import {
  confirmLaborRowIfDisplayedFingerprintMatches,
  withLaborConfirmed,
  withLaborModeSwitch,
} from '@/domain/quote/laborRowEdits';
import { computeRowConfirmationFingerprint } from '@/domain/labor/calculateLabor';
import type { LaborItem, LaborMapping, WageTable } from '@/domain/labor/types';
import type { QuoteRow } from '@/domain/quote/types';

function row(partial: Partial<QuoteRow> = {}): QuoteRow {
  return {
    rowId: 'r1',
    systemId: 'S1',
    name: '행1',
    specification: '',
    unit: 'EA',
    quantity: '1',
    laborMode: 'mapped',
    laborMappingId: 'm1',
    remark: '',
    origin: 'manual',
    ...partial,
  };
}

describe('withLaborModeSwitch — 모드 전환 시 이전 금액·사유·확인을 남기지 않는다', () => {
  it('mapped → manual: 이전 확인이 있어도 지운다', () => {
    const before = row({ laborConfirmation: { basisFingerprint: 'fp', confirmedAt: '2026-10-05' } });
    const after = withLaborModeSwitch(before, 'manual');
    expect(after.laborMode).toBe('manual');
    expect(after.laborConfirmation).toBeUndefined();
  });

  it('manual → not-applicable: 이전 수동 단가·사유를 지운다', () => {
    const before = row({ laborMode: 'manual', manualLaborUnitPrice: '5000', overrideReason: '사유' });
    const after = withLaborModeSwitch(before, 'not-applicable');
    expect(after.laborMode).toBe('not-applicable');
    expect(after.manualLaborUnitPrice).toBeUndefined();
    expect(after.overrideReason).toBeUndefined();
  });

  it('not-applicable → mapped: 이전 사유를 지운다 — 다시 확인해야 한다', () => {
    const before = row({ laborMode: 'not-applicable', overrideReason: '해당없음 사유' });
    const after = withLaborModeSwitch(before, 'mapped');
    expect(after.laborMode).toBe('mapped');
    expect(after.overrideReason).toBeUndefined();
    expect(after.laborConfirmation).toBeUndefined();
  });

  it('rowId·수량 등 노무와 무관한 칸은 그대로 둔다', () => {
    const before = row({ quantity: '7', remark: '비고 유지' });
    const after = withLaborModeSwitch(before, 'manual');
    expect(after.quantity).toBe('7');
    expect(after.remark).toBe('비고 유지');
  });
});

describe('withLaborConfirmed — 지금 지문으로 확인한다', () => {
  it('basisFingerprint·confirmedAt을 그대로 싣는다', () => {
    const after = withLaborConfirmed(row(), 'fp-123', '2026-10-05T00:00:00.000Z');
    expect(after.laborConfirmation).toEqual({ basisFingerprint: 'fp-123', confirmedAt: '2026-10-05T00:00:00.000Z' });
  });

  it('다른 칸은 건드리지 않는다', () => {
    const before = row({ remark: '비고' });
    const after = withLaborConfirmed(before, 'fp', '2026-10-05');
    expect(after.remark).toBe('비고');
    expect(after.laborMode).toBe('mapped');
  });
});

describe('confirmLaborRowIfDisplayedFingerprintMatches — 표시 지문과 지금 지문을 비교해서만 확인한다', () => {
  const wages: WageTable = {
    wageTableId: 'w-test',
    periodLabel: '테스트 반기',
    source: '합성 테스트 값',
    wages: { 통신내선공: { amount: '200000', unit: 'M/D' } },
  };
  const item: LaborItem = {
    laborItemId: 'L-001',
    code: 'TEST-01',
    description: '테스트 설치 품셈',
    baseUnit: 'EA',
    source: '합성 테스트 값',
    revision: '2026 상반기',
    wageUnit: 'M/D',
    trades: [{ trade: '통신내선공', quantity: '0.06' }],
  };
  const mapping: LaborMapping = {
    laborMappingId: 'm1',
    sku: 'SKU-1',
    laborItemId: 'L-001',
    conversionFactor: '1',
    surcharge: '0',
    itemRate: '1',
    confirmed: false,
    note: '',
  };
  const reference = { items: [item], mappings: [mapping], wages };
  const identity = { unit: 'EA', quantity: '1', ruleVersion: 'rule-v1' };

  it('화면이 보여준 지문과 지금 지문이 같으면 확인한다', () => {
    const displayed = computeRowConfirmationFingerprint('r1', 'm1', reference, identity)!;
    const result = confirmLaborRowIfDisplayedFingerprintMatches(row(), reference, identity, displayed, '2026-10-05');
    expect(result?.laborConfirmation).toEqual({ basisFingerprint: displayed, confirmedAt: '2026-10-05' });
  });

  it('화면이 보여준 지문이 오래됐으면(지금 지문과 다르면) 거부한다 — undefined', () => {
    const staleDisplayed = computeRowConfirmationFingerprint('r1', 'm1', reference, { ...identity, quantity: '999' })!;
    const result = confirmLaborRowIfDisplayedFingerprintMatches(row(), reference, identity, staleDisplayed, '2026-10-05');
    expect(result).toBeUndefined();
  });

  it('mapped 모드가 아니면 거부한다', () => {
    const displayed = computeRowConfirmationFingerprint('r1', 'm1', reference, identity)!;
    const result = confirmLaborRowIfDisplayedFingerprintMatches(
      row({ laborMode: 'manual' }),
      reference,
      identity,
      displayed,
      '2026-10-05',
    );
    expect(result).toBeUndefined();
  });

  it('존재하지 않는 매핑이면 거부한다', () => {
    const result = confirmLaborRowIfDisplayedFingerprintMatches(
      row({ laborMappingId: 'nope' }),
      reference,
      identity,
      'anything',
      '2026-10-05',
    );
    expect(result).toBeUndefined();
  });
});
