/**
 * 정리된 템플릿에서 서식을 수확한다 (설계서 §9.1 템플릿 우선 방식).
 *
 * 왜 스타일을 코드로 다시 만들지 않는가: 원본 내역 시트 한 장에만 서로 다른 셀 서식
 * 조합이 20종 넘게 있다 (글꼴·테두리 굵기·채움·표시형식·정렬의 조합).
 * 코드로 재생성하면 "원본과 인쇄 서식 대조 통과"(§9.7)를 달성할 수 없다.
 * 그래서 템플릿 모델 행의 `s=` 인덱스를 그대로 복제한다. `xl/styles.xml`은 손대지 않는다.
 */
import { unzipSync, strFromU8 } from 'fflate';
import {
  parseXml,
  findChild,
  findChildren,
  type XmlElement,
  type XmlDocument,
} from './xml';
import {
  COVER_ANCHOR,
  SYSTEM_ANCHOR,
  TEMPLATE_COVER_SHEET,
  TEMPLATE_SYSTEM_SHEET,
} from './anchors';

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** 열 이름 → `s=` 스타일 인덱스. */
export type RowStyles = Record<string, number>;

export interface RowSkeleton {
  styles: RowStyles;
  /** 행 요소의 `s` 속성 (행 전체 기본 서식). */
  rowStyle?: string;
  customFormat?: string;
  height?: string;
}

/**
 * 시트의 `sheetData` **밖** 요소들. 순서가 OOXML 스키마에 고정돼 있으므로
 * 원본 요소를 그대로 들고 있다가 같은 순서로 다시 내보낸다.
 */
export interface SheetSkeleton {
  sheetPr?: XmlElement;
  sheetViews?: XmlElement;
  sheetFormatPr?: XmlElement;
  cols?: XmlElement;
  printOptions?: XmlElement;
  pageMargins?: XmlElement;
  pageSetup?: XmlElement;
  headerFooter?: XmlElement;
  /**
   * `<drawing r:id="…"/>` — 갑지의 회사 직인 이미지가 여기에 붙어 있다.
   * 양식의 일부이므로 그대로 옮긴다. 참조하는 rels 파트도 함께 복사해야 한다.
   */
  drawing?: XmlElement;
  /** 모델 행 번호 → 그 행의 서식. */
  rows: Map<number, RowSkeleton>;
}

export interface TemplatePackage {
  /** ZIP의 모든 파트. sheet1/sheet2는 다시 쓰고 나머지는 그대로 복사한다. */
  files: Record<string, Uint8Array>;
  /** `xl/workbook.xml`의 파싱 결과. */
  workbook: XmlDocument;
  /** `xl/_rels/workbook.xml.rels`의 파싱 결과. */
  workbookRels: XmlDocument;
  /** `[Content_Types].xml`의 파싱 결과. */
  contentTypes: XmlDocument;

  coverSheetPath: string;
  systemSheetPath: string;
  coverSkeleton: SheetSkeleton;
  systemSkeleton: SheetSkeleton;
}

function sheetDataOf(worksheet: XmlElement): XmlElement {
  const sd = findChild(worksheet, 'sheetData');
  if (sd === undefined) throw new Error('템플릿 시트에 sheetData가 없다.');
  return sd;
}

function columnOf(ref: string): string {
  const match = /^([A-Z]+)\d+$/.exec(ref);
  if (match === null) throw new Error(`셀 주소가 아니다: ${ref}`);
  return match[1]!;
}

function harvestSkeleton(worksheet: XmlElement, anchors: readonly number[]): SheetSkeleton {
  const wanted = new Set(anchors);
  const rows = new Map<number, RowSkeleton>();

  for (const row of findChildren(sheetDataOf(worksheet), 'row')) {
    const rowNumber = Number.parseInt(row.attrs['r'] ?? '', 10);
    if (!wanted.has(rowNumber)) continue;

    const styles: RowStyles = {};
    for (const cell of findChildren(row, 'c')) {
      const ref = cell.attrs['r'];
      const style = cell.attrs['s'];
      if (ref === undefined || style === undefined) continue;
      styles[columnOf(ref)] = Number.parseInt(style, 10);
    }

    const skeleton: RowSkeleton = { styles };
    if (row.attrs['s'] !== undefined) skeleton.rowStyle = row.attrs['s'];
    if (row.attrs['customFormat'] !== undefined) {
      skeleton.customFormat = row.attrs['customFormat'];
    }
    if (row.attrs['ht'] !== undefined) skeleton.height = row.attrs['ht'];
    rows.set(rowNumber, skeleton);
  }

  const missing = anchors.filter((a) => !rows.has(a));
  if (missing.length > 0) {
    throw new Error(`템플릿에 모델 행이 없다: ${missing.join(', ')}`);
  }

  const skeleton: SheetSkeleton = { rows };
  for (const tag of [
    'sheetPr',
    'sheetViews',
    'sheetFormatPr',
    'cols',
    'printOptions',
    'pageMargins',
    'pageSetup',
    'headerFooter',
    'drawing',
  ] as const) {
    const element = findChild(worksheet, tag);
    if (element !== undefined) skeleton[tag] = element;
  }
  return skeleton;
}

/** `xl/workbook.xml`의 시트 이름 → 워크시트 파트 경로. */
function resolveSheetPaths(
  workbook: XmlDocument,
  rels: XmlDocument,
): Map<string, string> {
  const relTargets = new Map<string, string>();
  for (const rel of rels.root.children) {
    const id = rel.attrs['Id'];
    const target = rel.attrs['Target'];
    if (id === undefined || target === undefined) continue;
    relTargets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  }

  const result = new Map<string, string>();
  const sheets = findChild(workbook.root, 'sheets');
  if (sheets === undefined) throw new Error('workbook.xml에 sheets가 없다.');
  for (const sheet of findChildren(sheets, 'sheet')) {
    const name = sheet.attrs['name'];
    const relId = sheet.attrs['r:id'] ?? sheet.attrs['id'];
    if (name === undefined || relId === undefined) continue;
    const target = relTargets.get(relId);
    if (target !== undefined) result.set(name, target);
  }
  return result;
}

export function loadTemplate(bytes: Uint8Array): TemplatePackage {
  const files = unzipSync(bytes);

  const read = (path: string): XmlDocument => {
    const raw = files[path];
    if (raw === undefined) throw new Error(`템플릿에 ${path}가 없다.`);
    return parseXml(strFromU8(raw));
  };

  const workbook = read('xl/workbook.xml');
  const workbookRels = read('xl/_rels/workbook.xml.rels');
  const contentTypes = read('[Content_Types].xml');

  const paths = resolveSheetPaths(workbook, workbookRels);
  const coverSheetPath = paths.get(TEMPLATE_COVER_SHEET);
  const systemSheetPath = paths.get(TEMPLATE_SYSTEM_SHEET);
  if (coverSheetPath === undefined || systemSheetPath === undefined) {
    throw new Error(
      `템플릿에 '${TEMPLATE_COVER_SHEET}' 또는 '${TEMPLATE_SYSTEM_SHEET}' 시트가 없다. ` +
        `있는 시트: ${[...paths.keys()].join(', ')}`,
    );
  }

  const coverSkeleton = harvestSkeleton(
    read(coverSheetPath).root,
    Object.values(COVER_ANCHOR),
  );
  const systemSkeleton = harvestSkeleton(
    read(systemSheetPath).root,
    Object.values(SYSTEM_ANCHOR),
  );

  return {
    files,
    workbook,
    workbookRels,
    contentTypes,
    coverSheetPath,
    systemSheetPath,
    coverSkeleton,
    systemSkeleton,
  };
}

export { MAIN_NS, REL_NS };
