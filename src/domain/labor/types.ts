/**
 * 표준품셈·일위대가 도메인 타입 (설계서 §4.3, §5.2, §5.3, §6.2).
 *
 * 원본 품셈 통합문서의 뒤쪽 열(P:BA)이 담던 구조를 타입으로 옮긴 것이다.
 *   P: 품셈 항목 / Q: 품목별 요율 / R: 할증 / S: 표준단가 / T:BA: 직종별 품과 노임
 */
import type { DecimalText } from '../quote/types';

/** 직종 이름. 노임표의 키. */
export type Trade = string;

/**
 * 노임 단위 (결정 문서 D1).
 *
 * 품셈 파일의 노임은 대부분 `M/D`(인·일)이지만 CMS 시트 전용 4개 직종만 `M/M`(인·월)이다.
 * 섞으면 노무비가 약 20배 틀린다. 단위를 값과 함께 들고 다니는 이유다.
 */
export type WageUnit = 'M/D' | 'M/M';

export interface Wage {
  amount: DecimalText;
  unit: WageUnit;
}

/** 품셈 항목 하나 — 어떤 직종의 품이 얼마나 드는지. */
export interface LaborItem {
  laborItemId: string;
  /** 품셈 코드. */
  code: string;
  /** 품셈 내용. */
  description: string;
  /** 품셈의 산출 단위. 판매 단위와 다를 수 있다. */
  baseUnit: string;
  /** 어느 자료에서 왔는지. 설계서 §5.3: 출처를 표시한다. */
  source: string;
  /** 개정 표기 (`2026 상반기` 등). */
  revision: string;
  /**
   * 이 품셈의 품이 전제하는 노임 단위.
   * 노임표의 단위와 다르면 계산하지 않고 차단한다 — 조용히 환산하지 않는다.
   */
  wageUnit: WageUnit;
  trades: TradeQuantity[];
}

export interface TradeQuantity {
  trade: Trade;
  /** 직종별 품. */
  quantity: DecimalText;
}

/** 연도/반기 노임 단가표. 값마다 단위를 함께 담는다. */
export interface WageTable {
  wageTableId: string;
  periodLabel: string;
  source: string;
  wages: Record<Trade, Wage>;
}

/**
 * SKU ↔ 품셈 연결.
 *
 * 설계서 §5.3: 품셈의 기준 단위와 판매 단위가 다르면 환산 계수를 명시한다.
 * 설계서 §5.3: 미확인 매핑을 `품셈 검증 완료`로 표시하지 않는다.
 */
export interface LaborMapping {
  laborMappingId: string;
  sku: string;
  laborItemId: string;
  /** 판매 단위 1개당 품셈 기준 단위 몇 개인지. 같으면 `"1"`. */
  conversionFactor: DecimalText;
  /** 할증. `"0.1"` = 10%. */
  surcharge: DecimalText;
  /** 품목별 요율. `"1.2"`. */
  itemRate: DecimalText;
  /** 사람이 확인했는지. false면 확정을 막는다. */
  confirmed: boolean;
  note: string;
}

export type LaborWarningCode =
  | 'wage-missing'
  | 'wage-unit-mismatch'
  | 'mapping-missing'
  | 'mapping-unconfirmed'
  | 'labor-item-missing';

export interface LaborWarning {
  code: LaborWarningCode;
  blocking: boolean;
  message: string;
  rowId?: string;
  laborMappingId?: string;
}
