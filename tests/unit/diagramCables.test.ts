import { describe, expect, it } from 'vitest';
import { bulkUnits, buildCableLines, snapToStep } from '@/import/diagram/cables';
import { cat, diagram, edge, node } from '../fixtures/diagram';
import type { DiagramBomRow } from '@/import/diagram/types';

/** 계획 2026-10-04 Task 4, 결정 D8 규칙 1. */

function withEdges(
  edges: Array<{ id: string; lineTypeId: string; rows: DiagramBomRow[] }>,
) {
  return diagram(
    [node('n1', 'A', 'SRG-X40UH'), node('n2', 'B', 'XDM-12')],
    edges.map((e) => edge(e.id, 'n1', 'n2', e.lineTypeId, { bomRows: e.rows })),
  );
}

describe('완제품 길이 계단 — D8', () => {
  it.each([
    [0.5, 1],
    [1, 1],
    [1.2, 2],
    [3, 3],
    [3.1, 5],
    [5, 5],
    [6, 7],
    [7, 7],
    [8, 10],
    [10, 10],
    [12, 15],
    [15, 15],
    [16, 20],
    [20, 20],
  ])('%sm → %sm', (input, want) => {
    expect(snapToStep(input)).toBe(want);
  });

  it('20m를 넘으면 가장 큰 계단을 준다 — 호출부가 경고를 세운다', () => {
    expect(snapToStep(33.8)).toBe(20);
  });

  it('내리지 않고 올린다 — 모자라면 현장에서 못 쓴다', () => {
    expect(snapToStep(5.01)).toBe(7);
    expect(snapToStep(10.01)).toBe(15);
  });
});

describe('벌크 10M 단위 — D8', () => {
  it.each([
    [1, 1],
    [10, 1],
    [11, 2],
    [25, 3],
    [30, 3],
    [31, 4],
    [300, 30],
  ])('%sm → 10M×%s', (m, u) => {
    expect(bulkUnits(m)).toBe(u);
  });

  it('0m는 0 묶음이다', () => {
    expect(bulkUnits(0)).toBe(0);
  });
});

describe('케이블 행 — 완제품 (설계서 §7.4)', () => {
  it('5m 두 구간은 2EA지 10EA가 아니다', () => {
    const d = withEdges([
      {
        id: 'e1',
        lineTypeId: 'video',
        rows: [
          { cableType: 'ready-made', productName: 'HDMI Cable 5m', length: '5', quantity: '1' },
        ],
      },
      {
        id: 'e2',
        lineTypeId: 'video',
        rows: [
          { cableType: 'ready-made', productName: 'HDMI Cable 5m', length: '5', quantity: '1' },
        ],
      },
    ]);
    const { lines } = buildCableLines(d, cat());
    const hdmi = lines.find((l) => l.name.includes('HDMI Cable 5m'))!;
    expect(hdmi.unit).toBe('EA');
    expect(hdmi.quantity).toBe('2');
    expect(hdmi.segmentCount).toBe(2);
  });

  it('구간 하나에 여러 벌이면 그만큼 센다', () => {
    const d = withEdges([
      {
        id: 'e1',
        lineTypeId: 'video',
        rows: [{ cableType: 'ready-made', productName: 'HDMI 3m', length: '3', quantity: '4' }],
      },
    ]);
    expect(buildCableLines(d, cat()).lines[0]!.quantity).toBe('4');
  });

  it('같은 제품이 여러 구간에 나오면 한 행으로 합친다', () => {
    const d = withEdges([
      {
        id: 'e1',
        lineTypeId: 'video',
        rows: [{ cableType: 'ready-made', productName: 'HDMI 3m', length: '3', quantity: '2' }],
      },
      {
        id: 'e2',
        lineTypeId: 'video',
        rows: [{ cableType: 'ready-made', productName: 'HDMI 3m', length: '3', quantity: '4' }],
      },
    ]);
    const { lines } = buildCableLines(d, cat());
    expect(lines.filter((l) => l.name.includes('HDMI 3m'))).toHaveLength(1);
    expect(lines[0]!.quantity).toBe('6');
    expect(lines[0]!.sourceEdgeIds.sort()).toEqual(['e1', 'e2']);
  });

  it('cableType이 없으면 완제품으로 본다 — 안전한 쪽', () => {
    const d = withEdges([
      { id: 'e1', lineTypeId: 'video', rows: [{ productName: 'HDMI 3m', length: '3', quantity: '1' }] },
    ]);
    expect(buildCableLines(d, cat()).lines[0]!.unit).toBe('EA');
  });

  it('규격에 올림한 계단 길이를 적는다', () => {
    const d = withEdges([
      {
        id: 'e1',
        lineTypeId: 'video',
        rows: [{ cableType: 'ready-made', productName: 'HDMI Cable', length: '6', quantity: '1' }],
      },
    ]);
    expect(buildCableLines(d, cat()).lines[0]!.specification).toBe('7m');
  });

  it('20m를 넘는 완제품은 막는다 — 제작 케이블로 가야 한다', () => {
    const d = withEdges([
      {
        id: 'e1',
        lineTypeId: 'video',
        rows: [{ cableType: 'ready-made', productName: 'HDMI Cable', length: '33.8', quantity: '1' }],
      },
    ]);
    const { warnings } = buildCableLines(d, cat());
    const w = warnings.find((x) => x.code === 'cable-item-unresolved');
    expect(w?.blocking).toBe(true);
    expect(w?.message).toContain('33.8');
  });
});

describe('케이블 행 — 벌크', () => {
  it('길이를 합산한 뒤 10M로 올린다', () => {
    const d = withEdges([
      {
        id: 'e1',
        lineTypeId: 'network',
        rows: [
          { cableType: 'manufactured', productName: 'UTP Cable (CAT6)', length: '12', quantity: '1' },
        ],
      },
      {
        id: 'e2',
        lineTypeId: 'network',
        rows: [
          { cableType: 'manufactured', productName: 'UTP Cable (CAT6)', length: '15', quantity: '1' },
        ],
      },
    ]);
    const { lines } = buildCableLines(d, cat());
    const utp = lines.find((l) => l.name.includes('UTP'))!;
    expect(utp.unit).toBe('10M');
    expect(utp.quantity).toBe('3'); // 27m → 3묶음
    expect(utp.segmentCount).toBe(2);
  });

  it('합산 전 실제 길이를 남긴다 — 사람이 검토할 근거', () => {
    const d = withEdges([
      {
        id: 'e1',
        lineTypeId: 'network',
        rows: [{ cableType: 'manufactured', productName: 'UTP', length: '12.5', quantity: '1' }],
      },
    ]);
    const utp = buildCableLines(d, cat()).lines[0]!;
    expect(utp.totalMeters).toBe('12.5');
    expect(utp.quantity).toBe('2');
  });

  it('구간 하나에 여러 가닥이면 길이를 곱한다', () => {
    const d = withEdges([
      {
        id: 'e1',
        lineTypeId: 'network',
        rows: [{ cableType: 'manufactured', productName: 'UTP', length: '10', quantity: '3' }],
      },
    ]);
    const utp = buildCableLines(d, cat()).lines[0]!;
    expect(utp.totalMeters).toBe('30');
    expect(utp.quantity).toBe('3');
  });

  it('완제품과 벌크는 같은 품명이어도 따로 센다', () => {
    const d = withEdges([
      {
        id: 'e1',
        lineTypeId: 'video',
        rows: [{ cableType: 'ready-made', productName: 'HDMI', length: '3', quantity: '1' }],
      },
      {
        id: 'e2',
        lineTypeId: 'video',
        rows: [{ cableType: 'manufactured', productName: 'HDMI', length: '30', quantity: '1' }],
      },
    ]);
    const { lines } = buildCableLines(d, cat());
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.unit).sort()).toEqual(['10M', 'EA']);
  });
});

describe('케이블 행 — 품목이 없을 때 (Review Focus #5)', () => {
  it('bomRows가 비면 행을 만들되 수량을 비우고 막는다 — 선을 무시하면 안 된다', () => {
    const d = withEdges([{ id: 'e1', lineTypeId: 'video', rows: [] }]);
    const { lines, warnings } = buildCableLines(d, cat());
    expect(lines).toHaveLength(1);
    expect(lines[0]!.quantity).toBeUndefined();
    expect(lines[0]!.lineTypeId).toBe('video');
    expect(lines[0]!.name).toContain('미정');
    expect(warnings.some((w) => w.blocking && w.edgeId === 'e1')).toBe(true);
  });

  it('선 종류 이름을 품명에 쓴다 — 무슨 케이블을 정해야 하는지 보인다', () => {
    const d = withEdges([{ id: 'e1', lineTypeId: 'video', rows: [] }]);
    expect(buildCableLines(d, cat()).lines[0]!.name).toContain('HDMI');
  });

  it('같은 선 종류의 미정 구간은 한 행으로 모으고 구간 수를 센다', () => {
    const d = withEdges([
      { id: 'e1', lineTypeId: 'video', rows: [] },
      { id: 'e2', lineTypeId: 'video', rows: [] },
      { id: 'e3', lineTypeId: 'network', rows: [] },
    ]);
    const { lines, warnings } = buildCableLines(d, cat());
    expect(lines).toHaveLength(2);
    const video = lines.find((l) => l.lineTypeId === 'video')!;
    expect(video.segmentCount).toBe(2);
    // 경고는 구간마다 — 어느 선을 고쳐야 하는지 알아야 한다
    expect(warnings.filter((w) => w.code === 'cable-item-unresolved')).toHaveLength(3);
  });

  it('모르는 lineTypeId는 경고만 세우고 진행한다 — 사용자가 선 종류를 추가할 수 있다', () => {
    const d = withEdges([{ id: 'e1', lineTypeId: 'lt-신규', rows: [] }]);
    const { lines, warnings } = buildCableLines(d, cat());
    const w = warnings.find((x) => x.code === 'unknown-line-type');
    expect(w).toBeDefined();
    expect(w!.blocking).toBe(false);
    expect(lines).toHaveLength(1);
  });

  it('모르는 선 종류 경고는 한 번만 낸다', () => {
    const d = withEdges([
      { id: 'e1', lineTypeId: 'lt-신규', rows: [] },
      { id: 'e2', lineTypeId: 'lt-신규', rows: [] },
    ]);
    const { warnings } = buildCableLines(d, cat());
    expect(warnings.filter((w) => w.code === 'unknown-line-type')).toHaveLength(1);
  });
});

describe('멱등성 (설계서 §7.3)', () => {
  it('같은 구성도를 두 번 변환해도 수량이 누적되지 않는다', () => {
    const d = withEdges([
      {
        id: 'e1',
        lineTypeId: 'video',
        rows: [{ cableType: 'ready-made', productName: 'HDMI 3m', length: '3', quantity: '2' }],
      },
    ]);
    const c = cat();
    const a = buildCableLines(d, c);
    const b = buildCableLines(d, c);
    expect(a.lines[0]!.quantity).toBe('2');
    expect(b.lines[0]!.quantity).toBe('2');
    expect(JSON.stringify(a.lines)).toBe(JSON.stringify(b.lines));
  });
});

/**
 * 최종 검토에서 나온 두 결함.
 *
 * 둘 다 같은 유형이다 — **값이 틀린 게 아니라, 없는 값이 조용히 메워진다.**
 * 틀린 값은 테스트가 잡지만 없는 값은 테스트가 애초에 쳐다보지 않는다.
 */
describe('최종 검토 — 길이가 조용히 뭉개지지 않는다', () => {
  it('길이가 다른 완제품은 합쳐지지 않는다 — 15m 구간이 3m로 나가면 현장에서 모자란다', () => {
    const d = diagram(
      [node('a', '소스', 'XDM-12'), node('b', '디스플레이', 'LH98QMCEBGCXKR')],
      [
        edge('e1', 'a', 'b', 'video', {
          bomRows: [{ productName: 'HDMI 케이블', cableType: 'ready-made', length: '3' }],
        }),
        edge('e2', 'a', 'b', 'video', {
          bomRows: [{ productName: 'HDMI 케이블', cableType: 'ready-made', length: '15' }],
        }),
      ],
    );
    const result = buildCableLines(d, cat());
    const specs = result.lines.map((l) => l.specification).sort();
    expect(specs).toEqual(['15m', '3m']);
    for (const line of result.lines) expect(line.quantity).toBe('1');
  });

  it('길이가 같은 완제품은 여전히 합쳐진다', () => {
    const d = diagram(
      [node('a', '소스', 'XDM-12')],
      [
        edge('e1', 'a', 'a', 'video', {
          bomRows: [{ productName: 'HDMI 케이블', cableType: 'ready-made', length: '5' }],
        }),
        edge('e2', 'a', 'a', 'video', {
          bomRows: [{ productName: 'HDMI 케이블', cableType: 'ready-made', length: '5' }],
        }),
      ],
    );
    const result = buildCableLines(d, cat());
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.quantity).toBe('2');
  });

  it('벌크 케이블에 길이가 없으면 수량 0이 아니라 경고로 막는다', () => {
    const d = diagram(
      [node('a', '소스', 'XDM-12')],
      [
        edge('e1', 'a', 'a', 'network', {
          bomRows: [{ productName: 'CAT6 UTP', cableType: 'manufactured' }],
        }),
      ],
    );
    const result = buildCableLines(d, cat());
    expect(result.lines[0]!.quantity).toBeUndefined();
    expect(result.warnings.some((w) => w.blocking)).toBe(true);
    expect(result.warnings.some((w) => w.code === 'cable-length-missing')).toBe(true);
  });

  it('벌크 길이가 음수면 수량을 정하지 않는다', () => {
    const d = diagram(
      [node('a', '소스', 'XDM-12')],
      [
        edge('e1', 'a', 'a', 'network', {
          bomRows: [{ productName: 'CAT6 UTP', cableType: 'manufactured', length: '-5' }],
        }),
      ],
    );
    const result = buildCableLines(d, cat());
    expect(result.lines[0]!.quantity).toBeUndefined();
    expect(result.warnings.some((w) => w.blocking)).toBe(true);
  });
});
