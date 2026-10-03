/**
 * 원시 덤프의 타입 — `tools/extract_catalog.py`와 TypeScript 사이의 계약 (계획 Task 1).
 *
 * 덤프는 **판단하지 않는다.** 어느 행이 제품인지, SKU를 어떻게 만들지는
 * `classifyRow.ts`와 `buildProducts.ts`가 정한다. 그래서 분류 규칙을 바꿀 때
 * 원본 xlsx를 다시 열 필요가 없다.
 *
 * 덤프에는 **M열(제조사/구매처)·N열(영업비고)이 없다** — 추출기가 그 인덱스를
 * 갖고 있지 않다 (결정 문서 D1, 설계서 §8.1).
 */
import type { DecimalText } from '../../domain/quote/types';

/** 풀지 못한 수식 셀. 셀 참조가 섞여 있으면 여기로 온다. */
export interface UnresolvedFormula {
  trade: string;
  column: string;
  formula: string;
}

/** 원본 한 행. 빈 행은 덤프에 없다. */
export interface RawRow {
  /** 원본 행 번호 — SKU의 일부이자 추적 근거. */
  row: number;
  /** A열. */
  number?: string;
  /** B열. 분류 머리글 `[ … ]` / 브랜드 머리글 / 제품 / 설명줄이 섞여 있다. */
  name?: string;
  /** C열. */
  spec?: string;
  /** D열. */
  description?: string;
  /** E열 — 제품 판별의 기준이다. */
  unit?: string;
  /** G열 — 판매단가. */
  materialUnitPrice?: DecimalText;
  /** G열이 수식이면 원문. `배관 기타자재` 같은 파생 행이다. */
  materialUnitPriceFormula?: string;
  /** L열. */
  remark?: string;
  /** P열 — 품셈 코드. */
  laborCode?: string;
  /** Q열 — 품목별 요율. */
  itemRate?: DecimalText;
  itemRateFormula?: string;
  /** R열 — 할증. */
  surcharge?: DecimalText;
  surchargeFormula?: string;
  /** 직종별 품. 0과 빈칸은 담기지 않는다. */
  trades?: Array<{ trade: string; quantity: DecimalText }>;
  unresolvedTrades?: UnresolvedFormula[];
}

/** 시트 머리글의 직종·단위·노임. */
export interface RawWage {
  trade: string;
  /** `M/D` 또는 `M/M`. 결정 문서 D1 — 섞으면 약 20배 틀린다. */
  unit: string | null;
  amount: DecimalText | null;
  /** 품 값이 있는 열 — 원본 추적용. */
  quantityColumn: string;
}

export interface RawSheet {
  /** 시트 이름 = 제품 분류. */
  name: string;
  wages: RawWage[];
  rows: RawRow[];
}

export interface RawCatalog {
  schemaVersion: 1;
  source: {
    /** 원본 파일의 SHA-256. 파일명·경로는 담지 않는다. */
    sha256: string;
    extractedOn: string;
  };
  sheets: RawSheet[];
}
