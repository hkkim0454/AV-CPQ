/**
 * 구성도 → `QuoteDocument` (계획 2026-10-04 Task 6).
 *
 * **조립은 직접 하지 않는다.** 행을 만들어 `buildQuoteDocument`에 넘긴다.
 * 품목 직접 선택 경로가 같은 함수를 쓰므로, 두 입구가 같은 문서 모양으로 모인다
 * (결정 D7 보강).
 *
 * 행 순서는 견적서 관행을 따른다:
 * **장비(+옵션 카드) → 케이블 → 커넥터 → 배관.**
 */
import type { DecimalText, QuoteDocument, QuoteHeader } from '../../domain/quote/types';
import {
  buildQuoteDocument,
  type QuoteLineInput,
  type QuoteSystemInput,
} from '../../domain/quote/buildDocument';
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

function deviceToLine(line: DeviceLine): QuoteLineInput {
  return {
    ...(line.sku !== undefined ? { sku: line.sku } : {}),
    name: line.name,
    specification: line.specification,
    unit: line.unit,
    quantity: line.quantity,
    ...(line.sellingUnitPrice !== undefined
      ? { sellingUnitPrice: line.sellingUnitPrice }
      : {}),
    ...(line.laborMappingId !== undefined ? { laborMappingId: line.laborMappingId } : {}),
    isAccessory: line.isAccessory,
    remark: remarkFor(line),
  };
}

function cableToLine(line: CableLine): QuoteLineInput {
  return {
    ...(line.sku !== undefined ? { sku: line.sku } : {}),
    name: line.name,
    specification: line.specification,
    unit: line.unit,
    ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
    ...(line.sellingUnitPrice !== undefined
      ? { sellingUnitPrice: line.sellingUnitPrice }
      : {}),
    ...(line.laborMappingId !== undefined ? { laborMappingId: line.laborMappingId } : {}),
    remark: remarkForCable(line),
  };
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

  const systems: QuoteSystemInput[] = systemOrder.map((systemName, index) => {
    const deviceResult = buildDeviceLines(
      { ...diagram, nodes: nodesBySystem.get(systemName) ?? [] },
      catalog,
    );
    warnings.push(...deviceResult.warnings);

    const lines: QuoteLineInput[] = deviceResult.lines.map(deviceToLine);

    // 케이블·커넥터·배관은 **첫 시스템에만** 넣는다. 선이 어느 공간에 속하는지
    // 구성도에 정보가 없다 (열린 항목 O18 — av-builder가 선에도 systemName을 붙이면 해결).
    if (index === 0) {
      lines.push(...cableResult.lines.map(cableToLine));
      lines.push(...derivedResult.lines.map(deviceToLine));
    }

    return { name: systemName, lines };
  });

  const document = buildQuoteDocument({
    header: options.header,
    systems,
    ...(options.negoDeduction !== undefined
      ? { negoDeduction: options.negoDeduction }
      : {}),
    documentId: `diagram-${options.header.quoteNumber}`,
    rowIdPrefix: 'dg',
    // 품셈·노임 기준은 **여기서 알 수 없다.** 카탈로그 해시는 제품·단가의
    // 출처지 노임표의 출처가 아니다. 그걸 적어 두면 문서가 쓰지도 않은 기준을
    // 주장하게 되고, 다시 열 때 "같은 기준"으로 통과한다.
    // `prepareQuote` 가 실제로 쓴 기준을 적는다.
    versions: {
      catalog: catalog.sourceSha256,
      rule: 'diagram-2026-10-04',
    },
  });

  return {
    document,
    warnings,
    blocking: warnings.some((w) => w.blocking),
  };
}
