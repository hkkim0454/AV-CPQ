import type { Catalog, CatalogProduct } from '../../data/catalog/load';
import type { DecimalText, DerivedRow, QuoteDocument } from './types';
import type { ImportWarning } from '../../import/diagram/devices';
import { calculateQuote } from '../calculation/calculate';

const CABINET_GROUPS = new Set(['IEA', 'IEA-F', 'IEA-E', 'IEA-EF', 'IFR-M', 'IFR-MF', 'MPF', 'MMF', 'MMF-S']);
const RULE = 'misc-material-led-excluded-v1';

/** 이 문서의 잡자재 행이 옛 기준인가 — 새 기준(`RULE`)이 아닌 합산 행이다. */
function isLegacyMisc(row: DerivedRow): boolean {
  return row.derived.kind === 'material-sum-to-here' && row.ruleInstanceId !== RULE;
}

function productMap(catalog: Catalog): Map<string, CatalogProduct> {
  return new Map(catalog.products.map(product => [product.sku, product]));
}

/** 이 시스템에서 잡자재비 합산에서 빠지는 LED 캐비넷 행. */
function cabinetRowsOf(
  document: QuoteDocument,
  products: Map<string, CatalogProduct>,
  systemId: string,
): { rowId: string; name: string }[] {
  return document.rows.flatMap(row => {
    if (row.type !== 'item' || row.systemId !== systemId || row.sku === undefined) return [];
    const group = products.get(row.sku)?.options['group'];
    return group !== undefined && CABINET_GROUPS.has(group) ? [{ rowId: row.rowId, name: row.name }] : [];
  });
}

/** 품셈 묶음이 없는 행을 LED가 아닌 것으로 확정하지 않는다. */
export function computeMiscMaterialWarnings(document: QuoteDocument, catalog: Catalog): ImportWarning[] {
  const products = productMap(catalog);
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
  if (document.derivedRows.some(isLegacyMisc)) {
    warnings.push({ code: 'misc-basis-review-required', blocking: true,
      message: '기존 잡자재비 계산 기준이 있습니다. LED 캐비넷 제외 기준과 파생 행 순서를 확인한 뒤 재계산해야 합니다.' });
  }
  return warnings;
}

/**
 * 옛 기준의 잡자재 행을 새 기준으로 옮기면 **무엇이 어떻게 달라지는지**.
 *
 * 금액은 두 문서(지금 문서 / 옮긴 문서)를 각각 계산해서 가져온다 —
 * 여기서 2%를 다시 곱하면 계산 규칙이 두 곳으로 갈라진다.
 */
export interface MiscMaterialMigrationPlan {
  systemId: string;
  /** 옮길 옛 행. 행 id와 위치는 그대로 두고 기준만 바꾼다. */
  previousRowId: string;
  /** 지금(옛 기준) 잡자재비. 계산이 막혀 구하지 못하면 없다. */
  previousAmount?: DecimalText;
  /** 옮긴 뒤(LED 캐비넷 제외) 잡자재비. */
  nextAmount?: DecimalText;
  /** 옮기면 합산에서 빠지는 LED 캐비넷 행. "왜 금액이 줄어드는지"의 근거다. */
  excludedRows: readonly { rowId: string; name: string }[];
}

function miscAmountsOf(document: QuoteDocument): Map<string, DecimalText> {
  const amounts = new Map<string, DecimalText>();
  const calculated = calculateQuote(document);
  for (const system of calculated.systems) {
    for (const row of system.rows) {
      if (row.materialAmount !== undefined) amounts.set(row.rowId, row.materialAmount.toFixed());
    }
  }
  return amounts;
}

export function planMiscMaterialMigration(
  document: QuoteDocument,
  catalog: Catalog,
): readonly MiscMaterialMigrationPlan[] {
  const legacy = document.derivedRows.filter(isLegacyMisc);
  if (legacy.length === 0) return [];
  const products = productMap(catalog);
  const before = miscAmountsOf(document);
  const after = miscAmountsOf(migrateMiscMaterials(document, catalog));
  return legacy.map(row => {
    const previousAmount = before.get(row.rowId);
    const nextAmount = after.get(row.rowId);
    return {
      systemId: row.systemId,
      previousRowId: row.rowId,
      ...(previousAmount !== undefined ? { previousAmount } : {}),
      ...(nextAmount !== undefined ? { nextAmount } : {}),
      excludedRows: cabinetRowsOf(document, products, row.systemId),
    };
  });
}

/**
 * 옛 기준의 잡자재 행을 새 기준으로 바꾼다. **사용자가 명시적으로
 * 고른 뒤에만 부른다** — 저장 문서를 여는 것만으로 저절로 불리면
 * 모르는 사이 금액이 바뀐다.
 *
 * 행 id와 파생 행 순서는 그대로 둔다. `material-sum-to-here`는 자기
 * 앞의 행들을 합산하므로 자리를 옮기면 금액이 달라진다.
 */
export function migrateMiscMaterials(document: QuoteDocument, catalog: Catalog): QuoteDocument {
  if (!document.derivedRows.some(isLegacyMisc)) return document;
  const products = productMap(catalog);
  const derivedRows = document.derivedRows.map(row => {
    if (!isLegacyMisc(row)) return row;
    return {
      ...row,
      name: '잡자재비',
      specification: 'LED 캐비넷 제외 재료비의 2%',
      ruleInstanceId: RULE,
      rate: '0.02',
      derived: {
        kind: 'material-sum-to-here' as const,
        excludedRowIds: cabinetRowsOf(document, products, row.systemId).map(r => r.rowId),
      },
    };
  });
  return { ...document, derivedRows };
}

/** 새 견적의 자동 잡자재비. 기존에 가져온 별도 파생 행은 임의로 대체하지 않는다. */
export function synchronizeMiscMaterials(document: QuoteDocument, catalog: Catalog): QuoteDocument {
  const products = productMap(catalog);
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
