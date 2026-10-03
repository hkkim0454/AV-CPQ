/**
 * 일위대가 — 품셈에서 적용 노무 단가를 만든다 (설계서 §5.2, §5.3).
 *
 *   표준 노무 단가 = Σ(직종별 품 × 해당 연도/반기 노임)
 *   적용 노무 단가 = INT(표준 노무 단가 × (1 + 할증) × 품목별 요율 × 환산 계수)
 *
 * 원본 품셈 통합문서의 `I7 = INT(SUM(R7*S7,S7)*Q7)`과 같은 식이다.
 * `SUM(R*S, S)` = `S*(1+R)`이므로 할증을 곱으로 표현했다.
 *
 * 설계서 §5.3: 미연결·미확인 항목을 자동 확정하지 않는다. 계산은 하되 `blocking`을 세운다.
 */
import type { LaborItem, LaborMapping, LaborWarning, WageTable, Trade } from './types';
import { Decimal, ZERO, dec, excelInt, sum } from '../calculation/rounding';

export interface TradeAmount {
  trade: Trade;
  /** 직종별 품. */
  quantity: Decimal;
  /** 노임. */
  wage: Decimal;
  /** 직종별 금액 = 품 × 노임. */
  amount: Decimal;
}

/** 설계서 §5.3이 화면에 표시하라고 지정한 항목을 전부 담는다. */
export interface LaborBreakdown {
  laborMappingId: string;
  laborItemId: string;
  code: string;
  description: string;
  baseUnit: string;
  source: string;
  revision: string;
  wagePeriod: string;

  tradeAmounts: TradeAmount[];
  /** Σ(품 × 노임). */
  standardUnitPrice: Decimal;
  surcharge: Decimal;
  itemRate: Decimal;
  conversionFactor: Decimal;
  /** 절사 방법 — 원본이 INT를 쓴다. */
  roundingMethod: 'INT';
  /** 최종 단가 — 견적서 H열에 들어간다. */
  appliedUnitPrice: Decimal;

  warnings: LaborWarning[];
  blocking: boolean;
}

export function calculateLaborUnitPrice(
  item: LaborItem,
  mapping: LaborMapping,
  wages: WageTable,
): LaborBreakdown {
  const warnings: LaborWarning[] = [];

  const tradeAmounts: TradeAmount[] = item.trades.map((t) => {
    const quantity = dec(t.quantity);
    const wageText = wages.wages[t.trade];
    if (wageText === undefined) {
      warnings.push({
        code: 'wage-missing',
        blocking: true,
        message: `노임표 ${wages.periodLabel}에 직종 '${t.trade}'이 없다.`,
        laborMappingId: mapping.laborMappingId,
      });
      return { trade: t.trade, quantity, wage: ZERO, amount: ZERO };
    }
    const wage = dec(wageText);
    return { trade: t.trade, quantity, wage, amount: quantity.times(wage) };
  });

  const standardUnitPrice = sum(tradeAmounts.map((t) => t.amount));
  const surcharge = dec(mapping.surcharge);
  const itemRate = dec(mapping.itemRate);
  const conversionFactor = dec(mapping.conversionFactor);

  const appliedUnitPrice = excelInt(
    standardUnitPrice
      .times(new Decimal(1).plus(surcharge))
      .times(itemRate)
      .times(conversionFactor),
  );

  if (!mapping.confirmed) {
    warnings.push({
      code: 'mapping-unconfirmed',
      blocking: true,
      message: `품셈 연결 ${mapping.laborMappingId}이 미확인 상태다. 확정 전 사람이 확인해야 한다.`,
      laborMappingId: mapping.laborMappingId,
    });
  }

  return {
    laborMappingId: mapping.laborMappingId,
    laborItemId: item.laborItemId,
    code: item.code,
    description: item.description,
    baseUnit: item.baseUnit,
    source: item.source,
    revision: item.revision,
    wagePeriod: wages.periodLabel,
    tradeAmounts,
    standardUnitPrice,
    surcharge,
    itemRate,
    conversionFactor,
    roundingMethod: 'INT',
    appliedUnitPrice,
    warnings,
    blocking: warnings.some((w) => w.blocking),
  };
}

export interface LaborReference {
  items: readonly LaborItem[];
  mappings: readonly LaborMapping[];
  wages: WageTable;
}

export interface LaborRowRequest {
  rowId: string;
  laborMappingId: string;
}

export interface LaborRowsResult {
  /** `calculateQuote`의 `input.laborUnitPrices`로 넘길 값. */
  unitPrices: Map<string, Decimal>;
  /** 행별 근거 — LaborBreakdown 화면이 쓴다. */
  breakdowns: Map<string, LaborBreakdown>;
  warnings: LaborWarning[];
}

export function calculateLaborForRows(
  requests: readonly LaborRowRequest[],
  reference: LaborReference,
): LaborRowsResult {
  const unitPrices = new Map<string, Decimal>();
  const breakdowns = new Map<string, LaborBreakdown>();
  const warnings: LaborWarning[] = [];

  const mappingById = new Map(reference.mappings.map((m) => [m.laborMappingId, m]));
  const itemById = new Map(reference.items.map((i) => [i.laborItemId, i]));

  for (const request of requests) {
    const mapping = mappingById.get(request.laborMappingId);
    if (mapping === undefined) {
      warnings.push({
        code: 'mapping-missing',
        blocking: true,
        message: `행 ${request.rowId}: 품셈 연결 ${request.laborMappingId}을 찾을 수 없다.`,
        rowId: request.rowId,
      });
      continue;
    }
    const item = itemById.get(mapping.laborItemId);
    if (item === undefined) {
      warnings.push({
        code: 'labor-item-missing',
        blocking: true,
        message: `행 ${request.rowId}: 품셈 항목 ${mapping.laborItemId}을 찾을 수 없다.`,
        rowId: request.rowId,
      });
      continue;
    }

    const breakdown = calculateLaborUnitPrice(item, mapping, reference.wages);
    breakdowns.set(request.rowId, breakdown);
    unitPrices.set(request.rowId, breakdown.appliedUnitPrice);
    for (const w of breakdown.warnings) {
      warnings.push({ ...w, rowId: request.rowId });
    }
  }

  return { unitPrices, breakdowns, warnings };
}
