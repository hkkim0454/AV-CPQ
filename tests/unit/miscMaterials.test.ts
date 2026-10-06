import { describe, expect, it } from 'vitest';
import {
  synchronizeMiscMaterials,
  computeMiscMaterialWarnings,
  planMiscMaterialMigration,
  migrateMiscMaterials,
} from '@/domain/quote/miscMaterials';
import { makeDocument, itemRow, system } from '../fixtures/document';
import { cat } from '../fixtures/diagram';
import type { CatalogProduct } from '@/data/catalog/load';
import type { DerivedRow, QuoteDocument } from '@/domain/quote/types';

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

/**
 * Task 3·4 잔여 2번 — 옛 기준의 잡자재 행이 있는 저장 문서를 **자동으로**
 * 바꾸지 않되, 사용자가 확인한 뒤 옮길 수 있는 길을 낸다.
 */
describe('잡자재비 기준 이전', () => {
  /** 캐비넷(MMF) 100만 + 일반 자재 10만. 옛 행은 캐비넷을 빼지 않는다. */
  function legacyDocument(): QuoteDocument {
    const doc = makeDocument({
      systems: [system('S1', { indirect: [] })],
      rows: [
        withSku(itemRow('r1', 'S1', { quantity: '1', price: '1000000', name: 'LED 캐비넷' }), 'CAB'),
        withSku(itemRow('r2', 'S1', { quantity: '1', price: '100000', name: '일반 자재' }), 'BOX'),
      ],
    });
    doc.derivedRows = [{
      rowId: 'legacy-misc', systemId: 'S1', name: '잡자재비', specification: '재료비의 2%',
      unit: '식', quantity: '1', laborMode: 'not-applicable', remark: '', origin: 'rule',
      ruleInstanceId: 'misc-material-v0', rate: '0.02',
      derived: { kind: 'material-sum-to-here', excludedRowIds: [] },
    }] as DerivedRow[];
    return doc;
  }

  const legacyCatalog = () => cat([product('CAB', 'MMF'), product('BOX', 'S-BOX 및 부속품')]);

  it('옛 기준 행은 자동으로 바뀌지 않고 출력도 계속 막는다', () => {
    const doc = legacyDocument();
    const catalog = legacyCatalog();
    const synchronized = synchronizeMiscMaterials(doc, catalog);
    expect(synchronized.derivedRows).toHaveLength(1);
    expect(synchronized.derivedRows[0]!.rowId).toBe('legacy-misc');
    expect(computeMiscMaterialWarnings(synchronized, catalog)).toEqual([
      expect.objectContaining({ code: 'misc-basis-review-required', blocking: true }),
    ]);
  });

  it('무엇이 어떻게 달라지는지 미리 보여준다 — 옛 금액·새 금액과 제외될 캐비넷 행', () => {
    const plans = planMiscMaterialMigration(legacyDocument(), legacyCatalog());
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      systemId: 'S1',
      previousRowId: 'legacy-misc',
      // 110만 × 2% = 22000 → 캐비넷을 빼면 10만 × 2% = 2000
      previousAmount: '22000',
      nextAmount: '2000',
      excludedRows: [{ rowId: 'r1', name: 'LED 캐비넷' }],
    });
  });

  it('옮기기로 하면 새 기준 행으로 바뀌고 더는 막히지 않는다', () => {
    const catalog = legacyCatalog();
    const migrated = migrateMiscMaterials(legacyDocument(), catalog);
    expect(migrated.derivedRows).toHaveLength(1);
    expect(migrated.derivedRows[0]!.ruleInstanceId).toBe('misc-material-led-excluded-v1');
    expect(migrated.derivedRows[0]!.derived).toEqual({ kind: 'material-sum-to-here', excludedRowIds: ['r1'] });
    expect(computeMiscMaterialWarnings(migrated, catalog)).toEqual([]);
  });

  it('옮길 옛 기준 행이 없으면 계획도 없고 문서도 그대로다', () => {
    const doc = synchronizeMiscMaterials(
      makeDocument({ systems: [system('S1', { indirect: [] })], rows: [] }),
      legacyCatalog(),
    );
    expect(planMiscMaterialMigration(doc, legacyCatalog())).toEqual([]);
    expect(migrateMiscMaterials(doc, legacyCatalog())).toEqual(doc);
  });
});
