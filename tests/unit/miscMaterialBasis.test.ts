import { describe, expect, it } from 'vitest';
import { calculateQuote } from '@/domain/calculation/calculate';
import { makeDocument, itemRow, system } from '../fixtures/document';
import type { DerivedRow } from '@/domain/quote/types';

describe('D19 잡자재비 합산 제외', () => {
  it('캐비넷만 제외하고 부속품과 배관 기타자재는 포함한다', () => {
    const doc = makeDocument({ systems: [system('S1', { indirect: [] })], rows: [
      itemRow('cabinet', 'S1', { quantity: '10', price: '100000' }),
      itemRow('sbox', 'S1', { quantity: '1', price: '10000', laborPrice: '99999' }),
      itemRow('conduit', 'S1', { quantity: '3', price: '1000' }),
    ] });
    const common = { systemId: 'S1', name: '', specification: '', unit: '식', quantity: '1',
      laborMode: 'not-applicable' as const, remark: '', origin: 'rule' as const };
    doc.derivedRows = [
      { ...common, rowId: 'conduit-mat', derived: { kind: 'single-row-material', sourceRowId: 'conduit' }, rate: '0.2' },
      { ...common, rowId: 'misc', derived: { kind: 'material-sum-to-here', excludedRowIds: ['cabinet', 'cabinet'] }, rate: '0.02' },
    ] as DerivedRow[];
    const calc = calculateQuote(doc);
    expect(calc.systems[0]!.rows.find(r => r.rowId === 'misc')!.materialAmount!.toFixed()).toBe('272');
    expect(calc.systems[0]!.rows.find(r => r.rowId === 'cabinet')!.materialAmount!.toFixed()).toBe('1000000');
  });

  it('캐비넷만 있는 시스템은 잡자재비가 0이며 캐비넷 금액 자체는 유지한다', () => {
    const doc = makeDocument({ systems: [system('S1', { indirect: [] })], rows: [
      itemRow('cabinet', 'S1', { quantity: '1', price: '999999' }),
    ] });
    doc.derivedRows = [{ rowId: 'misc', systemId: 'S1', name: '잡자재비', specification: '', unit: '식', quantity: '1',
      laborMode: 'not-applicable', remark: '', origin: 'rule', rate: '0.02',
      derived: { kind: 'material-sum-to-here', excludedRowIds: ['cabinet'] },
    }] as DerivedRow[];
    expect(calculateQuote(doc).systems[0]!.directMaterial.toFixed()).toBe('999999');
  });
});
