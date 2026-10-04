import type { Catalog } from '../../data/catalog/load';
import type { DerivedRow, QuoteDocument } from './types';
import type { ImportWarning } from '../../import/diagram/devices';

const CABINET_GROUPS = new Set(['IEA', 'IEA-F', 'IEA-E', 'IEA-EF', 'IFR-M', 'IFR-MF', 'MPF', 'MMF', 'MMF-S']);
const RULE = 'misc-material-led-excluded-v1';

/** 품셈 묶음이 없는 행을 LED가 아닌 것으로 확정하지 않는다. */
export function computeMiscMaterialWarnings(document: QuoteDocument, catalog: Catalog): ImportWarning[] {
  const products = new Map(catalog.products.map(product => [product.sku, product]));
  const warnings: ImportWarning[] = [];
  for (const row of document.rows) {
    // 미연결 행은 기존 품목 경고가 차단한다. 연결된 뒤에도 근거가
    // 없을 때 이 경고를 추가해 같은 원인의 안내를 중복하지 않는다.
    if (row.type !== 'item' || row.sku === undefined) continue;
    const group = products.get(row.sku)?.options['group'];
    if (group === undefined || group.trim() === '') warnings.push({
      code: 'misc-classification-missing', blocking: true,
      message: `${row.name}: 품셈 묶음이 없어 잡자재비의 LED 캐비넷 제외 여부를 확인할 수 없습니다. 승인 품목 연결과 묶음을 확인해 주세요.`,
    });
  }
  if (document.derivedRows.some(row => row.derived.kind === 'material-sum-to-here' && row.ruleInstanceId !== RULE)) {
    warnings.push({ code: 'misc-basis-review-required', blocking: true,
      message: '기존 잡자재비 계산 기준이 있습니다. LED 캐비넷 제외 기준과 파생 행 순서를 확인한 뒤 재계산해야 합니다.' });
  }
  return warnings;
}

/** 새 견적의 자동 잡자재비. 기존에 가져온 별도 파생 행은 임의로 대체하지 않는다. */
export function synchronizeMiscMaterials(document: QuoteDocument, catalog: Catalog): QuoteDocument {
  const products = new Map(catalog.products.map(product => [product.sku, product]));
  const retained = document.derivedRows.filter(row => row.ruleInstanceId !== RULE);
  const generated: DerivedRow[] = [];
  for (const system of document.systems) {
    // 과거 문서의 수동 기준은 명시적 기준 변경에서 다룬다. 중복 부과하지 않는다.
    if (retained.some(row => row.systemId === system.systemId && row.derived.kind === 'material-sum-to-here')) continue;
    const excludedRowIds = document.rows.flatMap(row => {
      if (row.type !== 'item' || row.systemId !== system.systemId || row.sku === undefined) return [];
      const group = products.get(row.sku)?.options['group'];
      return group !== undefined && CABINET_GROUPS.has(group) ? [row.rowId] : [];
    });
    const previous = document.derivedRows.find(row => row.systemId === system.systemId && row.ruleInstanceId === RULE);
    generated.push({
      rowId: previous?.rowId ?? `derived-misc-${system.systemId}`, systemId: system.systemId,
      name: '잡자재비', specification: 'LED 캐비넷 제외 재료비의 2%', unit: '식', quantity: '1',
      laborMode: 'not-applicable', remark: '', origin: 'rule', ruleInstanceId: RULE,
      rate: '0.02', derived: { kind: 'material-sum-to-here', excludedRowIds },
    });
  }
  return { ...document, derivedRows: [...retained, ...generated] };
}
