/**
 * 커넥터와 배관 (계획 2026-10-04 Task 5, 결정 D8 규칙 2·3).
 *
 * ## 커넥터 — 구간당 3개, 10EA 묶음
 *
 * 한 구간에 커넥터 2개(양끝)가 들어가고 **예비 1개**를 더한다.
 * 사용자가 준 규칙이고, 평택 견적서로 역산해 검산했다 — 구간 수가 깔끔히 떨어진다.
 *
 * **벌크 케이블에만 붙인다.** 완제품 HDMI는 커넥터가 달려 나온다.
 * 판단은 `lineTypeId`가 아니라 **단위가 벌크인지**로 한다 — 선 종류는 사용자가
 * 추가할 수 있어서 목록으로 막으면 새 종류가 빠진다.
 *
 * ## 배관 — 공간 1개당 50m 고정
 *
 * 원래 "총 케이블 거리의 60%"였는데, 실측해 보니 10~61%로 흩어져 규칙이 아니었다.
 * 사용자에게 되물어 **공간당 50m 고정**으로 확정했다. 60% 규칙은 폐기됐다.
 *
 * 그래서 **케이블 길이와 무관하다.** 케이블이 아무리 많아도 배관은 공간 수로만 정해진다.
 */
import type { DecimalText } from '../../domain/quote/types';
import type { Catalog } from '../../data/catalog/load';
import { matchByModel } from './matchCatalog';
import type { DeviceLine, ImportWarning } from './devices';
import type { CableLine } from './cables';
import { BULK_UNIT_METERS } from './cables';

/** 한 구간에 들어가는 커넥터 수 — 사용 2 + 예비 1. */
export const CONNECTORS_PER_SEGMENT = 3;
/** 커넥터 판매 묶음. */
export const CONNECTOR_PACK = 10;
/** 공간 1개당 배관 길이(m). */
export const CONDUIT_METERS_PER_SYSTEM = 50;
/** 배관 판매 묶음(m). */
export const CONDUIT_PACK_METERS = 10;

/** 구성도가 제품을 지정하지 않았을 때 쓰는 기본 품명. 카탈로그에서 찾아본다. */
const DEFAULT_CONNECTOR_MODEL = 'CAT6 UTP용';
const DEFAULT_CONDUIT_MODEL = '28㎜_SF-28';

/** 구간 수 → 10EA 묶음 개수. */
export function connectorPacks(segmentCount: number): number {
  if (segmentCount <= 0) return 0;
  return Math.ceil((segmentCount * CONNECTORS_PER_SEGMENT) / CONNECTOR_PACK);
}

/** 공간 수 → 10M 묶음 개수. */
export function conduitPacks(systemCount: number): number {
  if (systemCount <= 0) return 0;
  return (systemCount * CONDUIT_METERS_PER_SYSTEM) / CONDUIT_PACK_METERS;
}

export interface BuildDerivedLinesResult {
  lines: DeviceLine[];
  warnings: ImportWarning[];
}

function isBulkLine(line: CableLine): boolean {
  return line.unit === `${BULK_UNIT_METERS}M`;
}

function makeLine(
  catalog: Catalog,
  model: string,
  fallbackName: string,
  unit: string,
  quantity: DecimalText,
  specification: string,
): { line: DeviceLine; found: boolean } {
  const match = matchByModel(model, catalog);
  return {
    found: match.product !== undefined,
    line: {
      ...(match.product !== undefined ? { sku: match.product.sku } : {}),
      name: match.product?.quoteName ?? fallbackName,
      specification: match.product?.quoteSpec ?? specification,
      unit,
      quantity,
      ...(match.sellingUnitPrice !== undefined
        ? { sellingUnitPrice: match.sellingUnitPrice }
        : {}),
      ...(match.product?.laborMappingId !== undefined
        ? { laborMappingId: match.product.laborMappingId }
        : {}),
      isAccessory: true,
      sourceNodeIds: [],
      matchedBy: match.matchedBy,
    },
  };
}

/**
 * 케이블 행과 공간 수에서 커넥터·배관 행을 만든다.
 *
 * @param systemCount 공간(시스템) 수. 배관은 이 값만으로 정해진다.
 */
export function buildDerivedLines(
  cables: readonly CableLine[],
  systemCount: number,
  catalog: Catalog,
): BuildDerivedLinesResult {
  const lines: DeviceLine[] = [];
  const warnings: ImportWarning[] = [];

  // --- 커넥터: 벌크 케이블 구간 수의 합 ---
  const bulkSegments = cables
    .filter(isBulkLine)
    .reduce((sum, line) => sum + line.segmentCount, 0);

  const packs = connectorPacks(bulkSegments);
  if (packs > 0) {
    const { line, found } = makeLine(
      catalog,
      DEFAULT_CONNECTOR_MODEL,
      'Pass Through RJ45 Connector',
      `${CONNECTOR_PACK}EA`,
      String(packs),
      DEFAULT_CONNECTOR_MODEL,
    );
    // 사람이 검산할 수 있게 근거를 남긴다.
    line.specification = `${line.specification} (${bulkSegments}구간 × ${CONNECTORS_PER_SEGMENT}개)`;
    lines.push(line);
    if (!found) {
      warnings.push({
        code: 'device-not-in-catalog',
        blocking: true,
        message: `커넥터 '${DEFAULT_CONNECTOR_MODEL}'을 카탈로그에서 찾을 수 없다. 단가가 미등록이다.`,
      });
    }
  }

  // --- 배관: 공간 수 × 50m. 케이블 길이와 무관하다 ---
  const conduit = conduitPacks(systemCount);
  if (conduit > 0) {
    const { line, found } = makeLine(
      catalog,
      DEFAULT_CONDUIT_MODEL,
      'Flexible Conduit (고장력,비방수)',
      `${CONDUIT_PACK_METERS}M`,
      String(conduit),
      DEFAULT_CONDUIT_MODEL,
    );
    line.specification = `${line.specification} (공간 ${systemCount}개 × ${CONDUIT_METERS_PER_SYSTEM}m)`;
    lines.push(line);
    if (!found) {
      warnings.push({
        code: 'device-not-in-catalog',
        blocking: true,
        message: `배관 '${DEFAULT_CONDUIT_MODEL}'을 카탈로그에서 찾을 수 없다. 단가가 미등록이다.`,
      });
    }
  }

  return { lines, warnings };
}
