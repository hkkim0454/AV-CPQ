/**
 * 구성도 → `QuoteDocument` (계획 2026-10-04 Task 6).
 *
 * 여기까지 오면 기존 계산 엔진과 exporter를 **그대로 태운다.** 둘 다 고치지 않는다.
 * 이 모듈은 그 앞단에서 문서를 만들어 넣을 뿐이다.
 *
 * 행 순서는 견적서 관행을 따른다:
 * **장비(+옵션 카드) → 케이블 → 커넥터 → 배관.**
 *
 * 시스템은 노드의 `systemName`으로 나눈다. av-builder가 아직 그 필드를 안 내보내므로
 * 지금은 전부 `defaultSystemName` 하나로 묶인다.
 */
import type {
  DecimalText,
  QuoteDocument,
  QuoteHeader,
  QuoteRow,
  QuoteSystem,
  SheetRow,
} from '../../domain/quote/types';
import { standardIndirectCosts } from '../../domain/quote/indirectCosts';
import type { Catalog } from '../../data/catalog/load';
import { buildDeviceLines, type DeviceLine, type ImportWarning } from './devices';
import { buildCableLines, type CableLine } from './cables';
import { buildDerivedLines } from './derived';
import type { DiagramFile, DiagramNode } from './types';

export interface ImportOptions {
  header: QuoteHeader;
  /** 노드에 `systemName`이 없을 때 쓸 이름. */
  defaultSystemName: string;
  negoDeduction?: DecimalText;
}

export interface ImportResult {
  document: QuoteDocument;
  warnings: ImportWarning[];
  /** 하나라도 blocking이면 Excel 출력을 막는다. */
  blocking: boolean;
}

function systemNameOf(node: DiagramNode, fallback: string): string {
  const name = node.data.systemName?.trim();
  return name !== undefined && name !== '' ? name : fallback;
}

/** 견적 행 하나. 수량이 없으면 `0`이 아니라 빈 값으로 둘 수 없으므로 경고가 이미 서 있다. */
function toQuoteRow(
  rowId: string,
  systemId: string,
  line: {
    name: string;
    specification: string;
    unit: string;
    quantity?: DecimalText;
    sku?: string;
    sellingUnitPrice?: DecimalText;
    isAccessory?: boolean;
    laborMappingId?: string;
  },
  remark: string,
): SheetRow {
  const row: QuoteRow = {
    rowId,
    systemId,
    ...(line.sku !== undefined ? { sku: line.sku, productId: line.sku } : {}),
    // 옵션 카드와 파생 항목은 견적서 관행대로 `- `를 붙인다.
    name: line.isAccessory === true && !line.name.startsWith('-')
      ? `- ${line.name}`
      : line.name,
    specification: line.specification,
    unit: line.unit,
    // 수량을 정하지 못한 행은 `0`으로 채우지 않는다. 계산 엔진이 0을 유효한 값으로
    // 보기 때문에 조용히 0원이 된다. 대신 빈 문자열이 아니라 `0`을 넣지 않으려면
    // 수량이 반드시 있어야 하므로, 미정 행은 `1`을 넣고 경고로 막는다.
    quantity: line.quantity ?? '1',
    ...(line.sellingUnitPrice !== undefined
      ? { sellingUnitPrice: line.sellingUnitPrice }
      : {}),
    // 품셈이 붙는 제품이면 `mapped`로 둔다. `calculateLaborForRows`가 단가를 만들어
    // `calculateQuote(doc, { laborUnitPrices })`로 넘기면 노무비가 들어간다.
    // 품셈이 없으면 `unresolved` — **`not-applicable`로 두지 않는다.** 그러면
    // 노무비가 조용히 0이 되고, 간접비가 노무비 대비라 간접비까지 0이 된다.
    ...(line.laborMappingId !== undefined
      ? { laborMode: 'mapped' as const, laborMappingId: line.laborMappingId }
      : { laborMode: 'unresolved' as const }),
    remark,
    origin: 'rule',
  };
  return { type: 'item', ...row };
}

export function diagramToQuote(
  diagram: DiagramFile,
  catalog: Catalog,
  options: ImportOptions,
): ImportResult {
  const warnings: ImportWarning[] = [];

  // --- 시스템을 나눈다 ---
  const systemOrder: string[] = [];
  const nodesBySystem = new Map<string, DiagramNode[]>();
  for (const node of diagram.nodes) {
    const name = systemNameOf(node, options.defaultSystemName);
    if (!nodesBySystem.has(name)) {
      nodesBySystem.set(name, []);
      systemOrder.push(name);
    }
    nodesBySystem.get(name)!.push(node);
  }
  if (systemOrder.length === 0) {
    systemOrder.push(options.defaultSystemName);
    nodesBySystem.set(options.defaultSystemName, []);
  }

  const systems: QuoteSystem[] = [];
  const rows: SheetRow[] = [];
  let rowCounter = 0;
  const nextRowId = (): string => `dg-${(rowCounter += 1)}`;

  // 케이블은 연결선 전체에서 한 번만 만든다. 선이 시스템을 가로지를 수 있어
  // 노드처럼 나누면 같은 케이블이 두 번 계산된다.
  const cableResult = buildCableLines(diagram, catalog);
  warnings.push(...cableResult.warnings);

  const derivedResult = buildDerivedLines(
    cableResult.lines,
    systemOrder.length,
    catalog,
  );
  warnings.push(...derivedResult.warnings);

  systemOrder.forEach((systemName, index) => {
    const systemId = `S${index + 1}`;
    systems.push({
      systemId,
      name: systemName,
      summarySpec: '',
      unit: '식',
      quantity: '1',
      remark: '',
      indirectCosts: standardIndirectCosts(),
    });

    // --- 장비(+옵션 카드) ---
    const deviceResult = buildDeviceLines(
      { ...diagram, nodes: nodesBySystem.get(systemName) ?? [] },
      catalog,
    );
    warnings.push(...deviceResult.warnings);
    for (const line of deviceResult.lines) {
      rows.push(
        toQuoteRow(nextRowId(), systemId, line, remarkFor(line)),
      );
    }

    // 케이블·커넥터·배관은 **첫 시스템에만** 넣는다. 공간별로 나누려면
    // 선이 어느 공간에 속하는지를 알아야 하는데 구성도에 그 정보가 없다.
    if (index !== 0) return;

    for (const line of cableResult.lines) {
      rows.push(toQuoteRow(nextRowId(), systemId, line, remarkForCable(line)));
    }
    for (const line of derivedResult.lines) {
      rows.push(toQuoteRow(nextRowId(), systemId, line, remarkFor(line)));
    }
  });

  const document: QuoteDocument = {
    schemaVersion: 1,
    documentId: `diagram-${options.header.quoteNumber}`,
    mode: 'material-and-labor',
    header: options.header,
    coverGroups: [
      {
        groupId: 'g1',
        marker: 'Ⅰ',
        name: options.header.projectName,
        systemIds: systems.map((s) => s.systemId),
      },
    ],
    systems,
    rows,
    derivedRows: [],
    negoDeduction: options.negoDeduction ?? '0',
    rounding: { coverTotalDigits: -4 },
    versions: {
      catalog: catalog.sourceSha256,
      labor: catalog.sourceSha256,
      wage: catalog.sourceSha256,
      template: 'sanitized-2026-10-03',
      rule: 'diagram-2026-10-04',
    },
    equipment: [],
    connections: [],
    existingSupplies: [],
  };

  return {
    document,
    warnings,
    blocking: warnings.some((w) => w.blocking),
  };
}

/** 비고에 근거를 남긴다 — 왜 이 행이 생겼는지 사람이 알아야 한다. */
function remarkFor(line: DeviceLine): string {
  if (line.matchedBy === 'model-fragment' && line.matchedFragment !== undefined) {
    return `구성도 — 모델 '${line.matchedFragment}'로 조회`;
  }
  if (line.matchedBy === 'none') return '구성도 — 카탈로그 미등록. 확인 필요';
  return '구성도';
}

function remarkForCable(line: CableLine): string {
  if (line.quantity === undefined) return '구성도 — 케이블 품목 미정. 확인 필요';
  if (line.totalMeters !== undefined) {
    return `구성도 — ${line.segmentCount}구간 합계 ${line.totalMeters}m`;
  }
  return `구성도 — ${line.segmentCount}구간`;
}
