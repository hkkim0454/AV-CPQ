import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

import { calculateQuote } from '@/domain/calculation/calculate';
import { buildCustomerProjection } from '@/export/customer/projection';
import { buildQuoteWorkbook } from '@/export/ooxml/workbook';
import {
  exportInternalXlsx,
  INTERNAL_FILE_MARKER,
  INTERNAL_SHEET_NAME,
} from '@/export/internal/workbook';
import { createSession, clearSession } from '@/services/private-cost/session';
import { internalLines } from '@/services/private-cost/calculate';
import { parseXml, findChild, findChildren } from '@/export/ooxml/xml';
import { TEMPLATE_PATH } from '@/export/ooxml/anchors';
import { syntheticQuote } from '../fixtures/syntheticQuote';

/**
 * 내부용 exporter와 원가 격리 (설계서 §8.7, 인수 기준 A07·A08).
 *
 * 핵심 질문 하나: **같은 세션에서 내부용 파일을 만든 뒤에도 고객용 파일에 원가가 없는가.**
 * sentinel 원가를 심고 ZIP 전체를 뒤져서 증명한다.
 */

const ROOT = resolve(__dirname, '../..');
const OUT_DIR = resolve(ROOT, 'tests/fixtures/out');

/** ZIP 어디에도 나오면 안 되는 합성 원가. 실제 가격이 아니다. */
const SENTINEL_COSTS = {
  'SYNTH-DP-100': '7777777',
  'SYNTH-MNT-02': '6666666',
  'SYNTH-AMP-240': '5555555',
} as const;

let templateBytes: Uint8Array;

beforeAll(() => {
  templateBytes = new Uint8Array(readFileSync(resolve(ROOT, TEMPLATE_PATH)));
  mkdirSync(OUT_DIR, { recursive: true });
});

function setup() {
  const doc = syntheticQuote();
  // 합성 SKU를 행에 붙인다 — 원가표와 맞물리게.
  const skuByRowId: Record<string, string> = {
    r1: 'SYNTH-DP-100',
    r2: 'SYNTH-MNT-02',
    r5: 'SYNTH-AMP-240',
  };
  for (const row of doc.rows) {
    if (row.type !== 'item') continue;
    const sku = skuByRowId[row.rowId];
    if (sku !== undefined) row.sku = sku;
  }

  const calculation = calculateQuote(doc);
  const projection = buildCustomerProjection(doc, calculation);

  const session = createSession(
    Object.entries(SENTINEL_COSTS).map(([sku, price]) => ({
      sku,
      purchaseUnitPrice: price,
      currency: 'KRW' as const,
      unit: 'EA',
    })),
  );

  const lines = internalLines(
    doc.rows
      .filter((r): r is typeof r & { type: 'item' } => r.type === 'item')
      .map((row) => ({
        rowId: row.rowId,
        ...(row.sku !== undefined ? { sku: row.sku } : {}),
        name: row.name,
        specification: row.specification,
        unit: row.unit,
        quantity: row.quantity,
        ...(row.sellingUnitPrice !== undefined
          ? { sellingUnitPrice: row.sellingUnitPrice }
          : {}),
      })),
    session,
  );

  return { doc, calculation, projection, session, lines };
}

function parts(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}

function allText(bytes: Uint8Array): string {
  return Object.values(parts(bytes))
    .map((data) => strFromU8(data))
    .join('\n');
}

describe('exportInternalXlsx — 내부용 파일', () => {
  it('고객용 시트에 원가 분석 시트를 덧붙인다', () => {
    const { projection, lines } = setup();
    const result = exportInternalXlsx(projection, templateBytes, {
      lines,
      costBasisLabel: '합성 원가표 2026-10',
    });
    expect(result.sheetNames).toEqual([
      '갑지',
      '교육장 영상',
      '교육장 음향',
      INTERNAL_SHEET_NAME,
    ]);
  });

  it('파일명에 내부용_원가포함을 명시한다 (설계서 §8.7)', () => {
    const { projection, lines } = setup();
    const result = exportInternalXlsx(projection, templateBytes, {
      lines,
      costBasisLabel: '합성 원가표',
    });
    expect(result.marker).toBe(INTERNAL_FILE_MARKER);
    expect(result.suggestedFileName.startsWith(INTERNAL_FILE_MARKER)).toBe(true);
    expect(result.suggestedFileName.endsWith('.xlsx')).toBe(true);
  });

  it('원가가 내부용 파일에는 실제로 들어 있다 — 안 들어가면 쓸모가 없다', () => {
    const { projection, lines } = setup();
    const result = exportInternalXlsx(projection, templateBytes, {
      lines,
      costBasisLabel: '합성 원가표',
    });
    const text = allText(result.bytes);
    for (const cost of Object.values(SENTINEL_COSTS)) {
      expect(text, `내부용에 ${cost}가 있어야 한다`).toContain(cost);
    }
  });

  it('원가 미등록 행을 0이 아니라 미등록으로 표시한다', () => {
    const { projection, lines } = setup();
    const result = exportInternalXlsx(projection, templateBytes, {
      lines,
      costBasisLabel: '합성 원가표',
    });
    const sheet = parseXml(
      strFromU8(parts(result.bytes)['xl/worksheets/sheet4.xml']!),
    ).root;
    const text = JSON.stringify(sheet);
    expect(text).toContain('미등록');
    // 미등록 행이 있다 — 합성 견적의 7개 품목 중 3개만 원가가 있다
    expect(lines.filter((l) => !l.costRegistered).length).toBeGreaterThan(0);
  });

  it('원가 기준과 가산율 정의를 파일에 적는다', () => {
    const { projection, lines } = setup();
    const result = exportInternalXlsx(projection, templateBytes, {
      lines,
      costBasisLabel: '합성 원가표 2026-10',
    });
    const text = allText(result.bytes);
    expect(text).toContain('합성 원가표 2026-10');
    expect(text).toContain('가산율 = (판매가 - 원가) / 원가');
  });

  it('원가표 파일명을 담지 않는다 (설계서 §6.3)', () => {
    const { projection, lines } = setup();
    const result = exportInternalXlsx(projection, templateBytes, {
      lines,
      costBasisLabel: '합성 원가표',
    });
    const text = allText(result.bytes);
    expect(text).not.toMatch(/원가[\w가-힣]*\.(csv|xlsx)/);
  });
});

describe('원가 격리 — 고객용 파일 (인수 기준 A07·A08)', () => {
  it('같은 세션에서 내부용을 만든 뒤에도 고객용 ZIP에 원가가 없다', () => {
    const { projection, lines } = setup();

    // 내부용을 먼저 만든다 — 상태가 남아 고객용으로 새는지 보려는 것이다.
    const internal = exportInternalXlsx(projection, templateBytes, {
      lines,
      costBasisLabel: '합성 원가표',
    });
    expect(allText(internal.bytes)).toContain('7777777');

    const customer = buildQuoteWorkbook(projection, templateBytes);
    const customerText = allText(customer.bytes);
    for (const cost of Object.values(SENTINEL_COSTS)) {
      expect(customerText, `고객용에 ${cost}가 있으면 안 된다`).not.toContain(cost);
    }
    expect(customerText).not.toContain(INTERNAL_SHEET_NAME);
    expect(customerText).not.toContain(INTERNAL_FILE_MARKER);
  });

  it('고객용 파일에는 시트가 갑지 + 시스템 수만큼만 있다', () => {
    const { projection } = setup();
    const customer = buildQuoteWorkbook(projection, templateBytes);
    expect(customer.sheetNames).toEqual(['갑지', '교육장 영상', '교육장 음향']);

    const wb = parseXml(strFromU8(parts(customer.bytes)['xl/workbook.xml']!)).root;
    const sheets = findChildren(findChild(wb, 'sheets')!, 'sheet');
    expect(sheets).toHaveLength(3);
    // 숨긴 시트로 원가를 남기지 않는다
    for (const sheet of sheets) {
      expect(sheet.attrs['state'] ?? 'visible').toBe('visible');
    }
  });

  it('고객용 projection에 원가가 닿지 않는다 — 타입으로 막혀 있다', () => {
    const { projection } = setup();
    const text = JSON.stringify(projection);
    for (const cost of Object.values(SENTINEL_COSTS)) {
      expect(text).not.toContain(cost);
    }
  });

  it('세션을 지우면 다음 내부용 출력에 원가가 없다', () => {
    const { projection, session, doc } = setup();
    clearSession(session);

    const after = internalLines(
      doc.rows
        .filter((r): r is typeof r & { type: 'item' } => r.type === 'item')
        .map((row) => ({
          rowId: row.rowId,
          ...(row.sku !== undefined ? { sku: row.sku } : {}),
          name: row.name,
          specification: row.specification,
          unit: row.unit,
          quantity: row.quantity,
          ...(row.sellingUnitPrice !== undefined
            ? { sellingUnitPrice: row.sellingUnitPrice }
            : {}),
        })),
      session,
    );
    expect(after.every((l) => !l.costRegistered)).toBe(true);

    const result = exportInternalXlsx(projection, templateBytes, {
      lines: after,
      costBasisLabel: '(원가표 없음)',
    });
    const text = allText(result.bytes);
    for (const cost of Object.values(SENTINEL_COSTS)) {
      expect(text).not.toContain(cost);
    }
  });
});

describe('산출물 저장 — 실제 Excel 검증용', () => {
  it('내부용 통합문서를 쓴다', () => {
    const { projection, lines } = setup();
    const result = exportInternalXlsx(projection, templateBytes, {
      lines,
      costBasisLabel: '합성 원가표 2026-10',
    });
    writeFileSync(resolve(OUT_DIR, 'internal-quote.xlsx'), result.bytes);
    expect(result.bytes.byteLength).toBeGreaterThan(1000);
  });
});

describe('내부용 표 — 열이 실제로 채워진다', () => {
  it('판매단가·판매금액·매입단가·매입금액·이익·가산율이 모두 있다', () => {
    const { projection, lines } = setup();
    const result = exportInternalXlsx(projection, templateBytes, {
      lines,
      costBasisLabel: '합성 원가표',
    });
    const sheet = parseXml(
      strFromU8(parts(result.bytes)['xl/worksheets/sheet4.xml']!),
    ).root;
    const sheetData = findChild(sheet, 'sheetData')!;

    // 4행 = 첫 품목. r1(SYNTH-DP-100) 수량 2, 판매 1,500,000, 매입 7,777,777
    const row4 = findChildren(sheetData, 'row').find((r) => r.attrs['r'] === '4')!;
    const valueAt = (column: string): string | undefined => {
      const c = findChildren(row4, 'c').find((x) => x.attrs['r'] === `${column}4`);
      if (c === undefined) return undefined;
      const inline = findChild(c, 'is');
      if (inline !== undefined) return findChild(inline, 't')?.text;
      return findChild(c, 'v')?.text;
    };

    expect(valueAt('A')).toBe('SYNTH-DP-100');
    expect(valueAt('E')).toBe('2');
    expect(valueAt('F')).toBe('1500000');   // 판매 단가
    expect(valueAt('G')).toBe('3000000');   // 판매 금액
    expect(valueAt('H')).toBe('7777777');   // 매입 단가
    expect(valueAt('I')).toBe('15555554');  // 매입 금액
    expect(valueAt('J')).toBe('-12555554'); // 이익 (합성 원가가 판매가보다 커서 음수다)
    expect(valueAt('K')).toBeDefined();     // 가산율
  });
});
