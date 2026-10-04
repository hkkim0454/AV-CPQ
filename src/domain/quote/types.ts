/**
 * 견적 문서 도메인 타입 (설계서 §6).
 *
 * 금액은 전부 `DecimalText`(10진 문자열)로 들고 다닌다. number를 쓰지 않는 이유는
 * 설계서 §5.1 — 통화는 Decimal 연산을 쓰고 절사 위치를 명시한다.
 *
 * 이 파일은 원가(매입단가·매입처)를 **정의하지 않는다**. 설계서 §8.1에 따라
 * 원가는 `services/private-cost`의 PrivateCostSession에만 존재한다.
 */

/** 10진수를 문자열로 표현한 값. `"1234567"`, `"0.0486"`, `"-80000"`. */
export type DecimalText = string;

/** 근거 상태 — 자동 확정 가능 여부를 가른다 (설계서 §5.3, §7.5). */
export type EvidenceState = 'verified' | 'review-required' | 'conflicted';

// ---------------------------------------------------------------------------
// 제품 카탈로그
// ---------------------------------------------------------------------------

/**
 * 판매 가능한 제품 변형 하나.
 *
 * 설계서 §6.1: 이름만 같은 케이블도 브랜드·길이·방향성·규격이 다르면 다른 SKU다.
 */
export interface ProductVariant {
  productId: string;
  sku: string;

  brand: string;
  model: string;

  /** 견적서 B열에 들어갈 품명. */
  quoteName: string;
  /** 견적서 C열에 들어갈 규격. 보통 모델명. */
  quoteSpec: string;

  unit: string;
  lengthM?: DecimalText;
  options: Record<string, string>;

  /** 공개 승인되었거나 사용자가 로컬에서 입력한 판매가. 미등록이면 undefined. */
  sellingUnitPrice?: DecimalText;
  currency: 'KRW';

  laborMappingId?: string;
  evidence: EvidenceState;

  /** 이 제품이 기본 포함하는 부자재 (설계서 §7.3-4). */
  includedAccessories?: IncludedAccessory[];
  /** 신호 포트 (설계서 §7.1). */
  ports?: PortSpec[];
}

export interface IncludedAccessory {
  /** 자유 서술 또는 SKU. SKU를 알면 배정 원장에서 차감한다. */
  sku?: string;
  description: string;
  quantity: DecimalText;
  unit: string;
}

export type SignalKind =
  | 'hdmi'
  | 'displayport'
  | 'hdbaset'
  | 'usb'
  | 'analog-audio'
  | 'speaker-passive'
  | 'network'
  | 'control-serial';

export type PortDirection = 'in' | 'out' | 'bidirectional';

export interface PortSpec {
  portId: string;
  direction: PortDirection;
  signal: SignalKind;
  count: number;
  /** 제조사 사양으로 확인한 내용인지. 설계서 §7.5: 추측하지 않는다. */
  evidence: EvidenceState;
  note?: string;
}

// ---------------------------------------------------------------------------
// 견적 문서
// ---------------------------------------------------------------------------

export type LaborMode = 'mapped' | 'manual' | 'not-applicable' | 'unresolved';

export type RowOrigin = 'manual' | 'sample' | 'rule';

/**
 * 견적 표의 한 행.
 *
 * 설계서 §6.1: `rowId`와 `productId/SKU`를 동일하게 만들지 않는다.
 * 같은 HDMI 모델을 강의대와 랙에 각각 쓰면 행 2개, SKU 1개다.
 */
export interface QuoteRow {
  rowId: string;
  systemId: string;

  productId?: string;
  sku?: string;

  /** 견적서 B열. */
  name: string;
  /** 견적서 C열. */
  specification: string;

  unit: string;
  quantity: DecimalText;
  sellingUnitPrice?: DecimalText;

  laborMode: LaborMode;
  laborMappingId?: string;
  manualLaborUnitPrice?: DecimalText;
  /** 설계서 §5.3: 수동 단가에는 사유를 남긴다. */
  overrideReason?: string;

  location?: string;
  /** 견적서 K열. */
  /**
   * 제품 설명 (가이드 D열). **사람 비고와 다른 칸이다.**
   *
   * 2단계(고객용)에서 지운다. 비고는 남는다.
   */
  internalDescription?: string;
  /**
   * 변환 메모 — 구성도에서 자동으로 만든 설명.
   *
   * `remark`(사람 칸)와 섞지 않는다. 섞으면 사람이 쓴 글을 지우거나
   * 기계가 쓴 글을 고객에게 보내게 된다.
   */
  conversionNote?: string;
  remark: string;

  /**
   * 구성도 노드 id들. 이름이 같은 노드는 한 행으로 합쳐지므로 여럿일 수
   * 있다(`devices.ts`의 병합 규칙). 미해결 모델 경고를 이 행과 다시
   * 연결할 때 쓴다 — 품목 직접 선택 경로의 행에는 없다.
   */
  sourceNodeIds?: readonly string[];
  /**
   * 옵션 카드 행에만 있다(`devices.ts`). 옵션은 **노드가 아니라
   * optionId로 합쳐진다** — 한 노드의 본체 행과 옵션 행이 같은
   * `sourceNodeIds`를 가질 수 있으므로, 옵션을 다시 연결할 때는
   * `sourceNodeIds`가 아니라 이 값으로 정확히 그 옵션 행만 찾는다.
   */
  optionId?: string;

  origin: RowOrigin;
  ruleInstanceId?: string;
}

/**
 * 표시 전용 행 — 그룹 머리글과 설명 줄.
 *
 * 원본에서 `[ LED Display ]`(그룹), `Main DISPLAY`(소그룹),
 * ` - Pixel Pitch`(설명)에 해당한다. 금액 수식이 없다.
 */
export type DisplayRowKind = 'group' | 'subgroup' | 'note';

export interface DisplayRow {
  rowId: string;
  systemId: string;
  kind: DisplayRowKind;
  /** B열 텍스트. */
  name: string;
  /** C열 텍스트. 설명 줄에서 쓴다. */
  specification?: string;
  /** F열에 `include` 같은 문구를 넣을 때. 숫자가 아니다. */
  materialNote?: string;
  remark?: string;
}

export type SheetRow =
  | ({ type: 'item' } & QuoteRow)
  | ({ type: 'display' } & DisplayRow);

/**
 * 파생 품목 — 다른 행의 금액에서 단가가 계산되는 행 (설계서 §4.2, mapping.md §3.4).
 *
 * `배관 기타자재` = INT(기준행 재료비금액 × 20%)
 * `잡자재비`      = INT(SUM(범위 재료비금액) × 2%)
 */
export type DerivedBasis =
  | { kind: 'single-row-material'; sourceRowId: string }
  | { kind: 'material-sum-to-here' };

export interface DerivedRow extends Omit<QuoteRow, 'sellingUnitPrice'> {
  derived: DerivedBasis;
  /** 0.2 = 20%. */
  rate: DecimalText;
}

/**
 * 간접비 항목 하나 (설계서 §5.4, mapping.md §3.6).
 *
 * `basis`는 **직접비계 행**을 가리킨다.
 *  - `labor`       → 직접비계의 노무비 금액 (원본 I열)
 *  - `direct`      → 직접비계의 합계      (원본 J열)
 *  - `composite`   → 직접비계 합계 + 지정한 다른 간접비 항목들의 합
 *  - `item`        → **지정한 항목의 금액만.** 직접비를 더하지 않는다
 *
 * `item`이 따로 있는 이유: 일반 프로파일의 노인장기요양보험료가
 * **건강보험료 대비** 12.95%다. `composite`는 항상 직접비계에서 출발하므로
 * 이걸 표현하면 직접비계가 통째로 더해져 조용히 틀린다.
 */
export type IndirectBasis =
  | { kind: 'labor' }
  | { kind: 'direct' }
  | { kind: 'composite'; plusItemIds: string[] }
  | { kind: 'item'; itemId: string };

export interface IndirectCostRule {
  itemId: string;
  /**
   * 적용 조건 문구. 가이드 원본이 간접비 블록 옆에 적어 둔 것
   * (`1개월 이상 공사 限`, `1억원 이상 공사 限`).
   *
   * 금액 계산에는 쓰지 않는다. 사람이 적용 여부를 판단할 근거다 —
   * 지우면 왜 미적용인지 알 수 없게 된다.
   */
  conditionText?: string;
  /** 견적서 B열. */
  name: string;
  /** 견적서 C열 — 기준 설명 문구. */
  basisLabel: string;
  basis: IndirectBasis;
  /** 견적서 E열. `"0.0486"`. */
  rate: DecimalText;
  /**
   * 설계서 §5.4: 모든 공사에 같은 보험·경비 요율을 적용하지 않는다.
   * 원본은 연금·건강·노인장기요양을 요율만 적고 금액은 상수 0으로 뒀다.
   */
  applied: boolean;
  /** 어디서 온 기준인지. 법정 요율 주장이 아니다. */
  source: string;
}

/** 배관 종류 — 후렉시블(기본) 또는 CD관(결정 D22). 케이블 트레이도
 *  배관 분류이지만 기타자재 비율이 아직 미정(O25)이라 선택지에 없다. */
export type ConduitType = 'flexible' | 'cd';

export interface QuoteSystem {
  systemId: string;
  /**
   * 어느 간접비 프로파일로 심었는지 (`ds` / `general`).
   *
   * 같은 프로파일로 다시 계산할 때 규칙을 **다시 심지 않기** 위해 들고 다닌다.
   * 다시 심으면 사용자가 손본 적용 여부·요율이 초기화된다.
   */
  indirectProfileId?: string;
  /** 갑지 C열이자 Excel 시트 이름의 원본. */
  name: string;
  /** 갑지 D열 — 시스템 요약 규격. */
  summarySpec: string;
  /** 갑지 E열. 보통 `식`. */
  unit: string;
  /** 갑지 F열. */
  quantity: DecimalText;
  /** 갑지 I열. */
  remark: string;
  /** 간접비 규칙. 시스템마다 다를 수 있다. */
  indirectCosts: IndirectCostRule[];

  /**
   * 배관 입력 (계획 Task 3, 결정 D8 보강). `indirectProfileId`와 같은
   * 이유로 문서 안에 둔다 — 별도 state로 두면 실행취소가 문서만
   * 되돌리고 이 값은 그대로 남아 수량이 어긋난다(이전에 프로파일에서
   * 실제로 겪은 결함과 같은 모양).
   */
  farthestDeviceMeters?: DecimalText;
  conduitRuns?: DecimalText;
  conduitType?: ConduitType;
  /** 퍼센트 문자열(`'20'`). 계산용 분수가 아니라 화면 입력 그대로다. */
  conduitMaterialRate?: DecimalText;
  /**
   * `conduitMaterialRate`가 사용자가 **직접 지정한 값**인지. 종류를
   * 바꿀 때 비율을 새 기본값으로 따라가게 할지 판단하는 데 쓴다.
   *
   * 값이 기본값과 "우연히 같은지"로 추정하지 않는다 — 사용자가 명시로
   * 20%를 입력했는데 그게 마침 후렉시블 기본값과 같다면, 값만 보고는
   * "아직 안 건드렸다"와 구분할 수 없다. 그래서 출처를 별도 칸에
   * 명시적으로 남긴다.
   */
  conduitMaterialRateManual?: boolean;
}

/** 갑지의 로마자 구역 행 (`Ⅰ  사무3동 6층 CLEAN IEC 룸`). */
export interface CoverGroup {
  groupId: string;
  /** `Ⅰ`, `Ⅱ` … */
  marker: string;
  name: string;
  /** 이 구역에 속한 시스템 순서. */
  systemIds: string[];
}

export interface QuoteHeader {
  /** 갑지 C2. */
  quoteNumber: string;
  /** 갑지 C3. ISO `YYYY-MM-DD`. 출력 시 `YYYY 년  MM 월  DD 일`로 바꾼다. */
  quoteDate: string;
  /** 갑지 C4. */
  customer: string;
  /** 갑지 C5. 시스템 시트 A1이 참조한다. */
  projectName: string;
  /** 갑지 C6. */
  contact: string;
  /** 갑지 C19, C20. */
  conditions: string[];
}

/** 설계서 §3: 재료비+노무비 견적과 노무비 전용 견적. */
export type QuoteMode = 'material-and-labor' | 'labor-only';

export interface RoundingPolicy {
  /**
   * 갑지 합계 절사 자릿수. 원본은 `ROUNDDOWN(…,-4)` = 만원 미만 절사.
   * `-4`를 그대로 쓴다.
   */
  coverTotalDigits: number;
}

export interface DocumentVersions {
  catalog: string;
  labor: string;
  wage: string;
  template: string;
  rule: string;
}

/**
 * 견적 문서 전체. 저장·불러오기 단위.
 *
 * 설계서 §6.3: 매입 원가·매입처·원가표 파일명·내부 원가 결과는 **저장하지 않는다**.
 * 이 타입에 해당 필드가 없는 것이 그 보증이다.
 */
export interface QuoteDocument {
  schemaVersion: 1;
  documentId: string;
  mode: QuoteMode;

  header: QuoteHeader;
  coverGroups: CoverGroup[];
  systems: QuoteSystem[];

  /** 모든 시스템의 행. `systemId`로 묶고 배열 순서가 곧 표시 순서다. */
  rows: SheetRow[];
  derivedRows: DerivedRow[];

  /** 설계서 §5.5: 웹에서는 **양수로** 입력받는다. 출력에서 음수로 바꾼다. */
  negoDeduction: DecimalText;

  rounding: RoundingPolicy;

  /** 설계서 §6.3: 계산에 쓴 판매가·노임의 스냅샷 버전. */
  versions: DocumentVersions;

  /** 장비 인스턴스와 연결 — 부자재 추천의 입력 (설계서 §7). */
  equipment: EquipmentInstance[];
  connections: Connection[];
  /** 현장 기존 케이블 등 이미 확보된 수량 (설계서 §7.3-4). */
  existingSupplies: ExistingSupply[];
}

// ---------------------------------------------------------------------------
// 연결과 부자재
// ---------------------------------------------------------------------------

export interface EquipmentInstance {
  instanceId: string;
  /** 이 장비를 만든 견적 행. 없으면 지급자재·기존 장비. */
  rowId?: string;
  sku?: string;
  label: string;
  location?: string;
  ports: PortSpec[];
}

export interface Connection {
  connectionId: string;
  fromInstanceId: string;
  fromPortId: string;
  toInstanceId: string;
  toPortId: string;
  signal: SignalKind;
  /** 설치 구간 길이(m). 모르면 undefined → `information-required`. */
  distanceM?: DecimalText;
  /** 같은 구간이 몇 벌인지. 기본 1. */
  quantity: DecimalText;
  note?: string;
}

export interface ExistingSupply {
  supplyId: string;
  sku?: string;
  description: string;
  quantity: DecimalText;
  unit: string;
  reason: 'existing-on-site' | 'included-with-product' | 'separate-contract';
}
