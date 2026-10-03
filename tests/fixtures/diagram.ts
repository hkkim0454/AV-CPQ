/**
 * 구성도 픽스처 빌더 (계획 2026-10-04).
 *
 * 모델명은 **실물 카탈로그에서 가져온 것**이다. 지어낸 모델명을 쓰면
 * 매칭 동작을 실제와 다르게 고정하게 된다.
 */
import type {
  DiagramEdge,
  DiagramFile,
  DiagramNode,
  DiagramNodeData,
  DiagramLineType,
} from '@/import/diagram/types';
import { buildCatalog, type Catalog, type CatalogProduct } from '@/data/catalog/load';

const SHA = 'a'.repeat(64);

export function catalogProduct(
  sku: string,
  quoteName: string,
  quoteSpec: string,
  unit = 'EA',
): CatalogProduct {
  return {
    productId: sku,
    sku,
    brand: '',
    model: quoteSpec,
    quoteName,
    quoteSpec,
    unit,
    options: {},
    currency: 'KRW',
    evidence: 'review-required',
  };
}

/**
 * 테스트용 카탈로그.
 *
 * `SRG-X40UH`는 **일부러 단가를 비워 뒀다** — 설계서 §5.6의 "미등록을 0으로
 * 처리하지 않는다"를 실제로 밟는 경로가 필요하다.
 */
export function cat(
  products: CatalogProduct[] = [
    catalogProduct('VID-0009', 'HD PTZ Camera', 'SRG-X40UH'),
    catalogProduct('VID-0138', 'UHD Matrix Frame', 'XDM-12'),
    catalogProduct('VID-0142', '- HDMI 4채널 output card', 'XDM-HOS100'),
    catalogProduct('TVD-0029', '삼성 98인치 LFD', 'LH98QMCEBGCXKR'),
  ],
  prices: Record<string, string> = { 'VID-0138': '5300000', 'VID-0142': '1900000' },
): Catalog {
  return buildCatalog(
    { schemaVersion: 1, generatedOn: '2026-10-04', sourceSha256: SHA, products },
    {
      schemaVersion: 1,
      generatedOn: '2026-10-04',
      sourceSha256: SHA,
      currency: 'KRW',
      prices: Object.fromEntries(
        Object.entries(prices).map(([sku, v]) => [
          sku,
          { sellingUnitPrice: v, currency: 'KRW' },
        ]),
      ),
    },
  );
}

export function node(
  id: string,
  name: string,
  model: string,
  extra: Partial<DiagramNodeData> = {},
): DiagramNode {
  return {
    id,
    type: 'equipment',
    data: { name, model, category: 'video', ...extra },
  };
}

export function edge(
  id: string,
  source: string,
  target: string,
  lineTypeId = 'video',
  data: Partial<NonNullable<DiagramEdge['data']>> = {},
): DiagramEdge {
  return { id, source, target, data: { lineTypeId, ...data } };
}

export const DEFAULT_LINE_TYPES: DiagramLineType[] = [
  { id: 'video', name: 'HDMI', color: '#ef4444' },
  { id: 'audio', name: 'A.AUDIO', color: '#a855f7' },
  { id: 'network', name: 'LAN', color: '#22c55e' },
  { id: 'sdi', name: 'SDI', color: '#374151' },
];

export function diagram(
  nodes: DiagramNode[],
  edges: DiagramEdge[] = [],
  lineTypes: DiagramLineType[] = DEFAULT_LINE_TYPES,
): DiagramFile {
  return { version: '1.1', nodes, edges, lineTypes };
}
