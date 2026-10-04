/**
 * 가이드 출력 산출물을 만든다 (계획 2026-10-04 Task 7).
 *
 * `.local/out/variants/` 에 조합별 `.xlsx` 와 기대값 `.json` 을 쓴다.
 * 기대값은 **도메인 계산**에서 만든다 — OOXML 캐시를 읽어 베끼면 "Excel 이
 * 제가 쓴 숫자와 같다"는 동어반복이 된다.
 *
 * 여기 쓰는 값은 전부 승인된 카탈로그와 합성 머리정보다. 실제 원가는 쓰지 않는다.
 */
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildGuideBasis } from '../src/data/catalog/guideBasis';
import { buildCatalog } from '../src/data/catalog/load';
import {
  GUIDE_IDS,
  readGuideTemplate,
  selectGuide,
  type GuideId,
  type GuideManifest,
  type GuideTemplateSet,
  type IndirectProfileId,
} from '../src/export/ooxml/guideTemplate';
import { prepareQuote } from '../src/export/variants/prepare';
import { buildCustomerProjection } from '../src/export/customer/projection';
import { buildCustomerGuideWorkbook } from '../src/export/customer/guideWorkbook';
import { buildSharedProjection } from '../src/export/shared/projection';
import { buildSharedGuideWorkbook } from '../src/export/shared/workbook';
import { buildSalesGuideWorkbook } from '../src/export/internal/guideWorkbook';
import { createSession } from '../src/services/private-cost/session';
import { parsePrivatePrices } from '../src/services/private-cost/parse';
import { readTable } from '../src/services/private-cost/readTable';
import { internalLines } from '../src/services/private-cost/calculate';
import { strToU8 } from 'fflate';
import { quoteFileName, type OutputLevel } from '../src/export/variants/fileName';
import { pickedItemsToQuote } from '../src/import/picker/toQuote';

const NEWLINE = String.fromCharCode(10);
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, '.local/out/variants');

const approved = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(ROOT, 'data/approved', name), 'utf8'));

const manifest = JSON.parse(
  readFileSync(resolve(ROOT, 'templates/sanitized/guide-manifest.json'), 'utf8'),
) as GuideManifest;

const guideOf = (id: GuideId) =>
  readGuideTemplate(
    id,
    new Uint8Array(readFileSync(resolve(ROOT, `templates/sanitized/guide-${id}.xlsx`))),
    manifest,
  );

const guides = Object.fromEntries(
  GUIDE_IDS.map((id) => [id, guideOf(id)]),
) as GuideTemplateSet;

const catalog = buildCatalog(approved('products.json'), approved('prices.json'));

/** 품셈과 단가가 둘 다 있고 노무비가 실제로 붙는 제품들. */
function pickProducts(count: number): string[] {
  const matrix = catalog.products.find((p) => p.quoteSpec === 'XDM-12');
  if (matrix === undefined) throw new Error('기준 제품 XDM-12 가 없다.');
  const rest = catalog.products.filter(
    (p) =>
      p.sku !== matrix.sku && catalog.prices.has(p.sku) && p.laborMappingId !== undefined,
  );
  return [matrix.sku, ...rest.slice(0, count - 1).map((p) => p.sku)];
}

/**
 * **합성** 원가를 만든다. 실제 원가 파일은 쓰지 않는다 (설계서 §8.4).
 *
 * 판매단가의 80% 를 매입단가로 둔 가짜 표다. 구조를 확인하려는 것이지
 * 금액을 확인하려는 것이 아니다.
 */
function syntheticCost(
  prepared: ReturnType<typeof prepareQuote>,
  firstRowId: string,
) {
  const items = prepared.document.rows.filter((r) => r.type === 'item');
  const header = '품명,규격,매입단가,통화,단위';
  const lines = items.map((row, index) => {
    const unitPrice = prepared.priced.calculation.systems[0]!.rows.find(
      (r) => r.rowId === row.rowId,
    )?.materialUnitPrice;
    const cost = unitPrice === undefined ? 1000 : Math.round(unitPrice.toNumber() * 0.8);
    return `합성품목${index + 1},MODEL-${index + 1},${cost},KRW,EA`;
  });
  const parsed = parsePrivatePrices(
    readTable(strToU8([header, ...lines].join(NEWLINE) + NEWLINE), 'csv'),
    { model: '규격', name: '품명', purchaseUnitPrice: '매입단가', currency: '통화', unit: '단위' },
  );
  const session = createSession(parsed.entries);
  const entryIds = items.map((_, index) =>
    session.candidatesByModel(`MODEL-${index + 1}`)[0]?.entryId,
  );
  const lines2 = internalLines(
    items.map((row, index) => ({
      rowId: row.rowId,
      ...(entryIds[index] !== undefined ? { costEntryId: entryIds[index]! } : {}),
      quantity: row.quantity,
    })),
    session,
  );
  return {
    lines: lines2,
    aiNotesByRow: new Map([[firstRowId, '구성도 — 카탈로그 조회 2건 걸림. 확인 필요']]),
    supplierByRow: new Map([[firstRowId, '합성 거래처']]),
    salesRemarkByRow: new Map([[firstRowId, '합성 영업메모']]),
  };
}

const SITE = '합성 현장 A동';
const DATE = '2026-10-04';

function build(profile: IndirectProfileId, level: OutputLevel, itemCount: number): void {
  const withCost = level === 0;
  const guide = selectGuide(guides, profile, withCost);

  const skus = pickProducts(itemCount);
  const document = pickedItemsToQuote(
    {
      header: {
        quoteNumber: `SVT-${DATE.replace(/-/g, '').slice(2)}-01`,
        quoteDate: DATE,
        customer: '합성 고객 주식회사',
        projectName: SITE,
        contact: '담당자',
        conditions: [],
      },
      systems: [
        {
          name: '회의실',
          items: skus.map((sku, i) => ({ sku, quantity: String(i + 1) })),
        },
      ],
    },
    catalog,
  ).document;

  const basis = buildGuideBasis({
    laborItemsRaw: approved('labor-items.json'),
    wageTableRaw: approved('wage-table.json'),
    laborMappingsRaw: approved('labor-mappings.json'),
    choice: { kind: 'guide', guide },
  });

  const prepared = prepareQuote({
    document,
    laborReference: basis.reference,
    basisVersions: basis.versions,
    guides,
    profileBySystem: new Map(document.systems.map((s) => [s.systemId, profile])),
    importWarnings: [],
    wageMode: 'initialize-new',
  });

  const tag = `${profile}-${level}`;

  const projection = buildCustomerProjection(
    prepared.document,
    prepared.priced.calculation,
  );

  // 설명과 거래처는 합성이다. 실제 자료는 화면이 채운다.
  const firstRowId = prepared.document.rows.find((r) => r.type === 'item')!.rowId;
  const sharedExport = () =>
    buildSharedProjection(
            {
              ...prepared,
              document: {
                ...prepared.document,
                rows: prepared.document.rows.map((r) =>
                  r.type === 'item'
                    ? { ...r, internalDescription: `설명: ${r.name}` }
                    : r,
                ),
              },
            },
      {
        supplierByRow: new Map([[firstRowId, '합성 거래처']]),
        salesRemarkByRow: new Map([[firstRowId, '합성 영업메모']]),
      },
    );

  const result =
    level === 0
      ? buildSalesGuideWorkbook({
          shared: sharedExport(),
          extras: syntheticCost(prepared, firstRowId),
          guide,
          baseGuide: selectGuide(guides, profile, false),
        })
      : level === 1
        ? buildSharedGuideWorkbook({ shared: sharedExport(), guide })
        : buildCustomerGuideWorkbook(projection, guide);

  const fileName = quoteFileName(SITE, DATE, level);
  writeFileSync(resolve(OUT, `${tag}.xlsx`), result.bytes);

  // --- 기대값: 도메인 계산에서 만든다 ---
  const calc = prepared.priced.calculation.systems[0]!;
  const layout = result.layout;
  const total = layout.column('total');
  const material = layout.column('material.amount');
  const labor = layout.column('labor.amount');

  const expected: Record<string, Record<string, string>> = {
    [guide.sheets.detail]: {
      [`${material}${layout.directSubtotalRow}`]: calc.directMaterial.toFixed(),
      [`${labor}${layout.directSubtotalRow}`]: calc.directLabor.toFixed(),
      [`${total}${layout.directSubtotalRow}`]: calc.directTotal.toFixed(),
      [`${total}${layout.indirectSubtotalRow}`]: calc.indirectTotal.toFixed(),
      [`${total}${layout.grandTotalRow}`]: calc.systemTotal.toFixed(),
    },
  };
  calc.indirect.forEach((item, index) => {
    expected[guide.sheets.detail]![`${total}${layout.indirectRows[index]!.row}`] =
      item.amount.toFixed();
  });

  writeFileSync(
    resolve(OUT, `${tag}.expected.json`),
    JSON.stringify(expected, null, 2) + '\n',
    'utf8',
  );
  writeFileSync(
    resolve(OUT, `${tag}.layout.json`),
    JSON.stringify(
      {
        detailSheetIndex: 2,
        coverSheetIndex: 1,
        quantityColumn: layout.column('quantity'),
        unitPriceColumn: layout.column('material.unit'),
        amountColumn: layout.column('material.amount'),
        coverAmountTextCell: 'C8',
        grandTotalRow: layout.grandTotalRow,
        printArea: layout.printArea,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  console.log(
    `${tag}  ${fileName}  품목 ${itemCount}  합계행 ${layout.grandTotalRow}  ` +
      `대조 ${Object.keys(expected[guide.sheets.detail]!).length}칸  ` +
      `막힘 ${prepared.blocking}`,
  );
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

for (const profile of ['general', 'ds'] as const) {
  for (const level of [0, 1, 2] as const) {
    build(profile, level, 9);
  }
}
console.log(`\n산출물: ${OUT}`);
