import { describe, expect, it } from 'vitest';
import {
  buildDerivedLines,
  connectorPacks,
  conduitPacks,
  CONNECTORS_PER_SEGMENT,
  CONDUIT_METERS_PER_SYSTEM,
} from '@/import/diagram/derived';
import type { CableLine } from '@/import/diagram/cables';
import { cat, catalogProduct } from '../fixtures/diagram';

/** 계획 2026-10-04 Task 5, 결정 D8 규칙 2·3. */

function cable(
  name: string,
  unit: string,
  segmentCount: number,
  lineTypeId = 'network',
): CableLine {
  return {
    name,
    specification: '',
    unit,
    segmentCount,
    lineTypeId,
    sourceEdgeIds: [],
  };
}

/** 커넥터·배관 제품이 들어 있는 카탈로그. */
const withParts = () =>
  cat([
    catalogProduct('CBL-0101', '- Pass Through RJ45 Connector', 'CAT6 UTP용', '10EA'),
    catalogProduct('CBL-0200', 'Flexible Conduit (고장력,비방수)', '28㎜_SF-28', '10M'),
  ], { 'CBL-0101': '12000', 'CBL-0200': '31000' });

describe('커넥터 — D8 규칙 2 (구간당 3개, 10EA 묶음)', () => {
  it.each([
    [1, 1], // 3개 → 1묶음
    [3, 1], // 9개 → 1묶음
    [4, 2], // 12개 → 2묶음
    [7, 3], // 21개 → 3묶음
    [10, 3], // 30개 → 3묶음
  ])('%s구간 → %s묶음', (seg, packs) => {
    expect(connectorPacks(seg)).toBe(packs);
  });

  it('구간 0이면 커넥터가 없다', () => {
    expect(connectorPacks(0)).toBe(0);
  });

  it('사용 2 + 예비 1 이다', () => {
    expect(CONNECTORS_PER_SEGMENT).toBe(3);
  });

  it('벌크 케이블에만 붙는다 — 완제품 HDMI에는 커넥터가 없다', () => {
    const { lines } = buildDerivedLines(
      [cable('HDMI Cable 5m', 'EA', 5, 'video')],
      0,
      withParts(),
    );
    expect(lines.filter((l) => l.name.includes('Connector'))).toHaveLength(0);
  });

  it('벌크 UTP에는 붙는다', () => {
    const { lines } = buildDerivedLines([cable('UTP Cable (CAT6)', '10M', 4)], 0, withParts());
    const connector = lines.find((l) => l.name.includes('Connector'))!;
    expect(connector.quantity).toBe('2'); // 4구간 × 3 = 12개 → 2묶음
    expect(connector.unit).toBe('10EA');
    expect(connector.sku).toBe('CBL-0101');
    expect(connector.sellingUnitPrice).toBe('12000');
  });

  it('여러 벌크 케이블의 구간을 합산한다', () => {
    const { lines } = buildDerivedLines(
      [cable('UTP', '10M', 3), cable('광케이블', '10M', 4, 'sdi')],
      0,
      withParts(),
    );
    // 7구간 × 3 = 21개 → 3묶음
    expect(lines.find((l) => l.name.includes('Connector'))!.quantity).toBe('3');
  });

  it('근거를 규격에 남긴다 — 사람이 검산할 수 있어야 한다', () => {
    const { lines } = buildDerivedLines([cable('UTP', '10M', 4)], 0, withParts());
    expect(lines.find((l) => l.name.includes('Connector'))!.specification).toContain(
      '4구간',
    );
  });

  it('카탈로그에 커넥터가 없으면 막는다', () => {
    const { lines, warnings } = buildDerivedLines([cable('UTP', '10M', 4)], 0, cat([]));
    expect(lines.find((l) => l.name.includes('Connector'))).toBeDefined();
    expect(warnings.some((w) => w.blocking)).toBe(true);
  });
});

describe('배관 — D8 규칙 3 (공간당 50m 고정)', () => {
  it('공간 1개면 10M × 5다', () => {
    const { lines } = buildDerivedLines([], 1, withParts());
    const conduit = lines.find((l) => l.name.includes('Conduit'))!;
    expect(conduit.quantity).toBe('5');
    expect(conduit.unit).toBe('10M');
  });

  it('공간 3개면 10M × 15다', () => {
    const { lines } = buildDerivedLines([], 3, withParts());
    expect(lines.find((l) => l.name.includes('Conduit'))!.quantity).toBe('15');
  });

  it('공간당 50m다', () => {
    expect(CONDUIT_METERS_PER_SYSTEM).toBe(50);
    expect(conduitPacks(1)).toBe(5);
    expect(conduitPacks(4)).toBe(20);
  });

  it('케이블 총 길이와 무관하다 — 60% 규칙은 폐기됐다', () => {
    const many = [cable('UTP Cable (CAT6)', '10M', 40)];
    const a = buildDerivedLines([], 1, withParts());
    const b = buildDerivedLines(many, 1, withParts());
    const quantityOf = (r: typeof a) =>
      r.lines.find((l) => l.name.includes('Conduit'))!.quantity;
    expect(quantityOf(a)).toBe(quantityOf(b));
  });

  it('공간 0이면 배관도 0이다', () => {
    const { lines } = buildDerivedLines([], 0, withParts());
    expect(lines.filter((l) => l.name.includes('Conduit'))).toHaveLength(0);
  });

  it('근거를 규격에 남긴다', () => {
    const { lines } = buildDerivedLines([], 3, withParts());
    const conduit = lines.find((l) => l.name.includes('Conduit'))!;
    expect(conduit.specification).toContain('공간 3개');
    expect(conduit.specification).toContain('50m');
  });
});

describe('파생 행 — 공통', () => {
  it('둘 다 딸림 항목으로 표시한다 — 견적서에서 `- `로 붙는다', () => {
    const { lines } = buildDerivedLines([cable('UTP', '10M', 2)], 1, withParts());
    expect(lines.every((l) => l.isAccessory)).toBe(true);
  });

  it('구성도 노드에서 온 것이 아니다', () => {
    const { lines } = buildDerivedLines([cable('UTP', '10M', 2)], 1, withParts());
    expect(lines.every((l) => l.sourceNodeIds.length === 0)).toBe(true);
  });

  it('두 번 돌려도 결과가 같다 (설계서 §7.3)', () => {
    const cables = [cable('UTP', '10M', 4)];
    const c = withParts();
    const a = buildDerivedLines(cables, 2, c);
    const b = buildDerivedLines(cables, 2, c);
    expect(JSON.stringify(a.lines)).toBe(JSON.stringify(b.lines));
  });

  it('케이블도 공간도 없으면 행을 만들지 않는다', () => {
    const { lines, warnings } = buildDerivedLines([], 0, withParts());
    expect(lines).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
});
