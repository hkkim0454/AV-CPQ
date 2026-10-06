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
  /**
   * **품셈 항목의 출처**(예: "2026년도 적용 정보통신공사 표준품셈") —
   * 공수(품)가 어느 자료에서 왔는지다. 적용 노임표의 출처와는 다른
   * 축이다(독립 검토 지적: 화면이 이 값을 "노임 출처"라는 이름으로
   * 보여주고 있었다 — 품셈 출처와 노임 출처를 섞어 표시하면, 노임이
   * 가이드로 바뀌어도(§guideBasis.ts) 화면은 품셈 쪽 출처만 보여줘
   * 사람이 실제 적용된 노임표를 확인할 길이 없어진다).
   */
  source: string;
  revision: string;
  /** 적용 노임표(`WageTable`)의 출처 — 품셈 출처(`source`)와 분리해서 보여준다. */
  wageTableSource: string;
  wageTableId: string;
  wagePeriod: string;
  /** 이 품셈이 전제하는 노임 단위. */
  wageUnit: WageUnit;

  tradeAmounts: TradeAmount[];
  /** Σ(품 × 노임). */
  standardUnitPrice: Decimal;
  surcharge: Decimal;
  itemRate: Decimal;
  conversionFactor: Decimal;
  /** 원본 수식에 박힌 배율. `INT` **다음에** 곱했다. 없으면 생략한다. */
  multiplier?: Decimal;
  /** 절사 방법 — 원본이 INT를 쓴다. */
  roundingMethod: 'INT';
  /** 최종 단가 — 견적서 H열에 들어간다. */
  appliedUnitPrice: Decimal;

  warnings: LaborWarning[];
  blocking: boolean;
}

/**
 * `calculateLaborForRows`가 행 단위로 돌려주는 근거 — **지금 이
 * 근거**(화면이 보여주는 바로 이 숫자들)의 지문이 확인 여부와 무관하게
 * 항상 있다. 화면의 "확인함" 버튼이 이 값을 그대로 `onConfirmLaborRow`에
 * 넘겨야 한다 — 클릭 시점에 액션이 이 값과 다시 계산한 지금 지문을
 * 비교해, 둘이 다르면(화면이 그린 뒤 근거가 바뀌었으면) 거부한다(독립
 * 검토 지적 — "그 순간 재계산"은 "표시 지문과 같음을 확인"이지 "새로
 * 계산해 그냥 저장"이 아니다). `calculateLaborUnitPrice` 자신은 rowId를
 * 모르므로(순수 품셈×노임 계산만 한다) 이 지문은 여기서만 생긴다.
 */
export interface RowLaborBreakdown extends LaborBreakdown {
  currentFingerprint: string;
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

  // ⚠ 배율은 **`INT` 다음에** 곱한다. 원본 수식이
  // `=INT(SUM((할증*표준단가),표준단가)*요율)*0.3` 이라 INT 가 먼저다.
  // 안으로 넣으면 1원씩 어긋난다(실측 케이블 233행: 203,887.8 vs 203,888).
  const multiplier = mapping.multiplier === undefined ? undefined : dec(mapping.multiplier);
  const unitMismatch = warnings.some((w) => w.code === 'wage-unit-mismatch');
  const beforeMultiplier = excelInt(
    standardUnitPrice
      .times(new Decimal(1).plus(surcharge))
      .times(itemRate)
      .times(conversionFactor),
  );
  const appliedUnitPrice = unitMismatch
    ? ZERO
    : multiplier === undefined
      ? beforeMultiplier
      : beforeMultiplier.times(multiplier);

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
    wageTableSource: wages.source,
    wageTableId: wages.wageTableId,
    wagePeriod: wages.periodLabel,
    wageUnit: item.wageUnit,
    tradeAmounts,
    standardUnitPrice,
    surcharge,
    itemRate,
    conversionFactor,
    ...(multiplier === undefined ? {} : { multiplier }),
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
  /**
   * 지금 지문을 계산할 재료 — 확인 여부와 무관하게 **항상** 필요하다.
   * `breakdown.currentFingerprint`가 이것으로 나오고, 화면의 "확인함"
   * 버튼이 지금 보이는 근거를 확인할 때 이 지문을 저장한다(독립 검토
   * 지적: 전에는 이미 확인된 행에만 지문을 계산해, 처음 확인하려는
   * 화면이 "지금 지문"을 알 방법이 없었다).
   */
  identity: LaborRowIdentity;
  /** 이 행이 전에 확인된 적 있으면 그 기록. */
  existingConfirmation?: LaborConfirmation;
}

export interface LaborRowsResult {
  /** `calculateQuote`의 `input.laborUnitPrices`로 넘길 값. */
  unitPrices: Map<string, Decimal>;
  /** 행별 근거 — 화면이 그대로 보여준다. */
  breakdowns: Map<string, RowLaborBreakdown>;
  warnings: LaborWarning[];
}

/** `computeLaborConfirmationFingerprint`에 넘길 identity·단위·수량 재료. */
export interface LaborRowIdentity {
  productId?: string;
  sku?: string;
  /** 견적 행의 unit(판매 단위). */
  unit: string;
  quantity: DecimalText;
  ruleVersion: string;
}

/**
 * **지금 계산 근거**(품셈 연결·직종별 품·적용 노임·단위·계수·행 수량·
 * rule 버전)로 지문을 다시 만든다. 화면의 "확인함" 버튼(지금 보고 있는
 * 근거를 확인한다)과 `calculateLaborForRows`의 재검증(저장된 지문이
 * 지금도 유효한지 본다)이 **같은 계산**을 쓰도록 여기 하나로 묶는다 —
 * 따로 두면 한쪽만 고쳤을 때 둘이 어긋난다.
 */
export function computeCurrentLaborFingerprint(
  rowId: string,
  item: LaborItem,
  mapping: LaborMapping,
  wages: WageTable,
  breakdown: LaborBreakdown,
  identity: LaborRowIdentity,
): string {
  return computeLaborConfirmationFingerprint({
    rowId,
    ...(identity.productId !== undefined ? { productId: identity.productId } : {}),
    ...(identity.sku !== undefined ? { sku: identity.sku } : {}),
    laborMappingId: mapping.laborMappingId,
    laborItemId: item.laborItemId,
    code: item.code,
    trades: item.trades,
    tradeWages: breakdown.tradeAmounts.map((t) => ({ trade: t.trade, amount: text(t.wage), unit: t.wageUnit })),
    wageTableId: wages.wageTableId,
    wageUnit: item.wageUnit,
    baseUnit: item.baseUnit,
    rowUnit: identity.unit,
    itemRate: mapping.itemRate,
    surcharge: mapping.surcharge,
    conversionFactor: mapping.conversionFactor,
    ...(mapping.multiplier === undefined ? {} : { multiplier: mapping.multiplier }),
    quantity: identity.quantity,
    ruleVersion: identity.ruleVersion,
  });
}

/**
 * 행 identity(productId/sku 포함)와 수량·rule 버전으로 **지금** 이
 * 매핑의 지문을 계산한다 — 화면의 "확인함" 액션이 이 함수로 저장할
 * `basisFingerprint`를 만든다. 매핑/품셈 항목을 찾을 수 없으면
 * `undefined`다(존재하지 않는 연결을 확인할 수 없다).
 */
export function computeRowConfirmationFingerprint(
  rowId: string,
  laborMappingId: string,
  reference: LaborReference,
  identity: LaborRowIdentity,
): string | undefined {
  const mapping = reference.mappings.find((m) => m.laborMappingId === laborMappingId);
  if (mapping === undefined) return undefined;
  const item = reference.items.find((i) => i.laborItemId === mapping.laborItemId);
  if (item === undefined) return undefined;
  const breakdown = calculateLaborUnitPrice(item, mapping, reference.wages);
  return computeCurrentLaborFingerprint(rowId, item, mapping, reference.wages, breakdown, identity);
}

/**
 * 지금 근거의 지문을 **항상** 계산해 붙이고, 저장된 확인이 있고 그
 * 지문과 같을 때만 **그 rowId에 한해** `mapping-unconfirmed`를 푼다
 * (계획 §Task B — "푸는 것은 그 행의 mapping-unconfirmed 하나뿐이다").
 * 전역 `mapping.confirmed`는 건드리지 않는다. 다른 경고
 * (wage-missing·wage-unit-mismatch 등)는 그대로 남는다.
 */
function applyLaborConfirmation(
  breakdown: LaborBreakdown,
  request: LaborRowRequest,
  item: LaborItem,
  mapping: LaborMapping,
  wages: WageTable,
): RowLaborBreakdown {
  const currentFingerprint = computeCurrentLaborFingerprint(
    request.rowId,
    item,
    mapping,
    wages,
    breakdown,
    request.identity,
  );

  const hasUnconfirmedWarning = breakdown.warnings.some((w) => w.code === 'mapping-unconfirmed');
  const matchesExisting =
    request.existingConfirmation !== undefined && currentFingerprint === request.existingConfirmation.basisFingerprint;

  if (!hasUnconfirmedWarning || !matchesExisting) {
    return { ...breakdown, currentFingerprint };
  }

  const warnings = breakdown.warnings.filter((w) => w.code !== 'mapping-unconfirmed');
  return { ...breakdown, currentFingerprint, warnings, blocking: warnings.some((w) => w.blocking) };
}

export function calculateLaborForRows(
  requests: readonly LaborRowRequest[],
  reference: LaborReference,
): LaborRowsResult {
  const unitPrices = new Map<string, Decimal>();
  const breakdowns = new Map<string, RowLaborBreakdown>();
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
