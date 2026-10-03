import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

import { calculateQuote } from '@/domain/calculation/calculate';
import { buildCustomerProjection } from '@/export/customer/projection';
import { buildQuoteWorkbook } from '@/export/ooxml/workbook';
import { planWorkbook } from '@/export/ooxml/layout';
import { parseXml, findChild, findChildren } from '@/export/ooxml/xml';
import { flattenLineBreaks } from '@/export/ooxml/sheetBuilder';
import { TEMPLATE_PATH } from '@/export/ooxml/anchors';
import { catalogQuote, selectWorstCase, displayWidth } from '../fixtures/catalogQuote';

/**
 * 실제 카탈로그 품명으로 다페이지 출력 재확인 (열린 항목 O2b).
 *
 * 합성 품명으로는 이미 통과했다. 여기서는 **실제 1,468개 제품 중 가장 불리한 품목**을
 * 골라 쓴다. 금액은 단언하지 않는다 — 회사 판매가가 테스트 출력에 찍히지 않게 한다.
 */

const ROOT = resolve(__dirname, '../..');
const OUT_DIR = resolve(ROOT, 'tests/fixtures/out');

let templateBytes: Uint8Array;

beforeAll(() => {
  templateBytes = new Uint8Array(readFileSync(resolve(ROOT, TEMPLATE_PATH)));
  mkdirSync(OUT_DIR, { recursive: true });
});

function build(itemCount = 100) {
  const doc = catalogQuote(itemCount);
  const calculation = calculateQuote(doc);
  const projection = buildCustomerProjection(doc, calculation);
  const result = buildQuoteWorkbook(projection, templateBytes);
  return { doc, calculation, projection, result };
}

function parts(bytes: Uint8Array) {
  return unzipSync(bytes);
}

function textCells(bytes: Uint8Array, sheetIndex: number): Map<string, string> {
  const ws = parseXml(
    strFromU8(parts(bytes)[`xl/worksheets/sheet${sheetIndex}.xml`]!),
  ).root;
  const out = new Map<string, string>();
  for (const row of findChildren(findChild(ws, 'sheetData')!, 'row')) {
    for (const cell of findChildren(row, 'c')) {
      const inline = findChild(cell, 'is');
      if (inline === undefined) continue;
      out.set(cell.attrs['r']!, findChild(inline, 't')?.text ?? '');
    }
  }
  return out;
}

describe('flattenLineBreaks — 셀 안 줄바꿈 (O2b에서 발견)', () => {
  it('줄바꿈을 공백 하나로 눕힌다', () => {
    expect(flattenLineBreaks('H_4xHDMI output card\n(HDMI 1.4 - Dual Link)')).toBe(
      'H_4xHDMI output card (HDMI 1.4 - Dual Link)',
    );
  });

  it('줄바꿈 주변 공백까지 하나로 합친다', () => {
    expect(flattenLineBreaks('5C-CRIMP\n F-5C')).toBe('5C-CRIMP F-5C');
  });

  it('CRLF도 처리한다', () => {
    expect(flattenLineBreaks('a\r\nb')).toBe('a b');
  });

  it('여러 줄도 전부 눕힌다', () => {
    expect(flattenLineBreaks('In : 40Mono\nOut : 25Bus\nTotal : 65ch')).toBe(
      'In : 40Mono Out : 25Bus Total : 65ch',
    );
  });

  it('줄바꿈이 없으면 그대로 둔다 — 연속 공백은 원본 의도다', () => {
    expect(flattenLineBreaks('H_4xHDMI  output  card')).toBe('H_4xHDMI  output  card');
  });
});

describe('selectWorstCase — 실제 카탈로그에서 불리한 품목 선정', () => {
  it('다섯 가지 근거로 고른다', () => {
    const { picks, totalProducts } = selectWorstCase(12);
    expect(totalProducts).toBeGreaterThan(1000);
    expect(picks.length).toBeGreaterThan(8);
    const reasons = new Set(picks.map((p) => p.reason));
    expect(reasons).toContain('셀 안 줄바꿈');
    expect(reasons).toContain('품명 폭 최대');
    expect(reasons).toContain('영문+한글 혼용');
  });

  it('B열 너비 28.625를 크게 넘는 품명이 실제로 있다', () => {
    const { picks } = selectWorstCase(12);
    const widest = Math.max(...picks.map((p) => displayWidth(p.product.quoteName)));
    expect(widest).toBeGreaterThan(50);
  });
});

describe('catalogQuote — 실제 품명 다페이지 출력', () => {
  it('100행 견적을 만든다', () => {
    const { doc } = build(100);
    const items = doc.rows.filter((r) => r.type === 'item');
    expect(items).toHaveLength(100);
  });

  it('줄바꿈이 든 규격을 눕혀서 내보낸다 — 잘리지 않는다', () => {
    const { result } = build(100);
    const cells = textCells(result.bytes, 2);
    for (const [ref, value] of cells) {
      expect(value, `${ref}에 줄바꿈이 남았다`).not.toContain('\n');
      expect(value, `${ref}에 CR이 남았다`).not.toContain('\r');
    }
  });

  it('줄바꿈을 지우지 않고 눕힌다 — 내용이 사라지지 않는다', () => {
    const { doc, result } = build(100);
    const cells = textCells(result.bytes, 2);
    const exported = [...cells.values()].join('\n');
    for (const row of doc.rows) {
      if (row.type !== 'item') continue;
      if (!row.specification.includes('\n')) continue;
      // 줄바꿈 뒤쪽 조각이 출력에 남아 있어야 한다
      const tail = row.specification.split(/[\r\n]+/).at(-1)!.trim();
      if (tail === '') continue;
      expect(exported, `'${tail}'가 사라졌다`).toContain(tail);
    }
  });

  it('긴 품명을 자르지 않는다', () => {
    const { doc, result } = build(100);
    const cells = textCells(result.bytes, 2);
    const exported = new Set(cells.values());
    const longest = doc.rows
      .filter((r): r is typeof r & { type: 'item' } => r.type === 'item')
      .map((r) => r.name)
      .sort((a, b) => displayWidth(b) - displayWidth(a))[0]!;
    expect(exported.has(flattenLineBreaks(longest))).toBe(true);
  });

  it('단가 미등록 제품을 0으로 바꾸지 않는다 (설계서 §5.6)', () => {
    const { doc, calculation } = build(100);
    const unpriced = doc.rows.filter(
      (r) => r.type === 'item' && r.sellingUnitPrice === undefined,
    );
    if (unpriced.length === 0) return;
    expect(calculation.warnings.some((w) => w.code === 'price-not-registered')).toBe(true);
    expect(calculation.blocking).toBe(true);
  });

  it('다페이지가 되는 행 수다', () => {
    const { projection } = build(100);
    const layout = planWorkbook(projection);
    // 품목 100 + 그룹 1 + 소그룹 3 = 104행 본문, 합계 121행
    expect(layout.systems[0]!.lastRow).toBeGreaterThan(110);
  });

  it('XML이 깨지지 않는다 — 특수문자를 올바르게 이스케이프한다', () => {
    const { result } = build(100);
    for (const [name, data] of Object.entries(parts(result.bytes))) {
      if (!name.endsWith('.xml')) continue;
      expect(() => parseXml(strFromU8(data)), `${name} 파싱 실패`).not.toThrow();
    }
  });
});

describe('산출물 저장 — 실제 Excel 검증용 (O2b)', () => {
  it('실제 품명 다페이지 통합문서를 쓴다', () => {
    const { result, calculation, projection } = build(100);
    writeFileSync(resolve(OUT_DIR, 'catalog-quote.xlsx'), result.bytes);

    const layout = planWorkbook(projection);
    const system = layout.systems[0]!;
    writeFileSync(
      resolve(OUT_DIR, 'catalog-quote.expected.json'),
      JSON.stringify(
        {
          [system.sheetName]: {
            [`J${system.grandTotalRow}`]: system.calculation.systemTotal.toFixed(),
          },
          갑지: {
            [`H${layout.cover.finalRow}`]: calculation.cover.finalTotal.toFixed(),
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    expect(result.bytes.byteLength).toBeGreaterThan(1000);
  });
});
