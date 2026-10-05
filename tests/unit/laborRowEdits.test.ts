import { describe, expect, it } from 'vitest';
import { withLaborConfirmed, withLaborModeSwitch } from '@/domain/quote/laborRowEdits';
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
