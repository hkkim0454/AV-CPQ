/**
 * 가이드 템플릿용 수식 (계획 2026-10-04 Task 5).
 *
 * ## 열 글자를 박지 않는다
 *
 * `_원` 과 `_품셈` 은 열이 세 칸 어긋난다. 합계가 하나는 `M`, 하나는 `K` 다.
 * 그래서 모든 수식이 `layout.column(역할)` 로 열을 묻는다. 모르는 역할을
 * 물으면 던진다 — 엉뚱한 열에 금액이 들어가면 인쇄물만 봐서는 못 찾는다.
 *
 * ## 엔진과 같은 값이 나와야 한다
 *
 * ```
 * calculate.ts                        여기
 * excelInt(수량 × 단가)         ↔     =F7*G7
 * excelInt(기준 × 요율)         ↔     =INT(J15*F17)
 * INT(SUM(범위 재료비) × 2%)    ↔     =INT(SUM(H6:H13)*2%)
 * ```
 *
 * 둘이 갈리면 화면과 Excel 이 다른 금액을 낸다. Task 7 이 실제 Excel 로 대조한다.
 */
import type { IndirectBasis } from '../../domain/quote/types';
import type { GuideSheetLayout } from './guideLayout';
import { bodyRange, GuideLayoutError } from './guideLayout';

/** `=F7*G7` — 수량 × 단가. */
export function amount(
  layout: GuideSheetLayout,
  row: number,
  unitPriceRole: string,
): string {
  const quantity = layout.column('quantity');
  const unitPrice = layout.column(unitPriceRole);
  return `${quantity}${row}*${unitPrice}${row}`;
}

/** `=H7+J7` — 재료비 금액 + 노무비 금액. */
export function rowTotal(layout: GuideSheetLayout, row: number): string {
  return `${layout.column('material.amount')}${row}+${layout.column('labor.amount')}${row}`;
}

/** `=IFERROR((I7/G7)-1,"-")` — 이윤율. **0단계에만** 쓴다. */
export function profitRate(layout: GuideSheetLayout, row: number): string {
  const selling = layout.column('material.unit');
  const cost = layout.column('cost.unit');
  return `IFERROR((${selling}${row}/${cost}${row})-1,"-")`;
}

/**
 * `=H12*40%` — 배관 기타자재. 지정한 배관 행 **하나만** 기준이다.
 *
 * 범위 합계가 아니다. 원본이 바로 윗 배관 행만 가리킨다.
 */
export function derivedFromRow(
  layout: GuideSheetLayout,
  sourceRow: number,
  amountRole: string,
  ratePercent: string,
): string {
  return `${layout.column(amountRole)}${sourceRow}*${ratePercent}%`;
}

/**
 * `=INT(SUM(H6:H13)*2%)` — 잡자재비.
 *
 * **배관 기타자재 행을 포함한다.** 원본이 그렇게 돼 있다. 품목만 더하면
 * 원본보다 작아진다.
 */
export function derivedFromRange(
  layout: GuideSheetLayout,
  firstRow: number,
  lastRow: number,
  amountRole: string,
  ratePercent: string,
): string | { constant: 0 } {
  if (lastRow < firstRow) return { constant: 0 };
  const column = layout.column(amountRole);
  return `INT(SUM(${column}${firstRow}:${column}${lastRow})*${ratePercent}%)`;
}

/**
 * `=SUM(H6:H14)` — 직접비계.
 *
 * 품목이 하나도 없으면 `SUM(H6:H5)` 라는 **역전 범위**가 된다.
 * Excel 이 복구 경고를 띄우므로 상수 0 을 쓴다.
 */
export function directSubtotal(
  layout: GuideSheetLayout,
  amountRole: string,
): { formula: string } | { constant: 0 } {
  const range = bodyRange(layout);
  if (range === undefined) return { constant: 0 };
  const column = layout.column(amountRole);
  return { formula: `SUM(${column}${range.first}:${column}${range.last})` };
}

/** 간접비 한 항목의 금액. */
export function indirectAmount(
  layout: GuideSheetLayout,
  basis: IndirectBasis,
  rateCell: string,
  rowByItemId: ReadonlyMap<string, number>,
): string {
  const direct = layout.directSubtotalRow;
  const total = layout.column('total');
  const labor = layout.column('labor.amount');

  switch (basis.kind) {
    case 'labor':
      return `INT(${labor}${direct}*${rateCell})`;
    case 'direct':
      return `INT(${total}${direct}*${rateCell})`;
    case 'composite': {
      const refs = [
        `${total}${direct}`,
        ...basis.plusItemIds.map((id) => {
          const row = rowByItemId.get(id);
          if (row === undefined) {
            throw new GuideLayoutError(
              `간접비 기준 항목 ${id} 의 행을 찾지 못했다.`,
            );
          }
          return `${total}${row}`;
        }),
      ].join(',');
      return `INT(SUM(${refs})*${rateCell})`;
    }
    case 'item': {
      // 지정 항목의 금액만. **직접비계를 넣지 않는다** — 넣으면 보험료가
      // 수십 배가 되고, 인쇄물만 봐서는 알아채기 어렵다.
      const row = rowByItemId.get(basis.itemId);
      if (row === undefined) {
        throw new GuideLayoutError(
          `간접비 기준 항목 ${basis.itemId} 가 앞에 없다.`,
        );
      }
      return `INT(${total}${row}*${rateCell})`;
    }
  }
}

/** `=SUM(M17:M25)` — 간접비계. */
export function indirectSubtotal(layout: GuideSheetLayout): string | { constant: 0 } {
  const rows = layout.indirectRows;
  if (rows.length === 0) return { constant: 0 };
  const column = layout.column('total');
  return `SUM(${column}${rows[0]!.row}:${column}${rows[rows.length - 1]!.row})`;
}

/** `=M15+M26` — 합계. */
export function grandTotal(layout: GuideSheetLayout): string {
  const column = layout.column('total');
  return `${column}${layout.directSubtotalRow}+${column}${layout.indirectSubtotalRow}`;
}

/**
 * 갑지가 세부내역의 합계를 가리키는 참조.
 *
 * 품목이 늘면 합계 행이 밀린다. 갑지를 같이 안 고치면 **금액이 0 이거나
 * `#REF!`** 가 되는데, 사용자는 인쇄물만 보고 알아채기 어렵다.
 */
export function coverReference(sheetName: string, layout: GuideSheetLayout): string {
  const column = layout.column('total');
  // 공백·기호가 있으면 작은따옴표로 감싼다. **한글은 그대로 쓴다** —
  // 원본도 `=갑지!C5` 로 적는다. 불필요하게 감싸면 원본과 글자가 달라진다.
  const plain = /^[\p{L}_][\p{L}\p{N}_.]*$/u.test(sheetName);
  // `A1` 이나 `R1C1` 처럼 셀 주소로 읽히는 이름은 감싸야 한다.
  const looksLikeCell = /^[A-Za-z]{1,3}[0-9]+$/.test(sheetName);
  const quoted =
    plain && !looksLikeCell ? sheetName : `'${sheetName.replace(/'/g, "''")}'`;
  return `${quoted}!${column}${layout.grandTotalRow}`;
}

/**
 * 직종 금액 — `=T6*U$3`.
 *
 * 품(앞칸) × 3행 노임(절대 행). 원본이 그렇게 돼 있다.
 *
 * **템플릿의 수식이 남아 있을 거라고 믿으면 안 된다.** 본문 행은 새로
 * 쓰이므로, 넣지 않으면 그냥 빈 칸이 된다. 실측으로 `T6=0.3` 인데 `U6` 이
 * 비어 있었다 — 품은 보이는데 금액이 없으니 근거 구실을 못 한다.
 */
export function tradeAmount(
  quantityColumn: string,
  amountColumn: string,
  row: number,
  wageRow: number,
): string {
  return `${quantityColumn}${row}*${amountColumn}$${wageRow}`;
}

/**
 * 표준단가 — `=SUM(U6,W6,Y6,…)`.
 *
 * 직종 금액 칸들의 합이다. 상수로 박으면 사용자가 품을 고쳐도 안 따라온다.
 */
export function standardUnitPrice(amountColumns: readonly string[], row: number): string {
  if (amountColumns.length === 0) return '0';
  return `SUM(${amountColumns.map((column) => `${column}${row}`).join(',')})`;
}

/**
 * 노무비 단가 — `=INT(SUM((R6*S6),S6)*Q6)`.
 *
 * `표준단가 × (1 + 할증) × 품목별 요율` 을 원본 표기로 쓴 것이다.
 * 계산 엔진의 `excelInt(표준단가 × (1+surcharge) × itemRate × conversionFactor)`
 * 와 같아야 한다.
 *
 * **환산계수(conversionFactor)는 원본에 칸이 없다.** 1 이 아니면 이 수식으로는
 * 엔진과 달라지므로 호출부가 막는다.
 */
export function laborUnitPrice(
  layout: GuideSheetLayout,
  row: number,
): string {
  const surcharge = layout.column('surcharge');
  const standard = layout.column('standardUnitPrice');
  const itemRate = layout.column('itemRate');
  return `INT(SUM((${surcharge}${row}*${standard}${row}),${standard}${row})*${itemRate}${row})`;
}
