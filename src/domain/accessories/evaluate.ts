/**
 * 연결 구간 평가 — 어떤 부자재가 얼마나 필요한지 판정한다 (설계서 §7.1, §7.2).
 *
 * 설계서 §7.3의 순서를 그대로 따른다.
 *   1. 장비 인스턴스와 연결 구간을 정규화한다
 *   2. 적용 가능한 규칙을 선택한다
 *   3. 확인되지 않은 조건을 분리한다
 *
 * 배정(4~6단계)은 `allocate.ts`가 맡는다. 판정과 배정을 나눈 이유는, 판정이
 * 기존 자재 재고와 무관하게 결정적이어야 하기 때문이다 (§7.3-7: 같은 동작을
 * 반복해도 수량이 계속 늘지 않아야 한다).
 */
import type { Connection, EquipmentInstance, PortSpec } from '../quote/types';
import { dec, mul, text, Decimal } from '../calculation/rounding';
import type {
  AccessoryRequirement,
  AccessoryRule,
  RequiredInput,
  Verdict,
} from './types';

export interface ConnectionGraph {
  equipment: readonly EquipmentInstance[];
  connections: readonly Connection[];
}

export interface EvaluateOptions {
  /**
   * 연결별로 사용자가 이미 확인해 준 입력.
   * 예: `{ c1: ['speaker-drive-mode'] }`
   *
   * 거리는 `Connection.distanceM`에서 직접 읽으므로 여기에 넣지 않아도 된다.
   */
  knownInputs?: Record<string, readonly RequiredInput[]>;
}

const INPUT_LABEL: Record<RequiredInput, string> = {
  distance: '설치 구간 거리',
  'speaker-drive-mode': '스피커 구동 방식 (저임피던스/정전압)',
  'port-confirmation': '포트 사양 확인',
};

function findPort(
  equipment: readonly EquipmentInstance[],
  instanceId: string,
  portId: string,
): { device: EquipmentInstance; port: PortSpec } | undefined {
  const device = equipment.find((e) => e.instanceId === instanceId);
  if (device === undefined) return undefined;
  const port = device.ports.find((p) => p.portId === portId);
  if (port === undefined) return undefined;
  return { device, port };
}

function describeSegment(
  from: { device: EquipmentInstance; port: PortSpec } | undefined,
  to: { device: EquipmentInstance; port: PortSpec } | undefined,
  connection: Connection,
): string {
  const left = from === undefined
    ? `${connection.fromInstanceId}:${connection.fromPortId}`
    : `${from.device.label} ${from.port.portId}`;
  const right = to === undefined
    ? `${connection.toInstanceId}:${connection.toPortId}`
    : `${to.device.label} ${to.port.portId}`;
  return `${left} → ${right}`;
}

/** 구간 길이에 맞는 가장 짧은 SKU. 없으면 undefined. */
function pickLengthOption(rule: AccessoryRule, distance: Decimal) {
  const sorted = [...rule.lengthOptions].sort((a, b) =>
    dec(a.maxLengthM).comparedTo(dec(b.maxLengthM)),
  );
  return sorted.find((option) => dec(option.maxLengthM).greaterThanOrEqualTo(distance));
}

export function evaluateConnections(
  graph: ConnectionGraph,
  rules: readonly AccessoryRule[],
  options: EvaluateOptions = {},
): AccessoryRequirement[] {
  const known = options.knownInputs ?? {};

  return graph.connections.map((connection) => {
    const from = findPort(graph.equipment, connection.fromInstanceId, connection.fromPortId);
    const to = findPort(graph.equipment, connection.toInstanceId, connection.toPortId);
    const segment = describeSegment(from, to, connection);

    const conflicts: string[] = [];
    const missing: string[] = [];

    // --- 포트 존재와 방향 (설계서 §7.1: 실제 연결 구간과 포트를 기준으로 판단) ---
    if (from === undefined) {
      conflicts.push(
        `출발 포트를 찾을 수 없다: ${connection.fromInstanceId}:${connection.fromPortId}`,
      );
    } else if (from.port.direction === 'in') {
      conflicts.push(`출발 포트 ${from.port.portId}가 입력이다. 출력에서 출발해야 한다.`);
    }
    if (to === undefined) {
      conflicts.push(
        `도착 포트를 찾을 수 없다: ${connection.toInstanceId}:${connection.toPortId}`,
      );
    } else if (to.port.direction === 'out') {
      conflicts.push(`도착 포트 ${to.port.portId}가 출력이다. 입력으로 도착해야 한다.`);
    }
    for (const side of [from, to]) {
      if (side !== undefined && side.port.signal !== connection.signal) {
        conflicts.push(
          `포트 ${side.port.portId}의 신호(${side.port.signal})가 연결 신호(${connection.signal})와 다르다.`,
        );
      }
    }

    const rule = rules.find((r) => r.signal === connection.signal);

    const base = {
      requirementId: `req-${connection.connectionId}`,
      connectionId: connection.connectionId,
      segment,
      unit: rule?.quantityBasis.unit ?? 'EA',
    };

    if (rule === undefined) {
      // 설계서 §7.5: 정보 없음·미지원·해당 없음을 구분한다. 조용히 넘기지 않는다.
      return {
        ...base,
        ruleId: '',
        ruleVersion: '',
        verdict: 'information-required' as Verdict,
        reason: `${connection.signal} 구간에 적용할 규칙이 없다.`,
        requiredQuantity: '0',
        evidence: 'review-required' as const,
        missingInformation: [`${connection.signal} 신호에 대한 검증된 규칙`],
        conflicts,
      };
    }

    // --- 필요한 입력이 갖춰졌는지 ---
    const knownForConnection = new Set(known[connection.connectionId] ?? []);
    const distanceText = connection.distanceM;
    for (const input of rule.requires) {
      if (input === 'distance') {
        if (distanceText === undefined) missing.push(INPUT_LABEL.distance);
        continue;
      }
      if (!knownForConnection.has(input)) missing.push(INPUT_LABEL[input]);
    }

    // 설계서 §7.5: 제조사 사양은 추측하지 않는다.
    for (const side of [from, to]) {
      if (side !== undefined && side.port.evidence !== 'verified') {
        missing.push(`${INPUT_LABEL['port-confirmation']}: ${side.device.label} ${side.port.portId}`);
      }
    }

    // --- 거리 한계 ---
    const distance = distanceText === undefined ? undefined : dec(distanceText);
    if (distance !== undefined && rule.maxDistanceM !== undefined) {
      const limit = dec(rule.maxDistanceM);
      if (distance.greaterThan(limit)) {
        conflicts.push(
          `구간 거리 ${distanceText}m가 규칙 ${rule.ruleId}의 한계 ${rule.maxDistanceM}m를 넘는다.`,
        );
      }
    }

    // --- 수량 ---
    const connectionQuantity = dec(connection.quantity);
    let requiredQuantity = new Decimal(0);
    if (rule.quantityBasis.kind === 'per-segment') {
      // 설계서 §7.4: 완제품 케이블은 구간당 1벌. 길이를 곱하지 않는다.
      requiredQuantity = connectionQuantity;
    } else if (distance !== undefined) {
      const spare = dec(rule.quantityBasis.sparePercent);
      requiredQuantity = mul(distance.times(connectionQuantity), spare.plus(1));
    }

    // --- SKU 결정 ---
    let sku: string | undefined;
    if (conflicts.length === 0 && missing.length === 0) {
      if (rule.lengthOptions.length > 0) {
        if (distance !== undefined) {
          const option = pickLengthOption(rule, distance);
          if (option === undefined) {
            conflicts.push(
              `구간 거리 ${distanceText}m를 감당하는 길이 선택지가 규칙 ${rule.ruleId}에 없다.`,
            );
          } else {
            sku = option.sku;
          }
        }
      } else {
        sku = rule.defaultSku;
      }
    }

    // --- 판정 ---
    let verdict: Verdict;
    if (conflicts.length > 0) {
      verdict = 'incompatible';
    } else if (missing.length > 0) {
      verdict = 'information-required';
    } else if (sku === undefined) {
      verdict = 'selection-required';
    } else if (rule.evidence !== 'verified') {
      // 설계서 §7.5: 미확인 호환성을 확인 완료로 바꾸지 않는다.
      verdict = 'selection-required';
    } else {
      verdict = 'auto-addable';
    }

    return {
      ...base,
      ruleId: rule.ruleId,
      ruleVersion: rule.version,
      verdict,
      reason: rule.reason,
      requiredQuantity: text(requiredQuantity),
      ...(verdict === 'auto-addable' && sku !== undefined ? { sku } : {}),
      evidence: rule.evidence,
      missingInformation: missing,
      conflicts,
    };
  });
}
