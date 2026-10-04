/**
 * 행 배치 계획 (설계서 §9.3).
 *
 * "동적 행 삽입 시 품목 수식·직접비계·간접비 기준·갑지·병합·인쇄 영역·반복 머리글을
 * 함께 갱신한다" — 그러려면 먼저 **모든 행 번호를 확정**해야 한다.
 * 이 모듈은 숫자만 만든다. XML도, 수식 문자열도 만들지 않는다.
 *
 * 입력은 `CustomerExport`뿐이다. `QuoteDocument`를 직접 받지 않는 것이
 * 설계서 §8.1 allowlist projection을 **구조로** 보장하는 방법이다 —
 * 내보내기 경로에 원문서 타입이 아예 들어오지 않는다.
 */
import type { IndirectCostRule } from '../../domain/quote/types';
import type { SystemCalculation, RowCalculation } from '../../domain/calculation/calculate';
import type {
  CustomerExport,
  CustomerRow,
  CustomerSystem,
} from '../customer/projection';
import { COVER_ANCHOR, SYSTEM_ANCHOR } from './anchors';
import { assignSheetNames } from './sheetName';

export type PlannedRowKind = 'group' | 'subgroup' | 'note' | 'item' | 'derived';

export interface PlannedBodyRow {
  kind: PlannedRowKind;
  /** 최종 Excel 행 번호. */
  row: number;
  /** 어떤 템플릿 모델 행의 서식을 쓸지. */
  styleAnchor: number;
  source: CustomerRow;
  calc?: RowCalculation;
  /**
   * A열 처리.
   *  - `undefined` — 번호 없음 (그룹·소그룹·설명 행)
   *  - `{ constant: 1 }` — 첫 품목
   *  - `{ previousRow: n }` — `=A{n}+1`
   */
  numbering?: { constant: number } | { previousRow: number };
  /** 파생 행이 참조할 기준 행 번호. */
  derivedSourceRow?: number;
  /** 파생 행이 합산할 범위. */
  derivedRange?: { first: number; last: number };
  derivedExcludedRows?: number[];
}

export interface PlannedIndirectRow {
  row: number;
  styleAnchor: number;
  rule: IndirectCostRule;
  /** `composite` 기준이 참조할 다른 간접비 행 번호. */
  plusRows: number[];
}

export interface SystemLayout {
  systemId: string;
  system: CustomerSystem;
  sheetName: string;
  calculation: SystemCalculation;

  titleRow: number;
  headerTopRow: number;
  headerBottomRow: number;
  directHeaderRow: number;

  bodyRows: PlannedBodyRow[];
  /** 첫 품목/파생 행. 품목이 하나도 없으면 undefined. */
  firstItemRow?: number;
  /** 마지막 본문 행. 본문이 비면 `directHeaderRow`. */
  lastBodyRow: number;

  directTotalRow: number;
  indirectHeaderRow: number;
  indirectRows: PlannedIndirectRow[];
  indirectTotalRow: number;
  grandTotalRow: number;

  /** 인쇄 범위의 마지막 행. */
  lastRow: number;
}

export interface PlannedCoverRow {
  kind: 'group' | 'system';
  row: number;
  styleAnchor: number;
  groupMarker?: string;
  groupName?: string;
  systemId?: string;
  /** 시스템 행의 순번 (B열). */
  sequence?: number;
}

export interface CoverLayout {
  titleRow: number;
  quoteNumberRow: number;
  quoteDateRow: number;
  customerRow: number;
  projectNameRow: number;
  contactRow: number;
  introRow: number;
  amountSentenceRow: number;
  headerRow: number;

  bodyRows: PlannedCoverRow[];
  /** 합계 SUM 범위의 시작. 본문이 비면 undefined. */
  firstBodyRow?: number;
  lastBodyRow: number;

  sumRow: number;
  negoRow: number;
  finalRow: number;
  remarkRows: number[];
  closeRow: number;
  lastRow: number;
}

export interface WorkbookLayout {
  cover: CoverLayout;
  systems: SystemLayout[];
}

/** 갑지가 쓰는 시트 이름. 시스템 시트명이 이것과 겹치지 않게 한다. */
export const COVER_SHEET_NAME = '갑지';

export function planWorkbook(exported: CustomerExport): WorkbookLayout {
  const calcById = new Map(exported.calculation.systems.map((c) => [c.systemId, c]));
  const systemById = new Map(exported.systems.map((s) => [s.systemId, s]));

  // 시스템 순서: 갑지 구역 순서를 따르고, 구역에 없는 시스템은 뒤에 붙인다.
  // 조용히 빠뜨리지 않는다.
  const orderedIds: string[] = [];
  for (const group of exported.groups) {
    for (const id of group.systemIds) {
      if (systemById.has(id) && !orderedIds.includes(id)) orderedIds.push(id);
    }
  }
  for (const system of exported.systems) {
    if (!orderedIds.includes(system.systemId)) orderedIds.push(system.systemId);
  }

  const sheetNames = assignSheetNames(
    orderedIds.map((id) => systemById.get(id)!.name),
    [COVER_SHEET_NAME],
  );

  const systems = orderedIds.map((id, index) => {
    const system = systemById.get(id)!;
    const calculation = calcById.get(id);
    if (calculation === undefined) {
      throw new Error(`시스템 ${id}의 계산 결과가 없다.`);
    }
    return planSystem(system, calculation, sheetNames[index]!);
  });

  return { cover: planCover(exported, orderedIds), systems };
}

function planSystem(
  system: CustomerSystem,
  calculation: SystemCalculation,
  sheetName: string,
): SystemLayout {
  const calcByRowId = new Map(calculation.rows.map((r) => [r.rowId, r]));
  const rowNumberByRowId = new Map<string, number>();

  const bodyRows: PlannedBodyRow[] = [];
  let row = SYSTEM_ANCHOR.directHeader + 1;
  let itemCount = 0;
  let previousItemRow = 0;
  let firstItemRow: number | undefined;

  for (const source of system.rows) {
    if (source.type === 'display') {
      bodyRows.push({
        kind: source.kind,
        row,
        styleAnchor:
          source.kind === 'group' ? SYSTEM_ANCHOR.group : SYSTEM_ANCHOR.subgroup,
        source,
      });
      rowNumberByRowId.set(source.rowId, row);
      row += 1;
      continue;
    }

    const isFirst = itemCount === 0;
    const planned: PlannedBodyRow = {
      kind: source.type === 'derived' ? 'derived' : 'item',
      row,
      styleAnchor: isFirst ? SYSTEM_ANCHOR.firstItem : SYSTEM_ANCHOR.item,
      source,
      numbering: isFirst ? { constant: 1 } : { previousRow: previousItemRow },
    };

    const calc = calcByRowId.get(source.rowId);
    if (calc !== undefined) planned.calc = calc;

    if (source.type === 'derived') {
      if (source.derived.kind === 'single-row-material') {
        const sourceRow = rowNumberByRowId.get(source.derived.sourceRowId);
        if (sourceRow !== undefined) planned.derivedSourceRow = sourceRow;
      } else if (firstItemRow !== undefined) {
        planned.derivedRange = { first: firstItemRow, last: row - 1 };
        planned.derivedExcludedRows = (source.derived.excludedRowIds ?? []).flatMap(id => {
          const at = rowNumberByRowId.get(id);
          return at === undefined ? [] : [at];
        });
      }
    }

    bodyRows.push(planned);
    rowNumberByRowId.set(source.rowId, row);
    if (isFirst) firstItemRow = row;
    previousItemRow = row;
    itemCount += 1;
    row += 1;
  }

  const lastBodyRow = row - 1;
  const directTotalRow = row;
  const indirectHeaderRow = directTotalRow + 1;

  const indirectRows: PlannedIndirectRow[] = [];
  const rowByItemId = new Map<string, number>();
  const lastIndex = system.indirectCosts.length - 1;

  system.indirectCosts.forEach((rule, index) => {
    const indirectRow = indirectHeaderRow + 1 + index;
    const styleAnchor =
      index === 0
        ? SYSTEM_ANCHOR.indirectFirst
        : index === lastIndex
          ? SYSTEM_ANCHOR.indirectLast
          : SYSTEM_ANCHOR.indirectMiddle;
    // 기준이 가리키는 항목의 **행 번호**를 넘긴다. `rowByItemId`에는 아직
    // **앞선 항목만** 들어 있다 — 뒤에 오는 항목이나 자기 자신을 가리키면
    // 여기서 비어 돌아가고, 계산 엔진이 같은 조건으로 출력을 막는다.
    const basisItemIds =
      rule.basis.kind === 'composite'
        ? rule.basis.plusItemIds
        : rule.basis.kind === 'item'
          ? [rule.basis.itemId]
          : [];
    const plusRows = basisItemIds
      .map((id) => rowByItemId.get(id))
      .filter((r): r is number => r !== undefined);
    indirectRows.push({ row: indirectRow, styleAnchor, rule, plusRows });
    rowByItemId.set(rule.itemId, indirectRow);
  });

  const indirectTotalRow = indirectHeaderRow + 1 + system.indirectCosts.length;
  const grandTotalRow = indirectTotalRow + 1;

  return {
    systemId: system.systemId,
    system,
    sheetName,
    calculation,
    titleRow: SYSTEM_ANCHOR.title,
    headerTopRow: SYSTEM_ANCHOR.headerTop,
    headerBottomRow: SYSTEM_ANCHOR.headerBottom,
    directHeaderRow: SYSTEM_ANCHOR.directHeader,
    bodyRows,
    ...(firstItemRow !== undefined ? { firstItemRow } : {}),
    lastBodyRow,
    directTotalRow,
    indirectHeaderRow,
    indirectRows,
    indirectTotalRow,
    grandTotalRow,
    lastRow: grandTotalRow,
  };
}

function planCover(exported: CustomerExport, orderedIds: readonly string[]): CoverLayout {
  const bodyRows: PlannedCoverRow[] = [];
  const systemById = new Map(exported.systems.map((s) => [s.systemId, s]));
  const placed = new Set<string>();

  let row = COVER_ANCHOR.header + 1;
  let sequence = 0;
  let firstBodyRow: number | undefined;

  const pushSystem = (systemId: string): void => {
    sequence += 1;
    if (firstBodyRow === undefined) firstBodyRow = row;
    bodyRows.push({
      kind: 'system',
      row,
      styleAnchor: COVER_ANCHOR.system,
      systemId,
      sequence,
    });
    placed.add(systemId);
    row += 1;
  };

  for (const group of exported.groups) {
    const members = group.systemIds.filter((id) => systemById.has(id) && !placed.has(id));
    if (members.length === 0) continue;
    // 합계 SUM 범위는 **첫 시스템 행**부터다. 구역 머리글 행은 금액이 없지만,
    // 원본이 `SUM(H11:H15)`로 머리글(10행)을 제외하므로 그 구조를 따른다.
    bodyRows.push({
      kind: 'group',
      row,
      styleAnchor: COVER_ANCHOR.group,
      groupMarker: group.marker,
      groupName: group.name,
    });
    row += 1;
    for (const id of members) pushSystem(id);
  }

  for (const systemId of orderedIds) {
    if (!placed.has(systemId)) pushSystem(systemId);
  }

  // 마지막 시스템 행은 아래 테두리가 달라 다른 서식을 쓴다.
  for (let index = bodyRows.length - 1; index >= 0; index -= 1) {
    if (bodyRows[index]!.kind === 'system') {
      bodyRows[index]!.styleAnchor = COVER_ANCHOR.lastSystem;
      break;
    }
  }

  const lastBodyRow = row - 1;
  const sumRow = row;
  const negoRow = sumRow + 1;
  const finalRow = negoRow + 1;
  // 비고는 항상 2줄 — 원본의 B19:B20 세로 병합 구조를 보존한다.
  const remarkRows = [finalRow + 1, finalRow + 2];
  const closeRow = finalRow + 3;

  return {
    titleRow: COVER_ANCHOR.title,
    quoteNumberRow: COVER_ANCHOR.quoteNumber,
    quoteDateRow: COVER_ANCHOR.quoteDate,
    customerRow: COVER_ANCHOR.customer,
    projectNameRow: COVER_ANCHOR.projectName,
    contactRow: COVER_ANCHOR.contact,
    introRow: COVER_ANCHOR.intro,
    amountSentenceRow: COVER_ANCHOR.amountSentence,
    headerRow: COVER_ANCHOR.header,
    bodyRows,
    ...(firstBodyRow !== undefined ? { firstBodyRow } : {}),
    lastBodyRow,
    sumRow,
    negoRow,
    finalRow,
    remarkRows,
    closeRow,
    lastRow: closeRow,
  };
}
