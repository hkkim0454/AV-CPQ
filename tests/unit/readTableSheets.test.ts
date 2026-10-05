import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { listXlsxSheets, previewXlsxRows, readTable } from '@/services/private-cost/readTable';
import { parsePrivatePrices } from '@/services/private-cost/parse';

/**
 * 시트 선택은 workbook 관계·이름 순서로 한다 — 파일 이름(ZIP 안의
 * `sheet1.xml` 등) 정렬이 아니다(독립 검토 지적 2026-10-05). 실제 원가
 * 파일은 "갑지"(표지) 시트를 포함할 수 있고, 그 표지가 ZIP 안에서
 * `sheet1.xml`일 수도 있다 — 파일 이름으로 고르면 표지를 원가표로
 * 잘못 읽는다.
 *
 * 아래 합성 파일은 일부러 **탭 순서와 ZIP 파일 이름 순서를 반대로**
 * 만든다: 탭 1번(워크북에서 가장 먼저)인 "갑지"가 실제로는
 * `sheet2.xml`에 들어 있고, 탭 2번인 "원가"가 `sheet1.xml`에 들어
 * 있다. 파일 이름 정렬로 고르면 "원가"(sheet1.xml)를 표지로
 * 착각하거나, 적어도 탭 순서를 무시하게 된다.
 */

function inlineCell(ref: string, text: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
}

function numberCell(ref: string, value: string): string {
  return `<c r="${ref}"><v>${value}</v></c>`;
}

function sheetXml(rows: string): Uint8Array {
  return strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<sheetData>${rows}</sheetData></worksheet>`,
  );
}

/** 표지 시트 — 셀은 있지만 원가표와 무관한 텍스트뿐이다. */
const coverSheet = sheetXml(
  `<row r="1">${inlineCell('A1', '㈜서울영상테크 견적서')}</row>` +
    `<row r="2">${inlineCell('A2', '2026년 10월')}</row>`,
);

/** 원가 시트 — 1행은 설명 제목, 2행이 실제 머리글, 3행부터 데이터. */
const costSheet = sheetXml(
  `<row r="1">${inlineCell('A1', '원가표(사내 전용, 2026년 하반기)')}</row>` +
    `<row r="2">${inlineCell('B2', '품명')}${inlineCell('C2', '규격')}${inlineCell('G2', '매입단가')}${inlineCell('H2', '총액')}</row>` +
    `<row r="3">${inlineCell('B3', 'PTZ 카메라')}${inlineCell('C3', 'SRG-A40')}${numberCell('G3', '1200000')}${numberCell('H3', '2400000')}</row>`,
);

function multiSheetWorkbook(): Uint8Array {
  const workbookXml = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' +
      '<sheet name="갑지" sheetId="1" r:id="rId1"/>' +
      '<sheet name="원가" sheetId="2" r:id="rId2"/>' +
      '</sheets></workbook>',
  );
  const relsXml = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      // 일부러 반대로 연결한다 — 탭 1번(갑지)이 sheet2.xml, 탭 2번(원가)이 sheet1.xml.
      '<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet2.xml"/>' +
      '<Relationship Id="rId2" Type="worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>',
  );
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/workbook.xml': workbookXml,
    'xl/_rels/workbook.xml.rels': relsXml,
    'xl/worksheets/sheet1.xml': costSheet, // 파일 이름은 1번이지만 실제로는 "원가"(탭 2번) 시트다.
    'xl/worksheets/sheet2.xml': coverSheet, // 파일 이름은 2번이지만 실제로는 "갑지"(탭 1번) 시트다.
  });
}

describe('listXlsxSheets — 탭 순서·이름을 관계로 복원한다', () => {
  it('파일 이름 정렬이 아니라 workbook.xml의 탭 순서대로 돌려준다', () => {
    const sheets = listXlsxSheets(multiSheetWorkbook());
    expect(sheets.map((s) => s.name)).toEqual(['갑지', '원가']);
    // "갑지"(탭 1번)의 실제 파트는 sheet2.xml이다 — 파일 이름 정렬이면 sheet1.xml을 집는다.
    expect(sheets[0]!.sheetPath).toBe('xl/worksheets/sheet2.xml');
    expect(sheets[1]!.sheetPath).toBe('xl/worksheets/sheet1.xml');
  });
});

describe('readTable — 고른 시트만 읽는다(파일 이름 정렬로 되돌아가지 않는다)', () => {
  it('sheetPath를 "원가" 시트로 지정하면 표지 내용이 섞이지 않는다', () => {
    const bytes = multiSheetWorkbook();
    const sheets = listXlsxSheets(bytes);
    const costSheetInfo = sheets.find((s) => s.name === '원가')!;

    const table = readTable(bytes, 'xlsx', undefined, {
      sheetPath: costSheetInfo.sheetPath,
      headerRowIndex: 1, // 2번째 행(0부터)이 실제 머리글이다 — 1행은 설명 제목.
    });

    expect(table.header).toContain('품명');
    expect(table.header).toContain('규격');
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toContain('PTZ 카메라');
    // 표지 시트의 문구는 전혀 섞이지 않는다.
    expect(JSON.stringify(table)).not.toContain('견적서');
  });

  it('sheetPath 없이 호출하면(기존 간단 경로) 워크북 순서상 첫 시트를 쓴다 — 파일 이름 정렬이 아니다', () => {
    const bytes = multiSheetWorkbook();
    // sheetPath를 생략하면 workbook 순서상 첫 탭인 "갑지"(sheet2.xml)를
    // 읽는다 — 예전처럼 파일 이름이 가장 빠른 sheet1.xml("원가")을
    // 잘못 집지 않는다는 것을 증명한다.
    const table = readTable(bytes, 'xlsx');
    expect(table.header.join(',')).toContain('견적서');
  });
});

describe('previewXlsxRows — 머리글을 고르기 전에 원본 행을 미리 본다', () => {
  it('지정한 시트의 원본 행을 그대로 돌려준다(아직 머리글을 안 고른 상태)', () => {
    const bytes = multiSheetWorkbook();
    const sheets = listXlsxSheets(bytes);
    const costSheetInfo = sheets.find((s) => s.name === '원가')!;
    const rows = previewXlsxRows(bytes, costSheetInfo.sheetPath);
    expect(rows[0]).toContain('원가표(사내 전용, 2026년 하반기)');
    expect(rows[1]).toContain('품명');
    expect(rows[2]).toContain('PTZ 카메라');
  });
});

describe('readTable — 머리글 행을 명시하면 그 위 설명 행은 데이터로 안 들어간다', () => {
  it('headerRowIndex로 고른 행 위의 설명 행은 머리글에도 데이터에도 안 들어간다', () => {
    const bytes = multiSheetWorkbook();
    const sheets = listXlsxSheets(bytes);
    const costSheetInfo = sheets.find((s) => s.name === '원가')!;
    const table = readTable(bytes, 'xlsx', undefined, {
      sheetPath: costSheetInfo.sheetPath,
      headerRowIndex: 1,
    });
    expect(table.rows).toHaveLength(1); // 1행(설명)은 데이터로 안 들어간다.
    expect(JSON.stringify(table.header)).not.toContain('원가표');
  });

  it('범위를 벗어난 머리글 행 번호는 거부한다', () => {
    const bytes = multiSheetWorkbook();
    const sheets = listXlsxSheets(bytes);
    const costSheetInfo = sheets.find((s) => s.name === '원가')!;
    expect(() =>
      readTable(bytes, 'xlsx', undefined, { sheetPath: costSheetInfo.sheetPath, headerRowIndex: 99 }),
    ).toThrow(/범위/);
  });
});

describe('headerRowIndex를 거쳐도 수식 가격 차단은 그대로 산다', () => {
  it('머리글 행을 명시해 읽어도 매입단가 열의 수식은 그 행만 막는다', () => {
    const sheet = sheetXml(
      `<row r="1">${inlineCell('A1', '설명 제목')}</row>` +
        `<row r="2">${inlineCell('B2', '품명')}${inlineCell('C2', '규격')}${inlineCell('G2', '매입단가')}${inlineCell('H2', '통화')}${inlineCell('I2', '단위')}</row>` +
        `<row r="3">${inlineCell('B3', 'PTZ 카메라')}${inlineCell('C3', 'SRG-A40')}<c r="G3"><f>H3/2</f><v>1200000</v></c>${inlineCell('H3', 'KRW')}${inlineCell('I3', 'EA')}</row>` +
        `<row r="4">${inlineCell('B4', 'NVR')}${inlineCell('C4', 'NVR-16')}${numberCell('G4', '800000')}${inlineCell('H4', 'KRW')}${inlineCell('I4', 'EA')}</row>`,
    );
    const bytes = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'xl/workbook.xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="원가" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>' +
          '</Relationships>',
      ),
      'xl/worksheets/sheet1.xml': sheet,
    });

    const sheets = listXlsxSheets(bytes);
    const table = readTable(bytes, 'xlsx', undefined, { sheetPath: sheets[0]!.sheetPath, headerRowIndex: 1 });
    const result = parsePrivatePrices(table, {
      name: '품명',
      model: '규격',
      purchaseUnitPrice: '매입단가',
      currency: '통화',
      unit: '단위',
    });

    expect(result.errors.map((e) => e.code)).toEqual(['price-formula']);
    expect(result.errors[0]!.row).toBe(1); // 수식이 있던 3행(데이터 1번째 줄)만 막힌다.
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.model).toBe('NVR-16'); // 수식 없는 둘째 줄은 그대로 읽힌다.
  });
});
