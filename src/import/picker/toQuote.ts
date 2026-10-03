/**
 * 품목 직접 선택 → `QuoteDocument` (결정 D7 보강).
 *
 * 사용자 지시:
 *
 * > 아주 간단한 견적은 — 예를 들어 PC 하고 프로젝터 설치. PC, 프로젝터, 그 사이를
 * > 연결하는 HDBaseT 전송기 또는 HDMI 케이블만 필요한데, 이런 견적은 그냥 이 견적서
 * > 구성기에서도 가능하게끔 돼야 돼. **꼭 구성도가 있어야지만 만들 수 있는 게 아니라.**
 *
 * D7 원안("아이템 선정은 실수가 많다")과 모순이 아니다. 그건 **복잡한 견적**에 대한
 * 말이었다. 서너 줄짜리에 구성도를 그리는 건 오히려 번거롭고 빠뜨릴 것도 없다.
 *
 * **조립은 `buildQuoteDocument`가 한다.** 구성도 경로와 같은 함수다 —
 * 그래야 두 입구가 같은 문서 모양으로 모이고, 한쪽만 고쳐져 달라지지 않는다.
 */
import type { DecimalText, QuoteDocument, QuoteHeader } from '../../domain/quote/types';
import {
  buildQuoteDocument,
  type QuoteLineInput,
  type QuoteSystemInput,
} from '../../domain/quote/buildDocument';
import type { Catalog } from '../../data/catalog/load';
import type { ImportWarning } from '../diagram/devices';

/** 사용자가 고른 품목 하나. */
export interface PickedItem {
  sku: string;
  quantity: DecimalText;
  /** 비워 두면 카탈로그 단위를 쓴다. */
  unit?: string;
  remark?: string;
  /** 카탈로그 품명을 바꿔 쓰고 싶을 때. 비워 두면 카탈로그 그대로. */
  nameOverride?: string;
  /** 딸림 항목으로 `- `를 붙일지. */
  isAccessory?: boolean;
}

export interface PickedSystem {
  name: string;
  summarySpec?: string;
  quantity?: DecimalText;
  items: PickedItem[];
}

export interface PickerOptions {
  header: QuoteHeader;
  systems: PickedSystem[];
  negoDeduction?: DecimalText;
}

export interface PickerResult {
  document: QuoteDocument;
  warnings: ImportWarning[];
  blocking: boolean;
}

export function pickedItemsToQuote(
  options: PickerOptions,
  catalog: Catalog,
): PickerResult {
  const warnings: ImportWarning[] = [];
  const bySku = new Map(catalog.products.map((p) => [p.sku, p]));

  const systems: QuoteSystemInput[] = options.systems.map((system) => {
    const lines: QuoteLineInput[] = [];

    for (const item of system.items) {
      const product = bySku.get(item.sku);

      if (product === undefined) {
        // 고른 SKU가 카탈로그에 없다. 행은 만들고 막는다 —
        // 사용자가 고른 품목이 조용히 사라지면 안 된다.
        warnings.push({
          code: 'device-not-in-catalog',
          blocking: true,
          message: `선택한 SKU '${item.sku}'가 카탈로그에 없다. 단가가 미등록이다.`,
        });
        lines.push({
          sku: item.sku,
          name: item.nameOverride ?? item.sku,
          specification: '',
          unit: item.unit ?? 'EA',
          quantity: item.quantity,
          ...(item.isAccessory === true ? { isAccessory: true } : {}),
          remark: item.remark ?? '직접 선택 — 카탈로그 미등록. 확인 필요',
        });
        continue;
      }

      const price = catalog.prices.get(item.sku);
      if (price === undefined) {
        warnings.push({
          code: 'price-not-registered',
          blocking: true,
          message: `'${product.quoteName}'의 판매 단가가 미등록이다.`,
        });
      }

      lines.push({
        sku: product.sku,
        name: item.nameOverride ?? product.quoteName,
        specification: product.quoteSpec,
        unit: item.unit ?? product.unit,
        quantity: item.quantity,
        // 미등록 단가는 **넣지 않는다**. `0`으로 채우면 설계서 §5.6 위반이다.
        ...(price !== undefined ? { sellingUnitPrice: price } : {}),
        // 품셈이 없으면 넣지 않는다 → `buildQuoteDocument`가 `unresolved`로 막는다.
        // `not-applicable`로 두면 간접비까지 0이 된다.
        ...(product.laborMappingId !== undefined
          ? { laborMappingId: product.laborMappingId }
          : {}),
        ...(item.isAccessory === true ? { isAccessory: true } : {}),
        remark: item.remark ?? '직접 선택',
      });
    }

    return {
      name: system.name,
      ...(system.summarySpec !== undefined ? { summarySpec: system.summarySpec } : {}),
      ...(system.quantity !== undefined ? { quantity: system.quantity } : {}),
      lines,
    };
  });

  const document = buildQuoteDocument({
    header: options.header,
    systems,
    ...(options.negoDeduction !== undefined
      ? { negoDeduction: options.negoDeduction }
      : {}),
    documentId: `picked-${options.header.quoteNumber}`,
    rowIdPrefix: 'pk',
    versions: {
      catalog: catalog.sourceSha256,
      labor: catalog.sourceSha256,
      wage: catalog.sourceSha256,
      rule: 'manual-pick',
    },
  });

  return { document, warnings, blocking: warnings.some((w) => w.blocking) };
}
