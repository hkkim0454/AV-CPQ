import { describe, expect, it } from 'vitest';
import { synchronizeMiscMaterials, computeMiscMaterialWarnings } from '@/domain/quote/miscMaterials';
import { makeDocument, itemRow, system } from '../fixtures/document';
import { cat } from '../fixtures/diagram';
import type { CatalogProduct } from '@/data/catalog/load';

function withSku(row: ReturnType<typeof itemRow>, sku: string) {
  if (row.type !== 'item') throw new Error('Expected item fixture');
  return { ...row, sku };
}

const product = (sku: string, group: string): CatalogProduct => ({ productId: sku, sku, brand: '', model: sku,
  quoteName: sku, quoteSpec: '', unit: 'EA', options: { group }, currency: 'KRW', evidence: 'verified' });

describe('잡자재비 자동 행', () => {
  it('묶음 근거가 없는 품목은 이름으로 판단하지 않고 출력 확인 대상으로 남긴다', () => {
    const doc = makeDocument({ systems: [system('S1', { indirect: [] })], rows: [withSku(itemRow('r1', 'S1', { quantity: '1', price: '1000' }), 'UNKNOWN')] });
    expect(computeMiscMaterialWarnings(doc, cat([]))).toEqual([
      expect.objectContaining({ code: 'misc-classification-missing', blocking: true }),
    ]);
    expect(computeMiscMaterialWarnings(doc, cat([product('UNKNOWN', '케이블 자재')]))).toEqual([]);
  });

  it('모든 시스템에 한 행을 만들고 승인 묶음 캐비넷만 제외하며 반복해도 늘지 않는다', () => {
    const doc = makeDocument({ systems: [system('S1', { indirect: [] }), system('S2', { indirect: [] })], rows: [
      withSku(itemRow('r1', 'S1', { quantity: '1', price: '1000' }), 'CAB'),
      withSku(itemRow('r2', 'S1', { quantity: '1', price: '100' }), 'BOX'),
      withSku(itemRow('r3', 'S2', { quantity: '1', price: '50', name: 'LED 캐비넷이라는 이름의 다른 자재' }), 'OTHER'),
    ] });
    const catalog = cat([product('CAB', 'MMF'), product('BOX', 'S-BOX 및 부속품'), product('OTHER', '케이블 자재')]);
    const first = synchronizeMiscMaterials(doc, catalog);
    const second = synchronizeMiscMaterials(first, catalog);
    expect(second.derivedRows).toEqual(first.derivedRows);
    expect(second.derivedRows).toHaveLength(2);
    expect(second.derivedRows[0]!.derived).toEqual({ kind: 'material-sum-to-here', excludedRowIds: ['r1'] });
    expect(second.derivedRows[1]!.derived).toEqual({ kind: 'material-sum-to-here', excludedRowIds: [] });
    expect(doc.derivedRows).toHaveLength(0);
  });

  it('기존 배관 기타자재 뒤에 위치하고 삭제된 캐비넷 제외 참조는 갱신한다', () => {
    const doc = makeDocument({ systems: [system('S1', { indirect: [] })], rows: [
      withSku(itemRow('r1', 'S1', { quantity: '1', price: '1000' }), 'CAB'),
    ] });
    doc.derivedRows = [{ rowId: 'pipe-extra', systemId: 'S1', name: '배관 기타자재', specification: '', unit: '식',
      quantity: '1', laborMode: 'not-applicable', remark: '', origin: 'rule', rate: '0.2',
      derived: { kind: 'single-row-material', sourceRowId: 'r1' } }];
    const catalog = cat([product('CAB', 'MMF')]);
    const first = synchronizeMiscMaterials(doc, catalog);
    expect(first.derivedRows[0]!.rowId).toBe('pipe-extra');
    const second = synchronizeMiscMaterials({ ...first, rows: [] }, catalog);
    expect(second.derivedRows[1]!.rowId).toBe(first.derivedRows[1]!.rowId);
    expect(second.derivedRows[1]!.derived).toEqual({ kind: 'material-sum-to-here', excludedRowIds: [] });
  });
});
