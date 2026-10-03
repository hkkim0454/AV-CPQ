/**
 * 제품 카탈로그와 판매단가 생성 (계획 Task 3, 결정 문서 D1·D3).
 *
 * **`products.json`과 `prices.json`을 분리한다.** `ProductVariant`에
 * `sellingUnitPrice`를 넣지 않는다 — 결정 D3가 "나중에 판매가를 가리자로 바뀌면
 * `prices.json`을 배포에서 빼기만 하면 된다"를 성립시키는 조건이다.
 * 한 파일에 섞으면 그 선택이 비가역이 된다.
 *
 * 설계서 §5.6: 단가 미등록을 0원으로 처리하지 않는다.
 * 가격 맵에 **키 자체가 없으면** 미등록이다. `0`은 명시적으로 입력된 유효한 값이다.
 */
import type { DecimalText, ProductVariant } from '../../domain/quote/types';
import type { RawSheet } from './rawTypes';
import { classifySheet } from './classifyRow';

/**
 * 시트 이름 → SKU 접두사.
 *
 * SKU를 품명이 아니라 **시트 + 원본 행 번호**로 만든다. 원본에는 품명·규격이
 * 완전히 같은 행이 연달아 있고(`DP to HDMI 변환젠더` 3행), 같은 품명이 여러 시트에
 * 걸치기도 한다. 품명 기반 SKU는 충돌해서 한쪽이 덮인다 (계획 Review Focus 3).
 *
 * 대가로 **원본 행이 밀리면 SKU가 바뀐다.** 품셈 파일이 개정되면 SKU 대조표가
 * 필요하다. 이건 알려진 한계이고 `docs/` 에 적어 둔다.
 */
const SHEET_CODES: Record<string, string> = {
  '케이블 및 커넥터': 'CBL',
  오디오: 'AUD',
  영상: 'VID',
  TV: 'TVD',
  'Head-End, CATV': 'HEC',
  제어: 'CTL',
  '전원, 랙, 판넬, 몰드 및 보양': 'PWR',
  화상회의: 'VCF',
  '프로젝터,스크린': 'PRJ',
  CMS: 'CMS',
  CCTV: 'CCT',
  '기타 유통제품': 'ETC',
};

/** 모르는 시트도 결정적인 3글자 코드를 받는다. */
function fallbackCode(sheetName: string): string {
  let hash = 0;
  for (const ch of sheetName) {
    hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  let value = hash;
  for (let i = 0; i < 3; i += 1) {
    out += alphabet[value % alphabet.length];
    value = Math.floor(value / alphabet.length);
  }
  return out;
}

export function sheetCode(sheetName: string): string {
  return SHEET_CODES[sheetName] ?? fallbackCode(sheetName);
}

export function makeSku(sheetName: string, row: number): string {
  return `${sheetCode(sheetName)}-${String(row).padStart(4, '0')}`;
}

export interface PriceEntry {
  sellingUnitPrice: DecimalText;
  currency: 'KRW';
}

/** SKU → 판매단가. 미등록 제품은 **키가 없다**. */
export type PriceMap = Record<string, PriceEntry>;

export interface BuildStats {
  totalProducts: number;
  totalPriced: number;
  totalWithLaborCode: number;
  bySheet: Record<string, { products: number; priced: number; withLaborCode: number }>;
  duplicateSkus: string[];
}

export interface BuildProductsResult {
  products: ProductVariant[];
  prices: PriceMap;
  stats: BuildStats;
}

export function buildProducts(sheets: readonly RawSheet[]): BuildProductsResult {
  const products: ProductVariant[] = [];
  const prices: PriceMap = {};
  const bySheet: BuildStats['bySheet'] = {};
  const seen = new Set<string>();
  const duplicateSkus: string[] = [];

  for (const sheet of sheets) {
    const classified = classifySheet(sheet.name, sheet.rows);
    let priced = 0;
    let withLaborCode = 0;

    for (const product of classified.products) {
      const sku = makeSku(sheet.name, product.row);
      if (seen.has(sku)) {
        duplicateSkus.push(sku);
      }
      seen.add(sku);

      const options: Record<string, string> = {
        sheet: sheet.name,
        category: product.category,
        sourceRow: String(product.row),
      };
      if (product.group !== undefined) options['group'] = product.group;
      if (product.description !== undefined) options['description'] = product.description;
      if (product.derivedPricing === true) options['pricing'] = 'derived';

      products.push({
        productId: sku,
        sku,
        // 원본에 브랜드 열이 없다. B열 머리글은 품목 그룹이지 브랜드가 아니므로
        // 브랜드로 해석하지 않는다 (추측 금지). `options.group`에 원문을 남긴다.
        brand: '',
        model: product.spec ?? '',
        quoteName: product.label ?? '',
        quoteSpec: product.spec ?? '',
        unit: product.unit ?? '',
        options,
        currency: 'KRW',
        ...(product.laborCode !== undefined ? { laborMappingId: sku } : {}),
        // 자동 추출이다. 사람이 확인하기 전까지 `verified`로 올리지 않는다
        // (설계서 §5.3, §7.5).
        evidence: 'review-required',
      });

      // 파생 단가 제품에는 고정 단가를 붙이지 않는다 — 견적 시점에 계산된다.
      if (product.sellingUnitPrice !== undefined && product.derivedPricing !== true) {
        prices[sku] = { sellingUnitPrice: product.sellingUnitPrice, currency: 'KRW' };
        priced += 1;
      }
      if (product.laborCode !== undefined) withLaborCode += 1;
    }

    bySheet[sheet.name] = {
      products: classified.products.length,
      priced,
      withLaborCode,
    };
  }

  return {
    products,
    prices,
    stats: {
      totalProducts: products.length,
      totalPriced: Object.keys(prices).length,
      totalWithLaborCode: Object.values(bySheet).reduce((s, v) => s + v.withLaborCode, 0),
      bySheet,
      duplicateSkus,
    },
  };
}
