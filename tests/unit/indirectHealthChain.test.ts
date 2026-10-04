/**
 * 건강보험료 ↔ 노인장기요양보험료 종속 계산 (계획
 * 2026-10-04-quote-workspace-ui Task 2).
 *
 * 간접비 패널은 `IndirectCostRule.basis.kind === 'item'`인 항목이 가리키는
 * 항목의 금액이 0이면 "기준이 0원이라 이 항목도 0원"이라고 표시한다.
 * 그 표시가 정확한지는 도메인 계산이 실제로 그렇게 체인되는지에
 * 달렸다 — 여기서 그 체인 자체를 직접 검증한다(화면은 이 결과를 그대로
 * 읽기만 한다, React에 금액 식을 복제하지 않는다).
 *
 * 노무비 1,000,000·건강보험료 요율 0.03545·노인장기요양보험료 요율
 * 0.1295는 실제 가이드(`templates/sanitized/guide-pumsem.xlsx`, 일반
 * 프로파일)에서 그대로 읽은 값이다 — 가상의 수가 아니다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildQuoteDocument } from '@/domain/quote/buildDocument';
import { calculateQuote } from '@/domain/calculation/calculate';
import {
  GUIDE_IDS,
  indirectCostsFor,
  readGuideTemplate,
  type GuideId,
  type GuideManifest,
  type GuideTemplateSet,
} from '@/export/ooxml/guideTemplate';
import type { QuoteDocument } from '@/domain/quote/types';

const ROOT = resolve(__dirname, '../..');
const manifest = JSON.parse(
  readFileSync(resolve(ROOT, 'templates/sanitized/guide-manifest.json'), 'utf8'),
) as GuideManifest;
const guideOf = (id: GuideId) =>
  readGuideTemplate(id, new Uint8Array(readFileSync(resolve(ROOT, `templates/sanitized/guide-${id}.xlsx`))), manifest);
const guides = Object.fromEntries(GUIDE_IDS.map((id) => [id, guideOf(id)])) as GuideTemplateSet;

function documentWithManualLabor(laborUnitPrice: string): QuoteDocument {
  const base = buildQuoteDocument({
    header: {
      quoteNumber: 'IND-1',
      quoteDate: '2026-10-04',
      customer: '합성 고객',
      projectName: '간접비 종속 검증',
      contact: '',
      conditions: [],
    },
    systems: [{ name: '회의실', lines: [{ name: '공임 항목', specification: '', unit: '식', quantity: '1' }] }],
    documentId: 'doc-ind-1',
    rowIdPrefix: 'ind',
  });
  const rows = base.rows.map((row) =>
    row.type === 'item'
      ? { ...row, laborMode: 'manual' as const, manualLaborUnitPrice: laborUnitPrice, sellingUnitPrice: '0' }
      : row,
  );
  const systems = base.systems.map((system) => ({ ...system, indirectCosts: indirectCostsFor('general', guides) }));
  return { ...base, rows, systems };
}

function withApplied(document: QuoteDocument, name: string, applied: boolean): QuoteDocument {
  return {
    ...document,
    systems: document.systems.map((s) => ({
      ...s,
      indirectCosts: s.indirectCosts.map((rule) => (rule.name === name ? { ...rule, applied } : rule)),
    })),
  };
}

describe('건강보험료 ↔ 노인장기요양보험료 — item 기준 체인', () => {
  it('실제 가이드 요율이 0.03545/0.1295다 (전제 확인)', () => {
    const rules = indirectCostsFor('general', guides);
    const health = rules.find((r) => r.name === '국민건강보험료')!;
    const longTermCare = rules.find((r) => r.name === '노인장기요양보험료')!;
    expect(health.rate).toBe('0.03545');
    expect(longTermCare.basis).toEqual({ kind: 'item', itemId: health.itemId });
    expect(longTermCare.rate).toBe('0.1295');
  });

  it('건강보험 적용 시 노무비 1,000,000 기준으로 35,450/4,590이 나온다', () => {
    let document = documentWithManualLabor('1000000');
    document = withApplied(document, '국민건강보험료', true);
    document = withApplied(document, '노인장기요양보험료', true);

    const calc = calculateQuote(document).systems[0]!;
    expect(calc.directLabor.toFixed()).toBe('1000000');

    const health = calc.indirect.find((i) => i.name === '국민건강보험료')!;
    const longTermCare = calc.indirect.find((i) => i.name === '노인장기요양보험료')!;
    expect(health.amount.toFixed()).toBe('35450');
    expect(longTermCare.basisAmount.toFixed()).toBe('35450');
    expect(longTermCare.amount.toFixed()).toBe('4590');
  });

  it('건강보험을 끄면(미적용) 기준이 0원이 되어 장기요양도 0원이다', () => {
    let document = documentWithManualLabor('1000000');
    document = withApplied(document, '국민건강보험료', false);
    document = withApplied(document, '노인장기요양보험료', true);

    const calc = calculateQuote(document).systems[0]!;
    const health = calc.indirect.find((i) => i.name === '국민건강보험료')!;
    const longTermCare = calc.indirect.find((i) => i.name === '노인장기요양보험료')!;

    expect(health.amount.isZero()).toBe(true);
    expect(longTermCare.basisAmount.isZero()).toBe(true);
    expect(longTermCare.amount.isZero()).toBe(true);
  });
});
