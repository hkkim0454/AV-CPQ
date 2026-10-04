import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

import {
  mergeSharedStrings,
  mergeStylesheets,
  remapWorksheetIndices,
} from '@/export/ooxml/guideStyleMerge';
import { findChild, findChildren, parseXml } from '@/export/ooxml/xml';

const ROOT = resolve(__dirname, '../..');

function partOf(guideId: string, part: string): string {
  const bytes = readFileSync(resolve(ROOT, `templates/sanitized/guide-${guideId}.xlsx`));
  return strFromU8(unzipSync(new Uint8Array(bytes))[part]!);
}

/**
 * `won`(일반)을 base, `ds-won`(DS)을 incoming 으로 합친다 — 실제 다중·혼합
 * 시스템 조립이 쓰는 것과 같은 조합이다. 합성 데이터만 쓴다; 템플릿은
 * 저장소에 이미 있는 정리된 양식이다.
 */
describe('guideStyleMerge — 스타일표·공유 문자열표 합치기', () => {
  it('cellXfs 개수가 base+incoming 의 합이다', () => {
    const baseStyles = partOf('won', 'xl/styles.xml');
    const dsStyles = partOf('ds-won', 'xl/styles.xml');
    const baseCount = findChildren(
      findChild(parseXml(baseStyles).root, 'cellXfs')!,
      'xf',
    ).length;
    const dsCount = findChildren(findChild(parseXml(dsStyles).root, 'cellXfs')!, 'xf').length;

    const merged = mergeStylesheets(baseStyles, dsStyles);
    const mergedCount = findChildren(
      findChild(parseXml(merged.stylesXml).root, 'cellXfs')!,
      'xf',
    ).length;

    expect(mergedCount).toBe(baseCount + dsCount);
    // incoming 의 0번째 cellXf 는 합친 표에서 baseCount 번째 자리로 간다.
    expect(merged.cellXfIndex(0)).toBe(baseCount);
    expect(merged.cellXfIndex(dsCount - 1)).toBe(baseCount + dsCount - 1);
  });

  it('fills·fonts·borders 가 전부 밀려서 incoming 의 cellXf 가 여전히 자기 fillId 를 가리킨다', () => {
    const baseStyles = partOf('won', 'xl/styles.xml');
    const dsStyles = partOf('ds-won', 'xl/styles.xml');
    const baseFills = findChildren(
      findChild(parseXml(baseStyles).root, 'fills')!,
      'fill',
    ).length;

    const dsRoot = parseXml(dsStyles).root;
    const dsCellXfs = findChildren(findChild(dsRoot, 'cellXfs')!, 'xf');
    // DS 전용 fill(3개 추가분)을 실제로 쓰는 cellXf 를 하나 찾는다.
    const dsFills = findChildren(findChild(dsRoot, 'fills')!, 'fill').length;
    const usesNewFill = dsCellXfs.findIndex(
      (xf) => Number.parseInt(xf.attrs['fillId'] ?? '-1', 10) >= dsFills - 3,
    );
    expect(usesNewFill).toBeGreaterThanOrEqual(0);

    const merged = mergeStylesheets(baseStyles, dsStyles);
    const mergedRoot = parseXml(merged.stylesXml).root;
    const mergedCellXfs = findChildren(findChild(mergedRoot, 'cellXfs')!, 'xf');
    const newIndex = merged.cellXfIndex(usesNewFill);
    const movedXf = mergedCellXfs[newIndex]!;
    const originalXf = dsCellXfs[usesNewFill]!;
    const expectedFillId =
      Number.parseInt(originalXf.attrs['fillId'] ?? '0', 10) + baseFills;
    expect(Number.parseInt(movedXf.attrs['fillId'] ?? '-1', 10)).toBe(expectedFillId);
  });

  it('합친 styles.xml 을 다시 파싱할 수 있다 — 구조가 깨지지 않는다', () => {
    const merged = mergeStylesheets(partOf('won', 'xl/styles.xml'), partOf('ds-won', 'xl/styles.xml'));
    expect(() => parseXml(merged.stylesXml)).not.toThrow();
    const root = parseXml(merged.stylesXml).root;
    expect(root.tag).toBe('styleSheet');
  });

  it('공유 문자열이 incoming 색인만큼 밀리고 내용이 보존된다', () => {
    const baseSst = partOf('won', 'xl/sharedStrings.xml');
    const dsSst = partOf('ds-won', 'xl/sharedStrings.xml');
    const baseCount = findChildren(parseXml(baseSst).root, 'si').length;
    const dsSi = findChildren(parseXml(dsSst).root, 'si');

    const merged = mergeSharedStrings(baseSst, dsSst);
    const mergedSi = findChildren(parseXml(merged.sharedStringsXml).root, 'si');

    expect(mergedSi).toHaveLength(baseCount + dsSi.length);
    // incoming 의 3번째 문자열 내용이 합친 표의 새 자리에 그대로 있다.
    const sampleOld = 3;
    const sampleNew = merged.index(sampleOld);
    const textOf = (si: ReturnType<typeof findChildren>[number]) => {
      const t = findChild(si, 't');
      return t?.text ?? '';
    };
    expect(textOf(mergedSi[sampleNew]!)).toBe(textOf(dsSi[sampleOld]!));
  });
});

describe('guideStyleMerge — 시트 XML 색인 다시 쓰기', () => {
  it('셀의 s= 와 공유 문자열 참조가 새 색인으로 바뀐다', () => {
    const dsSheet = partOf('ds-won', 'xl/worksheets/sheet2.xml');
    const remapped = remapWorksheetIndices(dsSheet, {
      cellXfIndex: (i) => i + 1000,
      sharedStringIndex: (i) => i + 2000,
      dxfIndex: (i) => i + 3000,
    });

    const original = parseXml(dsSheet).root;
    const rewritten = parseXml(remapped).root;

    const firstRowOriginal = findChildren(findChild(original, 'sheetData')!, 'row')[0]!;
    const firstRowRewritten = findChildren(findChild(rewritten, 'sheetData')!, 'row')[0]!;
    const firstCellOriginal = findChildren(firstRowOriginal, 'c').find((c) => c.attrs['s'] !== undefined);
    const firstCellRewritten = findChildren(firstRowRewritten, 'c').find(
      (c) => c.attrs['r'] === firstCellOriginal?.attrs['r'],
    );
    expect(firstCellOriginal).toBeDefined();
    expect(Number(firstCellRewritten!.attrs['s'])).toBe(Number(firstCellOriginal!.attrs['s']) + 1000);

    // t="s" 셀 하나를 찾아 <v> 가 2000만큼 밀렸는지 본다.
    const sharedCellOriginal = findChildren(firstRowOriginal, 'c').find((c) => c.attrs['t'] === 's');
    if (sharedCellOriginal !== undefined) {
      const ref = sharedCellOriginal.attrs['r'];
      const sharedCellRewritten = findChildren(firstRowRewritten, 'c').find((c) => c.attrs['r'] === ref);
      const vOld = Number(findChild(sharedCellOriginal, 'v')!.text);
      const vNew = Number(findChild(sharedCellRewritten!, 'v')!.text);
      expect(vNew).toBe(vOld + 2000);
    }
  });

  it('dxfId 가 조건부 서식 규칙에서 새 색인으로 바뀐다', () => {
    const dsSheet = partOf('ds-won', 'xl/worksheets/sheet2.xml');
    expect(dsSheet).toContain('<conditionalFormatting');
    const remapped = remapWorksheetIndices(dsSheet, {
      cellXfIndex: (i) => i,
      sharedStringIndex: (i) => i,
      dxfIndex: (i) => i + 777,
    });
    const original = parseXml(dsSheet).root;
    const rewritten = parseXml(remapped).root;
    const originalRule = findChild(findChildren(original, 'conditionalFormatting')[0]!, 'cfRule')!;
    const rewrittenRule = findChild(findChildren(rewritten, 'conditionalFormatting')[0]!, 'cfRule')!;
    expect(Number(rewrittenRule.attrs['dxfId'])).toBe(Number(originalRule.attrs['dxfId']) + 777);
  });
});
