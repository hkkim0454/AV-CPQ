/**
 * 구성도 연결선 → 케이블 행 (계획 2026-10-04 Task 4, 결정 D8 규칙 1).
 *
 * ## 완제품과 벌크를 다르게 센다 (설계서 §7.4)
 *
 * **완제품**은 구간당 한 벌이다. `HDMI 5m` 두 구간은 **2EA**지 10EA가 아니다.
 * 길이는 판매되는 계단(`1·2·3·5·7·10·15·20m`)으로 **올린다**.
 *
 * **벌크**는 길이를 합산한 뒤 10M 단위로 올린다. `12m + 15m = 27m → 10M × 3`.
 *
 * ## 선은 있는데 케이블 품목이 없으면
 *
 * 실물 샘플이 그렇다 — `edges[].data.bomRows`가 전부 비어 있다.
 * 선을 무시하면 **케이블 없는 견적**이 나간다. 선 종류별로 행을 만들되
 * 수량을 비우고 확정을 막는다 (설계서 §7.5).
 *
 * ## 구간 거리(`RouteInput`) — 있으면 쓰고, 없으면 기존 그대로다
 *
 * `routes`(edgeId → `RouteInput`)는 설치 패널에서 사람이 입력한 실측
 * 거리다(`domain/quote/installation.ts`의 `calcRouteMeters` — 결정
 * D8: measured-route는 `(수평+입상+입하)×1.3`, confirmed-total은
 * 재보정 없이 그대로). 아직 입력하지 않은 구간은 이 맵에 없고, 그
 * 구간은 지금처럼 `bomRows[].length`(원본 값, 실물 샘플에서는 거의
 * 늘 비어 있다)를 그대로 쓴다 — **경로 입력이 없다고 제품 길이로
 * 거리를 역산하지 않는다.**
 *
 * 경로 거리가 있으면:
 * - **벌크**는 그 거리를 합산에 쓴다(보정 전 원본 길이 대신).
 * - **완제품**은 그 거리로 다시 계단을 구하고, **원래 맞은 제품과 같은
 *   품셈 묶음(`options.group`)에서 그 계단 길이의 SKU를 다시 찾는다.**
 *   `BOM.length`(제품 규격)는 바꾸지 않는다 — 찾아낸 제품의 SKU·규격·
 *   가격을 통째로 쓴다. 그 길이의 제품을 묶음에서 찾지 못하면 **확인
 *   필요로 남긴다** — 기존 SKU에 새 길이 글자만 붙이지 않는다.
 */
import type { DecimalText } from '../../domain/quote/types';
import type { Catalog, CatalogProduct } from '../../data/catalog/load';
import { Decimal, dec, text } from '../../domain/calculation/rounding';
import { matchByModel, type MatchResult } from './matchCatalog';
import { calcRouteMeters, type RouteInput } from '../../domain/quote/installation';
import type { ImportWarning } from './devices';
import type { DiagramBomRow, DiagramFile } from './types';

/** 판매되는 완제품 케이블 길이(m). 품셈 파일에서 실제로 쓰인 모델에서 뽑았다. */
export const READY_MADE_STEPS = [1, 2, 3, 5, 7, 10, 15, 20] as const;

/** 벌크 케이블의 판매 단위(m). */
export const BULK_UNIT_METERS = 10;

/**
 * 완제품 길이를 계단으로 **올린다**.
 *
 * 내리면 케이블이 모자란다. 현장에서 모자란 것보다 남는 편이 낫다.
 * 가장 큰 계단을 넘으면 그 계단을 돌려주고, **경고는 호출부가 세운다** —
 * 20m를 넘는 구간은 완제품이 아니라 제작 케이블로 가야 한다.
 */
export function snapToStep(meters: number): number {
  for (const step of READY_MADE_STEPS) {
    if (meters <= step) return step;
  }
  return READY_MADE_STEPS[READY_MADE_STEPS.length - 1]!;
}

/** 벌크 길이를 10M 묶음 개수로 올린다. */
export function bulkUnits(meters: number): number {
  if (meters <= 0) return 0;
  return Math.ceil(meters / BULK_UNIT_METERS);
}

export interface CableLine {
  sku?: string;
  name: string;
  specification: string;
  /** `EA`(완제품) 또는 `10M`(벌크). */
  unit: string;
  /** 정하지 못했으면 **없다**. `0`으로 채우지 않는다. */
  quantity?: DecimalText;
  sellingUnitPrice?: DecimalText;
  /** 품셈 연결 id. 케이블에도 설치 노무비가 붙는다. */
  laborMappingId?: string;
  /** 몇 개 구간에서 왔는지. 커넥터 계산의 입력이다 (D8 규칙 2). */
  segmentCount: number;
  lineTypeId: string;
  /** 합쳐진 연결선 전부. */
  sourceEdgeIds: string[];
  /** 벌크일 때 합산 전 실제 길이(m). 사람이 검토할 근거. */
  totalMeters?: DecimalText;
}

export interface BuildCableLinesResult {
  lines: CableLine[];
  warnings: ImportWarning[];
}

interface Accumulator {
  line: CableLine;
  /** 완제품이면 개수, 벌크면 미터. */
  amount: Decimal;
  edges: Set<string>;
}

/** `cableType`이 없으면 완제품으로 본다 — 길이를 합산하지 않는 쪽이 안전하다. */
function isBulk(row: DiagramBomRow): boolean {
  return row.cableType === 'manufactured';
}

function toNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** `quoteSpec`/`quoteName`에서 `…1M`/`…1m` 꼴의 길이 토큰을 읽는다. */
const LENGTH_TOKEN = /(\d+(?:\.\d+)?)\s*[Mm]\b/;

function lengthOf(product: CatalogProduct): number | undefined {
  const found = LENGTH_TOKEN.exec(product.quoteSpec) ?? LENGTH_TOKEN.exec(product.quoteName);
  return found !== null ? Number(found[1]) : undefined;
}

/**
 * 원래 맞은 제품과 **같은 품셈 묶음**에서 `step`(m) 길이의 제품을
 * 찾는다. 묶음이 없거나(원래부터 미매칭) 그 길이의 제품이 묶음에
 * 없으면 `undefined` — 호출부가 확인 필요로 남긴다.
 */
export function findReadyMadeAtStep(
  catalog: Catalog,
  original: CatalogProduct | undefined,
  step: number,
): CatalogProduct | undefined {
  const group = original?.options['group'];
  if (group === undefined) return undefined;
  return catalog.products.find((p) => p.options['group'] === group && lengthOf(p) === step);
}

function matchFor(product: CatalogProduct | undefined, catalog: Catalog): MatchResult {
  if (product === undefined) return { matchedBy: 'none' };
  const price = catalog.prices.get(product.sku);
  return { product, ...(price !== undefined ? { sellingUnitPrice: price } : {}), matchedBy: 'model-fragment' };
}

export function buildCableLines(
  diagram: DiagramFile,
  catalog: Catalog,
  routes: ReadonlyMap<string, RouteInput> = new Map(),
): BuildCableLinesResult {
  const warnings: ImportWarning[] = [];
  const lines: CableLine[] = [];
  const byKey = new Map<string, Accumulator>();

  const knownLineTypes = new Set(diagram.lineTypes.map((l) => l.id));
  const lineTypeName = new Map(diagram.lineTypes.map((l) => [l.id, l.name]));
  const reportedUnknown = new Set<string>();

  const push = (key: string, line: CableLine, amount: number, edgeId: string): void => {
    const existing = byKey.get(key);
    if (existing === undefined) {
      const accumulator: Accumulator = {
        line,
        amount: dec(String(amount)),
        edges: new Set([edgeId]),
      };
      byKey.set(key, accumulator);
      lines.push(line);
      return;
    }
    existing.amount = existing.amount.plus(dec(String(amount)));
    existing.edges.add(edgeId);
    existing.line.sourceEdgeIds = [...existing.edges];
  };

  for (const edge of diagram.edges) {
    const lineTypeId = edge.data?.lineTypeId ?? '';

    if (lineTypeId !== '' && !knownLineTypes.has(lineTypeId)) {
      // 사용자가 선 종류를 추가할 수 있다. 하드코딩한 목록으로 막지 않는다.
      if (!reportedUnknown.has(lineTypeId)) {
        reportedUnknown.add(lineTypeId);
        warnings.push({
          code: 'unknown-line-type',
          blocking: false,
          message: `선 종류 '${lineTypeId}'를 구성도의 lineTypes에서 찾을 수 없다.`,
          edgeId: edge.id,
        });
      }
    }

    const rows = edge.data?.bomRows ?? [];
    if (rows.length === 0) {
      // 선은 그어져 있는데 케이블 품목이 없다. 무시하면 케이블 없는 견적이 나간다.
      const label = lineTypeName.get(lineTypeId) ?? lineTypeId ?? '미상';
      const key = `unresolved:${lineTypeId}`;
      const existing = byKey.get(key);
      if (existing === undefined) {
        const line: CableLine = {
          name: `${label} 케이블 (품목 미정)`,
          specification: '구성도에 케이블 품목이 지정되지 않았다',
          unit: 'EA',
          segmentCount: 1,
          lineTypeId,
          sourceEdgeIds: [edge.id],
        };
        byKey.set(key, { line, amount: new Decimal(0), edges: new Set([edge.id]) });
        lines.push(line);
      } else {
        existing.edges.add(edge.id);
        existing.line.sourceEdgeIds = [...existing.edges];
        existing.line.segmentCount = existing.edges.size;
      }
      warnings.push({
        code: 'cable-item-unresolved',
        blocking: true,
        message:
          `'${label}' 연결선에 케이블 품목이 지정되지 않았다. ` +
          '행은 만들었으나 수량을 정할 수 없다.',
        edgeId: edge.id,
      });
      continue;
    }

    // 이 구간의 실측 거리 — 아직 입력 안 했으면 undefined(기존 bomRow
    // 길이를 그대로 쓴다). source별 계산(D8)은 calcRouteMeters가 한다.
    const route = routes.get(edge.id);
    const routeMeters = route !== undefined ? calcRouteMeters(route) : undefined;

    for (const row of rows) {
      const productName = row.productName?.trim() ?? '';
      if (productName === '') continue;

      const originalMatch = matchByModel(productName, catalog);
      const bulk = isBulk(row);
      const count = toNumber(row.quantity, 1);
      const meters = routeMeters !== undefined ? Number(routeMeters) : toNumber(row.length, 0);

      // 완제품이고 실측 거리가 있으면, 원래 맞은 제품의 품셈 묶음에서
      // 그 거리에 맞는 계단 길이의 SKU를 다시 찾는다. BOM.length(제품
      // 규격)는 바꾸지 않는다 — 찾아낸 제품의 SKU·규격·가격을 통째로
      // 쓰거나, 못 찾으면 확인 필요로 남긴다(기존 SKU에 새 길이
      // 글자만 붙이지 않는다).
      const reroutedProduct =
        !bulk && routeMeters !== undefined
          ? findReadyMadeAtStep(catalog, originalMatch.product, snapToStep(meters))
          : undefined;
      const rerouted = !bulk && routeMeters !== undefined;
      const match = rerouted ? matchFor(reroutedProduct, catalog) : originalMatch;

      if (rerouted && reroutedProduct === undefined) {
        warnings.push({
          code: 'cable-item-unresolved',
          blocking: true,
          message:
            `'${productName}' 구간의 실측 거리(${routeMeters}m → ${snapToStep(meters)}m 계단)에 맞는 ` +
            '제품을 같은 묶음에서 찾지 못했다. 품목을 다시 확인해야 한다.',
          edgeId: edge.id,
        });
      }

      // 완제품은 **길이가 다르면 다른 품목이다.** 길이를 키에서 빼면
      // 3m 구간과 15m 구간이 한 행으로 합쳐지고, 먼저 온 쪽 길이가 남아
      // 15m 자리에 3m 케이블이 나간다. 현장에서 모자라고 경고도 없다.
      const key = bulk ? `bulk:${productName}` : `ready:${productName}:${snapToStep(meters)}`;
      const line: CableLine = {
        ...(match.product !== undefined ? { sku: match.product.sku } : {}),
        name: match.product?.quoteName ?? productName,
        specification: match.product?.quoteSpec ?? (bulk ? '' : `${snapToStep(meters)}m`),
        unit: bulk ? `${BULK_UNIT_METERS}M` : 'EA',
        ...(match.sellingUnitPrice !== undefined
          ? { sellingUnitPrice: match.sellingUnitPrice }
          : {}),
        ...(match.product?.laborMappingId !== undefined
          ? { laborMappingId: match.product.laborMappingId }
          : {}),
        segmentCount: 1,
        lineTypeId,
        sourceEdgeIds: [edge.id],
      };

      if (!bulk && meters > READY_MADE_STEPS[READY_MADE_STEPS.length - 1]!) {
        warnings.push({
          code: 'cable-item-unresolved',
          blocking: true,
          message:
            `'${productName}' 구간이 ${meters}m다. 완제품 최대 길이 ` +
            `${READY_MADE_STEPS[READY_MADE_STEPS.length - 1]}m를 넘는다. 제작 케이블로 바꿔야 한다.`,
          edgeId: edge.id,
        });
      }

      if (bulk && meters <= 0) {
        // 벌크는 길이가 곧 수량이다. 길이가 없으면 `0`이 되어 케이블이
        // 조용히 사라진다 — 금액도 0원이고 아무 표시도 남지 않는다.
        warnings.push({
          code: 'cable-length-missing',
          blocking: true,
          message:
            `'${productName}'은 벌크 케이블인데 구간 길이가 없다. ` +
            '길이를 넣어야 수량을 정할 수 있다.',
          edgeId: edge.id,
        });
      }

      // 완제품은 개수를, 벌크는 미터를 쌓는다.
      push(key, line, bulk ? meters * count : count, edge.id);
    }
  }

  // 쌓은 양을 수량으로 바꾼다.
  for (const [, accumulator] of byKey) {
    const { line, amount, edges } = accumulator;
    line.segmentCount = edges.size;
    line.sourceEdgeIds = [...edges];

    if (line.name.includes('(품목 미정)')) continue; // 수량을 비워 둔다

    if (line.unit === `${BULK_UNIT_METERS}M`) {
      line.totalMeters = text(amount);
      // 길이를 못 구했으면 **수량을 비운다.** `0`은 계산 엔진이 유효한 값으로
      // 보고 0원짜리 행을 만든다. 경고는 위에서 이미 세웠다.
      if (amount.greaterThan(0)) {
        line.quantity = String(bulkUnits(amount.toNumber()));
      }
    } else {
      line.quantity = text(amount);
    }
  }

  return { lines, warnings };
}
