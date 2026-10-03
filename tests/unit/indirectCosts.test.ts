import { describe, expect, it } from 'vitest';
import {
  standardIndirectCosts,
  INDIRECT_COST_SOURCE,
} from '@/domain/quote/indirectCosts';

/**
 * 간접비 기본 프로파일.
 *
 * 아래 요율은 원본 견적서 **5개 시트 전부에서 실측한 값**이다
 * (`docs/template/mapping.md` §3.6). 추측값이 아니므로, 이 테스트가 깨지면
 * 원본과 어긋난 것이다.
 */

/** 원본 실측값. 순서까지 원본과 같아야 한다 — 견적서에 그 순서로 찍힌다. */
const MEASURED: Array<[string, string, string, boolean]> = [
  ['간접노무비', '노무비 대비', '0.0486', true],
  ['고용보험료', '노무비 대비', '0.00424', true],
  ['산재보험료', '노무비 대비', '0.00961', true],
  ['연금보험료', '노무비 대비', '0.01215', false],
  ['건강보험료', '노무비 대비', '0.00957', false],
  ['노인장기요양보험료', '노무비 대비', '0.00124', false],
  ['산업안전보건관리비', '직접비 대비', '0.0311', true],
  ['퇴직공제부금비', '노무비 대비', '0.00621', true],
  ['공과잡비', '직접비+간접노무비+산업안전관리비', '0.1', true],
];

describe('standardIndirectCosts — 원본 실측값', () => {
  it('9항목을 원본 순서대로 낸다', () => {
    const rules = standardIndirectCosts();
    expect(rules).toHaveLength(9);
    expect(rules.map((r) => r.name)).toEqual(MEASURED.map((m) => m[0]));
  });

  it('이름·기준·요율·적용 여부가 원본과 같다', () => {
    const rules = standardIndirectCosts();
    rules.forEach((rule, index) => {
      const [name, basisLabel, rate, applied] = MEASURED[index]!;
      expect(rule.name).toBe(name);
      expect(rule.basisLabel).toBe(basisLabel);
      expect(rule.rate).toBe(rate);
      expect(rule.applied).toBe(applied);
    });
  });

  it('연금·건강·노인장기요양은 기본 미적용이다 — 원본 금액 칸이 상수 0이다', () => {
    const rules = standardIndirectCosts();
    const off = rules.filter((r) => !r.applied).map((r) => r.name);
    expect(off).toEqual(['연금보험료', '건강보험료', '노인장기요양보험료']);
  });

  it('미적용 항목도 요율은 들고 있다 — 사용자가 켤 수 있어야 한다', () => {
    const rules = standardIndirectCosts();
    for (const rule of rules.filter((r) => !r.applied)) {
      expect(rule.rate).not.toBe('0');
      expect(Number(rule.rate)).toBeGreaterThan(0);
    }
  });

  it('기준이 원본대로 연결돼 있다', () => {
    const rules = standardIndirectCosts();
    const byName = new Map(rules.map((r) => [r.name, r]));
    expect(byName.get('간접노무비')!.basis).toEqual({ kind: 'labor' });
    expect(byName.get('산업안전보건관리비')!.basis).toEqual({ kind: 'direct' });
    expect(byName.get('공과잡비')!.basis).toEqual({
      kind: 'composite',
      plusItemIds: ['i1', 'i7'],
    });
  });

  it('공과잡비가 참조하는 항목이 실재하고 앞에 온다', () => {
    const rules = standardIndirectCosts();
    const composite = rules.find((r) => r.basis.kind === 'composite')!;
    const compositeIndex = rules.indexOf(composite);
    for (const id of (composite.basis as { plusItemIds: string[] }).plusItemIds) {
      const index = rules.findIndex((r) => r.itemId === id);
      expect(index, `${id}가 없다`).toBeGreaterThanOrEqual(0);
      expect(index, `${id}가 공과잡비보다 뒤에 있다`).toBeLessThan(compositeIndex);
    }
  });

  it('출처를 전부 기록한다', () => {
    for (const rule of standardIndirectCosts()) {
      expect(rule.source).toBe(INDIRECT_COST_SOURCE);
    }
  });
});

describe('standardIndirectCosts — 호출할 때마다 새 배열', () => {
  it('한 견적의 변경이 다른 견적에 번지지 않는다', () => {
    const a = standardIndirectCosts();
    const b = standardIndirectCosts();
    a[3]!.applied = true;
    expect(b[3]!.applied).toBe(false);
  });

  it('배열 자체도 공유하지 않는다', () => {
    expect(standardIndirectCosts()).not.toBe(standardIndirectCosts());
  });
});

describe('요율의 단일 출처', () => {
  it('테스트 픽스처가 제품 코드의 것을 그대로 쓴다 — 두 곳에서 관리하지 않는다', async () => {
    const fixture = await import('../fixtures/syntheticQuote');
    expect(fixture.standardIndirectCosts).toBe(standardIndirectCosts);
  });
});
