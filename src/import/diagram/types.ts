/**
 * av-builder 구성도 JSON의 파싱 결과 타입 (계획 2026-10-04 Task 1).
 *
 * 규격은 `docs/interface/av-builder.md`다. 두 팀의 계약서이므로
 * 여기서 임의로 필드를 요구하거나 의미를 바꾸지 않는다.
 *
 * **느슨하게 받는다.** av-builder가 필드를 추가해도 깨지면 안 된다.
 * 모르는 필드는 무시하고 통과시킨다.
 */

export interface DiagramPort {
  [key: string]: unknown;
  id: string;
  label?: string | undefined;
  /** `video` · `audio` · `network` 등. `lineTypes`의 id와 같은 체계다. */
  type?: string | undefined;
  direction?: string | undefined;
}

export interface DiagramNodeData {
  /**
   * av-builder가 추가한 모르는 필드를 **그대로 들고 간다** (§5 호환 규칙).
   * 실물 샘플에도 `series`·`dimmed`·`imageUrl`·`isReused`가 있었다.
   * 버리지 않는 이유는, 나중에 그 필드가 필요해졌을 때 다시 파싱하지 않기 위해서다.
   */
  [key: string]: unknown;

  /** av-builder의 장비 id (`eq-xlsx-393`). **카탈로그 SKU가 아니다.** */
  id?: string | undefined;
  name?: string | undefined;
  /** 카탈로그 조회의 기준. 82%가 맞는다 (실측). */
  model?: string | undefined;
  manufacturer?: string | undefined;
  category?: string | undefined;
  description?: string | undefined;

  inputs?: DiagramPort[] | undefined;
  outputs?: DiagramPort[] | undefined;
  bidirectional?: DiagramPort[] | undefined;

  /**
   * 옵션 id → 장착 수량.
   *
   * **수량만 있고 그 옵션이 무슨 제품인지는 없다.** av-builder가 `options` 정의를
   * 아직 내보내지 않는다 (`docs/interface/av-builder.md` §2, 열린 항목 O15).
   * 실측: `equipmentDB` 674건 중 `options`를 가진 항목 **0건**.
   *
   * id에서 제품을 역산할 수 없다는 것도 확인했다 — `eq-xlsx-451`(XDM-12)의
   * 옵션이 `eqopt-xlsx-454`/`456`인데, av-builder의 번호와 카탈로그 행 번호 사이에
   * 일정한 차이가 없다 (시트마다 60~70가지로 흩어지고 같은 장비 안에서도 어긋난다).
   */
  selectedOptionQuantities?: Record<string, number> | undefined;

  /** 옵션 카드가 만들어낸 포트 id. 엣지가 이 id로 연결된다. */
  optionPortIds?: string[] | undefined;

  /** av-builder가 추가할 예정. 없을 수 있다. */
  systemName?: string | undefined;
}

export interface DiagramNode {
  id: string;
  type?: string;
  data: DiagramNodeData;
}

/** 선 하나에 사용자가 적어 넣은 케이블 품목. 실물 샘플에서는 전부 비어 있었다. */
export interface DiagramBomRow {
  cableType?: 'ready-made' | 'manufactured';
  productName?: string;
  /** 미터. 문자열로 받는다 — `DecimalText` 규약. */
  length?: string;
  quantity?: string;
  lineTypeId?: string;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  data?: {
    lineTypeId?: string;
    bomRows?: DiagramBomRow[];
  };
}

/**
 * 선 종류.
 *
 * **id를 하드코딩하지 않는다.** 사용자가 새 종류를 추가할 수 있다
 * (실물 샘플의 `lt-1784014150344` = `DP`). 모르는 id는 경고만 세우고 진행한다.
 */
export interface DiagramLineType {
  id: string;
  name: string;
  color?: string;
}

/** av-builder가 §2를 구현하면 채워진다. 지금은 오지 않는다. */
export interface DiagramOption {
  id: string;
  model: string;
  name?: string;
  manufacturer?: string;
}

export interface DiagramFile {
  version: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  lineTypes: DiagramLineType[];
  /** 장비 카탈로그 전체. 구성도 변환에는 쓰지 않는다 — 노드가 이미 사본을 들고 있다. */
  equipmentDB?: unknown[];
  options?: DiagramOption[];
}
