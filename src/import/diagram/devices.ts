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
import type { Catalog, CatalogProduct } from '../../data/catalog/load';
import { dec, text } from '../../domain/calculation/rounding';
import { matchByModel, type MatchResult, type ModelSearchCandidate } from './matchCatalog';
import type { DiagramFile, DiagramNode } from './types';

export type ImportWarningCode =
  | 'misc-classification-missing'
  | 'misc-basis-review-required'
  | 'device-not-in-catalog'
  | 'device-ambiguous-match'
  | 'option-definition-missing'
  | 'price-not-registered'
  | 'unknown-line-type'
  | 'cable-item-unresolved'
  | 'cable-length-missing'
  /** 제품 연결만으로 해소할 수 없는 완제품 길이 한계. */
  | 'cable-length-exceeded'
  /**
   * 구간 경로 입력(`RouteInput`)을 **시작은 했지만** 아직 완성되지
   * 않았거나 형식이 틀렸다 — `cable-length-missing`(입력 자체가
   * 없음)과 다르다. 이 상태에서는 구성도 원본 길이(`bomRows[].length`)로
   * 조용히 대신 계산하지 않는다(독립 검토 지적).
   */
  | 'cable-route-incomplete'
  | 'edge-endpoint-missing'
  /**
   * 명시적 재계산(`recalculateWithCurrentBasis`) 중 이미 해소해 둔
   * 품목(sku)이 **지금 카탈로그에 더는 없다**고 확인됐다(독립 검토
   * 지적). 옛 단가를 지금 기준인 것처럼 조용히 쓰지 않는다 — `rowId`로
   * 그 행만 찾아 다시 고르게 한다. nodeId/edgeId/optionId 연결이 없는
   * 행(직접 추가한 품목 등)도 똑같이 다룰 수 있도록 입구와 무관한
   * `rowId` 기반 경로 하나로 둔다.
   */
  | 'catalog-item-removed';

export interface ImportWarning {
  owner?: 'cable-generation';
  code: ImportWarningCode;
  /** 확정·Excel 출력을 막는가. */
  blocking: boolean;
  message: string;
  nodeId?: string;
  edgeId?: string;
  /** `catalog-item-removed` 전용 — 입구(노드/옵션/edge)와 무관하게 그 행 자체를 가리킨다. */
  rowId?: string;
  /** 같은 연결선 안의 서로 다른 BOM 품목을 구별하는 집계 키. */
  sourceCableKey?: string;
  requiredCableMeters?: string;
  /**
   * `device-ambiguous-match`일 때만 있다 — 모델명이 걸린 SKU들
   * (`matchByModel`의 `ambiguousSkus`). 화면이 사람에게 고르게 하는
   * 선택지다. 후보가 없는 경우(`device-not-in-catalog`)는 비워 두고
   * 추측하지 않는다 — 화면이 카탈로그 검색으로 직접 찾게 한다.
   */
  candidates?: readonly string[];
  /**
   * 4단계 모델명 검색이 올린 후보의 **근거** — 어느 칸에서 어떤 글자가 맞았는지다
   * (계획 2026-10-06 §5·§6). `candidates`가 SKU만 담는 데 비해 이쪽은 판단 근거를
   * 담는다. 설명 칸에서만 맞은 후보는 *다른 제품의 부속품*일 수 있어서, 화면이
   * 그 사실을 사람에게 보여주지 않으면 본체로 잘못 연결된다.
   */
  modelSearchCandidates?: readonly ModelSearchCandidate[];
  /**
   * 옵션 카드 경고에만 있다. 옵션은 **optionId로 합쳐진다** — 같은
   * 노드의 본체 경고와 `nodeId`가 같을 수 있으므로, 이 값이 있으면
   * `nodeId` 대신 이 값으로 정확히 그 옵션 행을 찾아야 한다(본체 SKU
   * 선택이 옵션까지 바꿔 버리는 것을 막는다).
   */
  optionId?: string;
  /**
   * 설치 패널(배관)이 만든 경고에만 있다(`domain/quote/installation.ts`).
   * 이 값이 있으면 `onResolveDevice`의 일반 카탈로그 검색이 아니라
   * **그 시스템의 현재 배관 종류(`conduitType`)에 맞는 묶음으로 검증된
   * 해소 경로**(`onResolveConduit`)로 보내야 한다 — 아무 제품이나
   * 검색해 붙이면 CD관처럼 후보가 없는 차단을 우회하게 된다.
   */
  installationSystemId?: string;
}

export interface DeviceLine {
  sku?: string;
  name: string;
  specification: string;
  unit: string;
  quantity: DecimalText;
  /** 미등록이면 **없다**. `0`으로 채우지 않는다. */
  sellingUnitPrice?: DecimalText;
  /** 카탈로그 `options['description']`. 사람이 쓴 비고(`remark`)와 다른 칸이다. */
  internalDescription?: string;
  /**
   * 품셈 연결 id. 카탈로그 제품이 품셈을 갖고 있으면 그 SKU다.
   * 없으면 노무비를 **0으로 두지 않고** `unresolved`로 막는다.
   */
  laborMappingId?: string;
  /** 옵션 카드는 주 장비 아래 `- `로 붙는다 — 견적서 관행. */
  isAccessory: boolean;
  /** 합쳐진 노드 전부. 나중에 되돌릴 수 있게 남긴다. */
  sourceNodeIds: string[];
  /** 옵션 카드 행에만 있다 — `optionByKey`의 병합 키와 같다. */
  optionId?: string;
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

/** 카탈로그 제품 설명. 없거나 빈 문자열이면 칸 자체를 만들지 않는다. */
function descriptionOf(product: CatalogProduct | undefined): string | undefined {
  const description = product?.options['description'];
  return description !== undefined && description !== '' ? description : undefined;
}

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
          candidates: match.ambiguousSkus,
        });
      } else if (match.modelSearchCandidates !== undefined) {
        // 4단계가 찾은 후보다. **자동으로 붙이지 않고** 사람이 고르게 한다.
        warnings.push({
          code: 'device-not-in-catalog',
          blocking: true,
          message:
            `'${model || name}'과 정확히 일치하는 제품이 카탈로그에 없다. ` +
            `모델명이 들어 있는 제품 ${match.modelSearchCandidates.length}건을 후보로 올린다. ` +
            '어느 것인지 사람이 확인해야 한다.',
          nodeId: node.id,
          candidates: match.modelSearchCandidates.map((c) => c.sku),
          modelSearchCandidates: match.modelSearchCandidates,
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

    const deviceDescription = descriptionOf(match.product);
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
      ...(deviceDescription !== undefined ? { internalDescription: deviceDescription } : {}),
      ...(match.product?.laborMappingId !== undefined
        ? { laborMappingId: match.product.laborMappingId }
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
            optionId,
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
            optionId,
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
          message:
            optionMatch.modelSearchCandidates !== undefined
              ? `옵션 '${definition.model}'과 정확히 일치하는 제품이 카탈로그에 없다. ` +
                `모델명이 들어 있는 제품 ${optionMatch.modelSearchCandidates.length}건을 후보로 올린다.`
              : `옵션 '${definition.model}'이 카탈로그에 없다. 단가가 미등록이다.`,
          nodeId: node.id,
          optionId,
          ...(optionMatch.modelSearchCandidates !== undefined
            ? {
                candidates: optionMatch.modelSearchCandidates.map((c) => c.sku),
                modelSearchCandidates: optionMatch.modelSearchCandidates,
              }
            : {}),
        });
      } else if (optionMatch.sellingUnitPrice === undefined) {
        warnings.push({
          code: 'price-not-registered',
          blocking: true,
          message: `옵션 '${optionMatch.product.quoteName}'의 판매 단가가 미등록이다.`,
          nodeId: node.id,
          optionId,
        });
      }

      const optionDescription = descriptionOf(optionMatch.product);
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
          ...(optionDescription !== undefined ? { internalDescription: optionDescription } : {}),
          ...(optionMatch.product?.laborMappingId !== undefined
            ? { laborMappingId: optionMatch.product.laborMappingId }
            : {}),
          isAccessory: true,
          sourceNodeIds: [node.id],
          optionId,
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
