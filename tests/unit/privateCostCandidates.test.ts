import { describe, expect, it } from 'vitest';
import { unresolvedCandidates } from '@/services/private-cost/candidates';
import { createSession } from '@/services/private-cost/session';
import type { PriceEntry } from '@/services/private-cost/parse';
import type { QuoteRow } from '@/domain/quote/types';

/**
 * 모델 후보 연결 — 독립 검토가 승인한 순서대로, 통화/단위 확인 입력
 * 다음 단계다. SKU로 이미 자동 연결되는 행, 이미 유효하게 수동 연결된
 * 행은 후보 목록에서 빼고, 사람이 직접 골라야 하는 행만 남긴다.
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
    const rows = [row({ rowId: 'r1', specification: 'SRG-A40' })];
    const entryId = session.candidatesByModel('SRG-A40')[0]!.entryId;
    expect(unresolvedCandidates(rows, session, { r1: entryId })).toEqual([]);
  });

  it('연결 표식이 다른 세션 것이면(옛 파일) 다시 후보 목록에 나온다', () => {
    const session = createSession([entry('row-1', 'SRG-A40')]);
    const rows = [row({ rowId: 'r1', specification: 'SRG-A40' })];
    const staleEntryId = 'cs-old-session:row-1'; // 다른 세션이 발급한 표식
    const result = unresolvedCandidates(rows, session, { r1: staleEntryId });
    expect(result).toHaveLength(1);
  });

  it('비슷한 모델이 여럿이어도 전부 후보로 돌려준다 — 하나를 고르지 않는다', () => {
    const session = createSession([entry('row-1', 'SRG-A40'), entry('row-2', 'SRG-A40T')]);
    const rows = [row({ rowId: 'r1', specification: 'SRG-A40' })];
    const result = unresolvedCandidates(rows, session, {});
    // 정확 일치만 돌려준다 — SRG-A40T는 SRG-A40의 후보가 아니다.
    expect(result[0]!.candidates.map((c) => c.model)).toEqual(['SRG-A40']);
  });

  it('후보가 0개여도 목록에 포함한다 — 미등록 표시용', () => {
    const session = createSession([entry('row-1', 'OTHER-MODEL')]);
    const rows = [row({ rowId: 'r1', specification: 'SRG-A40' })];
    const result = unresolvedCandidates(rows, session, {});
    expect(result).toHaveLength(1);
    expect(result[0]!.candidates).toEqual([]);
  });
});
