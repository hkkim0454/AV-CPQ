import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

import { buildQuoteDocument } from '@/domain/quote/buildDocument';
import { calculateQuote } from '@/domain/calculation/calculate';
import { indirectCostsFor } from '@/export/ooxml/guideTemplate';
import { buildCustomerProjection } from '@/export/customer/projection';
import {
  buildCustomerGuideWorkbook,
  buildGuideBase,
} from '@/export/customer/guideWorkbook';
import { buildSalesGuideWorkbook } from '@/export/internal/guideWorkbook';
import { GuideLayoutError } from '@/export/ooxml/guideLayout';
import {
  GUIDE_IDS,
  readGuideTemplate,
  selectGuide,
  type GuideId,
  type GuideManifest,
  type GuideTemplateSet,
  type IndirectProfileId,
} from '@/export/ooxml/guideTemplate';
import type { DerivedRow, QuoteDocument, QuoteHeader } from '@/domain/quote/types';
import type { InternalLineInput } from '@/services/private-cost/calculate';
import { internalLines } from '@/services/private-cost/calculate';

/**
 * 파생 행(배관 기타자재·잡자재비)의 원가측 (계획 2026-10-04 D19, 독립 검토 P1-4/P1-5).
 *
 * ## 실측으로 고정한 템플릿 규칙 (네 가이드 13~15행 원문 대조)
 *
 * ```
 *                일반(won)              DS(ds-won)
 * 배관 기타자재(13)  원가측 공란            원가측 = 직전 행 원가금액 × 40%
 * 잡자재비(14)      원가측 = INT(SUM(원가금액 범위)×2%)   — 두 프로파일 동일
 * 둘 다            원가금액(H) = 수량×원가단가 수식은 항상 있다
 * 직접비계(15)      원가금액 합계(H15=SUM(H6:H14))도 항상 있다
 * ```
 *
 * ## 현재 알려진 경계
 *
 * `buildQuoteDocument` (picker·diagram 두 입구가 공유) 는 `derivedRows: []`
 * 를 고정으로 둔다 — **실제 견적에서 파생 행이 자동으로 생기지 않는다.**
 * 이 테스트는 그 생성 로직이 아니라 **생성기(guideWorkbook)가 파생 행을
 * 받았을 때 올바르게 처리하는지**를 검증한다. 파생 행을 문서에 채워 넣는
 * 작업(어느 품목이 '배관'인지 판정하는 규칙 등)은 별도 과제다.
 */

const ROOT = resolve(__dirname, '../..');

const manifest = (): GuideManifest =>
  JSON.parse(
    readFileSync(resolve(ROOT, 'templates/sanitized/guide-manifest.json'), 'utf8'),
  ) as GuideManifest;

const guideOf = (id: GuideId) =>
  readGuideTemplate(
    id,
    new Uint8Array(readFileSync(resolve(ROOT, `templates/sanitized/guide-${id}.xlsx`))),
    manifest(),
  );

const allGuides = (): GuideTemplateSet =>
  Object.fromEntries(GUIDE_IDS.map((id) => [id, guideOf(id)])) as GuideTemplateSet;

const header = (): QuoteHeader => ({
  quoteNumber: 'DR-1',
  quoteDate: '2026-10-04',
  customer: '합성 고객',
  projectName: '파생 행 검증',
  contact: '',
  conditions: [],
});

/**
 * 품목 두 줄(배관 1개 포함) + 배관 기타자재 + 잡자재비로 문서를 만든다.
 *
 * 노무비는 이 시험의 관심사가 아니다 — 의도적으로 `not-applicable` 을 쓴다.
 * (주의: 실제 견적에서는 이게 간접비까지 0으로 만드는 금지 패턴이다. 여기선
 * 원가측 수식의 구조만 본다.)
 */
function documentWithDerivedRows(
  profile: IndirectProfileId,
  order: 'correct' | 'reversed' = 'correct',
): QuoteDocument {
  const base = buildQuoteDocument({
    header: header(),
    systems: [
      {
        name: '회의실',
        lines: [
          { name: '85인치 LFD', specification: 'KQ85QB67', unit: 'EA', quantity: '1' },
          {
            name: '난연CD/합성수지 Conduit',
            specification: '28㎜, 천정',
            unit: '10M',
            quantity: '2',
          },
        ],
      },
    ],
    documentId: 'doc-dr-1',
    rowIdPrefix: 'dr',
  });

  // buildQuoteDocument 는 품목 행에 sellingUnitPrice 를 넣지 않는다
  // (카탈로그가 없으니까). 이 시험은 구조만 보므로 합성 단가를 심는다.
  const rows = base.rows.map((row, index) =>
    row.type === 'item'
      ? { ...row, sellingUnitPrice: index === 0 ? '3480000' : '6000', laborMode: 'not-applicable' as const }
      : row,
  );
  const conduitRowId = rows[1]!.rowId;

  const conduitDerived: DerivedRow = {
    rowId: 'dr-derived-1',
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
    rowId: 'dr-derived-2',
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

  // **가이드 기준 간접비로 바꾼다.** `buildQuoteDocument` 는 항상 평택
  // 원본의 9항목(standardIndirectCosts)을 쓴다. 실제 파이프라인에서는
  // `prepareQuote` 가 이걸 `indirectCostsFor(profile, guides)` 로 바꾼 뒤에만
  // 가이드 내보내기로 넘긴다 — 그 단계를 건너뛰면 항목 수·id 가 guide 와
  // 안 맞아 "간접비 기준 항목을 찾지 못했다" 가 난다.
  const systems = base.systems.map((system) => ({
    ...system,
    indirectCosts: indirectCostsFor(profile, allGuides()),
  }));

  return {
    ...base,
    systems,
    rows,
    derivedRows: order === 'correct' ? [conduitDerived, miscDerived] : [miscDerived, conduitDerived],
  };
}

function build(profile: IndirectProfileId, level: 0 | 1 | 2) {
  const document = documentWithDerivedRows(profile);
  const calculation = calculateQuote(document);
  const projection = buildCustomerProjection(document, calculation);
  const guide = selectGuide(allGuides(), profile, level === 0);

  if (level === 2) return buildCustomerGuideWorkbook(projection, guide);
  if (level === 1) return buildGuideBase(projection, guide);

  // 0단계 — 첫 품목(LFD)에만 합성 원가를 준다. 배관과 파생 행은 원가
  // 미등록으로 두어, 파생 행 원가가 **문서 cost 세션이 아니라 수식에서**
  // 나오는지를 가린다.
  const lines: InternalLineInput[] = [{ rowId: document.rows[0]!.rowId, quantity: '1' }];
  const extrasLines = internalLines(lines, {
    sessionId: 's',
    size: 0,
    cleared: false,
    lookup: () => undefined,
    byEntryId: () => undefined,
    ownsEntryId: () => false,
    candidatesByModel: () => [],
    knownSkus: () => [],
    knownModels: () => [],
  });
  return buildSalesGuideWorkbook({
    shared: {
      customer: projection,
      details: { descriptionByRow: new Map(), laborByRow: new Map() },
      notes: { supplierByRow: new Map(), salesRemarkByRow: new Map() },
      suspiciousNotes: [],
    },
    extras: {
      lines: extrasLines,
      aiNotesByRow: new Map(),
      supplierByRow: new Map(),
      salesRemarkByRow: new Map(),
    },
    guide,
    baseGuide: selectGuide(allGuides(), profile, false),
  });
}

const detailOf = (bytes: Uint8Array): string =>
  strFromU8(unzipSync(bytes)['xl/worksheets/sheet2.xml']!);

function cellOf(sheet: string, ref: string): string | undefined {
  const m = new RegExp(`<c r="${ref}"[^>]*/>|<c r="${ref}"[^>]*>[\\s\\S]*?</c>`).exec(
    sheet,
  );
  return m?.[0];
}

describe('파생 행 — 재료측 (회귀, 기존 동작)', () => {
  it.each([['general'], ['ds']] as const)(
    '%s: 배관 기타자재 재료단가가 직전 배관 재료금액의 40%% 수식이다',
    (profile) => {
      const result = build(profile, 2);
      const layout = result.layout;
      const conduitDerivedRow = layout.derivedRows[0]!.row;
      const sheet = detailOf(result.bytes);
      const cell = cellOf(sheet, `${layout.column('material.unit')}${conduitDerivedRow}`)!;
      expect(cell).toMatch(/<f>/);
      expect(cell).toContain('*40');
    },
  );
});

describe('파생 행 — 원가측 (P1-4, 0단계에서만 의미가 있다)', () => {
  it('일반 프로파일: 배관 기타자재 원가단가는 비워 둔다 — 템플릿 설계', () => {
    const result = build('general', 0);
    const layout = result.layout;
    const conduitRow = layout.derivedRows[0]!.row;
    const sheet = detailOf(result.bytes);
    const cell = cellOf(sheet, `${layout.column('cost.unit')}${conduitRow}`);
    // 셀 자체가 없거나(서식만 있는 빈 칸), 있어도 값/수식이 없어야 한다.
    if (cell !== undefined) expect(cell).not.toMatch(/<v>|<f>/);
  });

  it('DS 프로파일: 배관 기타자재 원가단가는 직전 배관 원가금액의 40%% 수식이다', () => {
    const result = build('ds', 0);
    const layout = result.layout;
    const conduitRow = layout.derivedRows[0]!.row;
    const sheet = detailOf(result.bytes);
    const cell = cellOf(sheet, `${layout.column('cost.unit')}${conduitRow}`)!;
    expect(cell).toMatch(/<f>/);
    expect(cell).toContain('*40');
  });

  it.each([['general'], ['ds']] as const)(
    '%s: 잡자재비 원가단가는 두 프로파일 모두 원가금액 합의 2%% 수식이다',
    (profile) => {
      const result = build(profile, 0);
      const layout = result.layout;
      const miscRow = layout.derivedRows[1]!.row;
      const sheet = detailOf(result.bytes);
      const cell = cellOf(sheet, `${layout.column('cost.unit')}${miscRow}`)!;
      expect(cell).toMatch(/<f>/);
      expect(cell).toContain('SUM(');
      expect(cell).toContain('*2');
    },
  );

  it.each([['general'], ['ds']] as const)(
    '%s: 파생 행의 원가금액(수량×원가단가)은 두 행 모두 수식이다',
    (profile) => {
      const result = build(profile, 0);
      const layout = result.layout;
      const sheet = detailOf(result.bytes);
      for (const planned of layout.derivedRows) {
        const cell = cellOf(sheet, `${layout.column('cost.amount')}${planned.row}`)!;
        expect(cell, `행 ${planned.row}`).toMatch(/<f>/);
      }
    },
  );

  it.each([['general'], ['ds']] as const)(
    '%s: 원가 직접비계가 파생 행까지 포함해 합산한다',
    (profile) => {
      const result = build(profile, 0);
      const layout = result.layout;
      const sheet = detailOf(result.bytes);
      const cell = cellOf(
        sheet,
        `${layout.column('cost.amount')}${layout.directSubtotalRow}`,
      )!;
      expect(cell).toMatch(/<f>/);
      expect(cell).toContain(`SUM(`);
      // 마지막 파생 행(잡자재비)까지 포함해야 한다.
      const lastDerivedRow = layout.derivedRows[layout.derivedRows.length - 1]!.row;
      expect(cell).toContain(`:${layout.column('cost.amount')}${lastDerivedRow}`);
    },
  );

  it('1단계(공유용)에는 원가 열 자체가 없다 — hasCost 가드', () => {
    const profile: IndirectProfileId = 'general';
    const result = build(profile, 1) as ReturnType<typeof buildGuideBase>;
    // pumsem/ds 가이드에는 cost.unit 역할 자체가 없다. 기본값으로 떨어뜨리지
    // 않고 던지는지 확인한다 — guideLayout.ts 의 기존 규칙이다.
    expect(() => result.layout.column('cost.unit')).toThrow(GuideLayoutError);
  });
});

describe('파생 행 — 순서 (P1-5)', () => {
  it('잡자재비가 배관 기타자재보다 앞에 오면 던진다', () => {
    const document = documentWithDerivedRows('general', 'reversed');
    const calculation = calculateQuote(document);
    const projection = buildCustomerProjection(document, calculation);
    const guide = selectGuide(allGuides(), 'general', false);
    expect(() => buildGuideBase(projection, guide)).toThrow(GuideLayoutError);
    expect(() => buildGuideBase(projection, guide)).toThrow(/순서/);
  });

  /**
   * 독립 검토 재지적: 파생 **종류** 순서 가드(위 시험)만으로는 "원래 행
   * 의미 보존" 요구를 채우지 못한다. 예전에는 `buildGuideBase`가
   * `system.rows`를 품목/파생으로 각각 걸러 모은 뒤 "품목 전부 → 파생
   * 전부" 순서로 다시 썼다 — 파생 행 뒤에 품목 행이 있는 입력이면 그
   * 품목이 조용히 앞으로 당겨져, 잡자재비(`material-sum-to-here`)의
   * 합산 범위가 원본 행 배치보다 넓어졌다.
   *
   * 이제 `planGuideSheet`가 `bodyRows` 순서를 그대로 물리적 행 번호로
   * 쓰므로, "이 품목을 파생 뒤에 둔다"는 입력은 재배치되지 않고 **그
   * 품목이 실제로 잡자재비 합산 범위 밖에 물리적으로 놓인다** — 원본의
   * 행 배치가 가진 의미가 그대로 보존된다.
   */
  it('파생 행 뒤로 옮긴 품목은 잡자재비 합산 범위 밖에 그대로 남는다', () => {
    const document = documentWithDerivedRows('general');
    const calculation = calculateQuote(document);
    const projection = buildCustomerProjection(document, calculation);
    const system = projection.systems[0]!;
    const itemRows = system.rows.filter((r) => r.type === 'item');
    const derivedRows = system.rows.filter((r) => r.type === 'derived');
    const lastItem = itemRows[itemRows.length - 1]!;

    // "이 품목은 파생 뒤에 둔다" = 잡자재비 합산에서 빠져야 한다는 뜻으로
    // 읽히는 입력이다.
    const reordered = {
      ...projection,
      systems: [
        {
          ...system,
          rows: [...itemRows.slice(0, -1), ...derivedRows, lastItem],
        },
      ],
    };
    const guide = selectGuide(allGuides(), 'general', false);
    const result = buildGuideBase(reordered, guide);
    const layout = result.layout;

    const conduitDerivedRow = layout.derivedRows[0]!.row; // 배관 기타자재
    const miscRow = layout.derivedRows[1]!.row; // 잡자재비
    const relocatedItemRow = layout.itemRows[layout.itemRows.length - 1]!.row;

    // 전제 확인: 뒤로 옮긴 품목이 실제로 잡자재비보다 물리적으로 뒤에 있다.
    expect(relocatedItemRow).toBeGreaterThan(miscRow);

    const sheet = detailOf(result.bytes);
    const miscCell = cellOf(sheet, `${layout.column('material.unit')}${miscRow}`)!;
    // 합산 범위는 "품목부터 배관 기타자재까지" 로 끝난다 — 뒤로 간 품목의
    // 행 번호가 범위 끝에 나오면 안 된다.
    expect(miscCell).toContain(`:${layout.column('material.amount')}${conduitDerivedRow}`);
    expect(miscCell).not.toContain(`${layout.column('material.amount')}${relocatedItemRow}`);

    // 뒤로 간 품목 자체는 사라지지 않는다 — 자기 위치에서 정상적으로 계산된다.
    const relocatedCell = cellOf(
      sheet,
      `${layout.column('material.amount')}${relocatedItemRow}`,
    );
    expect(relocatedCell).toBeDefined();
  });
});
