/**
 * 배포 데이터의 런타임 검증 스키마 (계획 Task 5, 설계서 §10.1).
 *
 * 앱은 이 JSON들을 **네트워크로 받아서** 쓴다. 파일이 바뀌었거나 빌드가 잘못됐을 때
 * 조용히 이상한 값으로 견적을 만들지 않도록, 읽는 쪽에서 반드시 검증한다.
 *
 * `products.json`에 `sellingUnitPrice`가 **없어야** 한다는 것도 스키마로 고정한다
 * (결정 D3). 섞이면 "판매가는 가리자"로 바꿀 때 되돌릴 수 없다.
 */
import { z } from 'zod';

/** 10진 문자열. `number`를 받지 않는다 — 부동소수 오차가 굳으면 안 된다. */
const decimalText = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, '10진수 문자열이어야 한다 (예: "1234", "0.0486")');

const evidenceState = z.enum(['verified', 'review-required', 'conflicted']);

// ---------------------------------------------------------------------------
// products.json — 가격 없음
// ---------------------------------------------------------------------------

export const productSchema = z
  .object({
    productId: z.string().min(1),
    sku: z.string().min(1),
    brand: z.string(),
    model: z.string(),
    quoteName: z.string().min(1),
    quoteSpec: z.string(),
    unit: z.string().min(1),
    options: z.record(z.string(), z.string()),
    currency: z.literal('KRW'),
    laborMappingId: z.string().optional(),
    evidence: evidenceState,
  })
  // 결정 D3: 제품 파일에 판매단가를 넣지 않는다. 들어오면 거부한다.
  .strict();

export const productsFileSchema = z.object({
  schemaVersion: z.literal(1),
  generatedOn: z.string(),
  sourceSha256: z.string().length(64),
  products: z.array(productSchema),
});

// ---------------------------------------------------------------------------
// prices.json — 가격만
// ---------------------------------------------------------------------------

export const pricesFileSchema = z.object({
  schemaVersion: z.literal(1),
  generatedOn: z.string(),
  sourceSha256: z.string().length(64),
  currency: z.literal('KRW'),
  /** SKU → 판매단가. **미등록 제품은 키가 없다** (설계서 §5.6). */
  prices: z.record(
    z.string(),
    z.object({ sellingUnitPrice: decimalText, currency: z.literal('KRW') }),
  ),
});

// ---------------------------------------------------------------------------
// labor-items.json / wage-table.json / labor-mappings.json
// ---------------------------------------------------------------------------

const wageUnit = z.enum(['M/D', 'M/M']);

export const laborItemSchema = z
  .object({
    laborItemId: z.string().min(1),
    code: z.string().min(1),
    description: z.string(),
    baseUnit: z.string(),
    source: z.string(),
    revision: z.string(),
    wageUnit,
    /**
     * 직종별 금액을 각각 `INT` 한 뒤 더하는가. **원본의 예외 행에만** 있다
     * (실측: 오디오 371행 한 행). 없으면 합산 뒤 한 번만 `INT` 한다.
     */
    perTradeRounding: z.literal('int').optional(),
    trades: z
      .array(z.object({ trade: z.string().min(1), quantity: decimalText }))
      .min(1, '품 값이 없는 품셈 항목을 만들지 않는다'),
  })
  .strict();

export const laborItemsFileSchema = z.object({
  schemaVersion: z.literal(1),
  generatedOn: z.string(),
  sourceSha256: z.string().length(64),
  laborItems: z.array(laborItemSchema),
});

export const wageTableFileSchema = z.object({
  schemaVersion: z.literal(1),
  generatedOn: z.string(),
  sourceSha256: z.string().length(64),
  wageTable: z
    .object({
      wageTableId: z.string().min(1),
      periodLabel: z.string().min(1),
      source: z.string(),
      wages: z.record(z.string(), z.object({ amount: decimalText, unit: wageUnit })),
    })
    .strict(),
});

export const laborMappingSchema = z
  .object({
    laborMappingId: z.string().min(1),
    sku: z.string().min(1),
    laborItemId: z.string().min(1),
    conversionFactor: decimalText,
    surcharge: decimalText,
    itemRate: decimalText,
    /** 원본 수식에 박힌 배율. `INT` **다음에** 곱한다. */
    multiplier: decimalText.optional(),
    // 자동 추출 산출물은 전부 false여야 한다 (설계서 §5.3).
    confirmed: z.literal(false),
    note: z.string().min(1),
  })
  .strict();

export const laborMappingsFileSchema = z.object({
  schemaVersion: z.literal(1),
  generatedOn: z.string(),
  sourceSha256: z.string().length(64),
  mappings: z.array(laborMappingSchema),
  /** 품셈을 붙일 수 없는 SKU. 숨기지 않고 함께 배포해 화면에 경고를 띄운다. */
  unmappedSkus: z.array(z.string()),
});

export type ProductsFile = z.infer<typeof productsFileSchema>;
export type PricesFile = z.infer<typeof pricesFileSchema>;
export type LaborItemsFile = z.infer<typeof laborItemsFileSchema>;
export type WageTableFile = z.infer<typeof wageTableFileSchema>;
export type LaborMappingsFile = z.infer<typeof laborMappingsFileSchema>;

/**
 * SKU 대응표 (품셈 교체 Task 4).
 *
 * 열쇠는 **세 값**이다 — 저장 당시 지문, 옛 SKU, 지금 지문. 지금 지문을 빼면
 * 다음 교체 때 같은 번호가 또 재사용되어 옛 대응이 엉뚱한 곳을 가리킨다.
 */
const skuIdentitySchema = z
  .object({
    quoteName: z.string(),
    quoteSpec: z.string(),
    unit: z.string(),
    description: z.string(),
    group: z.string(),
  })
  .strict();

export const skuMigrationFileSchema = z
  .object({
    sourceCatalogFingerprint: z.string().min(1),
    targetCatalogFingerprint: z.string().min(1),
    entries: z.array(
      z
        .object({
          sourceSku: z.string().min(1),
          status: z.enum(['mapped', 'undecided', 'unmappable']),
          targetSku: z.string().min(1).optional(),
          targetIdentity: skuIdentitySchema.optional(),
          candidates: z.array(z.string()).optional(),
          decidedBy: z.enum(['auto', 'human']),
          note: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
