/**
 * 테스트용 합성 견적 문서 빌더.
 *
 * 설계서 §4.5 / §8.4: 개발 테스트에는 실제 매입 원가나 회사 판매가를 쓰지 않는다.
 * 여기 나오는 숫자는 전부 합성 값이다.
 */
import type {
  QuoteDocument,
  QuoteSystem,
  SheetRow,
  IndirectCostRule,
  DecimalText,
} from '@/domain/quote/types';

export function system(
  systemId: string,
  options: {
    indirect: IndirectCostRule[];
    name?: string;
    quantity?: DecimalText;
  },
): QuoteSystem {
  return {
    systemId,
    name: options.name ?? systemId,
    summarySpec: '',
    unit: '식',
    quantity: options.quantity ?? '1',
    remark: '',
    indirectCosts: options.indirect,
  };
}

export function itemRow(
  rowId: string,
  systemId: string,
  options: {
    quantity: DecimalText;
    price?: DecimalText;
    laborPrice?: DecimalText;
    name?: string;
    unit?: string;
  },
): SheetRow {
  return {
    type: 'item',
    rowId,
    systemId,
    name: options.name ?? rowId,
    specification: '',
    unit: options.unit ?? 'EA',
    quantity: options.quantity,
    ...(options.price !== undefined ? { sellingUnitPrice: options.price } : {}),
    laborMode: options.laborPrice !== undefined ? 'manual' : 'not-applicable',
    // Task 6 노무 확인 보완: manual·not-applicable 둘 다 사유가 있어야
    // 차단되지 않는다 — 합성 기존 시험이 전부 이 사유를 쓴다.
    overrideReason: '테스트 값',
    ...(options.laborPrice !== undefined ? { manualLaborUnitPrice: options.laborPrice } : {}),
    remark: '',
    origin: 'manual',
  };
}

export function groupRow(rowId: string, systemId: string, name: string): SheetRow {
  return { type: 'display', rowId, systemId, kind: 'group', name };
}

export function makeDocument(options: {
  systems: QuoteSystem[];
  rows: SheetRow[];
  negoDeduction?: DecimalText;
  projectName?: string;
}): QuoteDocument {
  return {
    schemaVersion: 1,
    documentId: 'test-doc',
    mode: 'material-and-labor',
    header: {
      quoteNumber: 'TEST-0001',
      quoteDate: '2026-10-03',
      customer: '테스트 고객',
      projectName: options.projectName ?? '테스트 공사',
      contact: '테스트 담당',
      conditions: [],
    },
    coverGroups: [
      {
        groupId: 'g1',
        marker: 'Ⅰ',
        name: '테스트 구역',
        systemIds: options.systems.map((s) => s.systemId),
      },
    ],
    systems: options.systems,
    rows: options.rows,
    derivedRows: [],
    negoDeduction: options.negoDeduction ?? '0',
    rounding: { coverTotalDigits: -4 },
    versions: {
      catalog: 'test',
      labor: 'test',
      wage: 'test',
      template: 'test',
      rule: 'test',
    },
    equipment: [],
    connections: [],
    existingSupplies: [],
  };
}
