/**
 * 원가표 파일을 표로 읽는다 (설계서 §8.3).
 *
 * 허용: CSV, 값 전용 XLSX.
 * 거부: 수식 셀, 매크로, 외부 링크, 암호화, 제한 초과.
 *
 * 설계서 §8.3의 금지 사항은 **구현으로** 지킨다.
 *   - JS 파일 실행 금지 → 이 모듈은 파일 내용을 데이터로만 읽는다
 *   - dynamic import 금지 → `import()`를 쓰지 않는다
 *   - eval 금지 → `eval`/`Function` 생성자를 쓰지 않는다
 *   - 매크로 실행 금지 → `vbaProject.bin`이 있으면 파일을 거부한다
 *
 * 설계서 §8.4: 이 모듈은 파일명이나 행 데이터를 바깥으로 내보내지 않는다.
 * 오류에는 **좌표와 사유만** 담고 값은 담지 않는다.
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
}

export type TableFormat = 'csv' | 'xlsx';

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

function parseXlsx(bytes: Uint8Array, limits: InputLimits): string[][] {
  assertOoxml(bytes);
  const files = unzipSync(bytes);
  const names = Object.keys(files);

  if (names.length > limits.maxZipEntries) {
    throw new TableReadError(
      `ZIP 항목이 ${limits.maxZipEntries}개를 넘는다.`,
      'too-many-entries',
    );
  }

  let unzipped = 0;
  for (const name of names) {
    unzipped += files[name]!.byteLength;
    if (unzipped > limits.maxUnzippedBytes) {
      throw new TableReadError(
        '압축 해제 크기가 제한을 넘는다.',
        'unzipped-too-large',
      );
    }
  }

  if (names.some((n) => /vbaProject|\.bin$/i.test(n) && /vbaProject/i.test(n))) {
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

  const sheetName = names
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort()[0];
  if (sheetName === undefined) {
    throw new TableReadError('워크시트를 찾을 수 없다.', 'no-worksheet');
  }

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

  const worksheet = parseXml(strFromU8(files[sheetName]!)).root;
  const sheetData = findChild(worksheet, 'sheetData');
  if (sheetData === undefined) return [];

  const rows: string[][] = [];
  for (const rowEl of findChildren(sheetData, 'row')) {
    const values: string[] = [];
    for (const cellEl of findChildren(rowEl, 'c')) {
      const ref = cellEl.attrs['r'] ?? '';
      const column = columnOf(ref);
      if (column > limits.maxColumns) {
        throw new TableReadError(
          `열이 ${limits.maxColumns}개를 넘는다.`,
          'too-many-columns',
        );
      }

      // 설계서 §8.3: 수식 가격 셀은 초기 버전에서 거부한다.
      // 캐시된 수식 결과를 원가 값으로 조용히 신뢰하지 않는다.
      if (findChild(cellEl, 'f') !== undefined) {
        throw new TableReadError(
          `셀 ${ref}에 수식이 있다. 값으로 붙여넣은 파일만 읽는다.`,
          'formula-cell',
        );
      }

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
    if (rows.length > limits.maxRows + 1) {
      throw new TableReadError(`행이 ${limits.maxRows}개를 넘는다.`, 'too-many-rows');
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------

export function readTable(
  bytes: Uint8Array,
  format: TableFormat,
  limits: InputLimits = DEFAULT_LIMITS,
): Table {
  if (bytes.byteLength > limits.maxBytes) {
    throw new TableReadError('파일 크기가 제한을 넘는다.', 'file-too-large');
  }

  const started = Date.now();
  const raw =
    format === 'csv'
      ? parseCsv(strFromU8(bytes).replace(/^﻿/, ''), limits)
      : parseXlsx(bytes, limits);

  if (Date.now() - started > limits.maxParseMs) {
    throw new TableReadError('파싱 시간이 제한을 넘었다.', 'parse-timeout');
  }

  const nonEmpty = raw.filter((row) => row.some((cell) => cell.trim() !== ''));
  if (nonEmpty.length === 0) {
    throw new TableReadError('빈 파일이다.', 'empty-file');
  }

  const [header, ...rows] = nonEmpty;
  return { header: header!.map((c) => c.trim()), rows };
}
