/**
 * 서로 다른 가이드 템플릿의 스타일표·공유 문자열표를 하나로 합친다
 * (계획 2026-10-04 P1-5 다중/혼합 시스템).
 *
 * ## 왜 필요한가
 *
 * OOXML 통합문서는 `xl/styles.xml` 하나를 모든 시트가 공유한다. 셀의
 * `s="N"` 은 그 표의 `cellXfs` **배열 인덱스**를 가리킨다. 일반 가이드
 * 시트를 DS 가이드가 들어있는 통합문서에 그대로 옮기면, 일반 쪽 `s="12"` 가
 * DS 쪽 `cellXfs[12]`(전혀 다른 서식)를 가리키게 된다 — 조용히 틀린 서식이
 * 아니라 아예 엉뚱한 서식이 나온다.
 *
 * ## 접근: 짓지 않고, 이어 붙인다
 *
 * 합치는 쪽(`incoming`)의 `fonts`·`fills`·`borders`·`cellStyleXfs`·`dxfs` 를
 * 기본(`base`) 표 **뒤에 그대로 이어 붙이고**, `incoming` 쪽 색인을 전부
 * "자기 배열 길이만큼" 밀어 올린 값으로 다시 쓴다. 겹치는 서식을 알아서
 * 줄이는 중복 제거는 하지 않는다 — 정확성이 우선이고, 중복 제거는 최적화일
 * 뿐이다. `numFmts` 는 번호(`numFmtId`)가 파일마다 다른 의미일 수 있어서
 * (내장 서식인 164 미만은 전역으로 같지만, 164 이상 사용자 지정 서식은
 * 파일마다 다르다) 번호 자체를 다시 매긴다.
 *
 * 공유 문자열(`sharedStrings.xml`)도 같은 방식이다 — `incoming` 의 `<si>`
 * 전부를 `base` 뒤에 이어 붙이고, 원래 색인에 `base` 쪽 개수를 더한 값을
 * 돌려준다.
 *
 * 이 모듈은 **표를 합칠 뿐 시트 XML을 고치지 않는다.** 실제로 시트의
 * `s=`·공유 문자열 `<v>`·`dxfId=` 를 다시 쓰는 것은
 * `remapWorksheetIndices` 가 한다 — 호출부가 이 두 함수를 같이 쓴다.
 */
import { element, findChild, findChildren, parseXml, serializeElement, type XmlElement } from './xml';

export interface StyleMergeResult {
  /** `<styleSheet>` 전체 XML(선언 포함하지 않는다 — 호출부가 붙인다). */
  stylesXml: string;
  /** incoming 의 cellXfs 배열 인덱스(0부터) → 합친 표에서의 새 인덱스. */
  cellXfIndex: (oldIndex: number) => number;
  /** incoming 의 dxfs 배열 인덱스(0부터) → 합친 표에서의 새 인덱스. */
  dxfIndex: (oldIndex: number) => number;
}

function childCount(parent: XmlElement | undefined, tag: string): number {
  if (parent === undefined) return 0;
  return findChildren(parent, tag).length;
}

function intAttr(el: XmlElement, name: string): number | undefined {
  const raw = el.attrs[name];
  if (raw === undefined) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? undefined : value;
}

/**
 * `numFmts` 를 합친다. 내장 서식(164 미만)은 전역으로 같은 뜻이라 그대로
 * 둔다. 사용자 지정 서식(164 이상)은 `incoming` 쪽에 **새 번호**를 내어
 * `base` 뒤에 추가한다 — 같은 서식 문자열이 이미 있어도 합치지 않는다
 * (정확성이 우선이다).
 */
function mergeNumFmts(
  base: XmlElement | undefined,
  incoming: XmlElement | undefined,
): { element: XmlElement | undefined; idMap: Map<number, number> } {
  const idMap = new Map<number, number>();
  const incomingFmts = incoming === undefined ? [] : findChildren(incoming, 'numFmt');
  if (incomingFmts.length === 0) return { element: base, idMap };

  const baseFmts = base === undefined ? [] : findChildren(base, 'numFmt');
  let nextId = Math.max(163, ...baseFmts.map((f) => intAttr(f, 'numFmtId') ?? 163)) + 1;

  const appended: XmlElement[] = [];
  for (const fmt of incomingFmts) {
    const oldId = intAttr(fmt, 'numFmtId');
    if (oldId === undefined) continue;
    if (oldId < 164) {
      idMap.set(oldId, oldId); // 내장 서식 — 안 바꾼다.
      continue;
    }
    const newId = nextId;
    nextId += 1;
    idMap.set(oldId, newId);
    appended.push(element('numFmt', { numFmtId: String(newId), formatCode: fmt.attrs['formatCode'] }));
  }

  const merged = element('numFmts', { count: String(baseFmts.length + appended.length) }, [
    ...baseFmts,
    ...appended,
  ]);
  return { element: merged, idMap };
}

/** `fonts`·`fills`·`borders`·`cellStyleXfs`·`dxfs` 처럼 색인이 **배열 위치뿐인** 표를 합친다. */
function mergeIndexedTable(
  base: XmlElement | undefined,
  incoming: XmlElement | undefined,
  tag: string,
  childTag: string,
  rewriteChild?: (child: XmlElement) => XmlElement,
): { element: XmlElement | undefined; offset: number } {
  const baseChildren = base === undefined ? [] : findChildren(base, childTag);
  const incomingChildren = incoming === undefined ? [] : findChildren(incoming, childTag);
  const offset = baseChildren.length;
  if (incomingChildren.length === 0) {
    return { element: base, offset };
  }
  const rewritten = incomingChildren.map((c) => (rewriteChild ? rewriteChild(c) : c));
  const merged = element(tag, { count: String(baseChildren.length + rewritten.length) }, [
    ...baseChildren,
    ...rewritten,
  ]);
  return { element: merged, offset };
}

/** `<xf numFmtId=.. fontId=.. fillId=.. borderId=.. xfId=.. />` 류의 색인을 전부 다시 쓴다. */
function remapXf(
  xf: XmlElement,
  maps: {
    numFmtId: Map<number, number>;
    fontOffset: number;
    fillOffset: number;
    borderOffset: number;
    cellStyleXfOffset: number;
  },
): XmlElement {
  const attrs = { ...xf.attrs };
  const numFmtId = intAttr(xf, 'numFmtId');
  if (numFmtId !== undefined && numFmtId >= 164) {
    const mapped = maps.numFmtId.get(numFmtId);
    if (mapped !== undefined) attrs['numFmtId'] = String(mapped);
  }
  const fontId = intAttr(xf, 'fontId');
  if (fontId !== undefined) attrs['fontId'] = String(fontId + maps.fontOffset);
  const fillId = intAttr(xf, 'fillId');
  if (fillId !== undefined) attrs['fillId'] = String(fillId + maps.fillOffset);
  const borderId = intAttr(xf, 'borderId');
  if (borderId !== undefined) attrs['borderId'] = String(borderId + maps.borderOffset);
  const xfId = intAttr(xf, 'xfId');
  if (xfId !== undefined) attrs['xfId'] = String(xfId + maps.cellStyleXfOffset);
  return { ...xf, attrs };
}

export function mergeStylesheets(baseXml: string, incomingXml: string): StyleMergeResult {
  const base = parseXml(baseXml).root;
  const incoming = parseXml(incomingXml).root;

  const numFmts = mergeNumFmts(findChild(base, 'numFmts'), findChild(incoming, 'numFmts'));
  const fonts = mergeIndexedTable(findChild(base, 'fonts'), findChild(incoming, 'fonts'), 'fonts', 'font');
  const fills = mergeIndexedTable(findChild(base, 'fills'), findChild(incoming, 'fills'), 'fills', 'fill');
  const borders = mergeIndexedTable(
    findChild(base, 'borders'),
    findChild(incoming, 'borders'),
    'borders',
    'border',
  );

  const xfMaps = {
    numFmtId: numFmts.idMap,
    fontOffset: fonts.offset,
    fillOffset: fills.offset,
    borderOffset: borders.offset,
  };

  const cellStyleXfs = mergeIndexedTable(
    findChild(base, 'cellStyleXfs'),
    findChild(incoming, 'cellStyleXfs'),
    'cellStyleXfs',
    'xf',
    (xf) => remapXf(xf, { ...xfMaps, cellStyleXfOffset: 0 }),
  );

  const cellXfs = mergeIndexedTable(
    findChild(base, 'cellXfs'),
    findChild(incoming, 'cellXfs'),
    'cellXfs',
    'xf',
    (xf) => remapXf(xf, { ...xfMaps, cellStyleXfOffset: cellStyleXfs.offset }),
  );

  // dxf(조건부 서식의 차등 서식)는 폰트·채우기·테두리를 **안에 직접 담고** 있다
  // (표를 참조하지 않는다) — 그대로 이어 붙이면 된다.
  const dxfs = mergeIndexedTable(findChild(base, 'dxfs'), findChild(incoming, 'dxfs'), 'dxfs', 'dxf');

  // cellStyles(이름 붙은 셀 스타일 갤러리)는 실제 셀이 직접 참조하지 않는다 —
  // 합치지 않고 base 것만 둔다. 합치면 이름 중복(예: "표준"/"Normal") 경고
  // 위험만 키우고 렌더링에는 영향이 없다.
  const replacements = new Map<string, XmlElement | undefined>([
    ['numFmts', numFmts.element],
    ['fonts', fonts.element],
    ['fills', fills.element],
    ['borders', borders.element],
    ['cellStyleXfs', cellStyleXfs.element],
    ['cellXfs', cellXfs.element],
    ['dxfs', dxfs.element],
  ]);

  const seen = new Set<string>();
  const newChildren: XmlElement[] = [];
  for (const child of base.children) {
    if (replacements.has(child.tag)) {
      const replacement = replacements.get(child.tag);
      if (replacement !== undefined) newChildren.push(replacement);
      seen.add(child.tag);
    } else {
      newChildren.push(child);
    }
  }
  // base 에 없던 표(예: base 에 dxfs 가 아예 없었는데 incoming 에는 있는 경우)도 넣는다.
  for (const [tag, el] of replacements) {
    if (!seen.has(tag) && el !== undefined) newChildren.push(el);
  }

  const merged: XmlElement = { ...base, children: newChildren };

  const cellXfBaseCount = childCount(findChild(base, 'cellXfs'), 'xf');
  const dxfBaseCount = childCount(findChild(base, 'dxfs'), 'dxf');

  return {
    stylesXml: serializeElement(merged),
    cellXfIndex: (oldIndex: number) => oldIndex + cellXfBaseCount,
    dxfIndex: (oldIndex: number) => oldIndex + dxfBaseCount,
  };
}

export interface SharedStringsMergeResult {
  sharedStringsXml: string;
  /** incoming 의 `<si>` 색인(0부터) → 합친 표에서의 새 색인. */
  index: (oldIndex: number) => number;
}

export function mergeSharedStrings(
  baseXml: string | undefined,
  incomingXml: string | undefined,
): SharedStringsMergeResult {
  const base = baseXml === undefined ? undefined : parseXml(baseXml).root;
  const incoming = incomingXml === undefined ? undefined : parseXml(incomingXml).root;

  const baseSi = base === undefined ? [] : findChildren(base, 'si');
  const incomingSi = incoming === undefined ? [] : findChildren(incoming, 'si');
  const offset = baseSi.length;

  const merged = element(
    'sst',
    {
      xmlns: base?.attrs['xmlns'] ?? incoming?.attrs['xmlns'],
      count: String(baseSi.length + incomingSi.length),
      uniqueCount: String(baseSi.length + incomingSi.length),
    },
    [...baseSi, ...incomingSi],
  );

  return {
    sharedStringsXml: serializeElement(merged),
    index: (oldIndex: number) => oldIndex + offset,
  };
}

export interface WorksheetIndexMaps {
  cellXfIndex: (oldIndex: number) => number;
  sharedStringIndex: (oldIndex: number) => number;
  dxfIndex: (oldIndex: number) => number;
}

/**
 * 시트 XML 안의 `s="N"`(셀·행·열 서식), 공유 문자열 `<v>N</v>`, `dxfId="N"`
 * 를 전부 새 색인으로 고친다. 정규식이 아니라 파서를 쓴다 — `s=` 가 셀 말고
 * `<pane state=` 같은 자리에도 나올 수 있어서, **태그별로** 봐야 한다.
 */
export function remapWorksheetIndices(sheetXml: string, maps: WorksheetIndexMaps): string {
  const doc = parseXml(sheetXml);
  const root = doc.root;

  const rewriteCell = (cell: XmlElement): void => {
    const s = cell.attrs['s'];
    if (s !== undefined) {
      const index = Number.parseInt(s, 10);
      if (!Number.isNaN(index)) cell.attrs['s'] = String(maps.cellXfIndex(index));
    }
    if (cell.attrs['t'] === 's') {
      const v = findChild(cell, 'v');
      if (v !== undefined && v.text !== undefined) {
        const index = Number.parseInt(v.text, 10);
        if (!Number.isNaN(index)) v.text = String(maps.sharedStringIndex(index));
      }
    }
  };

  const rewriteRow = (row: XmlElement): void => {
    const s = row.attrs['s'];
    if (s !== undefined) {
      const index = Number.parseInt(s, 10);
      if (!Number.isNaN(index)) row.attrs['s'] = String(maps.cellXfIndex(index));
    }
    for (const cell of findChildren(row, 'c')) rewriteCell(cell);
  };

  const sheetData = findChild(root, 'sheetData');
  if (sheetData !== undefined) {
    for (const row of findChildren(sheetData, 'row')) rewriteRow(row);
  }

  const cols = findChild(root, 'cols');
  if (cols !== undefined) {
    for (const col of findChildren(cols, 'col')) {
      const style = col.attrs['style'];
      if (style !== undefined) {
        const index = Number.parseInt(style, 10);
        if (!Number.isNaN(index)) col.attrs['style'] = String(maps.cellXfIndex(index));
      }
    }
  }

  for (const cf of findChildren(root, 'conditionalFormatting')) {
    for (const rule of findChildren(cf, 'cfRule')) {
      const dxfId = rule.attrs['dxfId'];
      if (dxfId !== undefined) {
        const index = Number.parseInt(dxfId, 10);
        if (!Number.isNaN(index)) rule.attrs['dxfId'] = String(maps.dxfIndex(index));
      }
    }
  }

  return serializeElement(root);
}
