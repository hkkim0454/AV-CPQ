/**
 * 가이드 템플릿으로 **여러 시스템**을 한 통합문서에 낸다 (계획 2026-10-04,
 * 독립 검토 P1-5 "다중/혼합 시스템").
 *
 * ## 단일 시스템과 다른 점
 *
 * `buildGuideBase` 는 세부내역 시트가 하나뿐이라고 가정한다. 여기서는
 * 시스템마다 **세부내역 시트를 하나씩 더 만든다** — 기존 가이드 템플릿의
 * 품목 행이 늘어나는 것과 같은 방식으로, 갑지의 시스템 한 줄(11행)도
 * 시스템 수만큼 늘린다. **새 서식을 짓지 않는다** — 전부 기존 템플릿
 * 행의 서식을 복제해 쓴다(D17). 이것은 "시트/행을 확장하는 것"이지
 * "서식을 새로 만드는 것"이 아니다.
 *
 * ## 혼합 프로파일(예: 일반 + DS)
 *
 * OOXML 통합문서는 `xl/styles.xml` 하나를 모든 시트가 공유한다. 시스템마다
 * 다른 가이드(다른 styles.xml)를 쓰면, 첫 시스템의 가이드를 **기준**으로
 * 삼고 나머지 시스템의 세부내역 시트를 기준 스타일표에 합친다
 * (`guideStyleMerge.ts`). 같은 프로파일끼리는 합칠 게 없다 — 이미 같은
 * styles.xml 을 쓴다.
 *
 * ## 하지 않는 것 (의도적 단순화)
 *
 * 기준이 아닌 시스템의 세부내역 시트에 도형(예: DS 가이드의 간접비 설명
 * 박스, `docs/template/verification.md` P2-2 기록 참고)이 있으면 **옮기지
 * 않고 뗀다.** 그 도형은 내용이 평문 요율 반복이라 떼도 정보 손실이 없고,
 * 도형·관계를 그대로 옮기려면 Content_Types·시트별 rels 까지 더 손대야
 * 한다. 떼지 않고 관계만 안 옮기면 Excel이 복구 경고를 띄운다.
 *
 * 그룹(`exported.groups`)은 **첫 번째만** 쓴다 — 기존 단일 시스템 경로도
 * 이미 그랬다(`guideWorkbook.ts`의 `fillCover`). 여러 그룹을 갑지에 따로
 * 묶는 것은 이번 범위 밖이다.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import type { CustomerExport } from './projection';
import type { GuideTemplate } from '../ooxml/guideTemplate';
import {
  buildSystemSheetContent,
  GuideWorkbookError,
} from './guideWorkbook';
import type { GuideSheetLayout } from '../ooxml/guideLayout';
import { fillGuideSheet } from '../ooxml/guideSheet';
import { fillCoverMultiSystem, type CoverSystemEntry } from '../ooxml/guideCoverMulti';
import { mergeSharedStrings, mergeStylesheets, remapWorksheetIndices } from '../ooxml/guideStyleMerge';
import {
  rebuildContentTypes,
  rebuildWorkbookRels,
  rebuildWorkbookXml,
  relsPathOf,
  type SheetEntry,
} from '../ooxml/workbook';
import { parseXml, serializeElement } from '../ooxml/xml';
import { quoteSheetRef } from '../ooxml/sheetName';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export interface MultiSystemGuideInput {
  exported: CustomerExport;
  /** 시스템 id → 그 시스템에 쓸 가이드. 시스템마다 프로파일이 달라도 된다. */
  guideBySystemId: ReadonlyMap<string, GuideTemplate>;
}

export interface SystemSheetInfo {
  systemId: string;
  sheetName: string;
  /** `xl/worksheets/sheet3.xml` 꼴. */
  partPath: string;
  layout: GuideSheetLayout;
}

export interface MultiSystemGuideWorkbookResult {
  bytes: Uint8Array;
  sheetNames: { cover: string };
  /** 시스템 순서대로, 각 시스템이 실제로 어느 시트·레이아웃으로 나갔는지. */
  systems: readonly SystemSheetInfo[];
  writtenCells: ReadonlySet<string>;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 세부내역 시트 루트의 `<drawing r:id=".."/>` 를 뗀다 — 관계를 안 옮기므로 참조도 없앤다. */
function stripDrawingRef(sheetXml: string): string {
  return sheetXml.replace(/<drawing r:id="[^"]*"\/>/, '');
}

/** `A1:J21` → `$A$1:$J$21`, 끝 행 번호에 shift 를 더한다. */
function toDollarPrintArea(areaA1: string, rowShift: number): string {
  const [start, end] = areaA1.split(':') as [string, string];
  const dollar = (ref: string, extraRowShift: number): string => {
    const col = ref.replace(/\d+$/, '');
    const row = Number.parseInt(ref.replace(/^[A-Z]+/, ''), 10) + extraRowShift;
    return `$${col}$${row}`;
  };
  return `${dollar(start, 0)}:${dollar(end, rowShift)}`;
}

/** 갑지의 머리정보(C2~C6)와 그룹 머리글(B10/C10)만 채운다 — 시스템 줄은 별도. */
function fillCoverHeader(coverXml: string, exported: CustomerExport): string {
  const group = exported.groups[0];
  const replacements = new Map<string, string>([
    ['C2', exported.header.quoteNumber],
    ['C3', exported.header.quoteDate],
    ['C4', exported.header.customer],
    ['C5', exported.header.projectName],
    ['C6', exported.header.contact],
    ['B10', group?.marker ?? 'Ⅰ'],
    ['C10', group?.name ?? exported.header.projectName],
  ]);
  return coverXml.replace(/<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g, (cellBlock) => {
    const ref = /\br="([A-Z]+\d+)"/.exec(cellBlock)?.[1];
    if (ref === undefined) return cellBlock;
    const value = replacements.get(ref);
    if (value === undefined) return cellBlock;
    const style = /\bs="(\d+)"/.exec(cellBlock)?.[1];
    const styleAttr = style === undefined ? '' : ` s="${style}"`;
    if (value === '') return `<c r="${ref}"${styleAttr}/>`;
    return (
      `<c r="${ref}"${styleAttr} t="inlineStr">` +
      `<is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
    );
  });
}

export function buildMultiSystemGuideBase(
  input: MultiSystemGuideInput,
): MultiSystemGuideWorkbookResult {
  const { exported } = input;
  const systems = exported.systems;
  if (systems.length === 0) {
    throw new GuideWorkbookError('시스템이 하나도 없다.');
  }

  const baseSystem = systems[0]!;
  const baseGuide = input.guideBySystemId.get(baseSystem.systemId);
  if (baseGuide === undefined) {
    throw new GuideWorkbookError(`시스템 ${baseSystem.systemId} 의 가이드가 없다.`);
  }

  // --- 스타일표·공유 문자열표를 기준 가이드부터 시작해 누적 합친다 ---
  const baseFiles = unzipSync(baseGuide.bytes);
  const baseStylesPart = baseFiles['xl/styles.xml'];
  const baseSstPart = baseFiles['xl/sharedStrings.xml'];
  if (baseStylesPart === undefined) {
    throw new GuideWorkbookError('기준 가이드에 styles.xml 이 없다.');
  }

  // **선언을 벗겨서 저장한다.** 시스템이 전부 같은 프로파일이면 아래
  // `ensureMergedFor` 가 한 번도 안 불려서 이 값이 그대로 파일에 쓰인다 —
  // 원본 문자열을 그대로 두면 그 안의 `<?xml …?>` 선언이 남은 채로, 마지막에
  // 또 하나(XML_DECL)를 더 붙이게 돼 **선언이 두 번** 들어간다. Excel은 그런
  // 파일을 열지 못한다(실측 — 혼합 프로파일 경로는 병합 과정에서 선언이
  // 자연히 벗겨져 우연히 멀쩡했고, 같은 프로파일 경로에서만 터졌다).
  let mergedStylesXml = serializeElement(parseXml(strFromU8(baseStylesPart)).root);
  let mergedSstXml =
    baseSstPart === undefined
      ? undefined
      : serializeElement(parseXml(strFromU8(baseSstPart)).root);
  const remapByGuideId = new Map<
    string,
    {
      cellXfIndex: (i: number) => number;
      dxfIndex: (i: number) => number;
      sharedStringIndex: (i: number) => number;
    }
  >();

  const ensureMergedFor = (guide: GuideTemplate): void => {
    if (guide.id === baseGuide.id || remapByGuideId.has(guide.id)) return;
    const files = unzipSync(guide.bytes);
    const stylesPart = files['xl/styles.xml'];
    const sstPart = files['xl/sharedStrings.xml'];
    if (stylesPart === undefined) {
      throw new GuideWorkbookError(`가이드 '${guide.id}' 에 styles.xml 이 없다.`);
    }
    const styleMerge = mergeStylesheets(mergedStylesXml, strFromU8(stylesPart));
    const sstMerge = mergeSharedStrings(
      mergedSstXml,
      sstPart === undefined ? undefined : strFromU8(sstPart),
    );
    mergedStylesXml = styleMerge.stylesXml;
    mergedSstXml = sstMerge.sharedStringsXml;
    remapByGuideId.set(guide.id, {
      cellXfIndex: styleMerge.cellXfIndex,
      dxfIndex: styleMerge.dxfIndex,
      sharedStringIndex: sstMerge.index,
    });
  };

  for (const system of systems) {
    const guide = input.guideBySystemId.get(system.systemId);
    if (guide === undefined) {
      throw new GuideWorkbookError(`시스템 ${system.systemId} 의 가이드가 없다.`);
    }
    if (guide.hasCost !== baseGuide.hasCost) {
      throw new GuideWorkbookError(
        `시스템마다 원가 열 유무가 다르면 안 된다 ` +
          `(${baseSystem.systemId}=${baseGuide.hasCost}, ${system.systemId}=${guide.hasCost}).`,
      );
    }
    ensureMergedFor(guide);
  }

  // --- 시스템마다 세부내역 시트를 만든다 ---
  interface BuiltDetail {
    systemId: string;
    guide: GuideTemplate;
    sheetName: string;
    partPath: string;
    sheetXml: string;
    layout: GuideSheetLayout;
    grandTotalRef: string; // "'세부내역2'!M25" 꼴
    sellRefs: string[]; // part 접두어 없는 "I6" 꼴 — 호출부가 합친다
  }

  const written = new Set<string>();
  const details: BuiltDetail[] = systems.map((system, index) => {
    const guide = input.guideBySystemId.get(system.systemId)!;
    const calculation = exported.calculation.systems.find((s) => s.systemId === system.systemId);
    if (calculation === undefined) {
      throw new GuideWorkbookError(`시스템 ${system.systemId} 의 계산 결과가 없다.`);
    }
    const content = buildSystemSheetContent(system, calculation, guide);

    const files = unzipSync(guide.bytes);
    const rawDetail = files['xl/worksheets/sheet2.xml'];
    if (rawDetail === undefined) {
      throw new GuideWorkbookError(`가이드 '${guide.id}' 에 세부내역 시트가 없다.`);
    }
    let sheetXml = fillGuideSheet({
      sheetXml: strFromU8(rawDetail),
      layout: content.layout,
      contentByRow: content.contentByRow,
    });

    if (guide.id !== baseGuide.id) {
      const remap = remapByGuideId.get(guide.id)!;
      sheetXml = remapWorksheetIndices(sheetXml, remap);
      // 기준이 아닌 시트의 도형 참조는 옮기지 않는다 — 머리말 설명 참고.
      sheetXml = stripDrawingRef(sheetXml);
    }

    const partPath = `xl/worksheets/sheet${index + 2}.xml`;
    const sheetName = index === 0 ? guide.sheets.detail : `${guide.sheets.detail}${index + 1}`;
    const grandTotalRef = `${quoteSheetRef(sheetName)}!${content.layout.column('total')}${content.layout.grandTotalRow}`;

    return {
      systemId: system.systemId,
      guide,
      sheetName,
      partPath,
      sheetXml,
      layout: content.layout,
      grandTotalRef,
      sellRefs: content.sellRefs,
    };
  });

  for (const detail of details) {
    for (const ref of detail.sellRefs) written.add(`${detail.partPath}!${ref}`);
  }

  // --- 갑지 ---
  const coverPart = baseFiles['xl/worksheets/sheet1.xml'];
  if (coverPart === undefined) {
    throw new GuideWorkbookError('기준 가이드에 갑지 시트가 없다.');
  }
  let coverXml = fillCoverHeader(strFromU8(coverPart), exported);
  const coverSystems: CoverSystemEntry[] = details.map((detail) => ({
    name: exported.systems.find((s) => s.systemId === detail.systemId)!.name,
    summarySpec: exported.systems.find((s) => s.systemId === detail.systemId)!.summarySpec,
    unit: exported.systems.find((s) => s.systemId === detail.systemId)!.unit,
    quantity: exported.systems.find((s) => s.systemId === detail.systemId)!.quantity,
    totalReference: detail.grandTotalRef,
  }));
  const coverResult = fillCoverMultiSystem(coverXml, coverSystems);
  coverXml = coverResult.sheetXml;
  for (const row of coverResult.systemRows) {
    written.add(`xl/worksheets/sheet1.xml!G${row}`);
    written.add(`xl/worksheets/sheet1.xml!H${row}`);
  }
  written.add(`xl/worksheets/sheet1.xml!H${coverResult.subtotalRow}`);

  // --- sheetId·관계·Content_Types (기존 다중 시트 조립과 같은 함수를 쓴다) ---
  const sheetEntries: SheetEntry[] = [
    {
      name: baseGuide.sheets.cover,
      path: 'xl/worksheets/sheet1.xml',
      relId: 'rId1',
      printArea: toDollarPrintArea(baseGuide.printArea.cover, coverResult.shift),
    },
    ...details.map((detail, index) => ({
      name: detail.sheetName,
      path: detail.partPath,
      relId: `rId${index + 2}`,
      printArea: toDollarPrintArea(detail.layout.printArea, 0),
      printTitles: '$1:$3',
    })),
  ];

  const workbookDoc = parseXml(strFromU8(baseFiles['xl/workbook.xml']!));
  const workbookRelsDoc = parseXml(strFromU8(baseFiles['xl/_rels/workbook.xml.rels']!));
  const contentTypesDoc = parseXml(strFromU8(baseFiles['[Content_Types].xml']!));

  const newWorkbookXml = rebuildWorkbookXml(workbookDoc, sheetEntries);
  const newWorkbookRels = rebuildWorkbookRels(workbookRelsDoc, sheetEntries);
  const newContentTypes = rebuildContentTypes(contentTypesDoc, sheetEntries);

  // --- 패키지 조립 ---
  const patched: Record<string, Uint8Array> = {};
  // 기준 가이드의 시트·관계 이외 파트(테마 등)를 그대로 가져온다.
  for (const [name, bytes] of Object.entries(baseFiles)) {
    if (name.startsWith('xl/worksheets/')) continue;
    if (name === 'xl/workbook.xml') continue;
    if (name === 'xl/_rels/workbook.xml.rels') continue;
    if (name === '[Content_Types].xml') continue;
    if (name === 'xl/styles.xml') continue;
    if (name === 'xl/sharedStrings.xml') continue;
    if (name === 'xl/calcChain.xml') continue;
    patched[name] = bytes;
  }

  patched['xl/styles.xml'] = strToU8(XML_DECL + mergedStylesXml);
  if (mergedSstXml !== undefined) {
    patched['xl/sharedStrings.xml'] = strToU8(XML_DECL + mergedSstXml);
  }
  patched['xl/workbook.xml'] = strToU8(newWorkbookXml);
  patched['xl/_rels/workbook.xml.rels'] = strToU8(newWorkbookRels);
  patched['[Content_Types].xml'] = strToU8(newContentTypes);
  patched['xl/worksheets/sheet1.xml'] = strToU8(coverXml);

  // 기준 시트(갑지)의 시트별 rels(예: 갑지 직인 도형)가 있으면 그대로 옮긴다.
  const baseCoverRels = baseFiles[relsPathOf('xl/worksheets/sheet1.xml')];
  if (baseCoverRels !== undefined) {
    patched[relsPathOf('xl/worksheets/sheet1.xml')] = baseCoverRels;
  }

  details.forEach((detail) => {
    patched[detail.partPath] = strToU8(detail.sheetXml);
    // 기준 가이드(index 0, guide.id === baseGuide.id)의 세부내역 rels(있다면)만
    // 그대로 옮긴다 — 나머지는 도형 참조를 이미 뗐으므로 rels 가 필요 없다.
    if (detail.guide.id === baseGuide.id) {
      const rels = baseFiles[relsPathOf('xl/worksheets/sheet2.xml')];
      if (rels !== undefined) patched[relsPathOf(detail.partPath)] = rels;
    }
  });

  const ordered: Record<string, Uint8Array> = {
    '[Content_Types].xml': patched['[Content_Types].xml']!,
  };
  for (const [name, bytes] of Object.entries(patched)) {
    if (name !== '[Content_Types].xml') ordered[name] = bytes;
  }

  return {
    bytes: zipSync(ordered),
    sheetNames: { cover: baseGuide.sheets.cover },
    systems: details.map((d) => ({
      systemId: d.systemId,
      sheetName: d.sheetName,
      partPath: d.partPath,
      layout: d.layout,
    })),
    writtenCells: written,
  };
}
