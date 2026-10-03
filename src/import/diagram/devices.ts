/**
 * 구성도 장비 → 견적 행 (계획 2026-10-04 Task 3).
 *
 * ## 합산한다
 *
 * 같은 제품인 노드는 **한 행으로 합치고 수량을 더한다.** 구성도에 PTZ 카메라가
 * 3개 놓여 있으면 견적서에는 `HD PTZ Camera … 3EA` 한 줄이다.
 *
 * 설계서 §6.1은 `rowId ≠ productId`를 요구하지만, 그건 **같은 SKU를 여러 위치에서
 * 독립 편집**할 수 있어야 한다는 뜻이다. 견적서 실물(DSR·평택)은 합쳐 쓴다.
 * 노드 id는 `sourceNodeIds`에 전부 보존하므로 나중에 나눌 수 있다.
 *
 * ## 못 찾아도 행을 만든다
 *
 * 카탈로그에 없는 장비라도 **행은 만든다.** 빼 버리면 구성도에 그린 장비가
 * 견적에서 조용히 사라진다. 단가를 비우고 경고를 세워 확정을 막는다
 * (설계서 §5.6, §7.5).
 *
 * ## 옵션 카드
 *
 * av-builder가 수량만 내보내고 **그 옵션이 무슨 제품인지는 안 내보낸다**
 * (`docs/interface/av-builder.md` §2). 역산도 불가하다는 것을 확인했다.
 *
 * 그래도 **행은 만든다.** DSR 견적서 기준 카드가 15줄이고 한 장에 74만~190만원이다.
 * 조용히 빼면 1,000만원대가 빠진 견적이 나간다.
 */
import type { DecimalText } from '../../domain/quote/types';
import type { Catalog } from '../../data/catalog/load';
import { dec, text } from '../../domain/calculation/rounding';
import { matchByModel, type MatchResult } from './matchCatalog';
import type { DiagramFile, DiagramNode } from './types';

export type ImportWarningCode =
  | 'device-not-in-catalog'
  | 'device-ambiguous-match'
  | 'option-definition-missing'
  | 'price-not-registered'
  | 'unknown-line-type'
  | 'cable-item-unresolved'
  | 'edge-endpoint-missing';

export interface ImportWarning {
  code: ImportWarningCode;
  /** 확정·Excel 출력을 막는가. */
  blocking: boolean;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface DeviceLine {
  sku?: string;
  name: string;
  specification: string;
  unit: string;
  quantity: DecimalText;
  /** 미등록이면 **없다**. `0`으로 채우지 않는다. */
  sellingUnitPrice?: DecimalText;
  /** 옵션 카드는 주 장비 아래 `- `로 붙는다 — 견적서 관행. */
  isAccessory: boolean;
  /** 합쳐진 노드 전부. 나중에 되돌릴 수 있게 남긴다. */
  sourceNodeIds: string[];
  /** 어떻게 붙었는지. 사람이 검토할 근거. */
  matchedBy: MatchResult['matchedBy'];
  matchedFragment?: string;
}

export interface BuildDeviceLinesResult {
  lines: DeviceLine[];
  warnings: ImportWarning[];
}

/** 옵션 카드 품명. 정의가 없을 때 쓴다. */
const UNKNOWN_OPTION_NAME = '옵션 카드 (미상)';

/** 합산 키 — SKU가 있으면 SKU, 없으면 모델명, 그것도 없으면 품명. */
function mergeKey(node: DiagramNode, match: MatchResult): string {
  if (match.product !== undefined) return `sku:${match.product.sku}`;
  const model = node.data.model?.trim();
  if (model !== undefined && model !== '') return `model:${model}`;
  return `name:${node.data.name?.trim() ?? node.id}`;
}

interface Accumulator {
  line: DeviceLine;
  quantity: ReturnType<typeof dec>;
}

export function buildDeviceLines(
  diagram: DiagramFile,
  catalog: Catalog,
): BuildDeviceLinesResult {
  const warnings: ImportWarning[] = [];
  const lines: DeviceLine[] = [];

  /** 주 장비 합산용. 옵션 카드는 주 장비 바로 뒤에 와야 하므로 따로 합산한다. */
  const deviceByKey = new Map<string, Accumulator>();
  const optionByKey = new Map<string, Accumulator>();
  /** 이미 경고한 옵션 id. 같은 카드가 여러 장비에 걸려도 한 번만 알린다. */
  const reportedOptions = new Set<string>();

  const optionDefinitions = new Map(
    (diagram.options ?? []).map((option) => [option.id, option]),
  );

  const pushOrMerge = (
    bucket: Map<string, Accumulator>,
    key: string,
    line: DeviceLine,
    quantity: string,
  ): void => {
    const existing = bucket.get(key);
    if (existing === undefined) {
      const accumulator: Accumulator = { line, quantity: dec(quantity) };
      bucket.set(key, accumulator);
      lines.push(line);
      line.quantity = text(accumulator.quantity);
      return;
    }
    existing.quantity = existing.quantity.plus(dec(quantity));
    existing.line.quantity = text(existing.quantity);
    existing.line.sourceNodeIds.push(...line.sourceNodeIds);
  };

  for (const node of diagram.nodes) {
    // --- 주 장비 ---
    const match = matchByModel(node.data.model, catalog);
    const name = node.data.name?.trim() ?? '';
    const model = node.data.model?.trim() ?? '';

    if (match.product === undefined) {
      if (match.ambiguousSkus !== undefined) {
        warnings.push({
          code: 'device-ambiguous-match',
          blocking: true,
          message:
            `'${model || name}'이 카탈로그의 여러 제품에 걸린다 ` +
            `(${match.ambiguousSkus.join(', ')}). 어느 것인지 사람이 정해야 한다.`,
          nodeId: node.id,
        });
      } else {
        warnings.push({
          code: 'device-not-in-catalog',
          blocking: true,
          message:
            `'${model || name}'이 카탈로그에 없다. 행은 만들었으나 단가가 미등록이다.`,
          nodeId: node.id,
        });
      }
    } else if (match.sellingUnitPrice === undefined) {
      warnings.push({
        code: 'price-not-registered',
        blocking: true,
        message: `'${match.product.quoteName}'의 판매 단가가 미등록이다.`,
        nodeId: node.id,
      });
    }

    const deviceLine: DeviceLine = {
      ...(match.product !== undefined ? { sku: match.product.sku } : {}),
      // 카탈로그 품명을 쓴다. 구성도의 이름은 설계자가 붙인 별명일 수 있다
      // (`비디오 매트릭스`). 견적서에는 회사 품명이 나가야 한다.
      name: match.product?.quoteName ?? name ?? model,
      specification: match.product?.quoteSpec ?? model,
      unit: match.product?.unit ?? 'EA',
      quantity: '1',
      ...(match.sellingUnitPrice !== undefined
        ? { sellingUnitPrice: match.sellingUnitPrice }
        : {}),
      isAccessory: false,
      sourceNodeIds: [node.id],
      matchedBy: match.matchedBy,
      ...(match.matchedFragment !== undefined
        ? { matchedFragment: match.matchedFragment }
        : {}),
    };
    pushOrMerge(deviceByKey, mergeKey(node, match), deviceLine, '1');

    // --- 옵션 카드 ---
    for (const [optionId, rawQuantity] of Object.entries(
      node.data.selectedOptionQuantities ?? {},
    )) {
      if (rawQuantity <= 0) continue;

      const definition = optionDefinitions.get(optionId);
      if (definition === undefined) {
        if (!reportedOptions.has(optionId)) {
          reportedOptions.add(optionId);
          warnings.push({
            code: 'option-definition-missing',
            blocking: true,
            message:
              `옵션 '${optionId}'의 제품 정의가 구성도에 없다. ` +
              '수량만 살려 행을 만들었다. 어떤 카드인지 지정해야 확정할 수 있다.',
            nodeId: node.id,
          });
        }
        pushOrMerge(
          optionByKey,
          `option:${optionId}`,
          {
            name: UNKNOWN_OPTION_NAME,
            specification: optionId,
            unit: 'EA',
            quantity: String(rawQuantity),
            isAccessory: true,
            sourceNodeIds: [node.id],
            matchedBy: 'none',
          },
          String(rawQuantity),
        );
        continue;
      }

      const optionMatch = matchByModel(definition.model, catalog);
      if (optionMatch.product === undefined) {
        warnings.push({
          code: 'device-not-in-catalog',
          blocking: true,
          message: `옵션 '${definition.model}'이 카탈로그에 없다. 단가가 미등록이다.`,
          nodeId: node.id,
        });
      } else if (optionMatch.sellingUnitPrice === undefined) {
        warnings.push({
          code: 'price-not-registered',
          blocking: true,
          message: `옵션 '${optionMatch.product.quoteName}'의 판매 단가가 미등록이다.`,
          nodeId: node.id,
        });
      }

      pushOrMerge(
        optionByKey,
        `option:${optionId}`,
        {
          ...(optionMatch.product !== undefined ? { sku: optionMatch.product.sku } : {}),
          name: definition.name ?? optionMatch.product?.quoteName ?? definition.model,
          specification: optionMatch.product?.quoteSpec ?? definition.model,
          unit: optionMatch.product?.unit ?? 'EA',
          quantity: String(rawQuantity),
          ...(optionMatch.sellingUnitPrice !== undefined
            ? { sellingUnitPrice: optionMatch.sellingUnitPrice }
            : {}),
          isAccessory: true,
          sourceNodeIds: [node.id],
          matchedBy: optionMatch.matchedBy,
          ...(optionMatch.matchedFragment !== undefined
            ? { matchedFragment: optionMatch.matchedFragment }
            : {}),
        },
        String(rawQuantity),
      );
    }
  }

  return { lines, warnings };
}
