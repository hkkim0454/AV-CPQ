/**
 * P2-1 — 편집 시나리오별 **독립** 기대값을 만든다 (독립 검토 P2-1, 재지적
 * 반영 2026-10-04: 공수 적용률(itemRate) 추가, 원가측 파생 행, 혼합
 * 시스템의 공수·노임·itemRate, 실행별 manifest).
 *
 * ## "독립"의 뜻
 *
 * 생성기가 만든 xlsx를 다시 읽어 베끼지 않는다. 대신 **도메인 입력을 직접
 * 바꾸고**(수량 문자열, 품셈 항목의 직종별 품, 노임표의 직종별 단가,
 * 품셈 연결의 itemRate, 간접비 규칙의 rate), 계산 엔진
 * (`calculateQuote`/`calculateLaborForRows`)을 **다시** 불러서 "그
 * 입력이면 나와야 할 값"을 얻는다. 그런 다음 Excel에서 **그 입력 변경에
 * 대응하는 꼭 한 칸**을 사람이 고친 것처럼 편집하고, 재계산된 값이
 * 독립 기대값과 같은지를 `tools/verify_in_excel.ps1`이 본다.
 *
 * 단일 시스템 다섯 시나리오(`build()`):
 *   1. 수량 편집 (품목 행의 수량 칸)
 *   2. 직종 공수 0→양수 편집 (비어 있던 직종의 품 칸)
 *   3. 노임 편집 (3행의 그 직종 단가 칸)
 *   4. 간접비 적용률 편집 (간접비 행의 rate 칸, `IndirectCostRule.rate`)
 *   5. **공수 적용률(itemRate) 편집** (`LaborMapping.itemRate`) — 4번과
 *      다른 축이다. 4번은 간접비(노무비 대비 등 basis×rate), 5번은
 *      품셈 자체의 "품목별 요율"이다. `F.laborUnitPrice` 수식에서
 *      `itemRate` 는 `standardUnitPrice*(1+surcharge)` 뒤에 **정확히
 *      한 번만** 곱한다 — 두 번 곱해지거나 다른 칸에 또 쓰이면 안 된다.
 *
 * 원가측 파생 행(`buildCostDerived()`): picker/diagram 두 입구 다
 * `derivedRows: []` 고정이라(알려진 경계, 별도 과제) 합성으로 배관
 * 기타자재·잡자재비 파생 행을 직접 주입한 0단계 문서를 만든다. 일반은
 * 원가측 배관 기타자재가 공란(템플릿 설계), DS는 직전 배관 원가금액의
 * 40% — 이 구분이 수량 편집 뒤에도 유지되는지 본다.
 *
 * 혼합 시스템(`buildMixed()`): 시스템마다 **자기 노임표/품셈 참조로
 * 따로 계산**하므로, 단일 시스템에서 통과했다고 혼합에서도 통과한다는
 * 보장이 없다 — 공수·노임·itemRate 편집을 혼합에서도 따로 돌린다.
 * 간접비 적용률은 단일 시스템 검증(및 기존 수량 편집 혼합 검증)을
 * 재사용한다 — 같은 위험(간접비 basis×rate 계산, 갑지 합산·절사)을
 * 혼합에서 또 도는 건 비용 대비 이득이 낮다.
 *
 * 합성 카탈로그·합성 품셈·합성 원가만 쓴다. 실제 원가·거래처 자료는
 * 쓰지 않는다 (설계서 §8.4).
 *
 * ## 실행 기록
 *
 * `rmSync` 로 이전 산출물을 지우지 않는다 — 실행마다 `<OUT>/<runId>/`
 * 새 폴더에 쓰고, 그 폴더에 `manifest.json`(커밋 SHA·dirty 여부·입력
 * 요약·명령·산출물 목록)을 같이 남긴다. "이 번호가 그 코드 상태에서
 * 나온 게 맞다"를 나중에도 확인할 수 있어야 한다.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';

import { buildGuideBasis } from '../src/data/catalog/guideBasis';
import { buildCatalog } from '../src/data/catalog/load';
import {
  GUIDE_IDS,
  indirectCostsFor,
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
import { buildSalesGuideWorkbook } from '../src/export/internal/guideWorkbook';
import {
  calculateQuote,
  type CalculationSnapshot,
  type SystemCalculation,
} from '../src/domain/calculation/calculate';
import { koreanAmountSentence } from '../src/export/ooxml/koreanAmount';
import {
  calculateLaborForRows,
  calculateLaborUnitPrice,
  type LaborReference,
} from '../src/domain/labor/calculateLabor';
import type { LaborItem, LaborMapping } from '../src/domain/labor/types';
import { pickedItemsToQuote } from '../src/import/picker/toQuote';
import { buildQuoteDocument } from '../src/domain/quote/buildDocument';
import type { DerivedRow, QuoteDocument } from '../src/domain/quote/types';
import { buildMultiSystemSharedGuideWorkbook } from '../src/export/shared/workbookMulti';
import type { InternalLine } from '../src/services/private-cost/calculate';
import type { PreparedQuote } from '../src/export/variants/prepare';

const ROOT = resolve(__dirname, '..');

/**
 * **실행마다 새 폴더.** `rmSync` 로 이전 산출물을 지우지 않는다 — 지우면
 * "이 번호가 그때 그 코드에서 나온 게 맞다"를 나중에 확인할 길이 없어진다.
 */
interface DirtyFile {
  path: string;
  sha256: string;
}

/**
 * 부모 커밋 SHA + (커밋 전이면) 바뀐 파일의 **내용 해시**를 같이 남긴다.
 * 커밋 SHA 하나만으로는 "커밋 전 상태에서 돌린 검증"을 나중에 재현할
 * 길이 없다 — 그 사이 같은 파일이 또 바뀌면 어느 내용으로 검증했는지
 * 알 수 없어진다. 해시가 있으면 나중에 그 커밋의 diff와 대조해 "이
 * manifest가 실제로 어떤 코드 상태에서 나왔는지"를 추적할 수 있다.
 */
function gitInfo(): {
  sha: string;
  dirty: boolean;
  dirtyFiles: readonly DirtyFile[];
  note?: string;
} {
  try {
    const sha = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();
    const statusOut = execSync('git status --porcelain', { cwd: ROOT }).toString();
    const paths = statusOut
      .split('\n')
      .map((line) => line.slice(3).trim())
      .filter((path) => path.length > 0);
    const dirtyFiles = paths.map((path) => {
      try {
        const bytes = readFileSync(resolve(ROOT, path));
        return { path, sha256: createHash('sha256').update(bytes).digest('hex') };
      } catch {
        return { path, sha256: '(읽지 못했다 — 삭제되었거나 폴더)' };
      }
    });
    return { sha, dirty: paths.length > 0, dirtyFiles };
  } catch {
    return { sha: 'unknown', dirty: true, dirtyFiles: [], note: 'git 명령을 못 돌렸다' };
  }
}

const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const BASE_OUT = resolve(ROOT, '.local/out/edit-scenarios');
const OUT = resolve(BASE_OUT, RUN_ID);
mkdirSync(OUT, { recursive: true });

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
  // 품목 행뿐 아니라 파생 행(배관 기타자재·잡자재비)의 판매측 금액도 같이
  // 본다 — `calculateQuote`가 파생 행도 `sys.rows`에 담는다.
  for (const planned of [...layout.itemRows, ...(layout.derivedRows ?? [])]) {
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

  // --- 시나리오 5: 공수 적용률(itemRate) 편집 ---
  //
  // 4번(간접비 적용률, `IndirectCostRule.rate`)과는 다른 축이다 — 이건
  // 품셈 연결의 "품목별 요율"(`LaborMapping.itemRate`)이다. 이 행 하나의
  // 매핑만 바꾼다 — 다른 행(다른 매핑)에 안 번지는지도 같이 본다
  // (독립 기대값이 baseline 노무 단가 맵을 복제해 이 행 하나만 덮어쓰므로,
  // Excel 비교가 그대로 "한 행에만 적용됐는가"를 검증한다).
  {
    const target = requests[0]!;
    const mapping = basis.reference.mappings.find((m) => m.laborMappingId === target.laborMappingId)!;
    const item = basis.reference.items.find((i) => i.laborItemId === mapping.laborItemId)!;
    const oldItemRate = mapping.itemRate;
    const newItemRate = new Decimal(oldItemRate).plus('0.5').toFixed();
    const editedMapping: LaborMapping = { ...mapping, itemRate: newItemRate };
    const editedBreakdown = calculateLaborUnitPrice(item, editedMapping, basis.reference.wages);

    const editedUnitPrices = new Map(baselineLabor.unitPrices);
    editedUnitPrices.set(target.rowId, editedBreakdown.appliedUnitPrice);
    const editedCalc = calculateQuote(prepared.document, { laborUnitPrices: editedUnitPrices });

    const row = layout.rows.find((r) => r.rowId === target.rowId)!.row;
    scenarios.push({
      label: `공수 적용률(itemRate) 편집 — 행 ${target.rowId} itemRate ${oldItemRate}→${newItemRate}`,
      sheet: guide.sheets.detail,
      cell: `${layout.column('itemRate')}${row}`,
      editValue: newItemRate,
      revertValue: oldItemRate,
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
 * 원가측 파생 행(배관 기타자재·잡자재비) — 0단계(영업팀용) 일반/DS 대표
 * 사례. `pickedItemsToQuote`/`buildQuoteDocument` 두 입구 다
 * `derivedRows: []` 고정이라(알려진 경계, `guideDerivedRows.test.ts` 주석
 * 참고) 합성으로 직접 주입한다 — `tests/integration/guideDerivedRows.test.ts`의
 * `documentWithDerivedRows()`와 같은 틀을 쓴다.
 *
 * 품목 2개(LFD 1개, 배관 Conduit 1개) + 파생 2개(배관 기타자재, 잡자재비).
 * 판매측(`material.*`)은 `calculateQuote`가 내므로 `expectedCellsOf`를
 * 그대로 재사용한다(독립 엔진 재사용). 원가측(`cost.*`)은
 * `CalculationSnapshot`에 아예 없으므로(설계상 원가는 그 스냅샷에서
 * 빠진다) **이 스크립트가 Decimal로 직접** 계산한다 — 생성기 코드를
 * 베끼는 게 아니라, `guideWorkbook.ts`의 파생 행 규칙 자체(배관 기타자재
 * = 직전 배관 원가금액×40%, 잡자재비 = INT(원가금액 합×2%), 일반
 * 프로파일은 배관 기타자재 원가단가를 비워 두는 템플릿 설계)를 그대로
 * 다시 구현해 대조한다.
 *
 * 수량 편집(배관 Conduit 행)으로 원가·판매 양쪽 파생/직접비계가 같이
 * 따라오는지, 그리고 일반(원가측 배관 기타자재 공란→0)과 DS(40% 수식)의
 * 구분이 편집 뒤에도 유지되는지를 본다.
 */
function buildCostDerived(profile: IndirectProfileId): void {
  const guide = selectGuide(guides, profile, true);

  const base = buildQuoteDocument({
    header: {
      quoteNumber: `EDIT-cost-derived-${profile}`,
      quoteDate: '2026-10-04',
      customer: '합성 고객',
      projectName: '원가측 파생 행 편집 시나리오 검증',
      contact: '',
      conditions: [],
    },
    systems: [
      {
        name: '회의실',
        lines: [
          { name: '85인치 LFD', specification: 'KQ85QB67', unit: 'EA', quantity: '1' },
          { name: '난연CD/합성수지 Conduit', specification: '28㎜, 천정', unit: '10M', quantity: '2' },
        ],
      },
    ],
    documentId: `doc-cost-derived-${profile}`,
    rowIdPrefix: `cd-${profile}`,
  });

  // 합성 원가·판매가 — 실제 원가·거래처 자료가 아니다(설계서 §8.4).
  // LFD=2,800,000(수량1), Conduit 원가단가=4,500(수량 2 → 9,000). 이전
  // 세션에서 실제 Excel로 대조해 "DS 직접비계=2,868,852"를 확인했던 것과
  // 같은 값이다.
  const lfdCostUnit = new Decimal('2800000');
  const conduitCostUnit = new Decimal('4500');
  const lfdSellUnit = new Decimal('3480000');
  const conduitSellUnit = new Decimal('6000');

  const rows = base.rows.map((row, index) =>
    row.type === 'item'
      ? {
          ...row,
          sellingUnitPrice: (index === 0 ? lfdSellUnit : conduitSellUnit).toFixed(),
          laborMode: 'not-applicable' as const,
        }
      : row,
  );
  const lfdRowId = rows[0]!.rowId;
  const conduitRowId = rows[1]!.rowId;
  const conduitRow = rows[1]! as typeof rows[number] & { type: 'item'; quantity: string };

  const conduitDerived: DerivedRow = {
    rowId: `cd-${profile}-derived-1`,
    systemId: 'S1',
    name: '배관 기타자재',
    specification: '배관자재40%',
    unit: '식',
    quantity: '1',
    laborMode: 'not-applicable',
    remark: '',
    origin: 'rule',
    derived: { kind: 'single-row-material', sourceRowId: conduitRowId },
    rate: '0.4',
  };
  const miscDerived: DerivedRow = {
    rowId: `cd-${profile}-derived-2`,
    systemId: 'S1',
    name: '잡자재비',
    specification: '자재비의 2%',
    unit: '식',
    quantity: '1',
    laborMode: 'not-applicable',
    remark: '',
    origin: 'rule',
    derived: { kind: 'material-sum-to-here' },
    rate: '0.02',
  };

  const systems = base.systems.map((system) => ({
    ...system,
    indirectCosts: indirectCostsFor(profile, guides),
  }));

  const document: QuoteDocument = {
    ...base,
    systems,
    rows,
    derivedRows: [conduitDerived, miscDerived],
    // `buildQuoteDocument`의 기본 절사 자릿수는 -4(평택 원본, 만원)다.
    // 가이드는 실측 -3(천원)이다 — 정상 경로(`prepareQuote`)는
    // `coverRoundingOf(guides)`로 이걸 덮어쓰지만, 이 함수는
    // `prepareQuote`를 건너뛰므로(품셈/간접비 재해석 없이 구조만 보는
    // 합성 문서라) **fixture를 실제 가이드 메타데이터에 맞춘다** — 코드에
    // -3을 박지 않고 `guide.coverRoundingDigits`를 그대로 읽는다. 이건
    // fixture가 가이드 기준과 어긋났던 결함(기대 3,850,000 vs 실제
    // 3,854,000, -4 대 -3 절사 차이)이었지 생성기 결함이 아니었다 —
    // 생성기는 가이드 메타데이터를 그대로 썼을 뿐이다.
    rounding: { coverTotalDigits: guide.coverRoundingDigits },
  };

  const calculation = calculateQuote(document);

  const prepared: PreparedQuote = {
    document,
    priced: { calculation, laborBreakdowns: new Map(), laborWarnings: [], blocking: false },
    profileBySystem: new Map([[document.systems[0]!.systemId, profile]]),
    importWarnings: [],
    blocking: false,
  };
  const sharedExport = buildSharedProjection(prepared, {
    supplierByRow: new Map(),
    salesRemarkByRow: new Map(),
  });

  const lines: InternalLine[] = [
    {
      rowId: lfdRowId,
      name: '85인치 LFD',
      specification: 'KQ85QB67',
      unit: 'EA',
      quantity: new Decimal('1'),
      costRegistered: true,
      purchaseUnitPrice: lfdCostUnit,
      purchaseAmount: lfdCostUnit.times(1),
    },
    {
      rowId: conduitRowId,
      name: '난연CD/합성수지 Conduit',
      specification: '28㎜, 천정',
      unit: '10M',
      quantity: new Decimal(conduitRow.quantity),
      costRegistered: true,
      purchaseUnitPrice: conduitCostUnit,
      purchaseAmount: conduitCostUnit.times(conduitRow.quantity),
    },
  ];

  const result = buildSalesGuideWorkbook({
    shared: sharedExport,
    extras: {
      lines,
      aiNotesByRow: new Map(),
      supplierByRow: new Map(),
      salesRemarkByRow: new Map(),
    },
    guide,
    baseGuide: selectGuide(guides, profile, false),
  });
  const layout = result.layout;

  mkdirSync(OUT, { recursive: true });
  const fileStem = `${profile}-cost-derived`;
  writeFileSync(resolve(OUT, `${fileStem}.xlsx`), result.bytes);

  const costUnitCol = layout.column('cost.unit');
  const costAmountCol = layout.column('cost.amount');
  const conduitDerivedRow = layout.derivedRows[0]!.row;
  const miscDerivedRow = layout.derivedRows[1]!.row;

  /**
   * 원가측 독립 기대값 — `guideWorkbook.ts`의 파생 행 규칙을 Decimal로
   * 다시 구현한다(§주석 윗부분 참고). 배관 기타자재의 40% 수식은
   * `derivedFromRow`(INT 없음), 잡자재비의 2% 수식은 `derivedFromRange`
   * (INT 로 내림)다 — 서로 다르다, 섞어 쓰면 안 된다.
   */
  function costSide(conduitQty: Decimal): Record<string, string> {
    const lfdCostAmount = lfdCostUnit.times(1);
    const conduitCostAmount = conduitCostUnit.times(conduitQty);
    const conduitDerivedCostAmount =
      profile === 'ds' ? conduitCostAmount.times('0.4') : new Decimal(0);
    const sumForMisc = lfdCostAmount.plus(conduitCostAmount).plus(conduitDerivedCostAmount);
    const miscCostUnit = sumForMisc.times('0.02').floor();
    const miscCostAmount = miscCostUnit.times(1);
    const directCostSubtotal = sumForMisc.plus(miscCostAmount);

    return {
      [`${costAmountCol}${layout.rows.find((r) => r.rowId === conduitRowId)!.row}`]:
        conduitCostAmount.toFixed(),
      [`${costAmountCol}${conduitDerivedRow}`]: conduitDerivedCostAmount.toFixed(),
      [`${costUnitCol}${miscDerivedRow}`]: miscCostUnit.toFixed(),
      [`${costAmountCol}${miscDerivedRow}`]: miscCostAmount.toFixed(),
      [`${costAmountCol}${layout.directSubtotalRow}`]: directCostSubtotal.toFixed(),
    };
  }

  const baselineCostDetail = costSide(new Decimal(conduitRow.quantity));
  const baselineSellDetail = expectedCellsOf(calculation, layout, guide);
  writeFileSync(
    resolve(OUT, `${fileStem}.expected.json`),
    JSON.stringify(
      {
        ...baselineSellDetail,
        [guide.sheets.detail]: { ...baselineSellDetail[guide.sheets.detail], ...baselineCostDetail },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  // --- 시나리오: 배관(Conduit) 수량 편집 — 원가·판매 양쪽 파생이 같이 따라오는지 ---
  const oldQty = conduitRow.quantity;
  const newQty = String(Number(oldQty) + 7);
  const editedDoc: QuoteDocument = {
    ...document,
    rows: document.rows.map((r) => (r.rowId === conduitRowId ? { ...r, quantity: newQty } : r)),
  };
  const editedCalc = calculateQuote(editedDoc);
  const editedSellDetail = expectedCellsOf(editedCalc, layout, guide);
  const editedCostDetail = costSide(new Decimal(newQty));
  const conduitExcelRow = layout.rows.find((r) => r.rowId === conduitRowId)!.row;

  const scenario: ScenarioEntry = {
    label: `원가측 파생 행 — 배관(Conduit) 수량 편집 ${oldQty}→${newQty} (프로파일 ${profile})`,
    sheet: guide.sheets.detail,
    cell: `${layout.column('quantity')}${conduitExcelRow}`,
    editValue: newQty,
    revertValue: oldQty,
    expected: {
      ...editedSellDetail,
      [guide.sheets.detail]: { ...editedSellDetail[guide.sheets.detail], ...editedCostDetail },
    },
  };

  writeFileSync(
    resolve(OUT, `${fileStem}.scenarios.json`),
    JSON.stringify([scenario], null, 2) + '\n',
    'utf8',
  );
  writeFileSync(
    resolve(OUT, `${fileStem}.layout.json`),
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

  console.log(`${fileStem}  시나리오 1개  ${scenario.label}`);
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
  // **공유용(1단계)을 쓴다.** `buildMultiSystemGuideBase` 단독 호출은
  // 설명·품셈 근거 오버레이가 없는 중간 산출물이라 품셈 참조 열(T열~BA열,
  // Q열 itemRate 등)이 비어 있다 — 단일 시스템의 `buildGuideBase`가 그런
  // 것과 같다. 수량 편집만 보던 기존 시나리오는 우연히 그 열을 안
  // 건드려 드러나지 않았지만, 공수·노임·itemRate 시나리오는 이 열이
  // 꼭 있어야 한다(실측: 오버레이 없이는 T6/Q6/AB6 등이 전부 빈 칸이라
  // 편집이 아무 것도 바꾸지 못했다).
  const sharedExport = buildSharedProjection(prepared, {
    supplierByRow: new Map(),
    salesRemarkByRow: new Map(),
  });
  const base = buildMultiSystemSharedGuideWorkbook({ shared: sharedExport, guideBySystemId });

  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'mixed.xlsx'), base.bytes);

  // 라벨 단가는 바뀌지 않는 시나리오(수량 편집)는 베이스라인 노무 단가
  // 맵을 그대로 쓴다. 시스템·행 둘 다 포함한 전체 요청 목록이 기준이다.
  const requestsAll = prepared.document.rows
    .filter(
      (r): r is typeof r & { type: 'item'; laborMappingId: string } =>
        r.type === 'item' && r.laborMode === 'mapped' && r.laborMappingId !== undefined,
    )
    .map((r) => ({ rowId: r.rowId, laborMappingId: r.laborMappingId, systemId: r.systemId }));
  const baselineLabor = calculateLaborForRows(requestsAll, basis.reference);
  const baselineCalc = calculateQuote(prepared.document, { laborUnitPrices: baselineLabor.unitPrices });

  const otherSysInfo = base.systems[0]!;
  const sysInfo = base.systems[1]!;

  /**
   * 혼합 시스템 기대값 조립 — 편집한 시스템 자신의 세부내역 칸, **건드리지
   * 않은 시스템의 합계가 그대로인지**, 갑지의 합산 금액·절사·한글 금액
   * 문구까지 한 번에 묶는다. 한글 금액은 Excel `NUMBERSTRING` 수식을 그대로
   * 베낀 `koreanAmountSentence`(`koreanAmount.ts`, 실제 Excel 측정으로
   * 고정된 구현)로 독립 계산한다 — 생성기의 수식 출력을 다시 읽는 게
   * 아니라 별도 구현으로 같은 값이 나오는지 본다.
   */
  function mixedExpected(
    editedIndex: 0 | 1,
    editedSys: SystemCalculation,
    untouchedSys: SystemCalculation,
    editedCalc: CalculationSnapshot,
  ): Record<string, Record<string, string>> {
    const editedInfo = base.systems[editedIndex]!;
    const untouchedInfo = base.systems[editedIndex === 0 ? 1 : 0]!;
    const editedLayout = editedInfo.layout;
    const untouchedLayout = untouchedInfo.layout;
    return {
      [editedInfo.sheetName]: {
        [`${editedLayout.column('material.amount')}${editedLayout.directSubtotalRow}`]:
          editedSys.directMaterial.toFixed(),
        [`${editedLayout.column('total')}${editedLayout.grandTotalRow}`]: editedSys.systemTotal.toFixed(),
      },
      [untouchedInfo.sheetName]: {
        // 안 건드린 시스템의 합계 — 편집 전과 같아야 한다(독립 재계산).
        [`${untouchedLayout.column('total')}${untouchedLayout.grandTotalRow}`]:
          untouchedSys.systemTotal.toFixed(),
      },
      [base.sheetNames.cover]: {
        H13: editedCalc.cover.rounded.toFixed(),
        C8: koreanAmountSentence(editedCalc.cover.rounded.toFixed()),
      },
    };
  }

  const scenarios: ScenarioEntry[] = [];

  // --- 시나리오 1: 수량 편집 — 시스템2(DS)의 첫 품목 ---
  {
    const targetSystem = prepared.document.systems[1]!;
    const targetRow = prepared.document.rows.find(
      (r) => r.type === 'item' && r.systemId === targetSystem.systemId,
    )! as QuoteDocument['rows'][number] & { type: 'item'; quantity: string };
    const excelRow = sysInfo.layout.rows.find((r) => r.rowId === targetRow.rowId)!.row;

    const oldQty = targetRow.quantity;
    const newQty = String(Number(oldQty) + 41);
    const editedDoc: QuoteDocument = {
      ...prepared.document,
      rows: prepared.document.rows.map((r) => (r.rowId === targetRow.rowId ? { ...r, quantity: newQty } : r)),
    };
    const editedCalc = calculateQuote(editedDoc, { laborUnitPrices: baselineLabor.unitPrices });

    scenarios.push({
      label: `혼합 시스템 — 시스템2(DS) 수량 편집 ${oldQty}→${newQty}, 시스템1(일반)은 그대로`,
      sheet: sysInfo.sheetName,
      cell: `${sysInfo.layout.column('quantity')}${excelRow}`,
      editValue: newQty,
      revertValue: oldQty,
      expected: mixedExpected(1, editedCalc.systems[1]!, baselineCalc.systems[0]!, editedCalc),
    });
  }

  // --- 시스템1(일반)의 공수·노임·itemRate 편집 — 각 시트가 자기만의
  // 노임표/품셈 참조로 따로 계산되므로, 시스템2(DS)에서 통과했다고
  // 시스템1에서도 통과한다는 보장이 없다. 시스템1을 건드려 시스템2가
  // 그대로인지(반대 방향)도 같이 본다. ---
  const system1 = prepared.document.systems[0]!;
  const system1Guide = guideBySystemId.get(system1.systemId)!;
  const layout1 = otherSysInfo.layout;
  const system1Requests = requestsAll.filter((r) => r.systemId === system1.systemId);
  const target1 = system1Requests[0]!;
  const mapping1 = basis.reference.mappings.find((m) => m.laborMappingId === target1.laborMappingId)!;
  const item1 = basis.reference.items.find((i) => i.laborItemId === mapping1.laborItemId)!;

  function mergedUnitPrices(sys1Labor: ReadonlyMap<string, Decimal>): Map<string, Decimal> {
    const merged = new Map(baselineLabor.unitPrices);
    for (const [rowId, price] of sys1Labor) merged.set(rowId, price);
    return merged;
  }

  // --- 시나리오 2: 직종 공수 0→양수 편집 (시스템1) ---
  {
    const usedTrades = new Set(item1.trades.map((t) => t.trade));
    const newTrade = system1Guide.trades.find((t) => !usedTrades.has(t));
    if (newTrade === undefined) {
      throw new Error('시험 전제가 깨졌다 — 혼합 시스템1에서 빈 직종을 찾지 못했다.');
    }
    const newQuantity = '2';
    const editedItem: LaborItem = {
      ...item1,
      trades: [...item1.trades, { trade: newTrade, quantity: newQuantity }],
    };
    const editedReference: LaborReference = {
      ...basis.reference,
      items: basis.reference.items.map((i) => (i.laborItemId === item1.laborItemId ? editedItem : i)),
    };
    const editedLaborSys1 = calculateLaborForRows(system1Requests, editedReference);
    const editedCalc = calculateQuote(prepared.document, {
      laborUnitPrices: mergedUnitPrices(editedLaborSys1.unitPrices),
    });

    const row = layout1.rows.find((r) => r.rowId === target1.rowId)!.row;
    const tradeIndex = system1Guide.trades.indexOf(newTrade);
    const first = columnIndex(layout1.column('tradeFirst'));
    const qtyColumn = columnName(first + tradeIndex * 2);

    scenarios.push({
      label: `혼합 시스템 — 시스템1(일반) 직종 공수 0→양수 편집 — 행 ${target1.rowId} 직종 '${newTrade}' 품 0→${newQuantity}, 시스템2(DS)는 그대로`,
      sheet: otherSysInfo.sheetName,
      cell: `${qtyColumn}${row}`,
      editValue: newQuantity,
      revertValue: '',
      expected: mixedExpected(0, editedCalc.systems[0]!, baselineCalc.systems[1]!, editedCalc),
    });
  }

  // --- 시나리오 3: 노임 편집 (시스템1) ---
  {
    const trade = item1.trades[0]!.trade;
    const oldWage = basis.reference.wages.wages[trade]!;
    const newAmount = new Decimal(oldWage.amount).plus(50000).toFixed();
    const editedReference: LaborReference = {
      ...basis.reference,
      wages: {
        ...basis.reference.wages,
        wages: { ...basis.reference.wages.wages, [trade]: { ...oldWage, amount: newAmount } },
      },
    };
    const editedLaborSys1 = calculateLaborForRows(system1Requests, editedReference);
    const editedCalc = calculateQuote(prepared.document, {
      laborUnitPrices: mergedUnitPrices(editedLaborSys1.unitPrices),
    });

    const tradeIndex = system1Guide.trades.indexOf(trade);
    const first = columnIndex(layout1.column('tradeFirst'));
    const amountColumn = columnName(first + tradeIndex * 2 + 1);

    scenarios.push({
      label: `혼합 시스템 — 시스템1(일반) 노임 편집 — 직종 '${trade}' 노임 ${oldWage.amount}→${newAmount}, 시스템2(DS)는 그대로`,
      sheet: otherSysInfo.sheetName,
      cell: `${amountColumn}3`,
      editValue: newAmount,
      revertValue: oldWage.amount,
      expected: mixedExpected(0, editedCalc.systems[0]!, baselineCalc.systems[1]!, editedCalc),
    });
  }

  // --- 시나리오 4: 공수 적용률(itemRate) 편집 (시스템1) ---
  {
    const oldItemRate = mapping1.itemRate;
    const newItemRate = new Decimal(oldItemRate).plus('0.5').toFixed();
    const editedMapping: LaborMapping = { ...mapping1, itemRate: newItemRate };
    const editedBreakdown = calculateLaborUnitPrice(item1, editedMapping, basis.reference.wages);
    const editedCalc = calculateQuote(prepared.document, {
      laborUnitPrices: mergedUnitPrices(new Map([[target1.rowId, editedBreakdown.appliedUnitPrice]])),
    });

    const row = layout1.rows.find((r) => r.rowId === target1.rowId)!.row;
    scenarios.push({
      label: `혼합 시스템 — 시스템1(일반) 공수 적용률(itemRate) 편집 — 행 ${target1.rowId} itemRate ${oldItemRate}→${newItemRate}, 시스템2(DS)는 그대로`,
      sheet: otherSysInfo.sheetName,
      cell: `${layout1.column('itemRate')}${row}`,
      editValue: newItemRate,
      revertValue: oldItemRate,
      expected: mixedExpected(0, editedCalc.systems[0]!, baselineCalc.systems[1]!, editedCalc),
    });
  }

  writeFileSync(
    resolve(OUT, 'mixed.scenarios.json'),
    JSON.stringify(scenarios, null, 2) + '\n',
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
  console.log(`mixed  시나리오 ${scenarios.length}개  ` + scenarios.map((s) => s.label).join(' | '));
}

const COMMAND = 'npx vite-node tools/probe_edit_scenarios.ts';

build('general');
build('ds');
buildCostDerived('general');
buildCostDerived('ds');
buildMixed();

const git = gitInfo();
const manifestOut = {
  runId: RUN_ID,
  generatedAt: new Date().toISOString(),
  // dirty 상태면 이 커밋은 **부모**다 — 실제 검증은 이 SHA 더하기
  // dirtyFiles 해시로 가리키는 작업 중 내용으로 돌았다.
  parentSha: git.sha,
  workingTreeDirty: git.dirty,
  dirtyFiles: git.dirtyFiles,
  note:
    git.dirty
      ? '커밋되지 않은 변경이 있는 상태에서 생성했다 — parentSha 커밋 하나만으로 재현되지 않는다. dirtyFiles의 sha256으로 그때 내용을 식별한다.'
      : 'parentSha 커밋 그대로 재현 가능하다(작업 트리가 깨끗했다).',
  command: COMMAND,
  inputSummary:
    '승인된 합성 카탈로그(data/approved/*.json) — 실제 원가·거래처 자료 없음. ' +
    'build()/buildMixed()는 원가를 다루지 않는다(1단계 공유용, 원가 열 없음). ' +
    'buildCostDerived()만 합성 원가를 코드 안에서 직접 주입한다(LFD 2,800,000, Conduit 4,500 — 판매단가와 무관한 임의 값).',
  outputs: readdirSync(OUT).sort(),
};
writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify(manifestOut, null, 2) + '\n', 'utf8');

console.log(`\n산출물: ${OUT}`);
console.log(`커밋 ${git.sha}${git.dirty ? ' (dirty)' : ''}`);
