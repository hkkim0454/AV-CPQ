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
import type {
  LaborItem,
  LaborMapping,
  LaborWarning,
  WageTable,
  WageUnit,
  Trade,
} from './types';
import { Decimal, ZERO, dec, excelInt, sum, text } from '../calculation/rounding';
import { computeLaborConfirmationFingerprint, type LaborConfirmation } from './laborConfirmation';
import type { DecimalText } from '../quote/types';

export interface TradeAmount {
  trade: Trade;
  /** 직종별 품. */
  quantity: Decimal;
  /** 노임. */
  wage: Decimal;
  /** 노임 단위 — 화면에 그대로 표시한다 (설계서 §5.3 추적성). */
  wageUnit: WageUnit;
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
  /** 이 품셈이 전제하는 노임 단위. */
  wageUnit: WageUnit;

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
    const entry = wages.wages[t.trade];
    if (entry === undefined) {
      warnings.push({
        code: 'wage-missing',
        blocking: true,
        message: `노임표 ${wages.periodLabel}에 직종 '${t.trade}'이 없다.`,
        laborMappingId: mapping.laborMappingId,
      });
      return { trade: t.trade, quantity, wage: ZERO, wageUnit: item.wageUnit, amount: ZERO };
    }

    // 결정 문서 D1: M/D와 M/M을 섞으면 약 20배 틀린다.
    // 자동 환산하지 않는다 — 한 달이 며칠인지는 공사 조건이지 상수가 아니다.
    if (entry.unit !== item.wageUnit) {
      warnings.push({
        code: 'wage-unit-mismatch',
        blocking: true,
        message:
          `직종 '${t.trade}'의 노임 단위가 ${entry.unit}인데 품셈 ${item.code}는 ` +
          `${item.wageUnit}를 전제한다. 자동 환산하지 않는다. 품셈 매핑을 확인한다.`,
        laborMappingId: mapping.laborMappingId,
      });
      return { trade: t.trade, quantity, wage: ZERO, wageUnit: entry.unit, amount: ZERO };
    }

    const wage = dec(entry.amount);
    return {
      trade: t.trade,
      quantity,
      wage,
      wageUnit: entry.unit,
      amount: quantity.times(wage),
    };
  });

  const standardUnitPrice = sum(tradeAmounts.map((t) => t.amount));
  const surcharge = dec(mapping.surcharge);
  const itemRate = dec(mapping.itemRate);
  const conversionFactor = dec(mapping.conversionFactor);

  const unitMismatch = warnings.some((w) => w.code === 'wage-unit-mismatch');
  const appliedUnitPrice = unitMismatch
    ? ZERO
    : excelInt(
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
    wageUnit: item.wageUnit,
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

/**
 * 사람이 이 행의 품셈 연결을 확인했다는 사실 + 그 확인이 **지금도
 * 유효한지** 재계산하는 데 필요한 나머지 재료(Task 6 노무 확인 보완
 * Task B). `laborConfirmation` 자체는 지문만 담고, 지문을 다시 계산할
 * 재료(제품 identity·단위·수량·rule 버전)는 행에서 따로 가져와야 한다.
 */
export interface LaborRowConfirmation {
  laborConfirmation: LaborConfirmation;
  productId?: string;
  sku?: string;
  /** 견적 행의 unit(판매 단위). */
  unit: string;
  quantity: DecimalText;
  ruleVersion: string;
}

export interface LaborRowRequest {
  rowId: string;
  laborMappingId: string;
  confirmation?: LaborRowConfirmation;
}

export interface LaborRowsResult {
  /** `calculateQuote`의 `input.laborUnitPrices`로 넘길 값. */
  unitPrices: Map<string, Decimal>;
  /** 행별 근거 — LaborBreakdown 화면이 쓴다. */
  breakdowns: Map<string, LaborBreakdown>;
  warnings: LaborWarning[];
}

/**
 * **그 rowId에 한해서만** `mapping-unconfirmed`를 푼다(계획 §Task B —
 * "푸는 것은 그 행의 mapping-unconfirmed 하나뿐이다"). 전역
 * `mapping.confirmed`는 건드리지 않는다 — `calculateLaborUnitPrice`가
 * 이미 그 경고를 넣은 뒤, 지금 계산 근거로 지문을 다시 만들어 저장된
 * 지문과 **같을 때만** 그 경고 하나만 걸러낸다. 다른 경고
 * (wage-missing·wage-unit-mismatch 등)는 그대로 남는다.
 */
function applyLaborConfirmation(
  breakdown: LaborBreakdown,
  request: LaborRowRequest,
  item: LaborItem,
  mapping: LaborMapping,
  wages: WageTable,
): LaborBreakdown {
  if (request.confirmation === undefined) return breakdown;
  if (!breakdown.warnings.some((w) => w.code === 'mapping-unconfirmed')) return breakdown;

  const currentFingerprint = computeLaborConfirmationFingerprint({
    rowId: request.rowId,
    ...(request.confirmation.productId !== undefined ? { productId: request.confirmation.productId } : {}),
    ...(request.confirmation.sku !== undefined ? { sku: request.confirmation.sku } : {}),
    laborMappingId: mapping.laborMappingId,
    laborItemId: item.laborItemId,
    code: item.code,
    trades: item.trades,
    tradeWages: breakdown.tradeAmounts.map((t) => ({ trade: t.trade, amount: text(t.wage), unit: t.wageUnit })),
    wageTableId: wages.wageTableId,
    wageUnit: item.wageUnit,
    baseUnit: item.baseUnit,
    rowUnit: request.confirmation.unit,
    itemRate: mapping.itemRate,
    surcharge: mapping.surcharge,
    conversionFactor: mapping.conversionFactor,
    quantity: request.confirmation.quantity,
    ruleVersion: request.confirmation.ruleVersion,
  });

  if (currentFingerprint !== request.confirmation.laborConfirmation.basisFingerprint) {
    return breakdown; // 지문이 다르다 — 차단을 유지한다. 풀지 않는다.
  }

  const warnings = breakdown.warnings.filter((w) => w.code !== 'mapping-unconfirmed');
  return { ...breakdown, warnings, blocking: warnings.some((w) => w.blocking) };
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

    const rawBreakdown = calculateLaborUnitPrice(item, mapping, reference.wages);
    const breakdown = applyLaborConfirmation(rawBreakdown, request, item, mapping, reference.wages);
    breakdowns.set(request.rowId, breakdown);
    unitPrices.set(request.rowId, breakdown.appliedUnitPrice);
    for (const w of breakdown.warnings) {
      warnings.push({ ...w, rowId: request.rowId });
    }
  }

  return { unitPrices, breakdowns, warnings };
}
