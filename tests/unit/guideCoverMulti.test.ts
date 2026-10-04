import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

import { fillCoverMultiSystem, shiftCoverPrintArea } from '@/export/ooxml/guideCoverMulti';

const ROOT = resolve(__dirname, '../..');

function coverXmlOf(guideId: string): string {
  const bytes = readFileSync(resolve(ROOT, `templates/sanitized/guide-${guideId}.xlsx`));
  return strFromU8(unzipSync(new Uint8Array(bytes))['xl/worksheets/sheet1.xml']!);
}

function cellOf(sheet: string, ref: string): string | undefined {
  return new RegExp(`<c r="${ref}"[^>]*/>|<c r="${ref}"[^>]*>[\\s\\S]*?</c>`).exec(sheet)?.[0];
}

describe('fillCoverMultiSystem — 갑지 시스템 줄 늘리기', () => {
  it('시스템 1개면 shift 가 0 이고 11행 그대로다', () => {
    const result = fillCoverMultiSystem(coverXmlOf('won'), [
      { name: '회의실', summarySpec: '스펙', unit: '식', quantity: '1', totalReference: "'세부내역'!M25" },
    ]);
    expect(result.shift).toBe(0);
    expect(result.subtotalRow).toBe(12);
    expect(result.systemRows).toEqual([11]);
    expect(cellOf(result.sheetXml, 'C11')).toContain('회의실');
    expect(cellOf(result.sheetXml, 'G11')).toContain("'세부내역'!M25");
    expect(cellOf(result.sheetXml, 'H12')).toContain('SUM(H11:H11)');
  });

  it('시스템 3개면 11~13행에 채워지고 그 아래는 2행 밀린다', () => {
    const result = fillCoverMultiSystem(coverXmlOf('won'), [
      { name: '회의실', summarySpec: 's1', unit: '식', quantity: '1', totalReference: "'세부내역'!M25" },
      { name: '대회의실', summarySpec: 's2', unit: '식', quantity: '2', totalReference: "'세부내역2'!M30" },
      { name: '로비', summarySpec: 's3', unit: '식', quantity: '3', totalReference: "'세부내역3'!M20" },
    ]);
    expect(result.shift).toBe(2);
    expect(result.systemRows).toEqual([11, 12, 13]);
    expect(result.subtotalRow).toBe(14);

    expect(cellOf(result.sheetXml, 'C11')).toContain('회의실');
    expect(cellOf(result.sheetXml, 'C12')).toContain('대회의실');
    expect(cellOf(result.sheetXml, 'C13')).toContain('로비');
    expect(cellOf(result.sheetXml, 'G12')).toContain("'세부내역2'!M30");
    expect(cellOf(result.sheetXml, 'H13')).toContain('F13*G13');

    // 합계 행이 14행으로 밀리고 SUM 범위가 11~13을 덮는다.
    expect(cellOf(result.sheetXml, 'H14')).toContain('SUM(H11:H13)');
    // 원래 12행(합계 행)은 더는 없고 14행에 그 내용이 있다 — B12 텍스트가 B14로 갔다.
    const subtotalLabelCell = cellOf(result.sheetXml, 'B14');
    expect(subtotalLabelCell).toBeDefined();

    // 비고 박스(원래 19~20행)가 21~22행으로 밀렸는지 병합 범위로 확인한다.
    expect(result.sheetXml).toContain('<mergeCell ref="B21:B22"/>');
    expect(result.sheetXml).toContain('<mergeCell ref="C21:I21"/>');

    // dimension 마지막 행이 2만큼 늘었다(원본 O22 → O24).
    expect(result.sheetXml).toMatch(/<dimension ref="A1:O24"\/>/);
  });

  /**
   * 실측으로 걸린 결함(P2-1): 8행의 한글 금액 문구
   * (`NUMBERSTRING(H12,1)` 류)는 **8행 자신은 안 밀리지만, 그 수식이
   * 가리키는 12행(합계)은 밀린다.** 처음에는 밀리는 행의 `r=` 주소와
   * 그 행 **안의 셀 r=** 만 옮기고, 수식 **본문**이 가리키는 행은 안
   * 옮겼다 — 그래서 시스템을 늘려도 한글 금액 문구가 조용히 그대로였다
   * (실제 Excel 편집 재계산 검증에서 발견). 8행은 안 밀리는 구역에
   * 있으므로 더 놓치기 쉬웠다.
   */
  it('8행(한글 금액 문구)의 수식이 가리키는 합계 행 번호도 밀린다', () => {
    const result = fillCoverMultiSystem(coverXmlOf('won'), [
      { name: 'A', summarySpec: '', unit: '식', quantity: '1', totalReference: "'세부내역'!M25" },
      { name: 'B', summarySpec: '', unit: '식', quantity: '1', totalReference: "'세부내역2'!M25" },
      { name: 'C', summarySpec: '', unit: '식', quantity: '1', totalReference: "'세부내역3'!M20" },
    ]);
    expect(result.subtotalRow).toBe(14);
    const row8 = cellOf(result.sheetXml, 'C8')!;
    expect(row8).toContain('NUMBERSTRING(H14,1)');
    expect(row8).toContain('TEXT(H14,');
    expect(row8).not.toContain('H12');
  });

  it('shiftCoverPrintArea 가 갑지 인쇄 영역의 마지막 행을 늘린다', () => {
    const workbookXml =
      '<workbook><definedNames>' +
      '<definedName name="_xlnm.Print_Area" localSheetId="0">갑지!$A$1:$J$21</definedName>' +
      '<definedName name="_xlnm.Print_Area" localSheetId="1">세부내역!$A$1:$O$25</definedName>' +
      '</definedNames></workbook>';
    const shifted = shiftCoverPrintArea(workbookXml, 2);
    expect(shifted).toContain('localSheetId="0">갑지!$A$1:$J$23<');
    // 세부내역(localSheetId=1) 쪽은 건드리지 않는다.
    expect(shifted).toContain('localSheetId="1">세부내역!$A$1:$O$25<');
  });
});
