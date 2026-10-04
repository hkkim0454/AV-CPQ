import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';

import { scanCostLeak } from '../../tools/costLeakScan';

/**
 * B2 — 원가 유출 숫자 검사.
 *
 * 고객용 산출물에서 "원가 35종 발견"이 떴으나 **전부 오경보**였다.
 *
 * ```
 * 30종  theme1.xml 색상값(satMod/lumMod) · styles.xml 서식 번호에 우연히 같은 숫자
 *  3종  원가 == 판매가인 제품 (마진 0) → 판매가로 들어간 것. 정상
 *  2종  계산된 금액(수량×판매단가)이 무관한 제품의 원가와 우연히 일치
 * ```
 *
 * 그리고 `'원가'`라는 단어도 걸렸는데, 시연용 **공사명**이 "원가 연결 시연"이었다.
 *
 * 양치기 소년이 되면 진짜 유출이 나도 묻힌다. 숫자 일치만으로는 유출을
 * 판정할 수 없다 — 진짜 보증은 projection이 원가를 못 받는 **타입 차단**이고
 * 그건 이미 있다. 이 검사는 보조다.
 */

function sheet(cells: string): Uint8Array {
  return strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<sheetData><row r="1">${cells}</row></sheetData></worksheet>`,
  );
}

function book(parts: Record<string, Uint8Array>): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    ...parts,
  });
}

const strings = (...values: string[]): Uint8Array =>
  strToU8(
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      values.map((v) => `<si><t>${v}</t></si>`).join('') +
      '</sst>',
  );

describe('scanCostLeak — 숫자', () => {
  it('셀 값에 원가가 그대로 있으면 잡는다', () => {
    const bytes = book({
      'xl/worksheets/sheet1.xml': sheet('<c r="A1"><v>1234567</v></c>'),
    });
    const found = scanCostLeak(bytes, { costValues: ['1234567'], allowedCells: new Set<string>() });
    expect(found.map((f) => f.kind)).toEqual(['cost-value']);
    expect(found[0]!.part).toBe('xl/worksheets/sheet1.xml');
  });

  it('theme·styles의 우연한 숫자는 잡지 않는다 — 셀 값만 본다', () => {
    const bytes = book({
      'xl/theme/theme1.xml': strToU8('<a:satMod val="1234567"/>'),
      'xl/styles.xml': strToU8('<fgColor rgb="1234567"/><numFmt numFmtId="1234567"/>'),
      'xl/worksheets/sheet1.xml': sheet('<c r="A1"><v>999</v></c>'),
    });
    expect(scanCostLeak(bytes, { costValues: ['1234567'], allowedCells: new Set<string>() })).toEqual([]);
  });

  it('공유 문자열 인덱스를 숫자로 보지 않는다', () => {
    // t="s"면 <v>는 sharedStrings 인덱스다. 35가 원가와 같다고 유출이 아니다.
    const bytes = book({
      'xl/worksheets/sheet1.xml': sheet('<c r="A1" t="s"><v>35</v></c>'),
      'xl/sharedStrings.xml': strings(...Array.from({ length: 36 }, (_, i) => `s${i}`)),
    });
    expect(scanCostLeak(bytes, { costValues: ['35'], allowedCells: new Set<string>() })).toEqual([]);
  });

  it('판매측 칸이면 같은 값이라도 통과한다 — 마진 0 제품이다', () => {
    const bytes = book({
      'xl/worksheets/sheet1.xml': sheet('<c r="A1"><v>500000</v></c>'),
    });
    expect(
      scanCostLeak(bytes, {
        costValues: ['500000'],
        allowedCells: new Set(['xl/worksheets/sheet1.xml!A1']),
      }),
    ).toEqual([]);
  });

  it('같은 값이 금지 칸에 있으면 잡는다 — 값으로 봐주면 못 가린다', () => {
    // 독립 검토의 재현 사례. A1(판매)과 Z1(금지)에 같은 숫자를 둔다.
    const bytes = book({
      'xl/worksheets/sheet1.xml': sheet(
        '<c r="A1"><v>987654321</v></c><c r="Z1"><v>987654321</v></c>',
      ),
    });
    const found = scanCostLeak(bytes, {
      costValues: ['987654321'],
      allowedCells: new Set(['xl/worksheets/sheet1.xml!A1']),
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'cost-value', ref: 'Z1' });
  });

  it('허용 칸을 안 주면 전부 검사한다', () => {
    const bytes = book({
      'xl/worksheets/sheet1.xml': sheet('<c r="A1"><v>500000</v></c>'),
    });
    expect(
      scanCostLeak(bytes, {
        costValues: ['500000'],
        allowedCells: new Set<string>(),
      }),
    ).toHaveLength(1);
  });

  it('있으면 안 되는 파트를 잡는다 — 숫자를 뒤지기 전에 목록부터', () => {
    const bytes = book({
      'xl/worksheets/sheet1.xml': sheet('<c r="A1"><v>1</v></c>'),
      'xl/comments1.xml': strToU8('<comments/>'),
      'docProps/custom.xml': strToU8('<Properties/>'),
    });
    const found = scanCostLeak(bytes, {
      costValues: [],
      allowedCells: new Set<string>(),
    });
    expect(found.map((f) => f.kind)).toEqual(['forbidden-part', 'forbidden-part']);
    expect(found.map((f) => f.part).sort()).toEqual([
      'docProps/custom.xml',
      'xl/comments1.xml',
    ]);
  });

  it('값을 발견 내용에 담지 않는다 (설계서 §8.4)', () => {
    const bytes = book({
      'xl/worksheets/sheet1.xml': sheet('<c r="A1"><v>1234567</v></c>'),
    });
    const found = scanCostLeak(bytes, { costValues: ['1234567'], allowedCells: new Set<string>() });
    expect(JSON.stringify(found)).not.toContain('1234567');
    expect(found[0]!.ref).toBe('A1');
  });

  it('천단위 쉼표나 소수점 표기가 달라도 같은 값으로 본다', () => {
    const bytes = book({
      'xl/worksheets/sheet1.xml': sheet('<c r="A1"><v>1234567</v></c>'),
    });
    const found = scanCostLeak(bytes, {
      costValues: ['1,234,567.00'],
      allowedCells: new Set<string>(),
    });
    expect(found).toHaveLength(1);
  });
});

describe('scanCostLeak — 금지 단어', () => {
  it("'원가'는 잡지 않는다 — 공사명에 들어갈 수 있다", () => {
    const bytes = book({
      'xl/worksheets/sheet1.xml': sheet('<c r="A1" t="s"><v>0</v></c>'),
      'xl/sharedStrings.xml': strings('원가 연결 시연'),
    });
    expect(scanCostLeak(bytes, { costValues: [], allowedCells: new Set<string>() })).toEqual([]);
  });

  it.each(['이익률', '이익율', '마진', '가산율', '제조사/구매처', '영업비고'])(
    "'%s'를 잡는다",
    (word) => {
      const bytes = book({
        'xl/worksheets/sheet1.xml': sheet('<c r="A1" t="s"><v>0</v></c>'),
        'xl/sharedStrings.xml': strings(`${word} 열`),
      });
      const found = scanCostLeak(bytes, { costValues: [], allowedCells: new Set<string>() });
      expect(found.map((f) => f.kind)).toEqual(['forbidden-word']);
      expect(found[0]!.detail).toBe(word);
    },
  );

  it('인라인 문자열에서도 잡는다', () => {
    const bytes = book({
      'xl/worksheets/sheet1.xml': sheet(
        '<c r="A1" t="inlineStr"><is><t>마진 15%</t></is></c>',
      ),
    });
    expect(scanCostLeak(bytes, { costValues: [], allowedCells: new Set<string>() })).toHaveLength(1);
  });

  it('정의된 이름에서도 잡는다', () => {
    const bytes = book({
      'xl/workbook.xml': strToU8(
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          '<definedNames><definedName name="가산율">Sheet1!$A$1</definedName></definedNames>' +
          '</workbook>',
      ),
    });
    expect(scanCostLeak(bytes, { costValues: [], allowedCells: new Set<string>() })).toHaveLength(1);
  });

  it('깨끗한 고객용 파일은 아무것도 내지 않는다', () => {
    const bytes = book({
      'xl/worksheets/sheet1.xml': sheet(
        '<c r="A1" t="s"><v>0</v></c><c r="B1"><v>5300000</v></c>',
      ),
      'xl/sharedStrings.xml': strings('UHD Matrix Frame'),
      'xl/theme/theme1.xml': strToU8('<a:lumMod val="110000"/>'),
    });
    expect(
      scanCostLeak(bytes, {
        costValues: ['110000'],
        allowedCells: new Set(['xl/worksheets/sheet1.xml!B1']),
      }),
    ).toEqual([]);
  });
});
