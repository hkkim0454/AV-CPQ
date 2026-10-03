/**
 * 견적 문서 → 계산 결과. **노무비 연결까지 한 번에 한다.**
 *
 * ## 왜 따로 있는가
 *
 * `calculateQuote`만 부르면 노무비가 들어가지 않는다. 품셈 단가를
 * `calculateLaborForRows`로 먼저 만들어 넘겨야 한다.
 *
 * 그 두 단계를 호출부마다 손으로 이으면 **언젠가 한쪽이 빼먹는다.**
 * 빼먹으면 `labor-unresolved` 경고가 모든 행에 서고, 그걸 없애려고
 * `laborMode`를 `'not-applicable'`로 바꾸는 순간 이렇게 된다.
 *
 * ```
 * 노무비 0  →  간접비 6항목이 "노무비 대비"라 전부 0
 *           →  공과잡비도 0 (직접비+간접노무비+산업안전 기준)
 *           →  견적서에 재료비만 남는다
 * ```
 *
 * 실측: 3,540만원 견적에서 노무 194만 + 간접비 431만 = **625만원(18%)**이 사라졌다.
 * 그리고 **아무 경고도 나지 않는다** — `'not-applicable'`은 정상 상태다.
 *
 * 그래서 입구를 하나로 둔다. 구성도 경로든 품목 선택 경로든 이것을 부른다.
 *
 * `calculateQuote`와 `calculateLaborForRows`는 **고치지 않는다.** 여기서 엮을 뿐이다.
 */
import { calculateQuote, type CalculationInput, type CalculationSnapshot } from '../calculation/calculate';
import {
  calculateLaborForRows,
  type LaborBreakdown,
  type LaborReference,
} from '../labor/calculateLabor';
import type { LaborWarning } from '../labor/types';
import type { QuoteDocument } from './types';

export interface PricedQuote {
  calculation: CalculationSnapshot;
  /** 행별 일위대가 근거. 화면이 그대로 보여준다 (설계서 §5.3). */
  laborBreakdowns: Map<string, LaborBreakdown>;
  laborWarnings: LaborWarning[];
  /** 계산 경고와 품셈 경고를 합쳐 하나라도 막으면 true. */
  blocking: boolean;
}

/**
 * 품셈을 붙여 견적을 계산한다.
 *
 * @param laborReference 없으면 노무비를 계산하지 않는다. 그 경우 품셈이 붙은 행은
 *   `labor-mapping-missing` 경고로 **막힌다** — 조용히 0이 되지 않는다.
 */
export function priceQuote(
  document: QuoteDocument,
  laborReference?: LaborReference,
): PricedQuote {
  if (laborReference === undefined) {
    const calculation = calculateQuote(document);
    return {
      calculation,
      laborBreakdowns: new Map(),
      laborWarnings: [],
      blocking: calculation.blocking,
    };
  }

  const requests = document.rows
    .filter(
      (row): row is typeof row & { type: 'item'; laborMappingId: string } =>
        row.type === 'item' &&
        row.laborMode === 'mapped' &&
        row.laborMappingId !== undefined,
    )
    .map((row) => ({ rowId: row.rowId, laborMappingId: row.laborMappingId }));

  const labor = calculateLaborForRows(requests, laborReference);

  const input: CalculationInput = { laborUnitPrices: labor.unitPrices };
  const calculation = calculateQuote(document, input);

  return {
    calculation,
    laborBreakdowns: labor.breakdowns,
    laborWarnings: labor.warnings,
    // 품셈 경고에는 `mapping-unconfirmed`가 거의 항상 들어 있다 — 자동 추출이라
    // 전부 미확인이다. 그것도 확정을 막는 것이 맞다 (설계서 §5.3).
    blocking: calculation.blocking || labor.warnings.some((w) => w.blocking),
  };
}

export type { LaborReference, LaborBreakdown };
