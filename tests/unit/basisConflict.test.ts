import { describe, expect, it } from 'vitest';
import { computeDocumentBasisConflicts, describeBasisConflicts } from '@/domain/quote/basisConflict';
import { CURRENT_TEMPLATE_VERSION } from '@/domain/quote/buildDocument';
import { makeDocument, itemRow, system } from '../fixtures/document';
import type { QuoteDocument } from '@/domain/quote/types';

/** 계획 2026-10-04-quote-workspace-ui Task 4. */

function baseDoc(versions: Partial<QuoteDocument['versions']>): QuoteDocument {
  const doc = makeDocument({
    systems: [system('S1', { indirect: [] })],
    rows: [itemRow('r1', 'S1', { quantity: '1', price: '1000' })],
  });
  return { ...doc, versions: { ...doc.versions, ...versions } };
}

describe('computeDocumentBasisConflicts', () => {
  it('카탈로그 해시가 같으면 충돌이 없다', () => {
    const doc = baseDoc({ catalog: 'abc', template: CURRENT_TEMPLATE_VERSION });
    expect(computeDocumentBasisConflicts(doc, { catalogSha256: 'abc' })).toEqual([]);
  });

  it('카탈로그 해시가 다르면 catalog 축 충돌을 돌려준다', () => {
    const doc = baseDoc({ catalog: 'old-hash', template: CURRENT_TEMPLATE_VERSION });
    const conflicts = computeDocumentBasisConflicts(doc, { catalogSha256: 'new-hash' });
    expect(conflicts).toEqual([{ axis: 'catalog', saved: 'old-hash', current: 'new-hash' }]);
  });

  it('템플릿 버전이 지금 상수와 다르면 template 축 충돌을 돌려준다', () => {
    const doc = baseDoc({ catalog: 'abc', template: 'sanitized-2020-01-01' });
    const conflicts = computeDocumentBasisConflicts(doc, { catalogSha256: 'abc' });
    expect(conflicts).toEqual([
      { axis: 'template', saved: 'sanitized-2020-01-01', current: CURRENT_TEMPLATE_VERSION },
    ]);
  });

  it('기준이 아직 적히지 않은(unknown) 문서는 비교하지 않는다 — 없는 값과 비교해 거짓 충돌을 만들지 않는다', () => {
    const doc = baseDoc({ catalog: 'unknown', template: 'unknown' });
    expect(computeDocumentBasisConflicts(doc, { catalogSha256: 'anything' })).toEqual([]);
  });

  it('describeBasisConflicts가 사람이 읽을 메시지로 합친다', () => {
    const message = describeBasisConflicts([{ axis: 'catalog', saved: 'a', current: 'b' }]);
    expect(message).toContain('카탈로그');
    expect(message).toContain('a');
    expect(message).toContain('b');
  });
});
