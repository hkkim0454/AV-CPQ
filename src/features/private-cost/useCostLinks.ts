/**
 * 견적 행과 원가 세션을 잇는다 — rowId→entryId 확인 연결은 이 훅의
 * React 상태에만 있다(QuoteDocument에 넣지 않는다, 계획 Task5).
 *
 * 문서가 바뀌면 연결을 전부 비운다 — 다른 문서의 rowId에 옛 문서의
 * 연결을 그대로 남겨 둘 이유가 없다(session 자체의 폐기와는 별개로,
 * 이 훅이 직접 관리하는 상태라 직접 비운다).
 */
import { useEffect, useState } from 'react';
import type { QuoteDocument, QuoteRow } from '../../domain/quote/types';
import { internalLines, type InternalLine } from '../../services/private-cost/calculate';
import { unresolvedCandidates, type UnresolvedRowCandidates } from '../../services/private-cost/candidates';
import type { PrivateCostSession } from '../../services/private-cost/session';

export interface CostLinks {
  lines: readonly InternalLine[];
  unresolved: readonly UnresolvedRowCandidates[];
  confirmLink(rowId: string, entryId: string): void;
}

function itemRowsOf(document: QuoteDocument | undefined): QuoteRow[] {
  if (document === undefined) return [];
  const out: QuoteRow[] = [];
  for (const row of document.rows) {
    if (row.type === 'item') out.push(row);
  }
  return out;
}

export function useCostLinks(
  document: QuoteDocument | undefined,
  session: PrivateCostSession | undefined,
): CostLinks {
  const [links, setLinks] = useState<Record<string, string>>({});

  useEffect(() => {
    setLinks({});
  }, [document]);

  function confirmLink(rowId: string, entryId: string): void {
    setLinks((current) => ({ ...current, [rowId]: entryId }));
  }

  if (session === undefined) {
    return { lines: [], unresolved: [], confirmLink };
  }

  const itemRows = itemRowsOf(document);
  const lines = internalLines(
    itemRows.map((row) => ({
      rowId: row.rowId,
      ...(row.sku !== undefined ? { sku: row.sku } : {}),
      ...(links[row.rowId] !== undefined ? { costEntryId: links[row.rowId]! } : {}),
      name: row.name,
      specification: row.specification,
      unit: row.unit,
      quantity: row.quantity,
      ...(row.sellingUnitPrice !== undefined ? { sellingUnitPrice: row.sellingUnitPrice } : {}),
    })),
    session,
  );
  const unresolved = unresolvedCandidates(itemRows, session, links);

  return { lines, unresolved, confirmLink };
}
