/**
 * 필수 부자재 추천 도메인 (설계서 §7).
 *
 * 핵심 원칙 (§7.1): "제품 두 개가 견적에 존재한다는 이유만으로 연결을 단정하지 않는다.
 * 실제 연결 구간과 포트를 기준으로 판단한다."
 *
 * 규칙은 **데이터**다 (§7.2: "검증된 결정 규칙으로 구현한다").
 * 함수로 쓰지 않는 이유는 규칙을 버전과 함께 저장·감사하고, 근거 없는 규칙이
 * `verified` 상태로 끼어들지 못하게 하기 위해서다.
 * 외부 AI에 견적이나 원가를 보내 추천받는 경로는 두지 않는다.
 */
import type { DecimalText, EvidenceState, SignalKind } from '../quote/types';

/** 설계서 §7.2의 5단계 판정. */
export type Verdict =
  /** 기존 배정 또는 포함 부자재로 충족. */
  | 'satisfied'
  /** 검증된 조건과 기본 SKU·수량이 모두 확정되어 자동 추가 가능. */
  | 'auto-addable'
  /** 케이블 종류는 필수지만 브랜드·길이·규격 선택 필요. */
  | 'selection-required'
  /** 포트·거리·설치 방식 등 정보 부족. */
  | 'information-required'
  /** 확인된 조건과 충돌. */
  | 'incompatible';

/** 규칙이 요구하는 정보. 없으면 `information-required`가 된다. */
export type RequiredInput =
  /** 설치 구간 거리. */
  | 'distance'
  /** 저임피던스/정전압 등 스피커 구동 방식 (§7.1). */
  | 'speaker-drive-mode'
  /** 포트 사양이 제조사 자료로 확인됐는지. */
  | 'port-confirmation';

/** 수량 계산 방식 (설계서 §7.4). */
export type QuantityBasis =
  /**
   * 완제품 케이블 — **구간당 1벌**.
   * HDMI 5m 두 구간은 2EA다. 5m × 2 = 10EA가 아니다.
   */
  | { kind: 'per-segment'; unit: string }
  /**
   * 벌크 케이블 — 구간 길이의 합.
   * 여유 길이는 승인된 비율만 붙이고, 권취 단위 올림은 발주 단계에서 따로 본다.
   */
  | { kind: 'by-length'; unit: string; sparePercent: DecimalText };

export interface LengthOption {
  /** 이 SKU가 감당하는 최대 구간 길이(m). */
  maxLengthM: DecimalText;
  sku: string;
  /** 사양 근거. */
  source: string;
}

export interface AccessoryRule {
  ruleId: string;
  /** 규칙 버전 — 판정 결과에 함께 기록한다 (§7.2). */
  version: string;
  /** 어떤 신호 구간에 적용되는지. */
  signal: SignalKind;
  /** 사람이 읽을 필요 사유. 판정 결과에 그대로 실린다. */
  reason: string;
  quantityBasis: QuantityBasis;
  /**
   * 길이별 SKU. 구간 길이에 맞는 항목이 있으면 `auto-addable`,
   * 비어 있으면 `selection-required`가 된다.
   */
  lengthOptions: LengthOption[];
  /** 길이와 무관한 기본 SKU. `lengthOptions`가 비었을 때만 본다. */
  defaultSku?: string;
  requires: RequiredInput[];
  /** 이 거리를 넘으면 `incompatible`. 모르면 undefined. */
  maxDistanceM?: DecimalText;
  /**
   * 규칙 자체의 근거 상태.
   * `verified`가 아니면 아무리 조건이 맞아도 `auto-addable`로 올리지 않는다
   * (§7.5: 미확인 호환성을 확인 완료로 바꾸는 우회 버튼은 만들지 않는다).
   */
  evidence: EvidenceState;
  source: string;
}

/** 한 연결 구간에 대한 판정 결과. 설계서 §7.2가 요구하는 항목을 전부 담는다. */
export interface AccessoryRequirement {
  requirementId: string;
  connectionId: string;
  ruleId: string;
  ruleVersion: string;
  verdict: Verdict;

  /** 연결 구간 — `강의대 PC HDMI OUT → 전면 TV HDMI IN`. */
  segment: string;
  /** 필요한 이유. */
  reason: string;

  /** 요구 수량. */
  requiredQuantity: DecimalText;
  unit: string;
  /** 확정된 SKU. `selection-required`/`information-required`면 undefined. */
  sku?: string;

  evidence: EvidenceState;
  /** 부족한 정보 — `information-required`의 근거. */
  missingInformation: string[];
  /** 충돌 내용 — `incompatible`의 근거. */
  conflicts: string[];
}

/** 이미 확보된 수량 — 현장 기존 자재나 제품 구성품 (설계서 §7.3-4). */
export interface SupplyPool {
  supplyId: string;
  sku: string;
  description: string;
  /** 남은 수량. 배정하면 줄어든다. */
  quantity: DecimalText;
  unit: string;
  reason: 'existing-on-site' | 'included-with-product' | 'separate-contract';
}

export interface AllocationLine {
  requirementId: string;
  sku?: string;
  unit: string;
  requiredQuantity: DecimalText;
  /** 기존 자재·구성품으로 충족한 수량. */
  satisfiedQuantity: DecimalText;
  /** 새로 사야 하는 수량. */
  shortfallQuantity: DecimalText;
  /** 어떤 공급에서 얼마를 가져왔는지 — 중복 배정 검사의 근거. */
  draws: Array<{ supplyId: string; quantity: DecimalText }>;
  verdict: Verdict;
}

export interface AllocationResult {
  lines: AllocationLine[];
  /** 배정 후 남은 공급. */
  remaining: SupplyPool[];
}
