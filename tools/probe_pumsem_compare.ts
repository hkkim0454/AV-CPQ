/** 읽기 전용 품셈 교체 대조의 단가 집계. SKU 대응은 호출자가 검증한 것만 받는다. */
import Decimal from 'decimal.js';

export interface MatchedSku {
  sourceSku: string;
  targetSku: string;
}

/** 중복 신원으로 여러 옛 제품이 하나의 새 제품에 연결되면 가격은 단정할 수 없다. */
export function oneToOneMatches(matched: readonly MatchedSku[]): MatchedSku[] {
  const counts = new Map<string, number>();
  for (const pair of matched) counts.set(pair.targetSku, (counts.get(pair.targetSku) ?? 0) + 1);
  return matched.filter((pair) => counts.get(pair.targetSku) === 1);
}

export interface PriceChange extends MatchedSku {
  oldPrice: string;
  newPrice: string;
  difference: string;
  ratio: string | null;
}

export function compareMatchedPrices(
  oldPrices: Record<string, { sellingUnitPrice: string }>,
  newPrices: Record<string, { sellingUnitPrice: string }>,
  matched: readonly MatchedSku[],
) {
  const changes: PriceChange[] = [];
  let compared = 0;
  let unchanged = 0;
  let increased = 0;
  let decreased = 0;
  let becameZero = 0;
  let oldMissing = 0;
  let newMissing = 0;
  for (const { sourceSku, targetSku } of matched) {
    const oldText = oldPrices[sourceSku]?.sellingUnitPrice;
    const newText = newPrices[targetSku]?.sellingUnitPrice;
    if (oldText === undefined) oldMissing++;
    if (newText === undefined) newMissing++;
    if (oldText === undefined || newText === undefined) continue;
    compared++;
    const oldPrice = new Decimal(oldText);
    const newPrice = new Decimal(newText);
    const difference = newPrice.minus(oldPrice);
    if (difference.isZero()) {
      unchanged++;
      continue;
    }
    if (difference.isPositive()) increased++;
    else decreased++;
    if (!oldPrice.isZero() && newPrice.isZero()) becameZero++;
    changes.push({
      sourceSku,
      targetSku,
      oldPrice: oldText,
      newPrice: newText,
      difference: difference.toString(),
      ratio: oldPrice.isZero() ? null : newPrice.div(oldPrice).toString(),
    });
  }
  return { compared, unchanged, increased, decreased, becameZero, oldMissing, newMissing, changes };
}
