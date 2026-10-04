/**
 * 견적 계산 엔진 (설계서 §5).
 *
 * 설계서 §5.1: 웹 화면과 Excel 출력이 **같은 계산 정의**를 쓴다.
 * 여기서 만든 `CalculationSnapshot`이 화면 표시와 Excel 수식 바인딩의 공통 입력이다.
 * Excel 쪽은 `export/ooxml/formulas.ts`가 같은 구조를 셀 주소로 옮긴다.
 *
 * 설계서 §10.4: 이 함수는 `PrivateCostSession`을 **인자로 받지 않는다**.
 * 원가는 판매가 계산에 들어오지 않는다.
 */
import type {
  QuoteDocument,
  QuoteSystem,
  SheetRow,
  QuoteRow,
  DerivedRow,
  IndirectCostRule,
  DocumentVersions,
} from '../quote/types';
import {
  Decimal,
  ZERO,
  dec,
  decOrUndefined,
  excelInt,
  mul,
  roundDown,
  sum,
} from './rounding';

export type WarningCode =
  | 'price-not-registered'
  | 'labor-unresolved'
  | 'labor-mapping-missing'
  | 'nego-exceeds-total'
  | 'nego-negative-input'
  | 'derived-source-missing'
  | 'indirect-basis-missing'
  | 'empty-system';

export interface CalculationWarning {
  code: WarningCode;
  /** 확정을 막는 경고인지. 설계서 §5.6/§7.5. */
  blocking: boolean;
  message: string;
  systemId?: string;
  rowId?: string;
  itemId?: string;
}

export interface RowCalculation {
  rowId: string;
  /** F열. 미등록이면 undefined — 0으로 바꾸지 않는다. */
  materialUnitPrice?: Decimal;
  /** G열 = E×F. 단가 미등록이면 undefined. */
  materialAmount?: Decimal;
  /** H열. */
  laborUnitPrice?: Decimal;
  /** I열 = E×H. */
  laborAmount?: Decimal;
  /** J열 = G+I. 양쪽 다 없으면 undefined. */
  total?: Decimal;
  quantity: Decimal;
}

export interface IndirectCalculation {
  itemId: string;
  name: string;
  basisLabel: string;
  rate: Decimal;
  applied: boolean;
  /** 적용한 기준 금액. 미적용이면 0. */
  basisAmount: Decimal;
  /** J열 = INT(기준 × 요율). 미적용이면 0. */
  amount: Decimal;
}

export interface SystemCalculation {
  systemId: string;
  rows: RowCalculation[];
  /** 직접비계 G. */
  directMaterial: Decimal;
  /** 직접비계 I. */
  directLabor: Decimal;
  /** 직접비계 J. */
  directTotal: Decimal;
  indirect: IndirectCalculation[];
  /** 간접비계 J. */
  indirectTotal: Decimal;
  /** 합계 J — 갑지가 참조하는 값. */
  systemTotal: Decimal;
}

export interface CoverSystemAmount {
  systemId: string;
  /** 갑지 G열 = 시스템 시트 합계. */
  unitAmount: Decimal;
  /** 갑지 F열. */
  quantity: Decimal;
  /** 갑지 H열 = F×G. */
  amount: Decimal;
}

export interface CoverCalculation {
  systemAmounts: CoverSystemAmount[];
  /** SUM(H…) — 절사 전. */
  subtotal: Decimal;
  /** ROUNDDOWN(subtotal, -4). */
  rounded: Decimal;
  /** 출력용 **음수** 조정액. 웹 입력은 양수다. */
  negoAdjustment: Decimal;
  /** 최종 공급금액. VAT 별도. */
  finalTotal: Decimal;
}

export interface CalculationSnapshot {
  systems: SystemCalculation[];
  cover: CoverCalculation;
  warnings: CalculationWarning[];
  /** 하나라도 blocking 경고가 있으면 true. 확정·고객 출력 전 해소해야 한다. */
  blocking: boolean;
  versions: DocumentVersions;
}

// ---------------------------------------------------------------------------

function isItem(row: SheetRow): row is SheetRow & { type: 'item' } & QuoteRow {
  return row.type === 'item';
}

/** 행의 적용 노무 단가. `mapped`는 `laborUnitPrices`에서 주입받는다. */
function resolveLaborUnitPrice(
  row: QuoteRow,
  laborUnitPrices: ReadonlyMap<string, Decimal>,
  warnings: CalculationWarning[],
): Decimal | undefined {
  switch (row.laborMode) {
    case 'not-applicable':
      return undefined;
    case 'manual':
      return decOrUndefined(row.manualLaborUnitPrice);
    case 'mapped': {
      const price = laborUnitPrices.get(row.rowId);
      if (price === undefined) {
        warnings.push({
          code: 'labor-mapping-missing',
          blocking: true,
          message: `행 ${row.rowId}: 품셈 연결은 지정됐으나 노무 단가가 계산되지 않았다.`,
          systemId: row.systemId,
          rowId: row.rowId,
        });
      }
      return price;
    }
    case 'unresolved':
      warnings.push({
        code: 'labor-unresolved',
        blocking: true,
        message: `행 ${row.rowId}: 노무비 처리 방식이 정해지지 않았다.`,
        systemId: row.systemId,
        rowId: row.rowId,
      });
      return undefined;
  }
}

export interface CalculationInput {
  /**
   * `laborMode: 'mapped'` 행의 적용 노무 단가.
   * `domain/labor/calculateLabor.ts`가 품셈·노임에서 만들어 넘긴다.
   * 설계서 §5.3: 미연결 항목을 자동 확정하지 않으므로 여기 없으면 경고가 난다.
   */
  laborUnitPrices?: ReadonlyMap<string, Decimal>;
}

export function calculateQuote(
  document: QuoteDocument,
  input: CalculationInput = {},
): CalculationSnapshot {
  const warnings: CalculationWarning[] = [];
  const laborUnitPrices = input.laborUnitPrices ?? new Map<string, Decimal>();
  const laborOnly = document.mode === 'labor-only';

  const systems = document.systems.map((system) =>
    calculateSystem(system, document, laborUnitPrices, laborOnly, warnings),
  );

  const cover = calculateCover(document, systems, warnings);

  return {
    systems,
    cover,
    warnings,
    blocking: warnings.some((w) => w.blocking),
    versions: document.versions,
  };
}

function calculateSystem(
  system: QuoteSystem,
  document: QuoteDocument,
  laborUnitPrices: ReadonlyMap<string, Decimal>,
  laborOnly: boolean,
  warnings: CalculationWarning[],
): SystemCalculation {
  const items = document.rows.filter(
    (r): r is SheetRow & { type: 'item' } & QuoteRow =>
      isItem(r) && r.systemId === system.systemId,
  );
  const derived = document.derivedRows.filter((d) => d.systemId === system.systemId);

  const rows: RowCalculation[] = [];
  const byRowId = new Map<string, RowCalculation>();

  for (const row of items) {
    const calc = calculateItemRow(row, laborUnitPrices, laborOnly, warnings);
    rows.push(calc);
    byRowId.set(row.rowId, calc);
  }

  // 파생 행은 앞선 행의 재료비 금액을 기준으로 계산되므로 품목 행 뒤에 붙인다.
  for (const row of derived) {
    const calc = calculateDerivedRow(row, rows, byRowId, laborUnitPrices, laborOnly, warnings);
    rows.push(calc);
    byRowId.set(row.rowId, calc);
  }

  if (rows.length === 0) {
    warnings.push({
      code: 'empty-system',
      blocking: false,
      message: `시스템 ${system.name}: 품목이 없다.`,
      systemId: system.systemId,
    });
  }

  const directMaterial = sum(rows.map((r) => r.materialAmount ?? ZERO));
  const directLabor = sum(rows.map((r) => r.laborAmount ?? ZERO));
  const directTotal = directMaterial.plus(directLabor);

  const indirect = calculateIndirect(system.indirectCosts, directLabor, directTotal, warnings, system.systemId);
  const indirectTotal = sum(indirect.map((i) => i.amount));

  return {
    systemId: system.systemId,
    rows,
    directMaterial,
    directLabor,
    directTotal,
    indirect,
    indirectTotal,
    systemTotal: directTotal.plus(indirectTotal),
  };
}

function calculateItemRow(
  row: QuoteRow,
  laborUnitPrices: ReadonlyMap<string, Decimal>,
  laborOnly: boolean,
  warnings: CalculationWarning[],
): RowCalculation {
  const quantity = dec(row.quantity);

  // 설계서 §5.6: 단가 미등록을 0원으로 표시해 견적을 완성시키지 않는다.
  const materialUnitPrice = laborOnly ? undefined : decOrUndefined(row.sellingUnitPrice);
  if (!laborOnly && row.sellingUnitPrice === undefined) {
    warnings.push({
      code: 'price-not-registered',
      blocking: true,
      message: `행 ${row.name || row.rowId}: 판매 단가가 미등록이다.`,
      systemId: row.systemId,
      rowId: row.rowId,
    });
  }

  const laborUnitPrice = resolveLaborUnitPrice(row, laborUnitPrices, warnings);

  return buildRowCalculation(row.rowId, quantity, materialUnitPrice, laborUnitPrice);
}

function calculateDerivedRow(
  row: DerivedRow,
  priorRows: readonly RowCalculation[],
  byRowId: ReadonlyMap<string, RowCalculation>,
  laborUnitPrices: ReadonlyMap<string, Decimal>,
  laborOnly: boolean,
  warnings: CalculationWarning[],
): RowCalculation {
  const quantity = dec(row.quantity);
  const rate = dec(row.rate);

  let basis: Decimal | undefined;
  if (row.derived.kind === 'single-row-material') {
    const source = byRowId.get(row.derived.sourceRowId);
    if (source === undefined) {
      warnings.push({
        code: 'derived-source-missing',
        blocking: true,
        message: `파생 행 ${row.name}: 기준 행 ${row.derived.sourceRowId}을 찾을 수 없다.`,
        systemId: row.systemId,
        rowId: row.rowId,
      });
    } else {
      basis = source.materialAmount;
    }
  } else {
    basis = sum(priorRows.map((r) => r.materialAmount ?? ZERO));
  }

  // F = INT(기준 × 요율). 원본의 `=INT(G17*20%)` / `=INT(SUM(G12:G21)*2%)`.
  const materialUnitPrice =
    laborOnly || basis === undefined ? undefined : excelInt(mul(basis, rate));

  const laborUnitPrice = resolveLaborUnitPrice(row, laborUnitPrices, warnings);

  return buildRowCalculation(row.rowId, quantity, materialUnitPrice, laborUnitPrice);
}

function buildRowCalculation(
  rowId: string,
  quantity: Decimal,
  materialUnitPrice: Decimal | undefined,
  laborUnitPrice: Decimal | undefined,
): RowCalculation {
  const materialAmount =
    materialUnitPrice === undefined ? undefined : quantity.times(materialUnitPrice);
  const laborAmount =
    laborUnitPrice === undefined ? undefined : quantity.times(laborUnitPrice);
  const total =
    materialAmount === undefined && laborAmount === undefined
      ? undefined
      : (materialAmount ?? ZERO).plus(laborAmount ?? ZERO);

  return {
    rowId,
    quantity,
    ...(materialUnitPrice !== undefined ? { materialUnitPrice } : {}),
    ...(materialAmount !== undefined ? { materialAmount } : {}),
    ...(laborUnitPrice !== undefined ? { laborUnitPrice } : {}),
    ...(laborAmount !== undefined ? { laborAmount } : {}),
    ...(total !== undefined ? { total } : {}),
  };
}

function calculateIndirect(
  rules: readonly IndirectCostRule[],
  directLabor: Decimal,
  directTotal: Decimal,
  warnings: CalculationWarning[],
  systemId: string,
): IndirectCalculation[] {
  const results: IndirectCalculation[] = [];
  const byItemId = new Map<string, IndirectCalculation>();

  for (const rule of rules) {
    const rate = dec(rule.rate);

    let basisAmount = ZERO;
    switch (rule.basis.kind) {
      case 'labor':
        basisAmount = directLabor;
        break;
      case 'direct':
        basisAmount = directTotal;
        break;
      case 'item': {
        // **지정한 항목의 금액만.** 직접비를 더하지 않는다.
        // 가이드: 노인장기요양보험료 = INT(건강보험료 금액 × 12.95%)
        const prior = byItemId.get(rule.basis.itemId);
        if (prior === undefined) {
          // 자기 자신이나 뒤에 오는 항목을 가리키면 여기로 온다.
          // 금액을 0으로 두고 넘어가면 보험료가 조용히 사라진다.
          warnings.push({
            code: 'indirect-basis-missing',
            blocking: true,
            message: `간접비 ${rule.name}: 기준 항목 ${rule.basis.itemId}가 앞에 없다.`,
            systemId,
            itemId: rule.itemId,
          });
          basisAmount = ZERO;
        } else {
          basisAmount = prior.amount;
        }
        break;
      }
      case 'composite': {
        // 직접비계 합계 + 지정한 간접비 항목들의 금액.
        // 원본: =INT(SUM(J{직접비계},J{간접노무비},J{산업안전})*요율)
        let acc = directTotal;
        for (const id of rule.basis.plusItemIds) {
          const prior = byItemId.get(id);
          if (prior === undefined) {
            warnings.push({
              code: 'indirect-basis-missing',
              blocking: true,
              message: `간접비 ${rule.name}: 기준 항목 ${id}가 앞에 없다.`,
              systemId,
              itemId: rule.itemId,
            });
            continue;
          }
          acc = acc.plus(prior.amount);
        }
        basisAmount = acc;
        break;
      }
    }

    const amount = rule.applied ? excelInt(mul(basisAmount, rate)) : ZERO;

    const result: IndirectCalculation = {
      itemId: rule.itemId,
      name: rule.name,
      basisLabel: rule.basisLabel,
      rate,
      applied: rule.applied,
      basisAmount: rule.applied ? basisAmount : ZERO,
      amount,
    };
    results.push(result);
    byItemId.set(rule.itemId, result);
  }

  return results;
}

function calculateCover(
  document: QuoteDocument,
  systems: readonly SystemCalculation[],
  warnings: CalculationWarning[],
): CoverCalculation {
  const byId = new Map(systems.map((s) => [s.systemId, s]));

  const systemAmounts: CoverSystemAmount[] = document.systems.map((system) => {
    const calc = byId.get(system.systemId);
    const unitAmount = calc?.systemTotal ?? ZERO;
    const quantity = dec(system.quantity);
    return { systemId: system.systemId, unitAmount, quantity, amount: quantity.times(unitAmount) };
  });

  const subtotal = sum(systemAmounts.map((s) => s.amount));
  const rounded = roundDown(subtotal, document.rounding.coverTotalDigits);

  // 설계서 §5.5: 웹에서는 차감액을 양수로 입력받고 출력에서 음수 조정액으로 바꾼다.
  const deduction = dec(document.negoDeduction);
  if (deduction.isNegative()) {
    warnings.push({
      code: 'nego-negative-input',
      blocking: true,
      message: 'NEGO 차감액은 양수로 입력한다. 음수를 넣으면 이중 차감이 된다.',
    });
  }
  if (deduction.greaterThan(rounded)) {
    warnings.push({
      code: 'nego-exceeds-total',
      blocking: true,
      message: `NEGO 차감액이 절사 후 공급금액보다 크다.`,
    });
  }

  const negoAdjustment = deduction.negated();

  return {
    systemAmounts,
    subtotal,
    rounded,
    negoAdjustment,
    finalTotal: rounded.plus(negoAdjustment),
  };
}
