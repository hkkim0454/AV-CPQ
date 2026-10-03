/**
 * 실제 카탈로그 품명으로 만든 견적 — 다페이지 재확인용 (열린 항목 O2b).
 *
 * 합성 품명으로는 통과했지만 실제 품명은 다르게 생겼다.
 * `data/approved/products.json`에서 **가장 불리한 품목**을 골라 쓴다.
 *
 *   - B열 너비(28.625)를 넘는 긴 품명 (최대 폭 67)
 *   - 규격까지 긴 것 — B만 긴 경우와 열 폭 압박이 다르다
 *   - 괄호·쉼표·`+`·연속 공백이 섞인 것
 *   - 영문+한글 혼용 — 줄바꿈 지점이 다르다
 *   - **셀 안에 줄바꿈이 든 것** — 고정 행 높이에서 잘릴 수 있다
 *
 * 가격은 `prices.json`에서 읽는다. 이것은 회사 판매가지만 결정 D3으로
 * 배포가 승인된 데이터이고, 테스트는 금액을 출력하지 않는다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { DecimalText, QuoteDocument, SheetRow } from '@/domain/quote/types';
import { standardIndirectCosts } from './syntheticQuote';

const ROOT = resolve(__dirname, '../..');

interface CatalogProduct {
  sku: string;
  quoteName: string;
  quoteSpec: string;
  unit: string;
  options: Record<string, string>;
}

function loadCatalog(): { products: CatalogProduct[]; prices: Record<string, { sellingUnitPrice: DecimalText }> } {
  const products = JSON.parse(
    readFileSync(resolve(ROOT, 'data/approved/products.json'), 'utf8'),
  ).products as CatalogProduct[];
  const prices = JSON.parse(
    readFileSync(resolve(ROOT, 'data/approved/prices.json'), 'utf8'),
  ).prices as Record<string, { sellingUnitPrice: DecimalText }>;
  return { products, prices };
}

/** Excel 열 너비 근사 — 한글·전각은 2칸, 그 외 1칸. */
export function displayWidth(text: string): number {
  let total = 0;
  for (const ch of text) {
    total += ch.codePointAt(0)! > 0x1100 && !/[\x00-\x7F]/.test(ch) ? 2 : 1;
  }
  return total;
}

export interface WorstCaseSelection {
  /** 가장 불리한 품목들. 선정 근거와 함께. */
  picks: Array<{ product: CatalogProduct; reason: string }>;
  totalProducts: number;
}

/** 열 폭·줄바꿈·문자 혼용이 가장 불리한 품목을 고른다. */
export function selectWorstCase(limit = 12): WorstCaseSelection {
  const { products } = loadCatalog();
  const picks: Array<{ product: CatalogProduct; reason: string }> = [];
  const taken = new Set<string>();

  const add = (list: CatalogProduct[], reason: string, count: number): void => {
    for (const product of list) {
      if (picks.length >= limit) return;
      if (taken.has(product.sku)) continue;
      taken.add(product.sku);
      picks.push({ product, reason });
      if (picks.filter((p) => p.reason === reason).length >= count) return;
    }
  };

  const byName = [...products].sort(
    (a, b) => displayWidth(b.quoteName) - displayWidth(a.quoteName),
  );
  const byBoth = [...products].sort(
    (a, b) =>
      displayWidth(b.quoteName) + displayWidth(b.quoteSpec) -
      (displayWidth(a.quoteName) + displayWidth(a.quoteSpec)),
  );
  const withBreaks = products.filter(
    (p) => p.quoteName.includes('\n') || p.quoteSpec.includes('\n'),
  );
  const withSpecials = products.filter((p) => /\s{2,}|[+,()/&%㎡㎜·×]/.test(p.quoteName));
  const mixed = products.filter(
    (p) =>
      (p.quoteName.match(/[A-Za-z]/g) ?? []).length >= 4 &&
      (p.quoteName.match(/[가-힣]/g) ?? []).length >= 4,
  );

  add(withBreaks, '셀 안 줄바꿈', 3);
  add(byName, '품명 폭 최대', 3);
  add(byBoth, '품명+규격 둘 다 긺', 2);
  add(withSpecials, '괄호·쉼표·연속공백', 2);
  add(mixed, '영문+한글 혼용', 2);

  return { picks, totalProducts: products.length };
}

/**
 * 실제 카탈로그 품명으로 채운 다페이지 견적.
 *
 * 불리한 품목을 앞에 두고, 나머지는 카탈로그 순서대로 채워 `itemCount`행을 만든다.
 */
export function catalogQuote(itemCount = 100): QuoteDocument {
  const { products, prices } = loadCatalog();
  const worst = selectWorstCase(12);

  const chosen: CatalogProduct[] = worst.picks.map((p) => p.product);
  const takenSkus = new Set(chosen.map((p) => p.sku));
  for (const product of products) {
    if (chosen.length >= itemCount) break;
    if (takenSkus.has(product.sku)) continue;
    chosen.push(product);
    takenSkus.add(product.sku);
  }

  const rows: SheetRow[] = [
    { type: 'display', rowId: 'g1', systemId: 'C1', kind: 'group', name: '[ 실제 품명 다페이지 검증 ]' },
  ];

  chosen.forEach((product, index) => {
    if (index > 0 && index % 25 === 0) {
      rows.push({
        type: 'display',
        rowId: `sg${index}`,
        systemId: 'C1',
        kind: 'subgroup',
        name: product.options['group'] ?? `소그룹 ${index / 25}`,
      });
    }
    const price = prices[product.sku]?.sellingUnitPrice;
    rows.push({
      type: 'item',
      rowId: `c${index}`,
      systemId: 'C1',
      sku: product.sku,
      name: product.quoteName,
      specification: product.quoteSpec,
      unit: product.unit,
      quantity: String((index % 7) + 1),
      // 단가가 없는 제품은 미등록으로 둔다 — 0으로 바꾸지 않는다 (설계서 §5.6).
      ...(price !== undefined ? { sellingUnitPrice: price } : {}),
      laborMode: 'not-applicable',
      remark: index % 13 === 0 ? '현장 확인 필요 — 반입 동선과 사다리차 조건 검토' : '',
      origin: 'manual',
    });
  });

  return {
    schemaVersion: 1,
    documentId: 'catalog-long',
    mode: 'material-and-labor',
    header: {
      quoteNumber: 'CAT-260826-01',
      quoteDate: '2026-08-26',
      customer: '합성 고객사',
      projectName: '실제 품명 다페이지 검증 공사',
      contact: '합성 담당자',
      conditions: [' - 합성 조건 1', ' - 합성 조건 2'],
    },
    coverGroups: [{ groupId: 'g1', marker: 'Ⅰ', name: '합성 현장', systemIds: ['C1'] }],
    systems: [
      {
        systemId: 'C1',
        name: '실제 품명 시스템',
        summarySpec: `카탈로그 품목 ${itemCount}행`,
        unit: '식',
        quantity: '1',
        remark: '',
        indirectCosts: standardIndirectCosts(),
      },
    ],
    rows,
    derivedRows: [],
    negoDeduction: '0',
    rounding: { coverTotalDigits: -4 },
    versions: {
      catalog: 'approved-2026-10-03',
      labor: 'approved-2026-10-03',
      wage: 'approved-2026-10-03',
      template: 'sanitized-2026-10-03',
      rule: 'none',
    },
    equipment: [],
    connections: [],
    existingSupplies: [],
  };
}
