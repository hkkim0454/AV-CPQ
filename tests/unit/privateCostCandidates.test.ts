import { describe, expect, it } from 'vitest';
import { unresolvedCandidates, type ConfirmedLink } from '@/services/private-cost/candidates';
import { createSession } from '@/services/private-cost/session';
import type { PriceEntry } from '@/services/private-cost/parse';
import type { QuoteRow } from '@/domain/quote/types';

/**
 * 모델 후보 연결 — 독립 검토가 승인한 순서대로, 통화/단위 확인 입력
 * 다음 단계다. SKU로 이미 자동 연결되는 행, 이미 유효하게 수동 연결된
 * 행은 후보 목록에서 빼고, 사람이 직접 골라야 하는 행만 남긴다.
 *
 * 확인 연결(`ConfirmedLink`)은 확인 당시 행의 제품 식별(productId·
 * SKU·규격·단위)을 그대로 품고 다닌다 — 모델 텍스트 하나만 비교하면,
 * 다른 제품으로 바뀐 행이 우연히 같은 규격 문구를 가질 때 옛 연결을
 * 잘못 "여전히 유효"로 본다(독립 검토 지적 2026-10-05).
 */

function row(overrides: Partial<QuoteRow> & Pick<QuoteRow, 'rowId' | 'specification'>): QuoteRow {
  return {
    systemId: 'sys-1',
    name: '합성 품목',
    unit: 'EA',
    quantity: '1',
    laborMode: 'not-applicable',
    remark: '',
    origin: 'manual',
    ...overrides,
  };
}

function entry(entryId: string, model: string): PriceEntry {
  return { entryId, model, purchaseUnitPrice: '1000000', currency: 'KRW', unit: 'EA' };
}

/** 지금 행의 식별을 그대로 확인 연결로 찍는다(사람이 "지금 이 행"을 보고 확인했다고 가정). */
function linkFor(row: QuoteRow, entryId: string): ConfirmedLink {
  return {
    entryId,
    ...(row.productId !== undefined ? { productId: row.productId } : {}),
    ...(row.sku !== undefined ? { sku: row.sku } : {}),
    specification: row.specification,
    unit: row.unit,
  };
}

describe('unresolvedCandidates', () => {
  it('SKU로 이미 자동 연결되는 행은 후보 목록에서 뺀다', () => {
    const session = createSession([{ entryId: 'row-1', sku: 'SKU-A', purchaseUnitPrice: '1000', currency: 'KRW', unit: 'EA' }]);
    const rows = [row({ rowId: 'r1', sku: 'SKU-A', specification: 'ANY' })];
    expect(unresolvedCandidates(rows, session, {})).toEqual([]);
  });

  it('SKU가 있어도 세션에 없으면 모델로 후보를 찾는다', () => {
    const session = createSession([entry('row-1', 'SRG-A40')]);
    const rows = [row({ rowId: 'r1', sku: 'SKU-NOT-IN-FILE', specification: 'SRG-A40' })];
    const result = unresolvedCandidates(rows, session, {});
    expect(result).toHaveLength(1);
    expect(result[0]!.candidates.map((c) => c.model)).toEqual(['SRG-A40']);
  });

  it('이미 유효하게 수동 연결된 행은 후보 목록에서 뺀다', () => {
    const session = createSession([entry('row-1', 'SRG-A40')]);
    const theRow = row({ rowId: 'r1', specification: 'SRG-A40' });
    const entryId = session.candidatesByModel('SRG-A40')[0]!.entryId;
    expect(unresolvedCandidates([theRow], session, { r1: linkFor(theRow, entryId) })).toEqual([]);
  });

  it('연결 표식이 다른 세션 것이면(옛 파일) 다시 후보 목록에 나온다', () => {
    const session = createSession([entry('row-1', 'SRG-A40')]);
    const theRow = row({ rowId: 'r1', specification: 'SRG-A40' });
    const staleEntryId = 'cs-old-session:row-1'; // 다른 세션이 발급한 표식
    const result = unresolvedCandidates([theRow], session, { r1: linkFor(theRow, staleEntryId) });
    expect(result).toHaveLength(1);
  });

  it('비슷한 모델이 여럿이어도 전부 후보로 돌려준다 — 하나를 고르지 않는다', () => {
    const session = createSession([entry('row-1', 'SRG-A40'), entry('row-2', 'SRG-A40T')]);
    const rows = [row({ rowId: 'r1', specification: 'SRG-A40' })];
    const result = unresolvedCandidates(rows, session, {});
    // 정확 일치만 돌려준다 — SRG-A40T는 SRG-A40의 후보가 아니다.
    expect(result[0]!.candidates.map((c) => c.model)).toEqual(['SRG-A40']);
  });

  it('행의 규격이 바뀌면(제품 교체) 연결이 다시 후보 목록에 나온다', () => {
    const session = createSession([entry('row-1', 'SRG-A40'), entry('row-2', 'OTHER-MODEL')]);
    const oldRow = row({ rowId: 'r1', specification: 'SRG-A40' });
    const entryId = session.candidatesByModel('SRG-A40')[0]!.entryId;
    const link = linkFor(oldRow, entryId); // 확인 당시 규격은 SRG-A40이었다.
    const changedRow = row({ rowId: 'r1', specification: 'OTHER-MODEL' }); // 지금은 다른 제품이다.
    const result = unresolvedCandidates([changedRow], session, { r1: link });
    expect(result).toHaveLength(1);
    expect(result[0]!.candidates.map((c) => c.model)).toEqual(['OTHER-MODEL']);
  });

  it('규격 텍스트가 우연히 같아도 SKU/productId가 바뀐 행은 다시 확인받는다', () => {
    // 독립 검토 지적: matchesModel(모델 텍스트 비교)만으로는 부족하다 —
    // 같은 모델 문구라도 다른 제품(productId/SKU)으로 바뀐 행은 무효화해야 한다.
    const session = createSession([entry('row-1', 'SRG-A40')]);
    const oldRow = row({ rowId: 'r1', specification: 'SRG-A40', sku: 'SKU-OLD' });
    const entryId = session.candidatesByModel('SRG-A40')[0]!.entryId;
    const link = linkFor(oldRow, entryId);
    const changedRow = row({ rowId: 'r1', specification: 'SRG-A40', sku: 'SKU-NEW' }); // 같은 규격, 다른 제품
    const result = unresolvedCandidates([changedRow], session, { r1: link });
    expect(result).toHaveLength(1);
  });

  it('단위만 바뀐 행도 다시 확인받는다', () => {
    const session = createSession([entry('row-1', 'SRG-A40')]);
    const oldRow = row({ rowId: 'r1', specification: 'SRG-A40', unit: 'EA' });
    const entryId = session.candidatesByModel('SRG-A40')[0]!.entryId;
    const link = linkFor(oldRow, entryId);
    const changedRow = row({ rowId: 'r1', specification: 'SRG-A40', unit: 'M' });
    const result = unresolvedCandidates([changedRow], session, { r1: link });
    expect(result).toHaveLength(1);
  });

  it('후보가 0개여도 목록에 포함한다 — 미등록 표시용', () => {
    const session = createSession([entry('row-1', 'OTHER-MODEL')]);
    const rows = [row({ rowId: 'r1', specification: 'SRG-A40' })];
    const result = unresolvedCandidates(rows, session, {});
    expect(result).toHaveLength(1);
    expect(result[0]!.candidates).toEqual([]);
  });
});
