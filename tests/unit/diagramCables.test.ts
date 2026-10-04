import { describe, expect, it } from 'vitest';
import { bulkUnits, buildCableLines, cableCandidates, snapToStep } from '@/import/diagram/cables';
import type { RouteInput } from '@/domain/quote/installation';
import { cat, diagram, edge, node } from '../fixtures/diagram';
import type { DiagramBomRow } from '@/import/diagram/types';
import type { Catalog, CatalogProduct } from '@/data/catalog/load';

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
    const w = warnings.find((x) => x.code === 'cable-item-unresolved' && x.message.includes('33.8'));
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

describe('RouteInput — 실측 거리가 있으면 그걸 쓴다(결정 D8 보강)', () => {
  function familyCatalog(): Catalog {
    const family = (sku: string, meters: string): CatalogProduct => ({
      productId: sku,
      sku,
      brand: '',
      model: sku,
      quoteName: 'HDMI Cable',
      quoteSpec: `Aluminum shell injection molding 2.0v ${meters}M`,
      unit: 'EA',
      options: { group: 'CS_HDMI 케이블' },
      currency: 'KRW',
      evidence: 'review-required',
    });
    return cat(
      [family('HDMI-1', '1'), family('HDMI-3', '3'), family('HDMI-5', '5')],
      { 'HDMI-1': '10000', 'HDMI-3': '15000', 'HDMI-5': '20000' },
    );
  }

  const twoNodeDiagram = (edges: Parameters<typeof diagram>[1]) =>
    diagram([node('n1', 'A', 'SRG-X40UH'), node('n2', 'B', 'XDM-12')], edges);

  it('완제품 — 경로 계산 거리로 다시 계단을 구해 같은 묶음에서 그 길이의 제품을 찾는다', () => {
    const route: RouteInput = {
      edgeId: 'e1',
      systemId: 's1',
      source: 'measured-route',
      horizontalMeters: '2',
      riseMeters: '0',
      dropMeters: '0',
    }; // 2 × 1.3 = 2.6m → 3m 계단
    const d = twoNodeDiagram([
      edge('e1', 'n1', 'n2', 'video', {
        bomRows: [{ cableType: 'ready-made', productName: 'HDMI-1', length: '1', quantity: '1' }],
      }),
    ]);
    const result = buildCableLines(d, familyCatalog(), new Map([['e1', route]]));
    expect(result.lines[0]).toMatchObject({ sku: 'HDMI-3', specification: expect.stringContaining('3M') });
    // BOM.length(제품 규격) 원본 문구는 바뀌지 않는다 — 새로 찾은 제품의
    // 규격을 그대로 쓴 것이지, 기존 글자에 새 길이만 붙인 게 아니다.
    expect(result.lines[0]!.specification).not.toContain('1M');
  });

  it('완제품 — 계단에 맞는 제품을 묶음에서 못 찾으면 확인 필요로 남긴다(기존 SKU에 새 길이만 붙이지 않는다)', () => {
    const route: RouteInput = {
      edgeId: 'e1',
      systemId: 's1',
      source: 'confirmed-total',
      confirmedTotalMeters: '9',
    }; // 9m → 10m 계단, 이 묶음에는 10M 제품이 없다
    const d = twoNodeDiagram([
      edge('e1', 'n1', 'n2', 'video', {
        bomRows: [{ cableType: 'ready-made', productName: 'HDMI-1', length: '1', quantity: '1' }],
      }),
    ]);
    const result = buildCableLines(d, familyCatalog(), new Map([['e1', route]]));
    expect(result.lines[0]!.sku).toBeUndefined();
    expect(result.lines[0]!.specification).toBe('10m');
    expect(result.warnings.some((w) => w.blocking && w.edgeId === 'e1')).toBe(true);
  });

  it('벌크 — 경로 계산 거리(측정값 보정)를 원본 bomRow 길이 대신 합산에 쓴다', () => {
    const route: RouteInput = {
      edgeId: 'e1',
      systemId: 's1',
      source: 'measured-route',
      horizontalMeters: '10',
      riseMeters: '0',
      dropMeters: '0',
    }; // 10 × 1.3 = 13m → ceil(13/10) = 2
    const d = twoNodeDiagram([
      edge('e1', 'n1', 'n2', 'network', {
        bomRows: [{ cableType: 'manufactured', productName: 'UTP Cable (CAT6)', length: '999', quantity: '1' }],
      }),
    ]);
    const result = buildCableLines(d, cat(), new Map([['e1', route]]));
    expect(result.lines[0]!.totalMeters).toBe('13');
    expect(result.lines[0]!.quantity).toBe('2');
  });

  it('벌크 — confirmed-total은 재보정 없이 그대로 합산된다', () => {
    const route: RouteInput = { edgeId: 'e1', systemId: 's1', source: 'confirmed-total', confirmedTotalMeters: '21' };
    const d = twoNodeDiagram([
      edge('e1', 'n1', 'n2', 'network', {
        bomRows: [{ cableType: 'manufactured', productName: 'UTP Cable (CAT6)', length: '1', quantity: '1' }],
      }),
    ]);
    const result = buildCableLines(d, cat(), new Map([['e1', route]]));
    expect(result.lines[0]!.totalMeters).toBe('21');
    expect(result.lines[0]!.quantity).toBe('3'); // ceil(21/10)
  });

  it('경로 입력이 없는 구간은 기존 bomRow 길이를 그대로 쓴다 — 역산하지 않는다', () => {
    const d = twoNodeDiagram([
      edge('e1', 'n1', 'n2', 'network', {
        bomRows: [{ cableType: 'manufactured', productName: 'UTP Cable (CAT6)', length: '12', quantity: '1' }],
      }),
    ]);
    const withoutRoutes = buildCableLines(d, cat());
    const withEmptyRouteMap = buildCableLines(d, cat(), new Map());
    expect(withoutRoutes.lines[0]!.totalMeters).toBe('12');
    expect(withEmptyRouteMap.lines[0]!.totalMeters).toBe('12');
  });

  describe('경로 입력을 시작했지만 미완성/무효 — "아예 없음"과 구분한다(독립 검토 지적)', () => {
    it('완제품 — 수평만 적고 입상·입하를 비우면 기존 BOM 길이로 조용히 산정하지 않는다', () => {
      const incompleteRoute: RouteInput = {
        edgeId: 'e1',
        systemId: 's1',
        source: 'measured-route',
        horizontalMeters: '10',
        // riseMeters/dropMeters 없음 — 입력 미완성
      };
      const d = twoNodeDiagram([
        edge('e1', 'n1', 'n2', 'video', {
          bomRows: [{ cableType: 'ready-made', productName: 'HDMI-1', length: '1', quantity: '1' }],
        }),
      ]);
      const result = buildCableLines(d, familyCatalog(), new Map([['e1', incompleteRoute]]));
      expect(result.lines[0]!.sku).toBeUndefined();
      expect(result.lines[0]!.quantity).toBeUndefined();
      expect(result.lines[0]!.specification).toBe('경로 입력 필요');
      const w = result.warnings.find((x) => x.edgeId === 'e1');
      expect(w).toMatchObject({ code: 'cable-route-incomplete', blocking: true });
      expect(w!.message).toContain('완성되지 않았다');
    });

    it('벌크 — 입력이 미완성이면 길이를 BOM.length로 대신 채우지 않고 수량도 비운다', () => {
      const incompleteRoute: RouteInput = {
        edgeId: 'e1',
        systemId: 's1',
        source: 'measured-route',
        horizontalMeters: '10',
        riseMeters: '2',
        // dropMeters 없음 — 입력 미완성
      };
      const d = twoNodeDiagram([
        edge('e1', 'n1', 'n2', 'network', {
          bomRows: [{ cableType: 'manufactured', productName: 'UTP Cable (CAT6)', length: '999', quantity: '1' }],
        }),
      ]);
      const result = buildCableLines(d, cat(), new Map([['e1', incompleteRoute]]));
      expect(result.lines[0]!.quantity).toBeUndefined();
      expect(result.lines[0]!.totalMeters).toBeUndefined();
      const w = result.warnings.find((x) => x.edgeId === 'e1');
      expect(w).toMatchObject({ code: 'cable-route-incomplete', blocking: true });
    });

    it('완성된 경로와 미완성 경로는 서로 다른 행으로 쌓인다 — 섞어 합산하지 않는다', () => {
      const complete: RouteInput = {
        edgeId: 'e1',
        systemId: 's1',
        source: 'confirmed-total',
        confirmedTotalMeters: '10',
      };
      const incomplete: RouteInput = { edgeId: 'e2', systemId: 's1', source: 'confirmed-total' };
      const d = twoNodeDiagram([
        edge('e1', 'n1', 'n2', 'network', {
          bomRows: [{ cableType: 'manufactured', productName: 'UTP Cable (CAT6)', quantity: '1' }],
        }),
        edge('e2', 'n1', 'n2', 'network', {
          bomRows: [{ cableType: 'manufactured', productName: 'UTP Cable (CAT6)', quantity: '1' }],
        }),
      ]);
      const result = buildCableLines(
        d,
        cat(),
        new Map([
          ['e1', complete],
          ['e2', incomplete],
        ]),
      );
      // e1(완성, 10m → 1묶음)과 e2(미완성, 수량 보류)가 한 행으로
      // 뭉개지지 않는다 — e1의 완성된 합계가 e2의 미완성 때문에
      // 흐려지면 안 된다.
      const resolvedLine = result.lines.find((l) => l.quantity !== undefined);
      const pendingLine = result.lines.find((l) => l.quantity === undefined);
      expect(resolvedLine).toMatchObject({ totalMeters: '10', quantity: '1' });
      expect(pendingLine).toBeDefined();
    });
  });

  describe('완제품 재매칭 — 같은 길이에 후보가 여럿이면 자동으로 고르지 않는다(독립 검토 지적)', () => {
    function duplicateStepCatalog(): Catalog {
      const family = (sku: string, meters: string): CatalogProduct => ({
        productId: sku,
        sku,
        brand: '',
        model: sku,
        quoteName: 'HDMI Cable',
        quoteSpec: `${meters}M`,
        unit: 'EA',
        options: { group: 'CS_HDMI 케이블' },
        currency: 'KRW',
        evidence: 'review-required',
      });
      // 3M 길이에 SKU 두 개(제조사/사양이 다른 별도 제품)가 걸린다.
      return cat(
        [family('HDMI-1', '1'), family('HDMI-3A', '3'), family('HDMI-3B', '3')],
        { 'HDMI-1': '10000', 'HDMI-3A': '15000', 'HDMI-3B': '16000' },
      );
    }

    it('동일 묶음·동일 계단에 후보가 둘이면 자동 선택하지 않고 후보로 차단한다', () => {
      const route: RouteInput = { edgeId: 'e1', systemId: 's1', source: 'confirmed-total', confirmedTotalMeters: '2.6' }; // → 3m 계단
      const d = twoNodeDiagram([
        edge('e1', 'n1', 'n2', 'video', {
          bomRows: [{ cableType: 'ready-made', productName: 'HDMI-1', length: '1', quantity: '1' }],
        }),
      ]);
      const result = buildCableLines(d, duplicateStepCatalog(), new Map([['e1', route]]));
      expect(result.lines[0]!.sku).toBeUndefined();
      const w = result.warnings.find((x) => x.edgeId === 'e1' && x.blocking);
      expect(w).toBeDefined();
      expect(w!.candidates).toEqual(expect.arrayContaining(['HDMI-3A', 'HDMI-3B']));
      expect(w!.message).toContain('후보가 2건');
    });

    it('원래 SKU가 이미 그 계단 길이면(후보 하나뿐) 그대로 유지된다 — 회귀 확인', () => {
      // HDMI-1은 이미 1m다. 경로 산출거리도 1m 계단으로 떨어지면
      // 같은 묶음의 1m 후보가 하나뿐이라 그대로 재확인된다.
      const route: RouteInput = { edgeId: 'e1', systemId: 's1', source: 'confirmed-total', confirmedTotalMeters: '0.8' }; // → 1m 계단
      const d = twoNodeDiagram([
        edge('e1', 'n1', 'n2', 'video', {
          bomRows: [{ cableType: 'ready-made', productName: 'HDMI-1', length: '1', quantity: '1' }],
        }),
      ]);
      const result = buildCableLines(d, duplicateStepCatalog(), new Map([['e1', route]]));
      expect(result.lines[0]!.sku).toBe('HDMI-1');
      expect(result.warnings.some((w) => w.edgeId === 'e1' && w.blocking)).toBe(false);
    });
  });
});

describe('HDMI 케이블 — 제조사별 종류·길이를 직접 고를 후보 목록', () => {
  function hdmiCatalog(): Catalog {
    const product = (sku: string, group: string, meters: string): CatalogProduct => ({
      productId: sku,
      sku,
      brand: '',
      model: sku,
      quoteName: 'HDMI Cable',
      quoteSpec: `${meters}M`,
      unit: 'EA',
      options: { group },
      currency: 'KRW',
      evidence: 'review-required',
    });
    return cat(
      [
        product('HDMI-A-1', 'CS_HDMI 케이블', '1'),
        product('HDMI-A-3', 'CS_HDMI 케이블', '3'),
        product('HDMI-B-10', 'CS_HDMI 케이블_AOC', '10'),
        product('HDMI-B-15', 'CS_HDMI 케이블_AOC', '15'),
        // 배관(10M, 벌크)은 완제품 후보가 아니므로 섞이면 안 된다.
        {
          productId: 'CBL-CONDUIT',
          sku: 'CBL-CONDUIT',
          brand: '',
          model: 'HDMI 몰드',
          quoteName: 'HDMI 전용 몰드',
          quoteSpec: '',
          unit: '10M',
          options: { group: '후렉시블' },
          currency: 'KRW',
          evidence: 'review-required',
        },
        // 선 종류와 무관한 제품은 후보에 들어오면 안 된다.
        {
          productId: 'AUD-1',
          sku: 'AUD-1',
          brand: '',
          model: 'XLR',
          quoteName: 'Audio Cable',
          quoteSpec: '1M',
          unit: 'EA',
          options: { group: '1CH MIC CABLE' },
          currency: 'KRW',
          evidence: 'review-required',
        },
      ],
      {},
    );
  }

  it('cableCandidates — 선 종류 이름과 묶음·품명이 겹치는 완제품만 모은다(제조사별 종류 두 묶음)', () => {
    const skus = cableCandidates(hdmiCatalog(), 'HDMI');
    expect(skus).toEqual(expect.arrayContaining(['HDMI-A-1', 'HDMI-A-3', 'HDMI-B-10', 'HDMI-B-15']));
    expect(skus).not.toContain('CBL-CONDUIT'); // 10M 벌크 제외
    expect(skus).not.toContain('AUD-1'); // 무관한 선 종류 제외
  });

  it('무관한 선 종류는 후보가 비어 있다 — 추측하지 않는다', () => {
    expect(cableCandidates(hdmiCatalog(), 'SDI')).toHaveLength(0);
  });

  it('카탈로그에 이름이 안 걸리는 완제품 구간은 후보와 함께 확인 경고를 낸다', () => {
    const d = withEdges([
      { id: 'e1', lineTypeId: 'video', rows: [{ cableType: 'ready-made', productName: 'HDMI Cable', length: '2' }] },
    ]);
    const { warnings } = buildCableLines(d, hdmiCatalog());
    const w = warnings.find((x) => x.code === 'cable-item-unresolved' && x.edgeId === 'e1');
    expect(w).toBeDefined();
    expect(w!.candidates).toEqual(expect.arrayContaining(['HDMI-A-1', 'HDMI-A-3', 'HDMI-B-10', 'HDMI-B-15']));
  });

  it('구성도에 품목 자체가 없는 구간도 선 종류 기준 후보를 받는다', () => {
    const d = withEdges([{ id: 'e1', lineTypeId: 'video', rows: [] }]);
    const { warnings } = buildCableLines(d, hdmiCatalog());
    const w = warnings.find((x) => x.code === 'cable-item-unresolved');
    expect(w!.candidates).toEqual(expect.arrayContaining(['HDMI-A-1', 'HDMI-A-3', 'HDMI-B-10', 'HDMI-B-15']));
  });
});
