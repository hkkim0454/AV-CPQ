/**
 * 고객용 출력에 들어갈 것만 추린다 (설계서 §8.1, §8.7, §10.4).
 *
 * **allowlist projection**이다. 문서에서 뺄 것을 지우는 방식이 아니라,
 * 넣을 것을 하나씩 적는 방식이다. 나중에 `QuoteDocument`에 필드가 추가돼도
 * 여기 적지 않으면 고객 파일로 새어 나가지 않는다.
 *
 * 설계서 §10.4: 이 함수는 `PrivateCostSession`을 인자로 받지 않는다.
 */
import type {
  QuoteDocument,
  DecimalText,
  IndirectCostRule,
  DerivedBasis,
} from '../../domain/quote/types';
import type { CalculationSnapshot } from '../../domain/calculation/calculate';

export interface CustomerHeader {
  quoteNumber: string;
  /** ISO `YYYY-MM-DD`. */
  quoteDate: string;
  customer: string;
  projectName: string;
  contact: string;
  conditions: string[];
}

export interface CustomerDisplayRow {
  type: 'display';
  rowId: string;
  kind: 'group' | 'subgroup' | 'note';
  name: string;
  specification?: string;
  materialNote?: string;
  remark?: string;
}

export interface CustomerItemRow {
  type: 'item';
  rowId: string;
  name: string;
  specification: string;
  unit: string;
  quantity: DecimalText;
  remark: string;
}

export interface CustomerDerivedRow {
  type: 'derived';
  rowId: string;
  name: string;
  specification: string;
  unit: string;
  quantity: DecimalText;
  remark: string;
  derived: DerivedBasis;
  rate: DecimalText;
}

export type CustomerRow = CustomerDisplayRow | CustomerItemRow | CustomerDerivedRow;

export interface CustomerSystem {
  systemId: string;
  name: string;
  summarySpec: string;
  unit: string;
  quantity: DecimalText;
  remark: string;
  indirectCosts: IndirectCostRule[];
  rows: CustomerRow[];
}

export interface CustomerGroup {
  marker: string;
  name: string;
  systemIds: string[];
}

export interface CustomerExport {
  header: CustomerHeader;
  groups: CustomerGroup[];
  systems: CustomerSystem[];
  negoDeduction: DecimalText;
  roundingDigits: number;
  calculation: CalculationSnapshot;
}

/**
 * 고객 파일에 **싣지 않는** 것 — 왜 빠졌는지 코드에 남긴다.
 *
 *  QuoteRow.productId / sku      내부 카탈로그 식별자
 *  QuoteRow.location             내부 설치 메모
 *  QuoteRow.origin               행이 어떻게 생겼는지 (수동·샘플·규칙)
 *  QuoteRow.ruleInstanceId       추천 엔진 내부 id
 *  QuoteRow.laborMode            내부 처리 방식
 *  QuoteRow.laborMappingId       품셈 연결 id
 *  QuoteRow.manualLaborUnitPrice 단가는 계산 스냅샷을 통해서만 나간다
 *  QuoteRow.overrideReason       수동 단가 사유 — 내부 기록
 *  QuoteDocument.equipment       장비 인스턴스
 *  QuoteDocument.connections     연결 구간
 *  QuoteDocument.existingSupplies 기존 자재 배정
 *  QuoteDocument.versions        내부 버전 스냅샷
 *  QuoteDocument.documentId      내부 문서 id
 *  QuoteDocument.mode            견적 모드
 */
export function buildCustomerProjection(
  document: QuoteDocument,
  calculation: CalculationSnapshot,
): CustomerExport {
  const systems: CustomerSystem[] = document.systems.map((system) => {
    const rows: CustomerRow[] = [];

    for (const row of document.rows) {
      if (row.systemId !== system.systemId) continue;
      if (row.type === 'display') {
        rows.push({
          type: 'display',
          rowId: row.rowId,
          kind: row.kind,
          name: row.name,
          ...(row.specification !== undefined ? { specification: row.specification } : {}),
          ...(row.materialNote !== undefined ? { materialNote: row.materialNote } : {}),
          ...(row.remark !== undefined ? { remark: row.remark } : {}),
        });
      } else {
        rows.push({
          type: 'item',
          rowId: row.rowId,
          name: row.name,
          specification: row.specification,
          unit: row.unit,
          quantity: row.quantity,
          remark: row.remark,
        });
      }
    }

    for (const derived of document.derivedRows) {
      if (derived.systemId !== system.systemId) continue;
      rows.push({
        type: 'derived',
        rowId: derived.rowId,
        name: derived.name,
        specification: derived.specification,
        unit: derived.unit,
        quantity: derived.quantity,
        remark: derived.remark,
        derived: derived.derived,
        rate: derived.rate,
      });
    }

    return {
      systemId: system.systemId,
      name: system.name,
      summarySpec: system.summarySpec,
      unit: system.unit,
      quantity: system.quantity,
      remark: system.remark,
      indirectCosts: system.indirectCosts.map((rule) => ({ ...rule })),
      rows,
    };
  });

  return {
    header: {
      quoteNumber: document.header.quoteNumber,
      quoteDate: document.header.quoteDate,
      customer: document.header.customer,
      projectName: document.header.projectName,
      contact: document.header.contact,
      conditions: [...document.header.conditions],
    },
    groups: document.coverGroups.map((g) => ({
      marker: g.marker,
      name: g.name,
      systemIds: [...g.systemIds],
    })),
    systems,
    negoDeduction: document.negoDeduction,
    roundingDigits: document.rounding.coverTotalDigits,
    calculation,
  };
}

export type { IndirectCostRule };
