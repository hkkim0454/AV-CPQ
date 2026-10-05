/**
 * 원가표 파일을 표로 읽는다 (설계서 §8.3).
 *
 * 허용: CSV, XLSX.
 * 거부: 매크로, 외부 링크, 암호화, 제한 초과.
 *
 * **수식은 파일 단위로 거부하지 않는다.** 품셈 파일은 수식투성이고 그 대부분은
 * 원가와 무관하다. 수식이 있던 자리를 `formulaColumns`로 기록해 넘기고,
 * **읽는 가격 열에 수식이 있을 때만** 막는다 (`parsePrivatePrices`).
 * 설계서 §8.3의 취지는 "수식이 만든 가격을 믿지 말자"지 "수식 있는 파일을
 * 거부하자"가 아니다.
 *
 * 설계서 §8.3의 금지 사항은 **구현으로** 지킨다.
 *   - JS 파일 실행 금지 → 이 모듈은 파일 내용을 데이터로만 읽는다
 *   - dynamic import 금지 → `import()`를 쓰지 않는다
 *   - eval 금지 → `eval`/`Function` 생성자를 쓰지 않는다
 *   - 매크로 실행 금지 → `vbaProject.bin`이 있으면 파일을 거부한다
 *
 * 설계서 §8.4: 이 모듈은 파일명이나 행 데이터를 바깥으로 내보내지 않는다.
 * 오류에는 **좌표와 사유만** 담고 값은 담지 않는다.
 *
 * ## 시트 선택은 workbook 관계로 한다 — 파일 이름 정렬이 아니다
 *
 * 실제 원가 파일은 "갑지"(표지) 시트를 포함해 여러 시트를 담고 있을 수
 * 있고, 그 표지 시트가 ZIP 안에서 `sheet1.xml`일 수도 있다. `sheet1.xml
 * < sheet2.xml < …` 같은 **파일 이름 정렬로 "첫 시트"를 고르면 표지를
 * 원가표로 잘못 읽는다.** 반드시 `xl/workbook.xml`의 `<sheets>` 순서와
 * `xl/_rels/workbook.xml.rels`의 관계(r:id → 파트 경로)를 따라가 실제
 * Excel 탭 순서·이름을 복원한다 — `export/ooxml/template.ts`의
 * `resolveSheetPaths`와 같은 알고리즘이다.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { parseXml, findChild, findChildren } from '../../export/ooxml/xml';
import { DEFAULT_LIMITS, type InputLimits } from './limits';

export class TableReadError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'TableReadError';
  }
}

export interface Table {
  header: string[];
  rows: string[][];
  /**
   * 데이터 행별로 **수식이 들어 있던 열 번호**. `rows`와 같은 순서·길이다.
   *
   * 값이 아니라 자리만 담는다 — 이 구조는 원가를 싣지 않는다 (설계서 §8.4).
   */
  formulaColumns: ReadonlySet<number>[];
}

export type TableFormat = 'csv' | 'xlsx';

export interface ReadTableOptions {
  /** `listXlsxSheets`가 돌려준 `sheetPath` — 비우면 워크북 순서상 첫 시트다. */
  sheetPath?: string;
  /**
   * 머리글 행의 자리(0부터, 원본 행 그대로 — 빈 행도 센다). 비우면
   * 기존 동작(처음 나오는 비어있지 않은 행)을 그대로 쓴다. 실제 파일은
   * 표지성 설명 행이 머리글 위에 있을 수 있어, 사람이 미리보기에서
   * 직접 고른 행 번호를 그대로 받는다 — 추측하지 않는다.
   */
  headerRowIndex?: number;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function parseCsv(text: string, limits: InputLimits): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let index = 0;

  const pushField = (): void => {
    row.push(field);
    field = '';
    if (row.length > limits.maxColumns) {
      throw new TableReadError(
        `열이 ${limits.maxColumns}개를 넘는다.`,
        'too-many-columns',
      );
    }
  };
  const pushRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
    if (rows.length > limits.maxRows + 1) {
      throw new TableReadError(`행이 ${limits.maxRows}개를 넘는다.`, 'too-many-rows');
    }
  };

  while (index < text.length) {
    const ch = text[index]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += ch;
      index += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (ch === ',') {
      pushField();
      index += 1;
      continue;
    }
    if (ch === '\r') {
      index += 1;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      index += 1;
      continue;
    }
    field += ch;
    index += 1;
  }
  if (field !== '' || row.length > 0) pushRow();

  return rows;
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_SIGNATURE = [0x50, 0x4b];

function assertOoxml(bytes: Uint8Array): void {
  if (OLE_SIGNATURE.every((b, i) => bytes[i] === b)) {
    throw new TableReadError(
      '암호화되었거나 구형(.xls) 형식이다. 암호를 풀고 .xlsx로 저장해 다시 선택한다.',
      'encrypted-or-legacy',
    );
  }
  if (!ZIP_SIGNATURE.every((b, i) => bytes[i] === b)) {
    throw new TableReadError('xlsx 형식이 아니다.', 'not-xlsx');
  }
}

function columnOf(ref: string): number {
  let out = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    out = out * 26 + (code - 64);
  }
  return out;
}

interface RawSheet {
  rows: string[][];
  /** 행마다 수식이 있던 열 번호. `rows`와 같은 길이다. */
  formulas: Set<number>[];
}

export interface XlsxSheetInfo {
  /** Excel 탭에 보이는 실제 이름. */
  name: string;
  /** `readTable`/`previewXlsxRows`에 그대로 넘기는 내부 경로 표식. */
  sheetPath: string;
}

/** `xl/_rels/workbook.xml.rels`의 관계 Id → 파트 경로. */
function resolveRelTargets(files: Record<string, Uint8Array>): Map<string, string> {
  const relTargets = new Map<string, string>();
  const relsRaw = files['xl/_rels/workbook.xml.rels'];
  if (relsRaw === undefined) return relTargets;
  const rels = parseXml(strFromU8(relsRaw));
  for (const rel of rels.root.children) {
    const id = rel.attrs['Id'];
    const target = rel.attrs['Target'];
    if (id === undefined || target === undefined) continue;
    relTargets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  }
  return relTargets;
}

/**
 * `xl/workbook.xml`의 `<sheets>` 순서(= Excel 탭 순서)대로, 관계를 따라가
 * 실제 이름·파트 경로를 돌려준다. 파일 이름 정렬이 아니다(위 모듈 설명).
 */
function listSheetsFromFiles(files: Record<string, Uint8Array>): XlsxSheetInfo[] {
  const workbookRaw = files['xl/workbook.xml'];
  if (workbookRaw === undefined) {
    throw new TableReadError('워크북 구조(xl/workbook.xml)가 없다.', 'no-workbook');
  }
  const workbook = parseXml(strFromU8(workbookRaw));
  const relTargets = resolveRelTargets(files);

  const sheetsEl = findChild(workbook.root, 'sheets');
  if (sheetsEl === undefined) {
    throw new TableReadError('워크시트 목록을 찾을 수 없다.', 'no-worksheet');
  }

  const out: XlsxSheetInfo[] = [];
  for (const sheet of findChildren(sheetsEl, 'sheet')) {
    const name = sheet.attrs['name'];
    const relId = sheet.attrs['r:id'] ?? sheet.attrs['id'];
    if (name === undefined || relId === undefined) continue;
    const target = relTargets.get(relId);
    if (target !== undefined && files[target] !== undefined) out.push({ name, sheetPath: target });
  }
  if (out.length === 0) {
    throw new TableReadError('워크시트를 찾을 수 없다.', 'no-worksheet');
  }
  return out;
}

/** 통합문서의 시트 목록을 Excel 탭 순서·실제 이름 그대로 돌려준다 — 시트 선택 UI용. */
export function listXlsxSheets(bytes: Uint8Array, limits: InputLimits = DEFAULT_LIMITS): XlsxSheetInfo[] {
  assertOoxml(bytes);
  const files = unzipSync(bytes);
  guardZip(files, limits);
  return listSheetsFromFiles(files);
}

function guardZip(files: Record<string, Uint8Array>, limits: InputLimits): void {
  const names = Object.keys(files);
  if (names.length > limits.maxZipEntries) {
    throw new TableReadError(`ZIP 항목이 ${limits.maxZipEntries}개를 넘는다.`, 'too-many-entries');
  }
  let unzipped = 0;
  for (const name of names) {
    unzipped += files[name]!.byteLength;
    if (unzipped > limits.maxUnzippedBytes) {
      throw new TableReadError('압축 해제 크기가 제한을 넘는다.', 'unzipped-too-large');
    }
  }
  if (names.some((n) => /vbaProject/i.test(n))) {
    throw new TableReadError(
      '매크로가 든 통합문서다. 매크로 없는 값 전용 파일로 저장해 다시 선택한다.',
      'macro-present',
    );
  }
  if (names.some((n) => /externalLink/i.test(n))) {
    throw new TableReadError(
      '외부 링크가 있는 통합문서다. 값으로 붙여넣어 링크를 끊고 다시 선택한다.',
      'external-link',
    );
  }
}

function parseXlsxSheet(files: Record<string, Uint8Array>, sheetPath: string, limits: InputLimits): RawSheet {
  const sharedStrings: string[] = [];
  const sstRaw = files['xl/sharedStrings.xml'];
  if (sstRaw !== undefined) {
    const sst = parseXml(strFromU8(sstRaw)).root;
    for (const si of findChildren(sst, 'si')) {
      const direct = findChild(si, 't');
      if (direct?.text !== undefined) {
        sharedStrings.push(direct.text);
        continue;
      }
      // 서식이 섞인 문자열은 <r><t>…</t></r> 조각으로 나뉜다.
      let joined = '';
      for (const run of findChildren(si, 'r')) {
        joined += findChild(run, 't')?.text ?? '';
      }
      sharedStrings.push(joined);
    }
  }

  const sheetRaw = files[sheetPath];
  if (sheetRaw === undefined) {
    throw new TableReadError(`시트 '${sheetPath}'를 찾을 수 없다.`, 'sheet-not-found');
  }
  const worksheet = parseXml(strFromU8(sheetRaw)).root;
  const sheetData = findChild(worksheet, 'sheetData');
  if (sheetData === undefined) return { rows: [], formulas: [] };

  const rows: string[][] = [];
  const formulas: Set<number>[] = [];
  for (const rowEl of findChildren(sheetData, 'row')) {
    const values: string[] = [];
    const formulaAt = new Set<number>();
    for (const cellEl of findChildren(rowEl, 'c')) {
      const ref = cellEl.attrs['r'] ?? '';
      const column = columnOf(ref);
      if (column > limits.maxColumns) {
        throw new TableReadError(`열이 ${limits.maxColumns}개를 넘는다.`, 'too-many-columns');
      }

      // 설계서 §8.3: 캐시된 수식 결과를 원가 값으로 조용히 신뢰하지 않는다.
      // 다만 **여기서 막지 않는다.** 품셈 파일은 수식투성이고 대부분 원가와
      // 무관하다. 자리만 적어 두고, 가격 열에 걸렸을 때 호출부가 막는다.
      if (findChild(cellEl, 'f') !== undefined) formulaAt.add(column - 1);

      const type = cellEl.attrs['t'];
      let value = '';
      if (type === 's') {
        const at = Number.parseInt(findChild(cellEl, 'v')?.text ?? '', 10);
        value = Number.isNaN(at) ? '' : (sharedStrings[at] ?? '');
      } else if (type === 'inlineStr') {
        const is = findChild(cellEl, 'is');
        value = is === undefined ? '' : (findChild(is, 't')?.text ?? '');
      } else {
        value = findChild(cellEl, 'v')?.text ?? '';
      }

      while (values.length < column - 1) values.push('');
      values[column - 1] = value;
    }
    rows.push(values);
    formulas.push(formulaAt);
    if (rows.length > limits.maxRows + 1) {
      throw new TableReadError(`행이 ${limits.maxRows}개를 넘는다.`, 'too-many-rows');
    }
  }
  return { rows, formulas };
}

function parseXlsx(bytes: Uint8Array, limits: InputLimits, sheetPath?: string): RawSheet {
  assertOoxml(bytes);
  const files = unzipSync(bytes);
  guardZip(files, limits);
  const resolved = sheetPath ?? listSheetsFromFiles(files)[0]!.sheetPath;
  return parseXlsxSheet(files, resolved, limits);
}

/**
 * 머리글을 고르기 전에 시트의 원본 행을 미리 본다 — 열 이름을 아직
 * 모르니 `Table`이 아니라 원본 문자열 그대로 돌려준다(헤더 행 선택
 * UI용). 수식 자리는 보지 않는다 — 미리보기는 값만 보여준다.
 */
export function previewXlsxRows(
  bytes: Uint8Array,
  sheetPath: string,
  maxRows = 15,
  limits: InputLimits = DEFAULT_LIMITS,
): string[][] {
  assertOoxml(bytes);
  const files = unzipSync(bytes);
  guardZip(files, limits);
  const sheet = parseXlsxSheet(files, sheetPath, limits);
  return sheet.rows.slice(0, maxRows);
}

// ---------------------------------------------------------------------------

export function readTable(
  bytes: Uint8Array,
  format: TableFormat,
  limits: InputLimits = DEFAULT_LIMITS,
  options: ReadTableOptions = {},
): Table {
  if (bytes.byteLength > limits.maxBytes) {
    throw new TableReadError('파일 크기가 제한을 넘는다.', 'file-too-large');
  }

  const started = Date.now();
  const sheet: RawSheet =
    format === 'csv'
      ? { rows: parseCsv(strFromU8(bytes).replace(/^﻿/, ''), limits), formulas: [] }
      : parseXlsx(bytes, limits, options.sheetPath);

  if (Date.now() - started > limits.maxParseMs) {
    throw new TableReadError('파싱 시간이 제한을 넘었다.', 'parse-timeout');
  }

  if (options.headerRowIndex !== undefined) {
    const headerRowIndex = options.headerRowIndex;
    if (headerRowIndex < 0 || headerRowIndex >= sheet.rows.length) {
      throw new TableReadError('머리글 행 번호가 범위를 벗어났다.', 'header-row-out-of-range');
    }
    const header = sheet.rows[headerRowIndex]!.map((c) => c.trim());
    const dataRows = sheet.rows.slice(headerRowIndex + 1);
    const dataFormulas = sheet.formulas.slice(headerRowIndex + 1);
    // 빈 행을 거를 때 수식 자리도 같이 걸러야 행 번호가 어긋나지 않는다.
    const kept: Array<{ values: string[]; formulas: ReadonlySet<number> }> = [];
    dataRows.forEach((row, index) => {
      if (!row.some((cell) => cell.trim() !== '')) return;
      kept.push({ values: row, formulas: dataFormulas[index] ?? new Set<number>() });
    });
    if (kept.length === 0) {
      throw new TableReadError('빈 파일이다.', 'empty-file');
    }
    return {
      header,
      rows: kept.map((r) => r.values),
      formulaColumns: kept.map((r) => r.formulas),
    };
  }

  // 머리글 행을 명시하지 않으면 기존 동작: 처음 나오는 비어있지 않은
  // 행을 머리글로 삼는다(간단한 CSV 경로가 그대로 쓰는 기본값).
  const kept: Array<{ values: string[]; formulas: ReadonlySet<number> }> = [];
  sheet.rows.forEach((row, index) => {
    if (!row.some((cell) => cell.trim() !== '')) return;
    kept.push({ values: row, formulas: sheet.formulas[index] ?? new Set<number>() });
  });
  if (kept.length === 0) {
    throw new TableReadError('빈 파일이다.', 'empty-file');
  }

  const [header, ...rest] = kept;
  return {
    header: header!.values.map((c) => c.trim()),
    rows: rest.map((r) => r.values),
    formulaColumns: rest.map((r) => r.formulas),
  };
}
