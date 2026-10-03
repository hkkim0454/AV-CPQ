/**
 * 배정 원장 — 이미 확보된 자재를 먼저 쓰고 부족분만 남긴다 (설계서 §7.3).
 *
 *   4. 구성품에 포함된 케이블과 현장 기존 케이블을 먼저 배정한다
 *   5. 동일 케이블 재고를 여러 구간에 중복 배정하지 않는다
 *   6. 부족분만 추가 또는 추천한다
 *   7. 같은 동작을 반복해도 수량이 계속 늘지 않아야 한다
 *
 * 7번을 보장하는 방법: **입력을 변형하지 않는다.** 공급 풀을 복사해서 소비하고,
 * 남은 양을 새 배열로 돌려준다. 같은 입력으로 몇 번을 돌려도 같은 결과가 나온다.
 */
import { dec, text, Decimal, ZERO } from '../calculation/rounding';
import type { AccessoryRequirement, AllocationLine, AllocationResult, SupplyPool } from './types';

/** SKU가 확정된 요구에만 배정한다. */
function canAllocate(requirement: AccessoryRequirement): boolean {
  return (
    requirement.sku !== undefined &&
    (requirement.verdict === 'auto-addable' || requirement.verdict === 'satisfied')
  );
}

export function allocateAccessories(
  requirements: readonly AccessoryRequirement[],
  supplies: readonly SupplyPool[],
): AllocationResult {
  // 입력을 건드리지 않는다. 호출자의 배열이 바뀌면 반복 실행 결과가 달라진다.
  const pool = supplies.map((s) => ({ ...s, remaining: dec(s.quantity) }));

  const lines: AllocationLine[] = requirements.map((requirement) => {
    const required = dec(requirement.requiredQuantity);
    const draws: AllocationLine['draws'] = [];
    let satisfied = ZERO;

    if (canAllocate(requirement)) {
      let outstanding = required;
      for (const supply of pool) {
        if (outstanding.lessThanOrEqualTo(0)) break;
        if (supply.sku !== requirement.sku) continue;
        if (supply.unit !== requirement.unit) continue;
        if (supply.remaining.lessThanOrEqualTo(0)) continue;

        const take = Decimal.min(supply.remaining, outstanding);
        supply.remaining = supply.remaining.minus(take);
        outstanding = outstanding.minus(take);
        satisfied = satisfied.plus(take);
        draws.push({ supplyId: supply.supplyId, quantity: text(take) });
      }
    }

    const shortfall = required.minus(satisfied);
    // 전부 충족됐으면 판정을 satisfied로 올린다. 그 외에는 원래 판정을 유지한다 —
    // 배정이 미확인 정보를 확인 완료로 바꾸지 않는다 (설계서 §7.5).
    const verdict =
      canAllocate(requirement) && shortfall.lessThanOrEqualTo(0) && required.greaterThan(0)
        ? ('satisfied' as const)
        : requirement.verdict;

    return {
      requirementId: requirement.requirementId,
      ...(requirement.sku !== undefined ? { sku: requirement.sku } : {}),
      unit: requirement.unit,
      requiredQuantity: text(required),
      satisfiedQuantity: text(satisfied),
      shortfallQuantity: text(Decimal.max(shortfall, ZERO)),
      draws,
      verdict,
    };
  });

  const remaining: SupplyPool[] = pool.map(({ remaining: left, ...supply }) => ({
    ...supply,
    quantity: text(left),
  }));

  return { lines, remaining };
}
