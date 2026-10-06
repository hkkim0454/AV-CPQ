/**
 * 품셈 항목·노임표·SKU 매핑 생성 (계획 Task 4, 결정 문서 D1).
 *
 * 세 가지 원칙:
 *
 * 1. **품셈 코드가 없거나 품 값이 없으면 매핑을 만들지 않는다.**
 *    만들어 버리면 노무비 0원이 조용히 들어간다 (계획 Review Focus 5).
 *    매핑 없는 SKU는 `unmappedSkus`로 보고하고, 견적에서 `laborMode: 'unresolved'`가 된다.
 *
 * 2. **M/D와 M/M을 섞은 품셈은 만들지 않는다.**
 *    섞으면 노무비가 약 20배 틀린다. 조용히 환산하지 않고 `conflicts`로 올린다.
 *
 * 3. **매핑은 전부 `confirmed: false`다.**
 *    자동 추출이다. 설계서 §5.3 — 미확인 매핑을 `품셈 검증 완료`로 표시하지 않는다.
 */
import type { DecimalText } from '../../domain/quote/types';
import type { LaborItem, LaborMapping, Wage, WageTable, WageUnit } from '../../domain/labor/types';
import type { RawSheet } from './rawTypes';
import { classifySheet } from './classifyRow';
import { makeSku } from './buildProducts';

const MAPPING_NOTE =
  '표준품셈 통합문서에서 자동 추출. 사람이 확인하기 전까지 확정에 쓰지 않는다.';

export interface BuildLaborOptions {
  /**
   * 노임표의 반기 표기. **호출부가 원시 덤프에서 읽어 넘긴다.**
   *
   * 예전 기본값은 `'26년 상반기'`였고 `build-approved.ts`가 인자 없이 불러서,
   * 하반기 자료에 상반기 이름이 붙을 수 있었다(하반기 계획 Task 2).
   * 지금은 `prepareApprovedFiles`가 덤프에 반기가 없으면 아예 막는다.
   * 여기 남은 기본값은 **시험 편의용**이지 생성 경로가 기대는 값이 아니다.
   */
  periodLabel?: string;
  /**
   * 품셈 매핑을 만들지 **않을** 행. `"<시트> <행>"` 모양이다.
   *
   * 노무비 역산이 원본과 **어긋난** 행이 여기 온다(품셈 교체 Task 2).
   * 어긋났다는 것은 우리가 다시 계산한 노무비가 원본이 적어 둔 값과 다르다는
   * 뜻이다 — 실측에서 원본 수식에 **열에 없는 계수**(`×0.3` 등)가 박혀 있어
   * 우리 계산이 3배 넘게 높아지는 행들이 그랬다. 매핑을 만들면 그 값이 그대로
   * 견적에 들어간다. 만들지 않으면 `laborMode: 'unresolved'`로 **막힌다.**
   */
  excludeRows?: ReadonlySet<string>;
}

export interface BuildLaborResult {
  wageTable: WageTable;
  laborItems: LaborItem[];
  mappings: LaborMapping[];
  /** 품셈 매핑을 만들 수 없는 제품 SKU. */
  unmappedSkus: string[];
  /** 노임 값 충돌, 단위 혼용 등 사람이 봐야 하는 것. */
  conflicts: string[];
}

function isWageUnit(value: string | null): value is WageUnit {
  return value === 'M/D' || value === 'M/M';
}

export function buildLabor(
  sheets: readonly RawSheet[],
  options: BuildLaborOptions = {},
): BuildLaborResult {
  const periodLabel = options.periodLabel ?? '26년 상반기';
  const conflicts: string[] = [];

  // --- 노임표: 전 시트를 합치되 값이 어긋나면 보고한다 ---
  const wages: Record<string, Wage> = {};
  for (const sheet of sheets) {
    for (const raw of sheet.wages) {
      if (raw.amount === null) continue;
      if (!isWageUnit(raw.unit)) {
        conflicts.push(`${sheet.name}: 직종 '${raw.trade}'의 노임 단위가 '${raw.unit}'이다.`);
        continue;
      }
      const existing = wages[raw.trade];
      if (existing === undefined) {
        wages[raw.trade] = { amount: raw.amount, unit: raw.unit };
        continue;
      }
      if (existing.amount !== raw.amount || existing.unit !== raw.unit) {
        conflicts.push(
          `직종 '${raw.trade}'의 노임이 시트마다 다르다 ` +
            `(${existing.amount}/${existing.unit} vs ${raw.amount}/${raw.unit}, ${sheet.name}).`,
        );
      }
    }
  }

  const wageTable: WageTable = {
    wageTableId: `WAGE-${periodLabel}`,
    periodLabel,
    source: '표준품셈 통합문서 3행',
    wages,
  };

  // --- 품셈 항목과 매핑 ---
  const laborItems: LaborItem[] = [];
  const mappings: LaborMapping[] = [];
  const unmappedSkus: string[] = [];

  for (const sheet of sheets) {
    const classified = classifySheet(sheet.name, sheet.rows);

    for (const product of classified.products) {
      const sku = makeSku(sheet.name, product.row);
      const trades = product.trades ?? [];

      // 역산이 어긋난 행은 매핑을 만들지 않는다 — 우리 계산이 원본과 다르다.
      if (options.excludeRows?.has(`${sheet.name} ${product.row}`) === true) {
        unmappedSkus.push(sku);
        continue;
      }

      // Review Focus 5 — 근거가 없으면 매핑을 만들지 않는다.
      if (product.laborCode === undefined || trades.length === 0) {
        unmappedSkus.push(sku);
        continue;
      }

      // 이 품셈이 쓰는 직종들의 노임 단위를 모은다.
      const units = new Set<WageUnit>();
      let unknownTrade = false;
      for (const trade of trades) {
        const wage = wages[trade.trade];
        if (wage === undefined) {
          unknownTrade = true;
          conflicts.push(
            `${sheet.name}!${product.row} (${sku}): 노임표에 직종 '${trade.trade}'이 없다.`,
          );
          continue;
        }
        units.add(wage.unit);
      }

      if (unknownTrade) {
        unmappedSkus.push(sku);
        continue;
      }
      if (units.size > 1) {
        // 결정 문서 D1 — M/D와 M/M을 섞으면 약 20배 틀린다.
        conflicts.push(
          `${sheet.name}!${product.row} (${sku}, 품셈 ${product.laborCode}, ${product.label}): ` +
            `노임 단위가 ${[...units].join('과 ')}로 섞여 있다. 자동 환산하지 않는다.`,
        );
        unmappedSkus.push(sku);
        continue;
      }

      const wageUnit: WageUnit = [...units][0] ?? 'M/D';

      laborItems.push({
        laborItemId: sku,
        code: product.laborCode,
        description: product.label ?? '',
        baseUnit: product.unit ?? '',
        source: `표준품셈 통합문서 ${sheet.name} ${product.row}행`,
        revision: periodLabel,
        wageUnit,
        trades: trades.map((t) => ({ trade: t.trade, quantity: t.quantity })),
      });

      mappings.push({
        laborMappingId: sku,
        sku,
        laborItemId: sku,
        // 품셈 기준 단위와 판매 단위가 같은 행에서 왔으므로 환산이 없다.
        conversionFactor: '1',
        surcharge: product.surcharge ?? '0',
        // 요율이 비면 1. 0으로 두면 노무 단가가 통째로 0원이 된다.
        itemRate: product.itemRate ?? '1',
        // 원본 수식에 배율이 박혀 있던 행만. 없으면 넣지 않는다 — 1을
        // 억지로 채우면 "배율이 있었다"는 사실이 사라진다.
        ...(product.laborMultiplier === undefined ? {} : { multiplier: product.laborMultiplier }),
        confirmed: false,
        note: MAPPING_NOTE,
      });
    }
  }

  return { wageTable, laborItems, mappings, unmappedSkus, conflicts };
}

export type { DecimalText };
