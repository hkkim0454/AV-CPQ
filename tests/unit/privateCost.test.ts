import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';

import { readTable, TableReadError } from '@/services/private-cost/readTable';
import { parsePrivatePrices } from '@/services/private-cost/parse';
import { createSession, clearSession } from '@/services/private-cost/session';
import { markupRate, marginRate, internalLines } from '@/services/private-cost/calculate';
import { DEFAULT_LIMITS } from '@/services/private-cost/limits';

/**
 * 설계서 §8. 여기 숫자는 전부 합성 값이다.
 * §8.4: "테스트 녹화와 console에 실제 원가를 넣지 않는다."
 */

const MAPPING = {
  sku: 'SKU',
  purchaseUnitPrice: '매입단가',
  currency: '통화',
  unit: '단위',
} as const;

function csv(text: string): Uint8Array {
  return strToU8(text);
}

/** 값 전용 XLSX를 합성한다 — sharedStrings를 쓰는 전형적인 형태. */
function makeXlsx(rows: string[][], options: { formulaAt?: [number, number] } = {}): Uint8Array {
  const strings: string[] = [];
  const indexOf = (value: string) => {
    const at = strings.indexOf(value);
    if (at !== -1) return at;
    strings.push(value);
    return strings.length - 1;
  };

  const rowXml = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
          if (options.formulaAt && options.formulaAt[0] === r && options.formulaAt[1] === c) {
            return `<c r="${ref}"><f>1000*2</f><v>${value}</v></c>`;
          }
          if (/^-?\d+(\.\d+)?$/.test(value)) {
            return `<c r="${ref}"><v>${value}</v></c>`;
          }
          return `<c r="${ref}" t="s"><v>${indexOf(value)}</v></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');

  const sheet =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${rowXml}</sheetData></worksheet>`;

  const sst =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
    strings.map((s) => `<si><t>${s}</t></si>`).join('') +
    '</sst>';

  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="원가" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
        '</Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
    'xl/sharedStrings.xml': strToU8(sst),
  });
}

// ---------------------------------------------------------------------------

describe('readTable — CSV', () => {
  it('머리글과 데이터 행을 읽는다', () => {
    const table = readTable(csv('SKU,매입단가,통화,단위\nA-1,1000,KRW,EA\n'), 'csv');
    expect(table.header).toEqual(['SKU', '매입단가', '통화', '단위']);
    expect(table.rows).toEqual([['A-1', '1000', 'KRW', 'EA']]);
  });

  it('따옴표 안의 쉼표와 줄바꿈을 처리한다', () => {
    const table = readTable(csv('SKU,설명\n"A,1","두 줄\n설명"\n'), 'csv');
    expect(table.rows[0]).toEqual(['A,1', '두 줄\n설명']);
  });

  it('BOM을 벗긴다', () => {
    const table = readTable(csv('﻿SKU,매입단가\nA-1,1000\n'), 'csv');
    expect(table.header[0]).toBe('SKU');
  });

  it('행 수 제한을 넘기면 거부한다', () => {
    const many = ['SKU,매입단가', ...Array.from({ length: 20 }, (_, i) => `A-${i},1`)].join('\n');
    expect(() => readTable(csv(many), 'csv', { ...DEFAULT_LIMITS, maxRows: 10 })).toThrow(
      TableReadError,
    );
  });

  it('파일 크기 제한을 넘기면 거부한다', () => {
    expect(() => readTable(csv('a'.repeat(100)), 'csv', { ...DEFAULT_LIMITS, maxBytes: 10 })).toThrow(
      TableReadError,
    );
  });
});

describe('readTable — XLSX (설계서 §8.3)', () => {
  it('값 전용 XLSX를 읽는다', () => {
    const bytes = makeXlsx([
      ['SKU', '매입단가', '통화', '단위'],
      ['A-1', '1000', 'KRW', 'EA'],
    ]);
    const table = readTable(bytes, 'xlsx');
    expect(table.header).toEqual(['SKU', '매입단가', '통화', '단위']);
    expect(table.rows[0]).toEqual(['A-1', '1000', 'KRW', 'EA']);
  });

  /**
   * B1 — 품셈 파일은 **수식투성이**다. 원가와 무관한 셀의 수식 때문에
   * 파일 전체가 거부되면 사용자가 원가를 못 올린다.
   *
   * 설계서 §8.3의 취지는 *"수식이 만든 가격을 그대로 믿지 말자"*지
   * *"수식 있는 파일을 거부하자"*가 아니다. 검사는 **읽는 가격 열에만** 건다.
   */
  it('가격과 무관한 열의 수식 때문에 파일이 거부되지 않는다', () => {
    const bytes = makeXlsx(
      [
        ['SKU', '매입단가', '통화', '단위', '품셈계산'],
        ['A-1', '2000', 'KRW', 'EA', '42'],
      ],
      { formulaAt: [1, 4] },
    );
    const table = readTable(bytes, 'xlsx');
    expect(table.rows[0]![1]).toBe('2000');
  });

  it('수식이 있던 자리를 행·열로 알려준다', () => {
    const bytes = makeXlsx(
      [
        ['SKU', '매입단가'],
        ['A-1', '2000'],
      ],
      { formulaAt: [1, 1] },
    );
    const table = readTable(bytes, 'xlsx');
    expect(table.formulaColumns[0]!.has(1)).toBe(true);
    expect(table.formulaColumns[0]!.has(0)).toBe(false);
  });

  it('CSV에는 수식 자리가 없다', () => {
    const table = readTable(csv('SKU,매입단가\nA-1,1000\n'), 'csv');
    expect(table.formulaColumns[0]!.size).toBe(0);
  });

  it('매크로 통합문서를 거부한다', () => {
    const bytes = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'xl/vbaProject.bin': strToU8('fake'),
    });
    expect(() => readTable(bytes, 'xlsx')).toThrow(/매크로/);
  });

  it('외부 링크가 있는 통합문서를 거부한다', () => {
    const bytes = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'xl/externalLinks/externalLink1.xml': strToU8('<externalLink/>'),
    });
    expect(() => readTable(bytes, 'xlsx')).toThrow(/외부 링크/);
  });

  it('암호화된 파일을 거부한다', () => {
    // OLE 복합 문서 서명으로 시작하는 파일 = 암호화된 OOXML
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    expect(() => readTable(ole, 'xlsx')).toThrow(/암호|형식/);
  });

  it('압축 해제 크기 제한을 넘기면 거부한다 — ZIP 폭탄 방지', () => {
    const big = makeXlsx([
      ['SKU', '매입단가'],
      ['A-1', '1000'],
    ]);
    expect(() => readTable(big, 'xlsx', { ...DEFAULT_LIMITS, maxUnzippedBytes: 10 })).toThrow(
      TableReadError,
    );
  });
});

describe('parsePrivatePrices — 가격 열 수식 (B1)', () => {
  it('매입단가 열에 수식이 있으면 그 행만 막는다', () => {
    const bytes = makeXlsx(
      [
        ['SKU', '매입단가', '통화', '단위'],
        ['A-1', '2000', 'KRW', 'EA'],
        ['A-2', '3000', 'KRW', 'EA'],
      ],
      { formulaAt: [1, 1] },
    );
    const result = parsePrivatePrices(readTable(bytes, 'xlsx'), MAPPING);
    expect(result.errors.map((e) => e.code)).toEqual(['price-formula']);
    expect(result.errors[0]!.row).toBe(1);
    // 나머지 행은 살아 있다 — 파일 전체를 버리지 않는다.
    expect(result.entries.map((e) => e.sku)).toEqual(['A-2']);
  });

  it('오류 메시지에 값을 담지 않는다 (설계서 §8.4)', () => {
    const bytes = makeXlsx(
      [
        ['SKU', '매입단가', '통화', '단위'],
        ['A-1', '123456789', 'KRW', 'EA'],
      ],
      { formulaAt: [1, 1] },
    );
    const result = parsePrivatePrices(readTable(bytes, 'xlsx'), MAPPING);
    expect(result.errors[0]!.message).not.toContain('123456789');
  });

  it('가격 아닌 열의 수식은 통과시킨다', () => {
    const bytes = makeXlsx(
      [
        ['SKU', '매입단가', '통화', '단위', '품셈계산'],
        ['A-1', '2000', 'KRW', 'EA', '42'],
      ],
      { formulaAt: [1, 4] },
    );
    const result = parsePrivatePrices(readTable(bytes, 'xlsx'), MAPPING);
    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(1);
  });
});

describe('parsePrivatePrices — 열 매핑과 검증 (설계서 §8.2, §8.3)', () => {
  const good = csv('SKU,매입단가,통화,단위\nA-1,1000,KRW,EA\nB-2,2500,KRW,M\n');

  it('필수 열을 매핑해 읽는다', () => {
    const result = parsePrivatePrices(readTable(good, 'csv'), MAPPING);
    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({ sku: 'A-1', currency: 'KRW', unit: 'EA' });
  });

  it('열 위치가 달라도 이름으로 찾는다', () => {
    const shuffled = csv('단위,통화,SKU,매입단가\nEA,KRW,A-1,1000\n');
    const result = parsePrivatePrices(readTable(shuffled, 'csv'), MAPPING);
    expect(result.errors).toEqual([]);
    expect(result.entries[0]!.sku).toBe('A-1');
  });

  it('필수 열이 없으면 오류다', () => {
    const missing = csv('SKU,통화,단위\nA-1,KRW,EA\n');
    const result = parsePrivatePrices(readTable(missing, 'csv'), MAPPING);
    expect(result.entries).toEqual([]);
    expect(result.errors.some((e) => e.code === 'column-missing')).toBe(true);
  });

  it('중복 SKU는 오류다', () => {
    const dup = csv('SKU,매입단가,통화,단위\nA-1,1000,KRW,EA\nA-1,1200,KRW,EA\n');
    const result = parsePrivatePrices(readTable(dup, 'csv'), MAPPING);
    expect(result.errors.some((e) => e.code === 'duplicate-sku')).toBe(true);
  });

  it('빈 가격은 오류다 — 0으로 바꾸지 않는다', () => {
    const empty = csv('SKU,매입단가,통화,단위\nA-1,,KRW,EA\n');
    const result = parsePrivatePrices(readTable(empty, 'csv'), MAPPING);
    expect(result.errors.some((e) => e.code === 'price-empty')).toBe(true);
    expect(result.entries).toHaveLength(0);
  });

  it('명시적으로 입력된 0은 유효한 값이다', () => {
    const zero = csv('SKU,매입단가,통화,단위\nA-1,0,KRW,EA\n');
    const result = parsePrivatePrices(readTable(zero, 'csv'), MAPPING);
    expect(result.errors).toEqual([]);
    expect(result.entries[0]!.purchaseUnitPrice).toBe('0');
  });

  it('숫자가 아닌 가격은 오류다', () => {
    const bad = csv('SKU,매입단가,통화,단위\nA-1,약 1000원,KRW,EA\n');
    const result = parsePrivatePrices(readTable(bad, 'csv'), MAPPING);
    expect(result.errors.some((e) => e.code === 'price-not-numeric')).toBe(true);
  });

  it('천 단위 구분 기호와 통화 기호는 허용한다', () => {
    const formatted = csv('SKU,매입단가,통화,단위\nA-1,"1,234,567",KRW,EA\n');
    const result = parsePrivatePrices(readTable(formatted, 'csv'), MAPPING);
    expect(result.errors).toEqual([]);
    expect(result.entries[0]!.purchaseUnitPrice).toBe('1234567');
  });

  it('통화가 섞이면 오류다', () => {
    const mixed = csv('SKU,매입단가,통화,단위\nA-1,1000,KRW,EA\nB-2,20,USD,EA\n');
    const result = parsePrivatePrices(readTable(mixed, 'csv'), MAPPING);
    expect(result.errors.some((e) => e.code === 'currency-mixed')).toBe(true);
  });

  it('단위가 비면 오류다', () => {
    const noUnit = csv('SKU,매입단가,통화,단위\nA-1,1000,KRW,\n');
    const result = parsePrivatePrices(readTable(noUnit, 'csv'), MAPPING);
    expect(result.errors.some((e) => e.code === 'unit-empty')).toBe(true);
  });

  it('오류 메시지에 원가 값을 넣지 않는다 (설계서 §8.4)', () => {
    const bad = csv('SKU,매입단가,통화,단위\nA-1,7777777x,KRW,EA\n');
    const result = parsePrivatePrices(readTable(bad, 'csv'), MAPPING);
    for (const error of result.errors) {
      expect(JSON.stringify(error)).not.toContain('7777777');
    }
  });
});

describe('PrivateCostSession — 메모리 전용 (설계서 §8.1, §8.4)', () => {
  const entries = [
    { sku: 'A-1', purchaseUnitPrice: '1000', currency: 'KRW' as const, unit: 'EA' },
    { sku: 'B-2', purchaseUnitPrice: '2500', currency: 'KRW' as const, unit: 'M' },
  ];

  it('SKU로 원가를 찾는다', () => {
    const session = createSession(entries);
    expect(session.lookup('A-1')?.purchaseUnitPrice).toBe('1000');
    expect(session.lookup('없는SKU')).toBeUndefined();
  });

  it('SKU 매칭은 정확 일치다 — 부분 일치로 엉뚱한 원가를 붙이지 않는다', () => {
    const session = createSession(entries);
    expect(session.lookup('A-10')).toBeUndefined();
    expect(session.lookup('a-1')).toBeUndefined();
  });

  it('지우면 아무것도 남지 않는다', () => {
    const session = createSession(entries);
    clearSession(session);
    expect(session.lookup('A-1')).toBeUndefined();
    expect(session.size).toBe(0);
    expect(session.cleared).toBe(true);
  });

  it('JSON 직렬화에 원가가 노출되지 않는다', () => {
    const session = createSession(entries);
    expect(JSON.stringify(session)).not.toContain('1000');
    expect(JSON.stringify(session)).not.toContain('2500');
  });

  it('원가표 파일명을 담지 않는다 (설계서 §6.3)', () => {
    const session = createSession(entries);
    expect(Object.keys(session)).not.toContain('fileName');
    expect(JSON.stringify(session)).not.toContain('.csv');
  });
});

describe('가산율과 이익률 (설계서 §8.7)', () => {
  it('가산율 = (판매가 - 원가) / 원가', () => {
    expect(markupRate('1500', '1000')?.toFixed()).toBe('0.5');
  });

  it('이익률 = (판매가 - 원가) / 판매가', () => {
    // 500 / 1500 = 1/3. JS number로는 정확히 쓸 수 없으므로 Decimal 의미로 확인한다.
    const rate = marginRate('1500', '1000')!;
    expect(rate.times(3).toFixed(0)).toBe('1');
    expect(rate.toSignificantDigits(12).toFixed()).toBe('0.333333333333');
  });

  it('나눗셈에서 부동소수 오차가 끼지 않는다', () => {
    // 0.1 + 0.2 !== 0.3 인 JS number와 달리 정확해야 한다.
    expect(markupRate('1100', '1000')?.toFixed()).toBe('0.1');
  });

  it('두 값은 다르다 — 혼동하지 않는다', () => {
    const markup = markupRate('1500', '1000')!;
    const margin = marginRate('1500', '1000')!;
    expect(markup.equals(margin)).toBe(false);
  });

  it('원가가 0이면 가산율은 계산 불가다', () => {
    expect(markupRate('1500', '0')).toBeUndefined();
  });

  it('판매가가 0이면 이익률은 계산 불가다', () => {
    expect(marginRate('0', '1000')).toBeUndefined();
  });

  it('원가 손실도 음수로 정확히 낸다', () => {
    expect(markupRate('800', '1000')?.toFixed()).toBe('-0.2');
  });
});

describe('internalLines — 내부용 계산 (설계서 §8.7)', () => {
  const session = createSession([
    { sku: 'A-1', purchaseUnitPrice: '1000', currency: 'KRW', unit: 'EA' },
  ]);

  it('원가가 있는 행만 계산하고 없는 행은 미등록으로 표시한다', () => {
    const lines = internalLines(
      [
        { rowId: 'r1', sku: 'A-1', quantity: '3', sellingUnitPrice: '1500' },
        { rowId: 'r2', sku: 'Z-9', quantity: '1', sellingUnitPrice: '500' },
      ],
      session,
    );
    expect(lines[0]).toMatchObject({ rowId: 'r1', costRegistered: true });
    expect(lines[0]!.purchaseAmount?.toFixed()).toBe('3000');
    expect(lines[0]!.markupRate?.toFixed()).toBe('0.5');
    expect(lines[1]).toMatchObject({ rowId: 'r2', costRegistered: false });
    expect(lines[1]!.purchaseAmount).toBeUndefined();
  });

  it('판매가가 없으면 이익을 계산하지 않는다', () => {
    const lines = internalLines([{ rowId: 'r1', sku: 'A-1', quantity: '1' }], session);
    expect(lines[0]!.markupRate).toBeUndefined();
    expect(lines[0]!.profitAmount).toBeUndefined();
  });
});
