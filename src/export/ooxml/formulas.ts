/**
 * Excel 수식 문자열 (설계서 §5.1, §9.3).
 *
 * "웹 계산과 Excel 수식을 서로 다른 곳에서 임의로 작성하지 않는다."
 * 그래서 이 모듈은 `domain/calculation/calculate.ts`가 쓰는 것과 **같은 정의**를
 * 셀 주소로 옮기기만 한다. 새로운 계산 규칙을 여기서 만들지 않는다.
 *
 * 대응표:
 *   calculate.ts `quantity.times(materialUnitPrice)` ↔ `materialAmount()`  `=E7*F7`
 *   calculate.ts `excelInt(mul(basis, rate))`        ↔ `indirectAmount()`  `=INT(I23*E25)`
 *   calculate.ts `roundDown(subtotal, -4)`           ↔ `coverRoundDown()`  `=ROUNDDOWN(SUM(H11:H15),-4)`
 */
import type { IndirectBasis } from '../../domain/quote/types';
import { quoteSheetRef } from './sheetName';

// ---------------------------------------------------------------------------
// 내역 시트
// ---------------------------------------------------------------------------

/** `A{row}` = `=A{previousRow}+1` — 원본의 번호 매기기. */
export function nextNumber(previousRow: number): string {
  return `A${previousRow}+1`;
}

/** `G{row}` = 수량 × 재료비 단가. */
export function materialAmount(row: number): string {
  return `E${row}*F${row}`;
}

/** `I{row}` = 수량 × 노무비 단가. */
export function laborAmount(row: number): string {
  return `E${row}*H${row}`;
}

/** `J{row}` = 재료비 금액 + 노무비 금액. */
export function rowTotal(row: number): string {
  return `G${row}+I${row}`;
}

/**
 * 파생 품목의 단가.
 *
 * `배관 기타자재` → `=INT(G17*20%)`
 * 원본이 퍼센트 표기를 쓰므로 C열의 `배관자재20%` 설명과 수식이 눈으로 대응된다.
 */
export function derivedFromSingleRow(sourceRow: number, ratePercent: string): string {
  return `INT(G${sourceRow}*${ratePercent}%)`;
}

/** `잡자재비` → `=INT(SUM(G7:G21)*2%)`. */
export function derivedFromRange(
  firstRow: number,
  lastRow: number,
  ratePercent: string,
  excludedRows: readonly number[] = [],
): string {
  const excluded = [...new Set(excludedRows)].filter(row => row >= firstRow && row <= lastRow);
  const range = `SUM(G${firstRow}:G${lastRow})`;
  const basis = excluded.length === 0 ? range : `(${range}-${excluded.map(row => `G${row}`).join('-')})`;
  return `INT(${basis}*${ratePercent}%)`;
}

/**
 * 직접비계의 SUM.
 *
 * 품목이 하나도 없으면 `SUM(G7:G6)` 같은 **역전 범위**가 된다.
 * Excel은 이것을 복구 경고로 띄우므로 상수 `0`을 쓴다.
 */
export function directTotalSum(
  column: 'G' | 'I' | 'J',
  firstRow: number | undefined,
  lastRow: number,
): { formula: string } | { constant: 0 } {
  if (firstRow === undefined || lastRow < firstRow) {
    return { constant: 0 };
  }
  return { formula: `SUM(${column}${firstRow}:${column}${lastRow})` };
}

/**
 * 간접비 한 항목의 금액.
 *
 * @param directTotalRow 직접비계 행.
 * @param rateCell       이 행의 요율 셀 (`E25`).
 * @param plusRows       기준이 가리키는 다른 간접비 행들.
 *   `composite`는 직접비계에 **더하고**, `item`은 그 행 **하나만** 쓴다.
 */
export function indirectAmount(
  basis: IndirectBasis,
  directTotalRow: number,
  rateCell: string,
  plusRows: readonly number[],
): string {
  switch (basis.kind) {
    case 'labor':
      // 노무비 대비 — 직접비계의 노무비 금액(I열).
      return `INT(I${directTotalRow}*${rateCell})`;
    case 'direct':
      // 직접비 대비 — 직접비계의 합계(J열).
      return `INT(J${directTotalRow}*${rateCell})`;
    case 'composite': {
      const refs = [`J${directTotalRow}`, ...plusRows.map((r) => `J${r}`)].join(',');
      return `INT(SUM(${refs})*${rateCell})`;
    }
    case 'item': {
      // 지정 항목의 금액만. **직접비계를 넣지 않는다** — 넣으면 보험료가
      // 수십 배가 되고, 인쇄물만 봐서는 알아채기 어렵다.
      const source = plusRows[0];
      if (source === undefined) {
        // 기준 행을 못 찾았다. 계산 엔진이 같은 상황에서 blocking 경고를 세우므로
        // 여기까지 오면 출력이 막힌 상태다. 상수 0으로 둬서 Excel 수식은 성립시킨다.
        return `INT(0*${rateCell})`;
      }
      return `INT(J${source}*${rateCell})`;
    }
  }
}

/** 간접비계 = `SUM(J25:J33)`. 항목이 없으면 상수 0. */
export function indirectTotalSum(
  firstRow: number | undefined,
  lastRow: number | undefined,
): { formula: string } | { constant: 0 } {
  if (firstRow === undefined || lastRow === undefined || lastRow < firstRow) {
    return { constant: 0 };
  }
  return { formula: `SUM(J${firstRow}:J${lastRow})` };
}

/** 시스템 합계 = 직접비계 + 간접비계. 갑지가 참조하는 셀. */
export function systemGrandTotal(directTotalRow: number, indirectTotalRow: number): string {
  return `J${directTotalRow}+J${indirectTotalRow}`;
}

/** 내역 시트 제목 = `="▣ 공사명 : "&갑지!C5`. */
export function systemTitle(coverSheetName: string, projectNameCell: string): string {
  return `"▣ 공사명 : "&${quoteSheetRef(coverSheetName)}!${projectNameCell}`;
}

// ---------------------------------------------------------------------------
// 갑지
// ---------------------------------------------------------------------------

/** 갑지 G열 = 해당 내역 시트의 합계 셀. */
export function coverSystemReference(sheetName: string, grandTotalRow: number): string {
  return `${quoteSheetRef(sheetName)}!J${grandTotalRow}`;
}

/** 갑지 H열 = 수량 × 금액. */
export function coverSystemAmount(row: number): string {
  return `F${row}*G${row}`;
}

/**
 * 갑지 합계 = `ROUNDDOWN(SUM(H11:H15),-4)` — 만원 미만 절사.
 *
 * 시스템이 없으면 역전 범위를 만들지 않고 상수 0을 쓴다.
 */
export function coverRoundDown(
  firstRow: number | undefined,
  lastRow: number,
  digits: number,
): { formula: string } | { constant: 0 } {
  if (firstRow === undefined || lastRow < firstRow) {
    return { constant: 0 };
  }
  return { formula: `ROUNDDOWN(SUM(H${firstRow}:H${lastRow}),${digits})` };
}

/** 최종 합계 = `SUM(H16:H17)` — 절사액 + 음수 NEGO. */
export function coverFinalTotal(sumRow: number, negoRow: number): string {
  return `SUM(H${sumRow}:H${negoRow})`;
}
