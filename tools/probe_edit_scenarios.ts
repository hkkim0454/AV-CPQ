/**
 * P2-1 — 편집 시나리오별 **독립** 기대값을 만든다 (독립 검토 P2-1).
 *
 * ## "독립"의 뜻
 *
 * 생성기가 만든 xlsx를 다시 읽어 베끼지 않는다. 대신 **도메인 입력을 직접
 * 바꾸고**(수량 문자열, 품셈 항목의 직종별 품, 노임표의 직종별 단가,
 * 간접비 규칙의 rate), 계산 엔진(`calculateQuote`/`calculateLaborForRows`)을
 * **다시** 불러서 "그 입력이면 나와야 할 값"을 얻는다. 그런 다음 Excel에서
 * **그 입력 변경에 대응하는 꼭 한 칸**을 사람이 고친 것처럼 편집하고,
 * 재계산된 값이 독립 기대값과 같은지를 `tools/verify_in_excel.ps1`이 본다.
 *
 * 네 시나리오:
 *   1. 수량 편집 (품목 행의 수량 칸)
 *   2. 직종 공수 0→양수 편집 (비어 있던 직종의 품 칸)
 *   3. 노임 편집 (3행의 그 직종 단가 칸)
 *   4. 간접비 적용률 편집 (간접비 행의 rate 칸)
 *
 * 합성 카탈로그·합성 품셈만 쓴다. 실제 원가·거래처 자료는 쓰지 않는다
 * (설계서 §8.4).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Decimal from 'decimal.js';

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
import { buildSharedProjection } from '../src/export/shared/projection';
import { buildSharedGuideWorkbook } from '../src/export/shared/workbook';
import { calculateQuote, type CalculationSnapshot } from '../src/domain/calculation/calculate';
import { calculateLaborForRows, type LaborReference } from '../src/domain/labor/calculateLabor';
import type { LaborItem } from '../src/domain/labor/types';
import { pickedItemsToQuote } from '../src/import/picker/toQuote';
import type { QuoteDocument } from '../src/domain/quote/types';
import { buildCustomerProjection } from '../src/export/customer/projection';
import { buildMultiSystemGuideBase } from '../src/export/customer/guideMultiSystem';

const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, '.local/out/edit-scenarios');

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
const guides = Object.fromEntries(GUIDE_IDS.map((id) => [id, guideOf(id)])) as GuideTemplateSet;
const catalog = buildCatalog(approved('products.json'), approved('prices.json'));

interface ScenarioEntry {
  label: string;
  sheet: string;
  cell: string;
  editValue: string;
  revertValue: string;
  expected: Record<string, Record<string, string>>;
}

function columnName(index: number): string {
  let out = '';
  let rest = index;
  while (rest > 0) {
    const rem = (rest - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    rest = Math.floor((rest - 1) / 26);
  }
  return out;
}
function columnIndex(name: string): number {
  return [...name].reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
}

/** 시스템 1개짜리 계산 결과를 가이드 세부내역·갑지 칸으로 옮긴다 — `probe_variants.ts`와 같은 규칙. */
function expectedCellsOf(
  calc: CalculationSnapshot,
  layout: ReturnType<typeof selectGuide> extends never ? never : any,
  guide: ReturnType<typeof guideOf>,
): Record<string, Record<string, string>> {
  const sys = calc.systems[0]!;
  const total = layout.column('total');
  const material = layout.column('material.amount');
  const labor = layout.column('labor.amount');
  const laborUnit = layout.column('labor.unit');

  const detail: Record<string, string> = {
    [`${material}${layout.directSubtotalRow}`]: sys.directMaterial.toFixed(),
    [`${labor}${layout.directSubtotalRow}`]: sys.directLabor.toFixed(),
    [`${total}${layout.directSubtotalRow}`]: sys.directTotal.toFixed(),
    [`${total}${layout.indirectSubtotalRow}`]: sys.indirectTotal.toFixed(),
    [`${total}${layout.grandTotalRow}`]: sys.systemTotal.toFixed(),
  };
  sys.indirect.forEach((item, index) => {
    detail[`${total}${layout.indirectRows[index]!.row}`] = item.amount.toFixed();
  });
  const calcByRowId = new Map(sys.rows.map((r) => [r.rowId, r]));
  for (const planned of layout.itemRows) {
    const rowCalc = calcByRowId.get(planned.rowId!);
    if (rowCalc === undefined) continue;
    if (rowCalc.materialAmount !== undefined) {
      detail[`${material}${planned.row}`] = rowCalc.materialAmount.toFixed();
    }
    if (rowCalc.laborUnitPrice !== undefined) {
      detail[`${laborUnit}${planned.row}`] = rowCalc.laborUnitPrice.toFixed();
    }
    if (rowCalc.laborAmount !== undefined) {
      detail[`${labor}${planned.row}`] = rowCalc.laborAmount.toFixed();
    }
    if (rowCalc.total !== undefined) {
      detail[`${total}${planned.row}`] = rowCalc.total.toFixed();
    }
  }

  return {
    [guide.sheets.detail]: detail,
    [guide.sheets.cover]: {
      G11: sys.systemTotal.toFixed(),
      H11: (calc.cover.systemAmounts[0]?.amount ?? sys.systemTotal).toFixed(),
      H12: calc.cover.rounded.toFixed(),
    },
  };
}

function build(profile: IndirectProfileId): void {
  const guide = selectGuide(guides, profile, false);
  const matrix = catalog.products.find((p) => p.quoteSpec === 'XDM-12')!;
  const rest = catalog.products.filter(
    (p) => p.sku !== matrix.sku && catalog.prices.has(p.sku) && p.laborMappingId !== undefined,
  );
  const picked = [matrix, ...rest.slice(0, 5)];

  const document = pickedItemsToQuote(
    {
      header: {
        quoteNumber: `EDIT-${profile}`,
        quoteDate: '2026-10-04',
        customer: '합성 고객',
        projectName: '편집 시나리오 검증',
        contact: '',
        conditions: [],
      },
      systems: [
        {
          name: '회의실',
          items: picked.map((p, i) => ({ sku: p.sku, quantity: String(i + 1) })),
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

  const requests = prepared.document.rows
    .filter(
      (r): r is typeof r & { type: 'item'; laborMappingId: string } =>
        r.type === 'item' && r.laborMode === 'mapped' && r.laborMappingId !== undefined,
    )
    .map((r) => ({ rowId: r.rowId, laborMappingId: r.laborMappingId }));

  const baselineLabor = calculateLaborForRows(requests, basis.reference);
  const baselineCalc = calculateQuote(prepared.document, {
    laborUnitPrices: baselineLabor.unitPrices,
  });

  // --- 산출물: 공유용(1단계) — 설명·품셈 다 보이고 원가는 없다 ---
  const sharedExport = buildSharedProjection(prepared, {
    supplierByRow: new Map(),
    salesRemarkByRow: new Map(),
  });
  const result = buildSharedGuideWorkbook({ shared: sharedExport, guide });
  const layout = result.layout;

  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, `${profile}.xlsx`), result.bytes);

  const scenarios: ScenarioEntry[] = [];

  // --- 시나리오 1: 수량 편집 ---
  {
    const target = prepared.document.rows.find((r) => r.type === 'item')! as typeof prepared.document.rows[number] & {
      type: 'item';
      quantity: string;
    };
    const row = layout.rows.find((r) => r.rowId === target.rowId)!.row;
    const oldQty = target.quantity;
    const newQty = String(Number(oldQty) + 37);
    const editedDoc: QuoteDocument = {
      ...prepared.document,
      rows: prepared.document.rows.map((r) => (r.rowId === target.rowId ? { ...r, quantity: newQty } : r)),
    };
    const editedCalc = calculateQuote(editedDoc, { laborUnitPrices: baselineLabor.unitPrices });
    scenarios.push({
      label: `수량 편집 — 행 ${target.rowId} 수량 ${oldQty}→${newQty}`,
      sheet: guide.sheets.detail,
      cell: `${layout.column('quantity')}${row}`,
      editValue: newQty,
      revertValue: oldQty,
      expected: expectedCellsOf(editedCalc, layout, guide),
    });
  }

  // --- 시나리오 2: 직종 공수 0→양수 편집 ---
  {
    // 품셈이 연결된 첫 품목을 고른다 — 그 품목의 직종 블록에서 품이 0인
    // (=원래 배열에 없는) 직종 하나를 골라 품을 더한다.
    const target = requests[0]!;
    const mapping = basis.reference.mappings.find((m) => m.laborMappingId === target.laborMappingId)!;
    const item = basis.reference.items.find((i) => i.laborItemId === mapping.laborItemId)!;
    const usedTrades = new Set(item.trades.map((t) => t.trade));
    const newTrade = guide.trades.find((t) => !usedTrades.has(t));
    if (newTrade === undefined) {
      throw new Error('시험 전제가 깨졌다 — 빈 직종을 찾지 못했다.');
    }
    const newQuantity = '2';
    const editedItem: LaborItem = {
      ...item,
      trades: [...item.trades, { trade: newTrade, quantity: newQuantity }],
    };
    const editedReference: LaborReference = {
      ...basis.reference,
      items: basis.reference.items.map((i) => (i.laborItemId === item.laborItemId ? editedItem : i)),
    };
    const editedLabor = calculateLaborForRows(requests, editedReference);
    const editedCalc = calculateQuote(prepared.document, { laborUnitPrices: editedLabor.unitPrices });

    const row = layout.rows.find((r) => r.rowId === target.rowId)!.row;
    const tradeIndex = guide.trades.indexOf(newTrade);
    const first = columnIndex(layout.column('tradeFirst'));
    const qtyColumn = columnName(first + tradeIndex * 2);

    scenarios.push({
      label: `직종 공수 0→양수 편집 — 행 ${target.rowId} 직종 '${newTrade}' 품 0→${newQuantity}`,
      sheet: guide.sheets.detail,
      cell: `${qtyColumn}${row}`,
      editValue: newQuantity,
      revertValue: '',
      expected: expectedCellsOf(editedCalc, layout, guide),
    });
  }

  // --- 시나리오 3: 노임 편집 ---
  {
    const target = requests[0]!;
    const mapping = basis.reference.mappings.find((m) => m.laborMappingId === target.laborMappingId)!;
    const item = basis.reference.items.find((i) => i.laborItemId === mapping.laborItemId)!;
    const trade = item.trades[0]!.trade;
    const oldWage = basis.reference.wages.wages[trade]!;
    const newAmount = new Decimal(oldWage.amount).plus(50000).toFixed();
    const editedReference: LaborReference = {
      ...basis.reference,
      wages: {
        ...basis.reference.wages,
        wages: { ...basis.reference.wages.wages, [trade]: { ...oldWage, amount: newAmount } },
      },
    };
    const editedLabor = calculateLaborForRows(requests, editedReference);
    const editedCalc = calculateQuote(prepared.document, { laborUnitPrices: editedLabor.unitPrices });

    const tradeIndex = guide.trades.indexOf(trade);
    const first = columnIndex(layout.column('tradeFirst'));
    const amountColumn = columnName(first + tradeIndex * 2 + 1);

    scenarios.push({
      label: `노임 편집 — 직종 '${trade}' 노임 ${oldWage.amount}→${newAmount}`,
      sheet: guide.sheets.detail,
      cell: `${amountColumn}3`,
      editValue: newAmount,
      revertValue: oldWage.amount,
      expected: expectedCellsOf(editedCalc, layout, guide),
    });
  }

  // --- 시나리오 4: 간접비 적용률 편집 ---
  {
    const sys = prepared.document.systems[0]!;
    const ruleIndex = sys.indirectCosts.findIndex((r) => r.applied && r.basis.kind !== 'composite');
    if (ruleIndex === -1) throw new Error('시험 전제가 깨졌다 — 적용 중인 간접비 규칙이 없다.');
    const rule = sys.indirectCosts[ruleIndex]!;
    const oldRate = rule.rate;
    const newRate = new Decimal(oldRate).plus('0.02').toFixed();
    const editedDoc: QuoteDocument = {
      ...prepared.document,
      systems: prepared.document.systems.map((s) =>
        s.systemId === sys.systemId
          ? {
              ...s,
              indirectCosts: s.indirectCosts.map((r, i) => (i === ruleIndex ? { ...r, rate: newRate } : r)),
            }
          : s,
      ),
    };
    const editedCalc = calculateQuote(editedDoc, { laborUnitPrices: baselineLabor.unitPrices });
    const row = layout.indirectRows[ruleIndex]!.row;

    scenarios.push({
      label: `간접비 적용률 편집 — '${rule.name}' rate ${oldRate}→${newRate}`,
      sheet: guide.sheets.detail,
      cell: `${layout.column('quantity')}${row}`,
      editValue: newRate,
      revertValue: oldRate,
      expected: expectedCellsOf(editedCalc, layout, guide),
    });
  }

  writeFileSync(
    resolve(OUT, `${profile}.scenarios.json`),
    JSON.stringify(scenarios, null, 2) + '\n',
    'utf8',
  );

  // --- 기준(편집 전) 기대값도 같이 쓴다 — verify_in_excel.ps1 의 -Expected 로 먼저 대조한다 ---
  writeFileSync(
    resolve(OUT, `${profile}.expected.json`),
    JSON.stringify(expectedCellsOf(baselineCalc, layout, guide), null, 2) + '\n',
    'utf8',
  );
  writeFileSync(
    resolve(OUT, `${profile}.layout.json`),
    JSON.stringify(
      {
        detailSheetIndex: 2,
        coverSheetIndex: 1,
        quantityColumn: layout.column('quantity'),
        unitPriceColumn: layout.column('material.unit'),
        amountColumn: layout.column('material.amount'),
        coverAmountTextCell: 'C8',
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  console.log(
    `${profile}  품목 ${picked.length}  시나리오 ${scenarios.length}개  ` +
      scenarios.map((s) => s.label).join(' | '),
  );
}

/**
 * 혼합 시스템(일반+DS) — 대표로 **수량 편집** 하나만 돌린다. 편집한
 * 시스템의 세부내역 칸과, **두 시스템을 합친** 갑지 칸을 독립 재계산해
 * 대조한다. 다른 시스템(안 건드린 쪽)의 칸은 그대로인지도 같이 본다 —
 * 시스템 사이에 수식이 간섭하지 않는다는 것을 고정한다.
 */
function buildMixed(): void {
  const matrix = catalog.products.find((p) => p.quoteSpec === 'XDM-12')!;
  const rest = catalog.products.filter(
    (p) => p.sku !== matrix.sku && catalog.prices.has(p.sku) && p.laborMappingId !== undefined,
  );
  const picked = [matrix, ...rest.slice(0, 3)];

  const document = pickedItemsToQuote(
    {
      header: {
        quoteNumber: 'EDIT-mixed',
        quoteDate: '2026-10-04',
        customer: '합성 고객',
        projectName: '혼합 시스템 편집 시나리오 검증',
        contact: '',
        conditions: [],
      },
      systems: [
        { name: '회의실', items: picked.map((p, i) => ({ sku: p.sku, quantity: String(i + 1) })) },
        { name: '대회의실', items: picked.map((p, i) => ({ sku: p.sku, quantity: String(i + 2) })) },
      ],
    },
    catalog,
  ).document;

  const profiles: readonly IndirectProfileId[] = ['general', 'ds'];
  const basis = buildGuideBasis({
    laborItemsRaw: approved('labor-items.json'),
    wageTableRaw: approved('wage-table.json'),
    laborMappingsRaw: approved('labor-mappings.json'),
    choice: { kind: 'guide', guide: selectGuide(guides, 'general', false) },
  });
  const profileBySystem = new Map(document.systems.map((s, i) => [s.systemId, profiles[i]!]));
  const prepared = prepareQuote({
    document,
    laborReference: basis.reference,
    basisVersions: basis.versions,
    guides,
    profileBySystem,
    importWarnings: [],
    wageMode: 'initialize-new',
  });

  const guideBySystemId = new Map(
    prepared.document.systems.map((s, i) => [s.systemId, selectGuide(guides, profiles[i]!, false)]),
  );
  const projection = buildCustomerProjection(prepared.document, prepared.priced.calculation);
  const base = buildMultiSystemGuideBase({ exported: projection, guideBySystemId });

  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'mixed.xlsx'), base.bytes);

  // --- 편집 대상: 두 번째 시스템(DS)의 첫 품목 수량 ---
  const targetSystem = prepared.document.systems[1]!;
  const targetRow = prepared.document.rows.find(
    (r) => r.type === 'item' && r.systemId === targetSystem.systemId,
  )! as QuoteDocument['rows'][number] & { type: 'item'; quantity: string };
  const sysInfo = base.systems[1]!;
  const excelRow = sysInfo.layout.rows.find((r) => r.rowId === targetRow.rowId)!.row;

  const oldQty = targetRow.quantity;
  const newQty = String(Number(oldQty) + 41);
  const editedDoc: QuoteDocument = {
    ...prepared.document,
    rows: prepared.document.rows.map((r) => (r.rowId === targetRow.rowId ? { ...r, quantity: newQty } : r)),
  };
  // 라벨 단가는 바뀌지 않으니 베이스라인 노무 단가 맵을 그대로 쓴다.
  const requests = prepared.document.rows
    .filter(
      (r): r is typeof r & { type: 'item'; laborMappingId: string } =>
        r.type === 'item' && r.laborMode === 'mapped' && r.laborMappingId !== undefined,
    )
    .map((r) => ({ rowId: r.rowId, laborMappingId: r.laborMappingId }));
  const baselineLabor = calculateLaborForRows(requests, basis.reference);
  const editedCalc = calculateQuote(editedDoc, { laborUnitPrices: baselineLabor.unitPrices });
  const baselineCalc = calculateQuote(prepared.document, { laborUnitPrices: baselineLabor.unitPrices });

  const editedSys = editedCalc.systems[1]!;
  const baselineOtherSys = baselineCalc.systems[0]!; // 안 건드린 시스템 — 그대로여야 한다.
  const layout = sysInfo.layout;
  const total = layout.column('total');
  const material = layout.column('material.amount');

  const otherSysInfo = base.systems[0]!;
  const otherTotal = otherSysInfo.layout.column('total');

  const expected: Record<string, Record<string, string>> = {
    [sysInfo.sheetName]: {
      [`${material}${layout.directSubtotalRow}`]: editedSys.directMaterial.toFixed(),
      [`${total}${layout.grandTotalRow}`]: editedSys.systemTotal.toFixed(),
    },
    [otherSysInfo.sheetName]: {
      // 안 건드린 시스템의 합계 — 편집 전과 같아야 한다(독립 재계산).
      [`${otherTotal}${otherSysInfo.layout.grandTotalRow}`]: baselineOtherSys.systemTotal.toFixed(),
    },
    [base.sheetNames.cover]: {
      H13: editedCalc.cover.rounded.toFixed(),
    },
  };

  const scenario: ScenarioEntry = {
    label: `혼합 시스템 — 시스템2(DS) 수량 편집 ${oldQty}→${newQty}, 시스템1(일반)은 그대로`,
    sheet: sysInfo.sheetName,
    cell: `${layout.column('quantity')}${excelRow}`,
    editValue: newQty,
    revertValue: oldQty,
    expected,
  };

  writeFileSync(
    resolve(OUT, 'mixed.scenarios.json'),
    JSON.stringify([scenario], null, 2) + '\n',
    'utf8',
  );
  writeFileSync(
    resolve(OUT, 'mixed.layout.json'),
    JSON.stringify(
      {
        detailSheetIndex: 2,
        coverSheetIndex: 1,
        // 기존 단일 시스템 전제(편집 후 재계산/품셈 편집 블록)가 첫 번째
        // 세부내역 시트(시스템1=일반)를 상대로 쓰는 열 — 혼합이라도
        // 시스템1 자체는 단일 시스템과 같은 열 구조다.
        quantityColumn: otherSysInfo.layout.column('quantity'),
        unitPriceColumn: otherSysInfo.layout.column('material.unit'),
        amountColumn: otherSysInfo.layout.column('material.amount'),
        coverAmountTextCell: 'C8',
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  console.log(`mixed  시나리오 1개  ${scenario.label}`);
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

build('general');
build('ds');
buildMixed();

console.log(`\n산출물: ${OUT}`);
