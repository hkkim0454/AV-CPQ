/**
 * 내부용 통합문서 — 원가가 들어간다 (설계서 §8.7).
 *
 * 설계서 §8.7의 요구를 코드 구조로 지킨다.
 *
 * > "고객용과 내부용은 별도 exporter와 allowlist projection을 사용한다.
 * >  원가 통합문서를 만든 후 열만 숨겨 고객용으로 보내지 않는다.
 * >  내부용 파일명과 다운로드 화면에 `내부용_원가포함`을 명시한다."
 *
 * 방향이 중요하다. **고객용 → 내부용**으로만 만든다. 고객용 통합문서에 원가 분석
 * 시트를 **덧붙이는** 방식이라, 내부용에서 뭔가를 지워 고객용을 만드는 경로가 아예 없다.
 * 지우는 방식이면 하나를 빠뜨렸을 때 원가가 고객에게 간다.
 *
 * 이 모듈은 `services/private-cost`를 import한다. 그래서 `tools/audit-exports.mjs`의
 * 원가-금지 경로 목록에 `src/export/internal`이 **없다**. 고객용 경로
 * (`src/export/customer`, `src/export/ooxml`, `src/domain`)에는 있다.
 */
import { serializeXml } from '../ooxml/xml';
import { buildWorksheet, num, str, type BuiltRow, type PlannedCell } from '../ooxml/sheetBuilder';
import { SYSTEM_COLUMNS } from '../ooxml/cellRef';
import { SYSTEM_ANCHOR } from '../ooxml/anchors';
import {
  buildQuoteWorkbook,
  type BuildWorkbookResult,
  type ExtraSheet,
  type TemplatePackage,
} from '../ooxml/workbook';
import type { CustomerExport } from '../customer/projection';
import type { InternalLine } from '../../services/private-cost/calculate';
import { Decimal } from '../../domain/calculation/rounding';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** 설계서 §8.7: 파일명에 명시한다. */
export const INTERNAL_FILE_MARKER = '내부용_원가포함';

export const INTERNAL_SHEET_NAME = '내부용_원가분석';

const HEADER_TOP = [
  '구분',
  '품 명',
  '규 격',
  '단위',
  '수량',
  '판매',
  '',
  '매입',
  '',
  '이익',
  '가산율',
] as const;

const HEADER_BOTTOM = ['', '', '', '', '', '단 가', '금 액', '단 가', '금 액', '', ''] as const;

function cell(column: string, content: PlannedCell['content']): PlannedCell {
  return { column, content };
}

function decimalText(value: Decimal | undefined): string | undefined {
  return value === undefined ? undefined : value.toFixed();
}

/** 가산율을 백분율 문자열로. 계산 불가면 `-`. */
function rateText(value: Decimal | undefined): string {
  return value === undefined ? '-' : `${value.times(100).toDecimalPlaces(1).toFixed()}%`;
}

export interface InternalSheetInput {
  lines: readonly InternalLine[];
  /** 원가표 기준 라벨. **파일명은 담지 않는다** (설계서 §6.3). */
  costBasisLabel: string;
}

/**
 * 원가 분석 시트 XML.
 *
 * 서식은 템플릿 내역 시트의 모델 행에서 가져온다 — 같은 글꼴·테두리·금액 서식을 쓴다.
 */
function buildCostSheet(template: TemplatePackage, input: InternalSheetInput): string {
  const skeleton = template.systemSkeleton;
  const modelRow = (anchor: number) => {
    const row = skeleton.rows.get(anchor);
    if (row === undefined) throw new Error(`템플릿 모델 행 ${anchor}이 없다.`);
    return row;
  };

  const rows: BuiltRow[] = [];

  rows.push({
    row: 1,
    skeleton: modelRow(SYSTEM_ANCHOR.title),
    cells: [cell('A', str(`▣ ${INTERNAL_FILE_MARKER} — 고객에게 보내지 않는다`))],
  });

  rows.push({
    row: 2,
    skeleton: modelRow(SYSTEM_ANCHOR.headerTop),
    cells: SYSTEM_COLUMNS.map((column, index) => cell(column, str(HEADER_TOP[index]))),
  });
  rows.push({
    row: 3,
    skeleton: modelRow(SYSTEM_ANCHOR.headerBottom),
    cells: SYSTEM_COLUMNS.map((column, index) => cell(column, str(HEADER_BOTTOM[index]))),
  });

  let totalSelling = new Decimal(0);
  let totalPurchase = new Decimal(0);
  let totalProfit = new Decimal(0);
  let unregistered = 0;

  input.lines.forEach((line, index) => {
    const row = 4 + index;
    const anchor = index === 0 ? SYSTEM_ANCHOR.firstItem : SYSTEM_ANCHOR.item;

    if (line.sellingAmount !== undefined) totalSelling = totalSelling.plus(line.sellingAmount);
    if (line.purchaseAmount !== undefined) totalPurchase = totalPurchase.plus(line.purchaseAmount);
    if (line.profitAmount !== undefined) totalProfit = totalProfit.plus(line.profitAmount);
    if (!line.costRegistered) unregistered += 1;

    rows.push({
      row,
      skeleton: modelRow(anchor),
      cells: [
        cell('A', str(line.sku ?? '')),
        cell('B', str(line.name)),
        cell('C', str(line.specification)),
        cell('D', str(line.unit)),
        cell('E', num(line.quantity.toFixed())),
        cell('F', num(decimalText(line.sellingUnitPrice))),
        cell('G', num(decimalText(line.sellingAmount))),
        // 설계서 §5.6 / §8.3: 미등록 원가를 0으로 쓰지 않는다. `미등록`으로 표시한다.
        cell('H', line.costRegistered ? num(decimalText(line.purchaseUnitPrice)) : str('미등록')),
        cell('I', line.costRegistered ? num(decimalText(line.purchaseAmount)) : str('미등록')),
        cell('J', num(decimalText(line.profitAmount))),
        cell('K', str(line.costRegistered ? rateText(line.markupRate) : '-')),
      ],
    });
  });

  const totalRow = 4 + input.lines.length;
  rows.push({
    row: totalRow,
    skeleton: modelRow(SYSTEM_ANCHOR.directTotal),
    cells: [
      cell('A', str('합 계')),
      cell('G', num(totalSelling.toFixed())),
      cell('I', num(totalPurchase.toFixed())),
      cell('J', num(totalProfit.toFixed())),
      cell(
        'K',
        str(
          totalPurchase.isZero()
            ? '-'
            : `${totalSelling.minus(totalPurchase).dividedBy(totalPurchase).times(100).toDecimalPlaces(1).toFixed()}%`,
        ),
      ),
    ],
  });

  const noteRow = totalRow + 2;
  rows.push({
    row: noteRow,
    skeleton: modelRow(SYSTEM_ANCHOR.item),
    cells: [
      cell(
        'A',
        str(
          `원가 기준: ${input.costBasisLabel} · 원가 미등록 ${unregistered}건 · ` +
            '가산율 = (판매가 - 원가) / 원가',
        ),
      ),
    ],
  });

  const merges = [
    'A1:K1',
    'F2:G2',
    'H2:I2',
    'A2:A3',
    'B2:B3',
    'C2:C3',
    'D2:D3',
    'E2:E3',
    'J2:J3',
    'K2:K3',
    `A${totalRow}:C${totalRow}`,
    `A${noteRow}:K${noteRow}`,
  ];

  return (
    XML_DECL +
    serializeXml({
      root: buildWorksheet({
        skeleton,
        rows,
        columns: SYSTEM_COLUMNS,
        dimension: `A1:K${noteRow}`,
        mergeRefs: merges,
      }),
    })
  );
}

export interface InternalWorkbookResult extends BuildWorkbookResult {
  /** 다운로드 화면과 파일명에 쓸 표식 (설계서 §8.7). */
  marker: typeof INTERNAL_FILE_MARKER;
  suggestedFileName: string;
}

/**
 * 내부용 통합문서를 만든다.
 *
 * 고객용 통합문서에 `내부용_원가분석` 시트를 **덧붙인다.**
 * 고객용 시트의 내용은 그대로다 — 원가가 그쪽으로 새지 않는다.
 *
 * 설계서 §8.7: "웹의 일반 저장 버튼으로 내부용 원가 파일을 자동 저장하지 않는다."
 * 그래서 이 함수는 저장하지 않고 바이트만 돌려준다. 저장은 호출자가 명시적으로 한다.
 */
export function exportInternalXlsx(
  exported: CustomerExport,
  templateBytes: Uint8Array,
  input: InternalSheetInput,
): InternalWorkbookResult {
  const extra: ExtraSheet = {
    name: INTERNAL_SHEET_NAME,
    printArea: `$A$1:$K$${4 + input.lines.length + 2}`,
    build: (template) => buildCostSheet(template, input),
  };

  const result = buildQuoteWorkbook(exported, templateBytes, { extraSheets: [extra] });

  const safeProject = exported.header.projectName.replace(/[\\/:*?"<>|]/g, '_');
  return {
    ...result,
    marker: INTERNAL_FILE_MARKER,
    suggestedFileName: `${INTERNAL_FILE_MARKER}_${safeProject}_${exported.header.quoteNumber}.xlsx`,
  };
}
