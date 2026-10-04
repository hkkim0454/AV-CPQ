import { describe, expect, it } from 'vitest';
import { computeDocumentBasisConflicts, describeBasisConflicts } from '@/domain/quote/basisConflict';
import { CURRENT_RULE_VERSION } from '@/domain/quote/buildDocument';
import { makeDocument, itemRow, system } from '../fixtures/document';
import type { QuoteDocument } from '@/domain/quote/types';

/** 계획 2026-10-04-quote-workspace-ui Task 4 — 독립 검토 지적 반영판. */

function baseDoc(versions: Partial<QuoteDocument['versions']>): QuoteDocument {
  const doc = makeDocument({
    systems: [system('S1', { indirect: [] })],
    rows: [itemRow('r1', 'S1', { quantity: '1', price: '1000' })],
  });
  return { ...doc, versions: { ...doc.versions, ...versions } };
}

describe('computeDocumentBasisConflicts — 새 문서(아직 기준 없음을 허용)', () => {
  const opts = { treatUnknownAsConflict: false };

  it('카탈로그 해시가 같으면 충돌이 없다', () => {
    const doc = baseDoc({ catalog: 'abc', rule: CURRENT_RULE_VERSION });
    expect(computeDocumentBasisConflicts(doc, { catalogSha256: 'abc' }, opts)).toEqual([]);
  });

  it('카탈로그 해시가 다르면 catalog 축 충돌을 돌려준다', () => {
    const doc = baseDoc({ catalog: 'old-hash', rule: CURRENT_RULE_VERSION });
    const conflicts = computeDocumentBasisConflicts(doc, { catalogSha256: 'new-hash' }, opts);
    expect(conflicts).toEqual([{ axis: 'catalog', saved: 'old-hash', current: 'new-hash' }]);
  });

  it('계산 규칙 버전이 지금 상수와 다르면 rule 축 충돌을 돌려준다', () => {
    const doc = baseDoc({ catalog: 'abc', rule: 'obsolete-conduit-50m-misc-all-materials' });
    const conflicts = computeDocumentBasisConflicts(doc, { catalogSha256: 'abc' }, opts);
    expect(conflicts).toEqual([
      { axis: 'rule', saved: 'obsolete-conduit-50m-misc-all-materials', current: CURRENT_RULE_VERSION },
    ]);
  });

  it('기준이 아직 적히지 않은(unknown) 새 문서는 비교하지 않는다 — 없는 값과 비교해 거짓 충돌을 만들지 않는다', () => {
    const doc = baseDoc({ catalog: 'unknown', rule: 'unknown' });
    expect(computeDocumentBasisConflicts(doc, { catalogSha256: 'anything' }, opts)).toEqual([]);
  });
});

describe('computeDocumentBasisConflicts — 재열기(기준 미상 자체가 충돌, 독립 검토 지적)', () => {
  const opts = { treatUnknownAsConflict: true };

  it('기준이 전부 unknown인 저장 파일을 재열기하면 두 축 모두 충돌로 본다', () => {
    const doc = baseDoc({ catalog: 'unknown', rule: 'unknown' });
    const conflicts = computeDocumentBasisConflicts(doc, { catalogSha256: 'abc' }, opts);
    expect(conflicts).toEqual([
      { axis: 'catalog', saved: 'unknown', current: 'abc' },
      { axis: 'rule', saved: 'unknown', current: CURRENT_RULE_VERSION },
    ]);
  });

  it('값이 전부 지금과 같으면(unknown도 아니고 일치) 충돌이 없다', () => {
    const doc = baseDoc({ catalog: 'abc', rule: CURRENT_RULE_VERSION });
    expect(computeDocumentBasisConflicts(doc, { catalogSha256: 'abc' }, opts)).toEqual([]);
  });
});

describe('describeBasisConflicts', () => {
  it('사람이 읽을 메시지로 합친다', () => {
    const message = describeBasisConflicts([{ axis: 'catalog', saved: 'a', current: 'b' }]);
    expect(message).toContain('카탈로그');
    expect(message).toContain('a');
    expect(message).toContain('b');
  });
});
