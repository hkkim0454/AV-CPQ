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

export type GuideBodyRowKind = 'item' | 'derived';

export interface GuideBodyRow {
  rowId: string;
  kind: GuideBodyRowKind;
  /** `kind === 'derived'` 일 때만 쓴다. */
  derivedKind?: DerivedBasis['kind'];
}

export interface GuideLayoutInput {
  guide: GuideTemplate;
  /**
   * 품목·파생 행을 **원래 순서 그대로** 준다(독립 검토 P1-5 재지적).
   *
   * 예전에는 품목 id 배열과 파생 id 배열을 따로 받아 이 함수 안에서
   * "품목 전부 → 파생 전부" 순서로 다시 썼다. 입력이 이미 그 순서면
   * 문제가 없지만, **파생 행 뒤에 품목 행이 있는 입력**이면 그 품목이
   * 조용히 앞으로 당겨져 `material-sum-to-here`(잡자재비)의 합산 범위
   * (`firstBodyRow` 부터 그 파생 행 바로 앞까지)가 원본 행 배치와
   * 달라진다 — 숫자는 나오지만 조용히 틀린 값이다.
   *
   * 이제 **배열의 순서가 곧 물리적 행 순서다.** 이 함수는 품목과 파생을
   * 갈라 다시 묶지 않고, 준 순서 그대로 위에서부터 행 번호를 매긴다.
   * 서식(`styleFromRow`)은 물리적 위치가 아니라 **역할**로 고른다 —
   * 품목은 몇 번째 품목인지로, 파생은 `derivedKind` 로 고른다. 템플릿의
   * 두 파생 자리는 역할이 고정돼 있다 — 13행은 배관 기타자재
   * (`single-row-material`), 14행은 잡자재비(`material-sum-to-here`)다.
   */
  bodyRows: readonly GuideBodyRow[];
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

  const derivedEntries = input.bodyRows.filter((r) => r.kind === 'derived');
  if (derivedEntries.length > templateDerivedCount) {
    // 원본에 자리가 둘뿐이다. 셋을 넣으려면 서식을 지어내야 한다 (D17 위반).
    throw new GuideLayoutError(
      `파생 행이 ${derivedEntries.length}개인데 가이드에는 ` +
        `${templateDerivedCount}개 자리뿐이다.`,
    );
  }

  // 'material-sum-to-here' 는 "품목부터 바로 앞 행까지" 를 합산한다.
  // 'single-row-material' 이 그보다 뒤에 오면 물리적으로도 합산 범위
  // 밖에 남아 조용히 빠진다. 템플릿 자체가 배관 기타자재(13) → 잡자재비
  // (14) 고정 순서라 이 조합은 의도된 입력이 아니다 — 던진다.
  let seenSumToHere = false;
  for (const entry of derivedEntries) {
    if (entry.derivedKind === 'material-sum-to-here') {
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

  // 품목이 하나도 없어도 **한 줄도 만들지 않는다.** 빈 줄을 넣으면 직접비계
  // SUM 이 빈 칸을 가리키고, 사람은 품목이 빠진 줄 모른다.
  //
  // **갈라 모으지 않는다.** `input.bodyRows` 의 순서가 곧 물리적 행
  // 순서다 — 품목과 파생이 섞여 있어도 준 순서 그대로 위에서부터 행
  // 번호를 매긴다. 서식은 물리적 위치가 아니라 역할로 고른다: 품목은
  // "몇 번째 품목인지"로(원본이 7줄이라 그보다 많으면 마지막 서식을
  // 되쓴다), 파생은 `derivedKind` 로(배관 기타자재류는 13행 서식,
  // 잡자재비는 14행 서식 — 어디에 물리적으로 있든 같다).
  const rows: PlannedRow[] = [];
  const itemRows: PlannedRow[] = [];
  const derivedRows: PlannedRow[] = [];
  let row = base.firstItem;
  let itemsSeen = 0;

  for (const entry of input.bodyRows) {
    if (entry.kind === 'item') {
      const planned: PlannedRow = {
        row,
        kind: 'item',
        styleFromRow: Math.min(base.firstItem + itemsSeen, base.lastItem),
        rowId: entry.rowId,
      };
      rows.push(planned);
      itemRows.push(planned);
      itemsSeen += 1;
    } else {
      const styleFromRow =
        entry.derivedKind === 'material-sum-to-here'
          ? (base.derived[1] ?? base.derived[base.derived.length - 1]!)
          : (base.derived[0] ?? base.derived[base.derived.length - 1]!);
      const planned: PlannedRow = {
        row,
        kind: 'derived',
        styleFromRow,
        rowId: entry.rowId,
      };
      rows.push(planned);
      derivedRows.push(planned);
    }
    row += 1;
  }

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
