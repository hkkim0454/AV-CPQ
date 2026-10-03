import { describe, it, expect } from 'vitest';
import { evaluateConnections } from '@/domain/accessories/evaluate';
import { allocateAccessories } from '@/domain/accessories/allocate';
import type { AccessoryRule, SupplyPool } from '@/domain/accessories/types';
import type { Connection, EquipmentInstance } from '@/domain/quote/types';

/**
 * 설계서 §7. 아래 규칙과 모델명은 **합성 값**이다.
 * §7.5: "제조사 사양은 추측하지 않는다." 실제 모델 규칙은 근거가 있을 때만 등록한다.
 */

const hdmiRule: AccessoryRule = {
  ruleId: 'R-HDMI',
  version: '1',
  signal: 'hdmi',
  reason: 'HDMI 출력과 입력을 잇는 케이블이 필요하다.',
  quantityBasis: { kind: 'per-segment', unit: 'EA' },
  lengthOptions: [
    { maxLengthM: '2', sku: 'SYNTH-HDMI-002', source: '합성' },
    { maxLengthM: '5', sku: 'SYNTH-HDMI-005', source: '합성' },
    { maxLengthM: '10', sku: 'SYNTH-HDMI-010', source: '합성' },
  ],
  requires: ['distance'],
  maxDistanceM: '10',
  evidence: 'verified',
  source: '합성 테스트 규칙',
};

const hdbasetRule: AccessoryRule = {
  ruleId: 'R-HDBT',
  version: '1',
  signal: 'hdbaset',
  reason: 'HDBaseT 송수신 구간에 Category 케이블이 필요하다.',
  quantityBasis: { kind: 'by-length', unit: 'M', sparePercent: '0' },
  lengthOptions: [],
  defaultSku: 'SYNTH-CAT6A',
  requires: ['distance'],
  maxDistanceM: '100',
  evidence: 'verified',
  source: '합성 테스트 규칙',
};

const speakerRule: AccessoryRule = {
  ruleId: 'R-SPK',
  version: '1',
  signal: 'speaker-passive',
  reason: '앰프와 패시브 스피커를 잇는 스피커 케이블이 필요하다.',
  quantityBasis: { kind: 'by-length', unit: 'M', sparePercent: '0.1' },
  lengthOptions: [],
  defaultSku: 'SYNTH-SPC-2C',
  requires: ['distance', 'speaker-drive-mode'],
  evidence: 'verified',
  source: '합성 테스트 규칙',
};

/** 근거가 확인되지 않은 규칙 — 자동 추가로 올리면 안 된다. */
const unverifiedRule: AccessoryRule = {
  ...hdmiRule,
  ruleId: 'R-HDMI-UNVERIFIED',
  evidence: 'review-required',
};

function device(instanceId: string, label: string, ports: EquipmentInstance['ports']): EquipmentInstance {
  return { instanceId, label, ports };
}

function port(
  portId: string,
  direction: 'in' | 'out',
  signal: Connection['signal'],
  evidence: 'verified' | 'review-required' = 'verified',
): EquipmentInstance['ports'][number] {
  return { portId, direction, signal, count: 1, evidence };
}

function link(
  connectionId: string,
  from: [string, string],
  to: [string, string],
  signal: Connection['signal'],
  distanceM?: string,
  quantity = '1',
): Connection {
  return {
    connectionId,
    fromInstanceId: from[0],
    fromPortId: from[1],
    toInstanceId: to[0],
    toPortId: to[1],
    signal,
    ...(distanceM !== undefined ? { distanceM } : {}),
    quantity,
  };
}

describe('evaluateConnections — PC → TV (설계서 §7.1)', () => {
  const pc = device('pc', '강의대 PC', [port('hdmi-out', 'out', 'hdmi')]);
  const tv = device('tv', '전면 TV', [port('hdmi-in', 'in', 'hdmi')]);

  it('거리를 알면 길이에 맞는 SKU로 자동 추가 가능하다', () => {
    const [req] = evaluateConnections(
      { equipment: [pc, tv], connections: [link('c1', ['pc', 'hdmi-out'], ['tv', 'hdmi-in'], 'hdmi', '4.2')] },
      [hdmiRule],
    );
    expect(req!.verdict).toBe('auto-addable');
    expect(req!.sku).toBe('SYNTH-HDMI-005');
    expect(req!.requiredQuantity).toBe('1');
    expect(req!.unit).toBe('EA');
    expect(req!.ruleVersion).toBe('1');
  });

  it('거리를 모르면 정보 요청으로 남긴다 — 추측하지 않는다', () => {
    const [req] = evaluateConnections(
      { equipment: [pc, tv], connections: [link('c1', ['pc', 'hdmi-out'], ['tv', 'hdmi-in'], 'hdmi')] },
      [hdmiRule],
    );
    expect(req!.verdict).toBe('information-required');
    expect(req!.missingInformation).toContain('설치 구간 거리');
    expect(req!.sku).toBeUndefined();
  });

  it('규칙의 최대 거리를 넘으면 충돌로 표시한다', () => {
    const [req] = evaluateConnections(
      { equipment: [pc, tv], connections: [link('c1', ['pc', 'hdmi-out'], ['tv', 'hdmi-in'], 'hdmi', '25')] },
      [hdmiRule],
    );
    expect(req!.verdict).toBe('incompatible');
    expect(req!.conflicts.join(' ')).toContain('25');
  });

  it('근거가 확인되지 않은 규칙은 자동 추가로 올리지 않는다 (§7.5)', () => {
    const [req] = evaluateConnections(
      { equipment: [pc, tv], connections: [link('c1', ['pc', 'hdmi-out'], ['tv', 'hdmi-in'], 'hdmi', '4.2')] },
      [unverifiedRule],
    );
    expect(req!.verdict).toBe('selection-required');
    expect(req!.evidence).toBe('review-required');
  });

  it('포트 사양이 미확인이면 확인을 요청한다', () => {
    const unsureTv = device('tv', '전면 TV', [port('hdmi-in', 'in', 'hdmi', 'review-required')]);
    const [req] = evaluateConnections(
      { equipment: [pc, unsureTv], connections: [link('c1', ['pc', 'hdmi-out'], ['tv', 'hdmi-in'], 'hdmi', '4.2')] },
      [hdmiRule],
    );
    expect(req!.verdict).toBe('information-required');
    expect(req!.missingInformation.join(' ')).toContain('포트');
  });

  it('존재하지 않는 포트를 가리키면 충돌이다', () => {
    const [req] = evaluateConnections(
      { equipment: [pc, tv], connections: [link('c1', ['pc', 'nope'], ['tv', 'hdmi-in'], 'hdmi', '3')] },
      [hdmiRule],
    );
    expect(req!.verdict).toBe('incompatible');
    expect(req!.conflicts.join(' ')).toContain('nope');
  });

  it('방향이 맞지 않으면 충돌이다 — 출력끼리 이을 수 없다', () => {
    const tv2 = device('tv', '전면 TV', [port('hdmi-in', 'out', 'hdmi')]);
    const [req] = evaluateConnections(
      { equipment: [pc, tv2], connections: [link('c1', ['pc', 'hdmi-out'], ['tv', 'hdmi-in'], 'hdmi', '3')] },
      [hdmiRule],
    );
    expect(req!.verdict).toBe('incompatible');
  });
});

describe('evaluateConnections — PC → TX → RX → TV (설계서 §7.1)', () => {
  it('각 구간을 별도 연결로 계산한다', () => {
    const equipment = [
      device('pc', 'PC', [port('o', 'out', 'hdmi')]),
      device('tx', 'HDBT TX', [port('i', 'in', 'hdmi'), port('o', 'out', 'hdbaset')]),
      device('rx', 'HDBT RX', [port('i', 'in', 'hdbaset'), port('o', 'out', 'hdmi')]),
      device('tv', 'TV', [port('i', 'in', 'hdmi')]),
    ];
    const connections = [
      link('c1', ['pc', 'o'], ['tx', 'i'], 'hdmi', '1.5'),
      link('c2', ['tx', 'o'], ['rx', 'i'], 'hdbaset', '42'),
      link('c3', ['rx', 'o'], ['tv', 'i'], 'hdmi', '1.5'),
    ];
    const reqs = evaluateConnections({ equipment, connections }, [hdmiRule, hdbasetRule]);

    expect(reqs).toHaveLength(3);
    expect(reqs[0]!.sku).toBe('SYNTH-HDMI-002');
    expect(reqs[1]!.sku).toBe('SYNTH-CAT6A');
    expect(reqs[1]!.requiredQuantity).toBe('42');
    expect(reqs[1]!.unit).toBe('M');
    expect(reqs[2]!.sku).toBe('SYNTH-HDMI-002');
  });

  it('HDBaseT 거리 한계를 넘으면 충돌로 표시한다', () => {
    const equipment = [
      device('tx', 'TX', [port('o', 'out', 'hdbaset')]),
      device('rx', 'RX', [port('i', 'in', 'hdbaset')]),
    ];
    const [req] = evaluateConnections(
      { equipment, connections: [link('c1', ['tx', 'o'], ['rx', 'i'], 'hdbaset', '140')] },
      [hdbasetRule],
    );
    expect(req!.verdict).toBe('incompatible');
  });

  it('내장 수신 디스플레이로 가는 구간도 전송 케이블만 요구한다 — RX를 또 넣지 않는다', () => {
    const equipment = [
      device('tx', 'TX', [port('o', 'out', 'hdbaset')]),
      device('display', '내장 수신 디스플레이', [port('i', 'in', 'hdbaset')]),
    ];
    const reqs = evaluateConnections(
      { equipment, connections: [link('c1', ['tx', 'o'], ['display', 'i'], 'hdbaset', '30')] },
      [hdmiRule, hdbasetRule],
    );
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.sku).toBe('SYNTH-CAT6A');
  });
});

describe('evaluateConnections — 앰프 → 패시브 스피커 (설계서 §7.1)', () => {
  const amp = device('amp', '앰프', [port('o', 'out', 'speaker-passive')]);
  const spk = device('spk', '패시브 스피커', [port('i', 'in', 'speaker-passive')]);

  it('구동 방식을 모르면 정보 요청으로 남긴다', () => {
    const [req] = evaluateConnections(
      { equipment: [amp, spk], connections: [link('c1', ['amp', 'o'], ['spk', 'i'], 'speaker-passive', '12')] },
      [speakerRule],
    );
    expect(req!.verdict).toBe('information-required');
    expect(req!.missingInformation.join(' ')).toContain('구동 방식');
  });

  it('구동 방식을 알면 길이 + 승인된 여유로 수량을 낸다', () => {
    const connection = {
      ...link('c1', ['amp', 'o'], ['spk', 'i'], 'speaker-passive', '12'),
      note: 'drive-mode: low-impedance',
    };
    const [req] = evaluateConnections(
      { equipment: [amp, spk], connections: [connection] },
      [speakerRule],
      { knownInputs: { c1: ['speaker-drive-mode'] } },
    );
    expect(req!.verdict).toBe('auto-addable');
    // 12m + 10% 여유 = 13.2m
    expect(req!.requiredQuantity).toBe('13.2');
  });
});

describe('evaluateConnections — 수량 (설계서 §7.4)', () => {
  const pc = device('pc', 'PC', [port('o', 'out', 'hdmi')]);
  const tv = device('tv', 'TV', [port('i', 'in', 'hdmi')]);

  it('완제품 HDMI 5m 두 구간은 2EA다 — 5m × 2 = 10EA가 아니다', () => {
    const connections = [
      link('c1', ['pc', 'o'], ['tv', 'i'], 'hdmi', '5'),
      link('c2', ['pc', 'o'], ['tv', 'i'], 'hdmi', '5'),
    ];
    const reqs = evaluateConnections({ equipment: [pc, tv], connections }, [hdmiRule]);
    const total = reqs.reduce((sum, r) => sum + Number(r.requiredQuantity), 0);
    expect(total).toBe(2);
    expect(reqs.every((r) => r.unit === 'EA')).toBe(true);
  });

  it('같은 구간이 여러 벌이면 그만큼 요구한다', () => {
    const reqs = evaluateConnections(
      { equipment: [pc, tv], connections: [link('c1', ['pc', 'o'], ['tv', 'i'], 'hdmi', '5', '4')] },
      [hdmiRule],
    );
    expect(reqs[0]!.requiredQuantity).toBe('4');
  });

  it('벌크 케이블은 구간 길이를 합산한다 — 10m + 15m = 25m', () => {
    const equipment = [
      device('tx', 'TX', [port('o', 'out', 'hdbaset')]),
      device('rx', 'RX', [port('i', 'in', 'hdbaset')]),
    ];
    const reqs = evaluateConnections(
      {
        equipment,
        connections: [
          link('c1', ['tx', 'o'], ['rx', 'i'], 'hdbaset', '10'),
          link('c2', ['tx', 'o'], ['rx', 'i'], 'hdbaset', '15'),
        ],
      },
      [hdbasetRule],
    );
    const total = reqs.reduce((sum, r) => sum + Number(r.requiredQuantity), 0);
    expect(total).toBe(25);
  });
});

describe('evaluateConnections — 결정성 (설계서 §7.3-7)', () => {
  it('같은 동작을 반복해도 결과가 같다 — 수량이 늘지 않는다', () => {
    const equipment = [
      device('pc', 'PC', [port('o', 'out', 'hdmi')]),
      device('tv', 'TV', [port('i', 'in', 'hdmi')]),
    ];
    const input = { equipment, connections: [link('c1', ['pc', 'o'], ['tv', 'i'], 'hdmi', '3')] };
    const a = evaluateConnections(input, [hdmiRule]);
    const b = evaluateConnections(input, [hdmiRule]);
    const c = evaluateConnections(input, [hdmiRule]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(b)).toBe(JSON.stringify(c));
  });

  it('규칙이 없는 신호는 조용히 넘기지 않고 정보 요청으로 남긴다', () => {
    const equipment = [
      device('a', 'A', [port('o', 'out', 'control-serial')]),
      device('b', 'B', [port('i', 'in', 'control-serial')]),
    ];
    const [req] = evaluateConnections(
      { equipment, connections: [link('c1', ['a', 'o'], ['b', 'i'], 'control-serial', '3')] },
      [hdmiRule],
    );
    expect(req!.verdict).toBe('information-required');
    expect(req!.missingInformation.join(' ')).toContain('규칙');
  });
});

describe('allocateAccessories — 배정 원장 (설계서 §7.3)', () => {
  const equipment = [
    device('pc', 'PC', [port('o', 'out', 'hdmi')]),
    device('tv', 'TV', [port('i', 'in', 'hdmi')]),
  ];

  function requirements(count: number) {
    return evaluateConnections(
      {
        equipment,
        connections: Array.from({ length: count }, (_, i) =>
          link(`c${i + 1}`, ['pc', 'o'], ['tv', 'i'], 'hdmi', '5'),
        ),
      },
      [hdmiRule],
    );
  }

  const supply = (quantity: string): SupplyPool => ({
    supplyId: 's1',
    sku: 'SYNTH-HDMI-005',
    description: '현장 기존 HDMI 5m',
    quantity,
    unit: 'EA',
    reason: 'existing-on-site',
  });

  it('기존 자재로 충족하면 부족분이 0이고 satisfied가 된다', () => {
    const result = allocateAccessories(requirements(2), [supply('2')]);
    expect(result.lines.every((l) => l.shortfallQuantity === '0')).toBe(true);
    expect(result.lines.every((l) => l.verdict === 'satisfied')).toBe(true);
    expect(result.remaining[0]!.quantity).toBe('0');
  });

  it('부족분만 남긴다', () => {
    const result = allocateAccessories(requirements(5), [supply('2')]);
    const shortfall = result.lines.reduce((s, l) => s + Number(l.shortfallQuantity), 0);
    expect(shortfall).toBe(3);
  });

  it('같은 재고를 여러 구간에 중복 배정하지 않는다', () => {
    const result = allocateAccessories(requirements(5), [supply('2')]);
    const drawn = result.lines.flatMap((l) => l.draws).reduce((s, d) => s + Number(d.quantity), 0);
    expect(drawn).toBe(2);
  });

  it('SKU가 다른 재고는 배정하지 않는다', () => {
    const other: SupplyPool = { ...supply('10'), sku: 'SYNTH-HDMI-010' };
    const result = allocateAccessories(requirements(2), [other]);
    expect(result.lines.every((l) => l.satisfiedQuantity === '0')).toBe(true);
    expect(result.remaining[0]!.quantity).toBe('10');
  });

  it('반복 실행해도 결과가 같다 — 배정이 누적되지 않는다', () => {
    const reqs = requirements(3);
    const supplies = [supply('2')];
    const a = allocateAccessories(reqs, supplies);
    const b = allocateAccessories(reqs, supplies);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // 입력 배열을 변형하지 않는다
    expect(supplies[0]!.quantity).toBe('2');
  });

  it('SKU가 확정되지 않은 요구에는 배정하지 않는다', () => {
    const reqs = evaluateConnections(
      {
        equipment,
        connections: [link('c1', ['pc', 'o'], ['tv', 'i'], 'hdmi')], // 거리 미상
      },
      [hdmiRule],
    );
    const result = allocateAccessories(reqs, [supply('5')]);
    expect(result.lines[0]!.satisfiedQuantity).toBe('0');
    expect(result.lines[0]!.verdict).toBe('information-required');
    expect(result.remaining[0]!.quantity).toBe('5');
  });

  it('벌크 길이도 부분 충족을 계산한다', () => {
    const bulkReqs = evaluateConnections(
      {
        equipment: [
          device('tx', 'TX', [port('o', 'out', 'hdbaset')]),
          device('rx', 'RX', [port('i', 'in', 'hdbaset')]),
        ],
        connections: [link('c1', ['tx', 'o'], ['rx', 'i'], 'hdbaset', '40')],
      },
      [hdbasetRule],
    );
    const result = allocateAccessories(bulkReqs, [
      { supplyId: 'b1', sku: 'SYNTH-CAT6A', description: '잔여 케이블', quantity: '12.5', unit: 'M', reason: 'existing-on-site' },
    ]);
    expect(result.lines[0]!.satisfiedQuantity).toBe('12.5');
    expect(result.lines[0]!.shortfallQuantity).toBe('27.5');
    expect(result.lines[0]!.verdict).toBe('auto-addable');
  });
});
