/**
 * 행 목록 + 머리정보 → `QuoteDocument` (결정 D7 보강).
 *
 * **견적을 만드는 입구가 둘이다.**
 *
 * ```
 * 구성도 JSON  ─┐
 *               ├──→ buildQuoteDocument ──→ 계산 ──→ Excel
 * 품목 직접선택 ─┘
 * ```
 *
 * 복잡한 견적은 구성도로 그린다(빠뜨림이 없다). PC + 프로젝터 + 케이블 같은
 * 서너 줄짜리는 품목을 직접 고르는 편이 빠르다. **두 입구가 여기서 만난다.**
 *
 * 이 함수가 따로 있는 이유: 두 경로가 각자 `QuoteDocument`를 조립하면
 * 한쪽만 고쳐져 조용히 달라진다. 특히 `laborMode`를 잘못 두면
 * 간접비까지 0이 된다 (아래 참고).
 */
import type {
  DecimalText,
  DocumentVersions,
  QuoteDocument,
  QuoteHeader,
  QuoteRow,
  QuoteSystem,
  SheetRow,
} from './types';
import { standardIndirectCosts } from './indirectCosts';

/** 어느 입구에서 왔든 이 모양이면 견적 행이 된다. */
export interface QuoteLineInput {
  sku?: string;
  name: string;
  specification: string;
  unit: string;
  /** 정하지 못했으면 생략한다. 호출부가 경고를 세워 확정을 막는다. */
  quantity?: DecimalText;
  /** 미등록이면 생략한다. **`0`으로 채우지 않는다** (설계서 §5.6). */
  sellingUnitPrice?: DecimalText;
  /**
   * 품셈 연결 id.
   *
   * ☠ **없다고 `laborMode: 'not-applicable'`로 두면 안 된다.**
   * 그건 "이 품목에는 노무비가 없다"는 **단정**이다. 간접비 6항목이 노무비 대비라
   * 노무비가 0이 되면 **간접비까지 0**이 되고, 실측에서 견적의 18%가 사라졌다.
   * 모르면 `'unresolved'`로 막는다 — 이 함수가 그렇게 한다.
   */
  laborMappingId?: string;
  /** 딸림 항목은 견적서 관행대로 품명 앞에 `- `를 붙인다. */
  isAccessory?: boolean;
  remark?: string;
}

export interface QuoteSystemInput {
  name: string;
  /** 갑지 D열. */
  summarySpec?: string;
  /** 갑지 F열. 기본 `1`. */
  quantity?: DecimalText;
  remark?: string;
  lines: QuoteLineInput[];
}

export interface BuildQuoteDocumentInput {
  header: QuoteHeader;
  systems: QuoteSystemInput[];
  negoDeduction?: DecimalText;
  /** 갑지 구역 이름. 기본은 공사명. */
  groupName?: string;
  documentId?: string;
  versions?: Partial<DocumentVersions>;
  /** 행 id 접두사. 입구를 구분해 추적하기 위한 것. */
  rowIdPrefix?: string;
}

function toRow(
  rowId: string,
  systemId: string,
  line: QuoteLineInput,
): SheetRow {
  const row: QuoteRow = {
    rowId,
    systemId,
    ...(line.sku !== undefined ? { sku: line.sku, productId: line.sku } : {}),
    name:
      line.isAccessory === true && !line.name.startsWith('-')
        ? `- ${line.name}`
        : line.name,
    specification: line.specification,
    unit: line.unit,
    // 수량 미정 행도 `0`을 넣지 않는다. `0`은 계산 엔진이 유효한 값으로 보고
    // 금액을 0원으로 만든다. `1`을 넣고 호출부의 경고로 확정을 막는다.
    quantity: line.quantity ?? '1',
    ...(line.sellingUnitPrice !== undefined
      ? { sellingUnitPrice: line.sellingUnitPrice }
      : {}),
    ...(line.laborMappingId !== undefined
      ? { laborMode: 'mapped' as const, laborMappingId: line.laborMappingId }
      : { laborMode: 'unresolved' as const }),
    remark: line.remark ?? '',
    origin: 'rule',
  };
  return { type: 'item', ...row };
}

export function buildQuoteDocument(input: BuildQuoteDocumentInput): QuoteDocument {
  const prefix = input.rowIdPrefix ?? 'r';
  const systems: QuoteSystem[] = [];
  const rows: SheetRow[] = [];
  let counter = 0;

  input.systems.forEach((system, index) => {
    const systemId = `S${index + 1}`;
    systems.push({
      systemId,
      name: system.name,
      summarySpec: system.summarySpec ?? '',
      unit: '식',
      quantity: system.quantity ?? '1',
      remark: system.remark ?? '',
      indirectCosts: standardIndirectCosts(),
    });
    for (const line of system.lines) {
      counter += 1;
      rows.push(toRow(`${prefix}-${counter}`, systemId, line));
    }
  });

  return {
    schemaVersion: 1,
    documentId: input.documentId ?? `quote-${input.header.quoteNumber}`,
    mode: 'material-and-labor',
    header: input.header,
    coverGroups: [
      {
        groupId: 'g1',
        marker: 'Ⅰ',
        name: input.groupName ?? input.header.projectName,
        systemIds: systems.map((s) => s.systemId),
      },
    ],
    systems,
    rows,
    derivedRows: [],
    negoDeduction: input.negoDeduction ?? '0',
    rounding: { coverTotalDigits: -4 },
    versions: {
      catalog: input.versions?.catalog ?? 'unknown',
      labor: input.versions?.labor ?? 'unknown',
      wage: input.versions?.wage ?? 'unknown',
      template: input.versions?.template ?? 'sanitized-2026-10-03',
      rule: input.versions?.rule ?? 'manual',
    },
    equipment: [],
    connections: [],
    existingSupplies: [],
  };
}
