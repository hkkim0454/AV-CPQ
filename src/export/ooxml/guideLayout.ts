/**
 * 가이드 템플릿의 **실제 주소**를 계산한다 (계획 2026-10-04 Task 5).
 *
 * ## 원본은 품목 7줄짜리 예시다
 *
 * ```
 *  6~12  품목 7줄
 *    13  배관 기타자재   = 위 배관 행 판매금액 × 40%
 *    14  잡자재비        = INT(SUM(6:13) × 2%)
 *    15  직접비계
 *    16  Ⅱ 간접비
 * 17~23  간접비 7항목 (DS 는 17~25 로 9항목)
 *    24  간접비계
 *    25  합계
 * ```
 *
 * 실무 견적은 수백 줄이다. 품목이 늘면 **그 아래가 전부 밀린다.** 직접비계
 * SUM 범위, 간접비가 가리키는 직접비계 행, 갑지가 가리키는 합계 행, 인쇄
 * 영역이 함께 따라가야 한다. 하나라도 안 따라가면 금액이 틀리거나 `#REF!` 가
 * 된다 — 그리고 인쇄물만 봐서는 알아채기 어렵다.
 *
 * 이 모듈은 **주소만** 계산한다. XML 도 수식도 만들지 않는다. 수식 생성기와
 * 검증 manifest 가 **같은 결과**를 쓴다 — 따로 계산하면 언젠가 갈린다.
 */
import type { GuideTemplate } from './guideTemplate';
import type { DerivedBasis } from '../../domain/quote/types';

/** 한 행이 무엇인지. */
export type GuideRowKind =
  | 'item'
  | 'derived'
  | 'group'
  | 'directSubtotal'
  | 'indirectHeader'
  | 'indirect'
  | 'indirectSubtotal'
  | 'grandTotal';

export interface PlannedRow {
  row: number;
  kind: GuideRowKind;
  /** 원본에서 서식을 가져올 행. 품목이 늘어도 7번째 행 서식을 되쓴다. */
  styleFromRow: number;
  /** 문서 쪽 식별자. 구조 행에는 없다. */
  rowId?: string;
  /** 간접비 항목 id. `kind === 'indirect'` 일 때만. */
  itemId?: string;
}

export interface GuideSheetLayout {
  /** 품목·파생 행을 통틀어 첫 행. */
  firstBodyRow: number;
  /** 품목 행만. 파생 행은 뺀다. */
  itemRows: readonly PlannedRow[];
  /** 배관 기타자재·잡자재비. */
  derivedRows: readonly PlannedRow[];
  rows: readonly PlannedRow[];
  directSubtotalRow: number;
  indirectHeaderRow: number;
  indirectRows: readonly PlannedRow[];
  indirectSubtotalRow: number;
  grandTotalRow: number;
  /** 원본 대비 몇 줄 밀렸는가. 0 이면 예시와 같은 줄 수다. */
  shift: number;
  /** `A1:O27` 꼴. 마지막 행이 합계 행까지 덮는다. */
  printArea: string;
  /** 열 역할 → 열 글자. 수식이 이것만 쓴다. */
  column: (role: string) => string;
}

export interface GuideLayoutInput {
  guide: GuideTemplate;
  /** 품목 행의 문서 식별자. 순서가 곧 출력 순서다. */
  itemRowIds: readonly string[];
  /** 파생 행의 문서 식별자. 보통 배관 기타자재·잡자재비 둘이다. */
  derivedRowIds: readonly string[];
  /**
   * 파생 행의 종류. **순서 검증에만 쓴다** — 자리 배정에는 여전히
   * `derivedRowIds` 의 배열 순서를 쓴다.
   *
   * 템플릿의 두 자리는 **역할이 고정**돼 있다. 13행은 배관 기타자재
   * (`single-row-material`), 14행은 잡자재비(`material-sum-to-here`)다.
   * 잡자재비는 "품목부터 바로 윗 행까지" 를 합산하므로, 순서가 뒤집히면
   * 배관 기타자재가 합산 범위 밖으로 빠진다 — 숫자는 나오지만 원본보다
   * 작은, 조용히 틀린 값이다.
   */
  derivedRowKinds?: readonly DerivedBasis['kind'][];
}

export class GuideLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuideLayoutError';
  }
}

function columnName(index: number): string {
  let out = '';
  let rest = index;
  while (rest > 0) {
    const rem = (rest - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    rest = Math.floor((rest - 1) / 26);
  }
  return out;
}

export function planGuideSheet(input: GuideLayoutInput): GuideSheetLayout {
  const { guide } = input;
  const base = guide.rows;
  const templateDerivedCount = base.derived.length;

  if (input.derivedRowIds.length > templateDerivedCount) {
    // 원본에 자리가 둘뿐이다. 셋을 넣으려면 서식을 지어내야 한다 (D17 위반).
    throw new GuideLayoutError(
      `파생 행이 ${input.derivedRowIds.length}개인데 가이드에는 ` +
        `${templateDerivedCount}개 자리뿐이다.`,
    );
  }

  if (input.derivedRowKinds !== undefined) {
    // 'material-sum-to-here' 는 "품목부터 바로 윗 행까지" 를 합산한다.
    // 그 앞에 'single-row-material' 이 와야 **그 행까지 포함**된다.
    // 뒤집히면 숫자는 나오지만 원본보다 작은, 조용히 틀린 값이 된다.
    let seenSumToHere = false;
    for (const kind of input.derivedRowKinds) {
      if (kind === 'material-sum-to-here') {
        seenSumToHere = true;
        continue;
      }
      if (seenSumToHere) {
        throw new GuideLayoutError(
          "파생 행 순서가 틀렸다 — 'material-sum-to-here'(잡자재비) 뒤에 " +
            "'single-row-material'(배관 기타자재류) 가 왔다. 잡자재비는 " +
            '앞선 행까지만 합산하므로, 이 순서면 배관 기타자재가 합산 범위 밖으로 빠진다.',
        );
      }
    }
  }

  const rows: PlannedRow[] = [];
  let row = base.firstItem;

  // --- 품목 ---
  // 품목이 하나도 없어도 **한 줄도 만들지 않는다.** 빈 줄을 넣으면 직접비계
  // SUM 이 빈 칸을 가리키고, 사람은 품목이 빠진 줄 모른다.
  const itemRows: PlannedRow[] = input.itemRowIds.map((rowId, index) => {
    const planned: PlannedRow = {
      row: row + index,
      kind: 'item',
      // 원본 품목 행이 7줄이다. 그보다 많으면 마지막 서식을 되쓴다.
      styleFromRow: Math.min(base.firstItem + index, base.lastItem),
      rowId,
    };
    return planned;
  });
  rows.push(...itemRows);
  row += itemRows.length;

  // --- 파생 (배관 기타자재 → 잡자재비 순서를 지킨다) ---
  const derivedRows: PlannedRow[] = input.derivedRowIds.map((rowId, index) => ({
    row: row + index,
    kind: 'derived' as const,
    styleFromRow: base.derived[index] ?? base.derived[base.derived.length - 1]!,
    rowId,
  }));
  rows.push(...derivedRows);
  row += derivedRows.length;

  const directSubtotalRow = row;
  rows.push({
    row: directSubtotalRow,
    kind: 'directSubtotal',
    styleFromRow: base.directSubtotal,
  });
  row += 1;

  const indirectHeaderRow = row;
  rows.push({
    row: indirectHeaderRow,
    kind: 'indirectHeader',
    styleFromRow: base.indirectFirst - 1,
  });
  row += 1;

  const indirectRows: PlannedRow[] = guide.indirectRules.map((rule, index) => ({
    row: row + index,
    kind: 'indirect' as const,
    styleFromRow: Math.min(base.indirectFirst + index, base.indirectLast),
    itemId: rule.itemId,
  }));
  rows.push(...indirectRows);
  row += indirectRows.length;

  const indirectSubtotalRow = row;
  rows.push({
    row: indirectSubtotalRow,
    kind: 'indirectSubtotal',
    styleFromRow: base.indirectSubtotal,
  });
  row += 1;

  const grandTotalRow = row;
  rows.push({ row: grandTotalRow, kind: 'grandTotal', styleFromRow: base.grandTotal });

  const shift = grandTotalRow - base.grandTotal;

  const printLast = columnName(guide.printLastColumn);
  const printStart = guide.printArea.detail.split(':')[0] ?? 'A1';

  const columnByRole = new Map(
    [...guide.columns.entries()].map(([role, index]) => [role, columnName(index)]),
  );

  return {
    firstBodyRow: base.firstItem,
    itemRows,
    derivedRows,
    rows,
    directSubtotalRow,
    indirectHeaderRow,
    indirectRows,
    indirectSubtotalRow,
    grandTotalRow,
    shift,
    printArea: `${printStart}:${printLast}${grandTotalRow}`,
    column: (role: string): string => {
      const letter = columnByRole.get(role);
      if (letter === undefined) {
        // 모르는 역할을 'A' 같은 기본값으로 떨어뜨리지 않는다.
        // 엉뚱한 열에 금액이 들어가면 인쇄물만 봐서는 못 찾는다.
        throw new GuideLayoutError(
          `가이드 '${guide.id}' 에 '${role}' 열이 없다. ` +
            `있는 역할: ${[...columnByRole.keys()].join(', ')}`,
        );
      }
      return letter;
    },
  };
}

/**
 * 품목이 하나도 없을 때의 직접비계 SUM 범위.
 *
 * `SUM(H6:H5)` 같은 **역전 범위**가 되면 Excel 이 복구 경고를 띄운다
 * (verification.md). 그 경우 상수 0 을 쓴다.
 */
export function bodyRange(
  layout: GuideSheetLayout,
): { first: number; last: number } | undefined {
  const last = layout.directSubtotalRow - 1;
  if (last < layout.firstBodyRow) return undefined;
  return { first: layout.firstBodyRow, last };
}
