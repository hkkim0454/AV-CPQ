/**
 * 모델 후보 연결 — SKU로 이미 자동 연결되는 행은 빼고, 사람이 모델명
 * 후보 중 직접 골라야 하는 행만 추려낸다(계획 Task5 체크리스트).
 *
 * 비슷한 모델명으로 조용히 하나를 고르지 않는다 — `session.
 * candidatesByModel`이 돌려준 후보를 그대로 보여주고, 어느 줄인지는
 * 사람이 고른다(session.ts의 설계 원칙을 그대로 따른다).
 */
import type { QuoteRow } from '../../domain/quote/types';
import type { PriceEntry } from './parse';
import type { PrivateCostSession } from './session';

export interface UnresolvedRowCandidates {
  rowId: string;
  name: string;
  specification: string;
  unit: string;
  candidates: readonly PriceEntry[];
}

/**
 * 사람이 확인할 자리를 돌려준다 — 이미 유효하게 연결됐거나(수동 확인
 * 또는 SKU 정확 일치) 자동으로 해소되는 행은 뺀다. 후보가 0개인 행도
 * 포함한다(화면에 "후보 없음"으로 보여주기 위해).
 */
export function unresolvedCandidates(
  rows: readonly QuoteRow[],
  session: PrivateCostSession,
  links: Readonly<Record<string, string>>,
): UnresolvedRowCandidates[] {
  return rows
    .filter((row) => {
      const linked = links[row.rowId];
      if (linked !== undefined && session.ownsEntryId(linked)) return false;
      if (row.sku !== undefined && session.lookup(row.sku) !== undefined) return false;
      return true;
    })
    .map((row) => ({
      rowId: row.rowId,
      name: row.name,
      specification: row.specification,
      unit: row.unit,
      candidates: session.candidatesByModel(row.specification),
    }));
}
