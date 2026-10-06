/**
 * 원시 덤프의 타입 — `tools/extract_catalog.py`와 TypeScript 사이의 계약 (계획 Task 1).
 *
 * 덤프는 **판단하지 않는다.** 어느 행이 제품인지, SKU를 어떻게 만들지는
 * `classifyRow.ts`와 `buildProducts.ts`가 정한다. 그래서 분류 규칙을 바꿀 때
 * 원본 xlsx를 다시 열 필요가 없다.
 *
 * 덤프에는 **제조사/구매처·영업비고·원가가 없다.** 추출기가 그 열을 읽지
 * 않을뿐더러, 읽기 대상 열의 머리글에 그 낱말이 있으면 추출 자체를 멈춘다
 * (결정 문서 D1, 설계서 §8.1).
 *
 * ⚠ **열 문자를 아래 주석에 적지 않는다.** 2026 상·하반기 파일의 열 위치가
 * 서로 다르고(상반기 G=재료비, 하반기 G=원가), 추출기는 열 번호가 아니라
 * **머리글**로 찾는다. 여기에 특정 열 문자를 적어 두면 다음 교체 때 거짓말이
 * 된다 — 실제로 그렇게 밀려서 매입처가 샐 뻔했다.
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
  /** `번호` 머리글. */
  number?: string;
  /** `품 명` — 분류 머리글 `[ … ]` / 브랜드 머리글 / 제품 / 설명줄이 섞여 있다. */
  name?: string;
  /** `규 격`. */
  spec?: string;
  /** `설 명`. */
  description?: string;
  /** `단위` — 제품 판별의 기준이다. */
  unit?: string;
  /** `재료비` + `단 가` — 판매단가. */
  materialUnitPrice?: DecimalText;
  /** 판매단가가 수식이면 원문. `배관 기타자재` 같은 파생 행이다. */
  materialUnitPriceFormula?: string;
  /** 그 수식의 캐시값. 믿을지 말지는 읽는 쪽이 정한다 (설계서 §8.3). */
  materialUnitPriceCached?: DecimalText;
  /**
   * `노무비` + `단 가` — 원본이 적어 둔 노무비 단가.
   *
   * **계산에 쓰지 않는다.** 노무비는 `공수 × 노임`으로 우리가 다시 구한다.
   * 이 값은 그 재계산이 원본과 맞는지 **역산으로 대조**하기 위한 것이다
   * (품셈 교체 Task 2). 실측상 대부분 셀 참조 수식이라
   * `laborUnitPriceCached`로 온다.
   */
  laborUnitPrice?: DecimalText;
  laborUnitPriceFormula?: string;
  laborUnitPriceCached?: DecimalText;
  /** `비 고`. */
  remark?: string;
  /** 품셈 코드 — **머리글이 없는 열**이다. `품목별 요율%` 왼쪽의 블록으로 찾는다. */
  laborCode?: string;
  /** `품목별 요율%`. */
  itemRate?: DecimalText;
  itemRateFormula?: string;
  itemRateCached?: DecimalText;
  /** `할증`. */
  surcharge?: DecimalText;
  surchargeFormula?: string;
  surchargeCached?: DecimalText;
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
    /**
     * 품셈 파일이 스스로 적어 둔 반기 표기(`26년 하반기`). 표준 단가 열의
     * 상위 머리글에서 읽는다.
     *
     * **기본값으로 때우지 않는다.** 예전에는 `buildLabor`의 기본값
     * `'26년 상반기'`가 그대로 붙어서, 하반기 자료에 상반기 이름이 찍힐
     * 수 있었다. 이 값이 없으면 `prepareApprovedFiles`가 막는다.
     *
     * 옛 덤프에는 없으므로 선택 항목이다 — 없으면 **중단**이지 기본값이 아니다.
     */
    periodLabel?: string;
  };
  sheets: RawSheet[];
}
