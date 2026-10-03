import { describe, expect, it } from 'vitest';
import { parseDiagram, DiagramParseError } from '@/import/diagram/schema';

/**
 * 계획 2026-10-04 Task 1.
 *
 * 스키마는 **느슨해야 한다.** av-builder가 필드를 추가해도 깨지면 안 되고,
 * 아직 안 내보내는 필드를 요구하면 지금 있는 파일을 아예 못 읽는다
 * (`docs/interface/av-builder.md` §5).
 */

const min = () => ({
  version: '1.1',
  nodes: [{ id: 'n1', type: 'equipment', data: { name: 'PTZ 카메라', model: 'SRG-A40' } }],
  edges: [],
  lineTypes: [{ id: 'video', name: 'HDMI', color: '#ef4444' }],
});

describe('parseDiagram — 기본', () => {
  it('최소 구성을 읽는다', () => {
    const d = parseDiagram(min());
    expect(d.version).toBe('1.1');
    expect(d.nodes[0]!.data.model).toBe('SRG-A40');
  });

  it('edges가 비어 있어도 된다 — 장비만 놓고 선을 안 그은 구성도', () => {
    expect(parseDiagram(min()).edges).toEqual([]);
  });

  it('options가 없어도 된다 — av-builder가 아직 안 내보낸다', () => {
    expect(parseDiagram(min()).options).toBeUndefined();
  });

  it('equipmentDB가 없어도 된다', () => {
    expect(parseDiagram(min()).equipmentDB).toBeUndefined();
  });
});

describe('parseDiagram — 호환성 (docs/interface/av-builder.md §5)', () => {
  it('모르는 필드를 무시하고 통과시킨다', () => {
    const base = min();
    const raw = {
      ...base,
      미래필드: 1,
      nodes: [
        {
          ...base.nodes[0]!,
          새필드: true,
          data: { ...base.nodes[0]!.data, 또다른: 'x' },
        },
      ],
    };
    expect(() => parseDiagram(raw)).not.toThrow();
  });

  it('모르는 필드가 있어도 아는 필드는 그대로 읽는다', () => {
    const base = min();
    const raw = {
      ...base,
      nodes: [{ ...base.nodes[0]!, data: { ...base.nodes[0]!.data, imageUrl: 'data:...', dimmed: false } }],
    };
    expect(parseDiagram(raw).nodes[0]!.data.model).toBe('SRG-A40');
  });

  it('사용자가 추가한 lineType도 읽는다 — id를 하드코딩하지 않는다', () => {
    const raw = {
      ...min(),
      lineTypes: [...min().lineTypes, { id: 'lt-1784014150344', name: 'DP', color: '#ff8585' }],
    };
    expect(parseDiagram(raw).lineTypes.map((l) => l.id)).toContain('lt-1784014150344');
  });

  it('미래에 options가 오면 읽는다', () => {
    const raw = {
      ...min(),
      options: [{ id: 'eqopt-xlsx-454', model: 'XDM-HDMI-OUT4', name: 'HDMI 4채널 output card' }],
    };
    expect(parseDiagram(raw).options?.[0]).toMatchObject({
      id: 'eqopt-xlsx-454',
      model: 'XDM-HDMI-OUT4',
    });
  });
});

describe('parseDiagram — 뼈대가 없으면 던진다', () => {
  it('version이 없으면 던진다', () => {
    const raw = { ...min() } as Record<string, unknown>;
    delete raw['version'];
    expect(() => parseDiagram(raw)).toThrow(/version/);
  });

  it('nodes가 없으면 던진다', () => {
    const raw = { ...min() } as Record<string, unknown>;
    delete raw['nodes'];
    expect(() => parseDiagram(raw)).toThrow(DiagramParseError);
  });

  it('lineTypes가 없으면 던진다', () => {
    const raw = { ...min() } as Record<string, unknown>;
    delete raw['lineTypes'];
    expect(() => parseDiagram(raw)).toThrow(DiagramParseError);
  });

  it('JSON 객체가 아니면 던진다', () => {
    expect(() => parseDiagram('문자열')).toThrow(DiagramParseError);
    expect(() => parseDiagram(null)).toThrow(DiagramParseError);
    expect(() => parseDiagram([])).toThrow(DiagramParseError);
  });

  it('오류에 어느 자리가 틀렸는지 적는다', () => {
    const raw = { ...min(), nodes: [{ data: { model: 'X' } }] };
    try {
      parseDiagram(raw);
      expect.unreachable('던져야 한다');
    } catch (error) {
      expect(error).toBeInstanceOf(DiagramParseError);
      expect((error as DiagramParseError).issues.join(' ')).toContain('nodes.0.id');
    }
  });
});

describe('parseDiagram — 보존해야 하는 값', () => {
  it('selectedOptionQuantities를 보존한다', () => {
    const raw = {
      ...min(),
      nodes: [
        { id: 'n1', data: { name: 'M', model: 'XDM-12', selectedOptionQuantities: { 'eqopt-454': 4 } } },
      ],
    };
    expect(parseDiagram(raw).nodes[0]!.data.selectedOptionQuantities).toEqual({
      'eqopt-454': 4,
    });
  });

  it('음수 옵션 수량은 던진다 — 장착 개수다', () => {
    const raw = {
      ...min(),
      nodes: [{ id: 'n1', data: { selectedOptionQuantities: { 'eqopt-454': -1 } } }],
    };
    expect(() => parseDiagram(raw)).toThrow(DiagramParseError);
  });

  it('bomRows를 보존한다', () => {
    const raw = {
      ...min(),
      edges: [
        {
          id: 'e1',
          source: 'n1',
          target: 'n1',
          data: {
            lineTypeId: 'video',
            bomRows: [
              { cableType: 'ready-made', productName: 'HDMI 3m', length: '3', quantity: '2' },
            ],
          },
        },
      ],
    };
    expect(parseDiagram(raw).edges[0]!.data?.bomRows?.[0]!.quantity).toBe('2');
  });

  it('길이·수량이 숫자로 와도 문자열로 바꾼다 — DecimalText 규약', () => {
    const raw = {
      ...min(),
      edges: [
        {
          id: 'e1',
          source: 'n1',
          target: 'n1',
          data: { bomRows: [{ length: 3.5, quantity: 2 }] },
        },
      ],
    };
    const row = parseDiagram(raw).edges[0]!.data?.bomRows?.[0]!;
    expect(row.length).toBe('3.5');
    expect(row.quantity).toBe('2');
  });

  it('포트와 옵션 포트 id를 보존한다 — 엣지가 이 id로 연결된다', () => {
    const raw = {
      ...min(),
      nodes: [
        {
          id: 'n1',
          data: {
            model: 'XDM-12',
            inputs: [{ id: 'in-1', type: 'video', direction: 'in', label: 'In 1' }],
            optionPortIds: ['opt-eqopt-xlsx-456-0-xlsxopt-456-in-1'],
          },
        },
      ],
    };
    const data = parseDiagram(raw).nodes[0]!.data;
    expect(data.inputs?.[0]!.id).toBe('in-1');
    expect(data.optionPortIds).toEqual(['opt-eqopt-xlsx-456-0-xlsxopt-456-in-1']);
  });
});
