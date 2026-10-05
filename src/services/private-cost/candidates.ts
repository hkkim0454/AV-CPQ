/**
 * 모델 후보 연결 — SKU로 이미 자동 연결되는 행은 빼고, 사람이 모델명
 * 후보 중 직접 골라야 하는 행만 추려낸다(계획 Task5 체크리스트).
 *
 * 비슷한 모델명으로 조용히 하나를 고르지 않는다 — `session.
 * candidatesByModel`이 돌려준 후보를 그대로 보여주고, 어느 줄인지는
 * 사람이 고른다(session.ts의 설계 원칙을 그대로 따른다).
 *
 * 확인 당시 행의 제품 식별(productId·SKU·규격·단위)을 **그대로
 * 저장**해 두고, 노출마다 지금 행과 전부 같은지 다시 비교한다 — 모델
 * 텍스트 하나만 비교하면, 다른 제품으로 바뀐 행이 우연히 같은 규격
 * 문구를 가질 때 옛 연결을 "여전히 유효"로 잘못 본다(독립 검토 지적
 * 2026-10-05).
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

/** rowId에 사람이 확인해 연결한 자리표 — 확인 당시 행의 제품 식별을 품고 다닌다. */
export interface ConfirmedLink {
  readonly entryId: string;
  readonly productId?: string;
  readonly sku?: string;
  readonly specification: string;
  readonly unit: string;
}

/**
 * 이 연결이 지금도 유효한가 — 이 세션의 자리표이고(파일 교체로
 * 무효화되지 않았고), **확인 당시 행의 제품 식별이 지금 행과 전부
 * 같을 때만** 유효하다. 제품(productId)·SKU·규격·단위 중 하나라도
 * 바뀌면(다른 제품으로 교체) 더는 유효하지 않다 — 다시 확인받는다.
 */
export function linkStillValid(row: QuoteRow, link: ConfirmedLink, session: PrivateCostSession): boolean {
  if (!session.ownsEntryId(link.entryId)) return false;
  return (
    link.productId === row.productId &&
    link.sku === row.sku &&
    link.specification === row.specification &&
    link.unit === row.unit
  );
}

/**
 * 사람이 확인할 자리를 돌려준다 — 이미 유효하게 연결됐거나(수동 확인
 * 또는 SKU 정확 일치) 자동으로 해소되는 행은 뺀다. 후보가 0개인 행도
 * 포함한다(화면에 "후보 없음"으로 보여주기 위해).
 */
export function unresolvedCandidates(
  rows: readonly QuoteRow[],
  session: PrivateCostSession,
  links: Readonly<Record<string, ConfirmedLink>>,
): UnresolvedRowCandidates[] {
  return rows
    .filter((row) => {
      const linked = links[row.rowId];
      if (linked !== undefined && linkStillValid(row, linked, session)) return false;
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
