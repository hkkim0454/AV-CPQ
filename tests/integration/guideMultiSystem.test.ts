import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

import { buildGuideBasis } from '@/data/catalog/guideBasis';
import { buildCatalog } from '@/data/catalog/load';
import {
  GUIDE_IDS,
  readGuideTemplate,
  selectGuide,
  type GuideId,
  type GuideManifest,
  type GuideTemplateSet,
  type IndirectProfileId,
} from '@/export/ooxml/guideTemplate';
import { prepareQuote } from '@/export/variants/prepare';
import { buildCustomerProjection } from '@/export/customer/projection';
import {
  buildMultiSystemGuideBase,
  buildMultiSystemCustomerGuideWorkbook,
} from '@/export/customer/guideMultiSystem';
import { pickedItemsToQuote } from '@/import/picker/toQuote';
import { scanCostLeak } from '../../tools/costLeakScan';

/**
 * 다중/혼합 시스템 (독립 검토 P1-5 우선순위 1).
 *
 * 일반 2개·DS 2개·일반+DS 조합을 만든다. 합성 카탈로그·합성 간접비
 * 기준만 쓴다 — 실제 원가·거래처 자료는 쓰지 않는다(설계서 §8.4).
 */

const ROOT = resolve(__dirname, '../..');
const j = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(ROOT, 'data/approved', name), 'utf8'));

const manifest = (): GuideManifest =>
  JSON.parse(
    readFileSync(resolve(ROOT, 'templates/sanitized/guide-manifest.json'), 'utf8'),
  ) as GuideManifest;

const guideOf = (id: GuideId) =>
  readGuideTemplate(
    id,
    new Uint8Array(readFileSync(resolve(ROOT, `templates/sanitized/guide-${id}.xlsx`))),
    manifest(),
  );

const allGuides = (): GuideTemplateSet =>
  Object.fromEntries(GUIDE_IDS.map((id) => [id, guideOf(id)])) as GuideTemplateSet;

/** 시스템마다 다른 프로파일을 줄 수 있게, picker 로 N개 시스템을 만든다. */
function build(systemProfiles: readonly IndirectProfileId[]) {
  const catalog = buildCatalog(j('products.json'), j('prices.json'));
  const matrix = catalog.products.find((p) => p.quoteSpec === 'XDM-12')!;
  const rest = catalog.products
    .filter(
      (p) => p.sku !== matrix.sku && catalog.prices.has(p.sku) && p.laborMappingId !== undefined,
    )
    .slice(0, 3);
  const picked = [matrix, ...rest];

  const systemNames = ['회의실', '대회의실', '로비'];
  const document = pickedItemsToQuote(
    {
      header: {
        quoteNumber: 'MS-1',
        quoteDate: '2026-10-04',
        customer: '합성 고객',
        projectName: '다중 시스템 시험',
        contact: '',
        conditions: [],
      },
      systems: systemProfiles.map((_, index) => ({
        name: systemNames[index]!,
        items: picked.map((p, i) => ({ sku: p.sku, quantity: String(i + 1 + index) })),
      })),
    },
    catalog,
  ).document;

  const guides = allGuides();
  const basis = buildGuideBasis({
    laborItemsRaw: j('labor-items.json'),
    wageTableRaw: j('wage-table.json'),
    laborMappingsRaw: j('labor-mappings.json'),
    // 혼합 프로파일이면 간접비 기준 선택에 guide 가 필요 없는 "raw" 경로가
    // 없어서, 첫 시스템 프로파일의 가이드를 기준으로 품셈 테이블을 연결한다.
    choice: { kind: 'guide', guide: selectGuide(guides, systemProfiles[0]!, false) },
  });
  const profileBySystem = new Map(
    document.systems.map((s, index) => [s.systemId, systemProfiles[index]!]),
  );
  const prepared = prepareQuote({
    document,
    laborReference: basis.reference,
    basisVersions: basis.versions,
    guides,
    profileBySystem,
    importWarnings: [],
    wageMode: 'initialize-new',
  });
  const projection = buildCustomerProjection(prepared.document, prepared.priced.calculation);

  const guideBySystemId = new Map(
    prepared.document.systems.map((s, index) => [
      s.systemId,
      selectGuide(guides, systemProfiles[index]!, false),
    ]),
  );

  return { projection, guideBySystemId, document: prepared.document };
}

function detailOf(bytes: Uint8Array, partPath: string): string {
  return strFromU8(unzipSync(bytes)[partPath]!);
}
function cellOf(sheet: string, ref: string): string | undefined {
  return new RegExp(`<c r="${ref}"[^>]*/>|<c r="${ref}"[^>]*>[\\s\\S]*?</c>`).exec(sheet)?.[0];
}

describe('다중 시스템 — 같은 프로파일 2개 (일반×2)', () => {
  /**
   * 실측으로 걸린 결함: 시스템이 전부 같은 프로파일이면 스타일표를 합칠
   * 일이 없어서 병합 경로(`ensureMergedFor`)가 한 번도 안 불린다. 그때
   * `styles.xml`/`sharedStrings.xml` 원본 문자열(자기 `<?xml …?>` 선언을
   * 이미 갖고 있다)에 호출부가 선언을 또 붙이면 **선언이 두 번** 들어가
   * Excel이 파일을 못 연다. 혼합 프로파일 경로는 병합 과정에서 선언이
   * 자연히 벗겨져 우연히 멀쩡했다 — 그래서 "병합이 전혀 안 일어나는"
   * 이 경로를 따로 고정한다.
   */
  it('styles.xml·sharedStrings.xml 에 XML 선언이 정확히 하나다 — 병합이 안 일어나도', () => {
    const { projection, guideBySystemId } = build(['general', 'general']);
    const result = buildMultiSystemGuideBase({ exported: projection, guideBySystemId });
    const files = unzipSync(result.bytes);
    for (const part of ['xl/styles.xml', 'xl/sharedStrings.xml']) {
      const xml = strFromU8(files[part]!);
      const declCount = (xml.match(/<\?xml /g) ?? []).length;
      expect(declCount, part).toBe(1);
      expect(xml.indexOf('<?xml'), part).toBe(0);
    }
  });

  it('세부내역 시트가 2장이고 갑지가 둘 다 더한다', () => {
    const { projection, guideBySystemId } = build(['general', 'general']);
    const result = buildMultiSystemGuideBase({ exported: projection, guideBySystemId });

    expect(result.systems).toHaveLength(2);
    expect(result.systems[0]!.sheetName).toBe('세부내역');
    expect(result.systems[1]!.sheetName).toBe('세부내역2');

    const files = unzipSync(result.bytes);
    expect(files[result.systems[0]!.partPath]).toBeDefined();
    expect(files[result.systems[1]!.partPath]).toBeDefined();

    const cover = detailOf(result.bytes, 'xl/worksheets/sheet1.xml');
    expect(cellOf(cover, 'G11')).toContain("'세부내역'!");
    expect(cellOf(cover, 'G12')).toContain("'세부내역2'!");
    // 합계 SUM 범위가 11~12 를 덮는다(시스템 2개 → subtotalRow=13).
    expect(cellOf(cover, 'H13')).toContain('SUM(H11:H12)');
  });

  it('워크북에 시트가 정확히 3장(갑지+세부내역 2장) 등록된다', () => {
    const { projection, guideBySystemId } = build(['general', 'general']);
    const result = buildMultiSystemGuideBase({ exported: projection, guideBySystemId });
    const workbook = detailOf(result.bytes, 'xl/workbook.xml');
    const sheetTags = [...workbook.matchAll(/<sheet [^>]*\/>/g)];
    expect(sheetTags).toHaveLength(3);
  });

  it('쓴 칸이 두 세부내역 시트 모두에 분산돼 있다', () => {
    const { projection, guideBySystemId } = build(['general', 'general']);
    const result = buildMultiSystemGuideBase({ exported: projection, guideBySystemId });
    const partsWithWrites = new Set(
      [...result.writtenCells].map((ref) => ref.split('!')[0]),
    );
    expect(partsWithWrites.has(result.systems[0]!.partPath)).toBe(true);
    expect(partsWithWrites.has(result.systems[1]!.partPath)).toBe(true);
  });
});

describe('다중 시스템 — 같은 프로파일 2개 (DS×2)', () => {
  it('세부내역 시트가 2장이고 간접비 9항목씩 갖는다', () => {
    const { projection, guideBySystemId } = build(['ds', 'ds']);
    const result = buildMultiSystemGuideBase({ exported: projection, guideBySystemId });
    expect(result.systems[0]!.layout.indirectRows).toHaveLength(9);
    expect(result.systems[1]!.layout.indirectRows).toHaveLength(9);
  });
});

describe('다중 시스템 — 혼합 프로파일 (일반 + DS)', () => {
  it('세부내역 두 장이 서로 다른 간접비 항목 수를 갖는다 — 스타일표를 성공적으로 합쳤다', () => {
    const { projection, guideBySystemId } = build(['general', 'ds']);
    const result = buildMultiSystemGuideBase({ exported: projection, guideBySystemId });
    expect(result.systems[0]!.layout.indirectRows).toHaveLength(7);
    expect(result.systems[1]!.layout.indirectRows).toHaveLength(9);

    // 합친 결과가 ZIP 으로 다시 풀려야 한다 — 구조가 깨지지 않았다는 최소 확인.
    const files = unzipSync(result.bytes);
    expect(files['xl/styles.xml']).toBeDefined();
    const styles = strFromU8(files['xl/styles.xml']!);
    expect(styles).toContain('<styleSheet');

    // DS 세부내역의 도형 참조는 뗐다 — 관계를 안 옮겼으므로 남아 있으면 Excel이 복구를 요구한다.
    const dsDetail = detailOf(result.bytes, result.systems[1]!.partPath);
    expect(dsDetail).not.toContain('<drawing ');
  });

  it('산출물을 .local 에 써서 사람이 Excel 로 열어 볼 수 있게 한다', () => {
    const { projection, guideBySystemId } = build(['general', 'ds']);
    const result = buildMultiSystemGuideBase({ exported: projection, guideBySystemId });
    const dir = resolve(ROOT, '.local/out/multi-system');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'general-ds-mixed.xlsx'), result.bytes);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
  });
});

describe('다중 시스템 — 고객용(2단계), 금지 열 삭제', () => {
  it.each([
    ['general', 'general'],
    ['ds', 'ds'],
    ['general', 'ds'],
  ] as const)('%s+%s: 두 세부내역 시트 모두 금지 열이 지워진다', (p1, p2) => {
    const { projection, guideBySystemId } = build([p1, p2]);
    const result = buildMultiSystemCustomerGuideWorkbook({ exported: projection, guideBySystemId });
    expect(result.systems).toHaveLength(2);

    for (const sys of result.systems) {
      const sheet = detailOf(result.bytes, sys.partPath);
      for (const header of ['제조사/구매처', '영업비고', '설   명']) {
        expect(sheet, `${sys.sheetName} / ${header}`).not.toContain(header);
      }
      // 지워진 열 역할을 물으면 던진다 — 조용히 엉뚱한 칸을 주지 않는다.
      expect(() => sys.layout.column('supplier')).toThrow(/지워졌다/);
    }

    // 갑지가 두 시트 모두를, 지워진 뒤의 새 주소로 가리킨다.
    const cover = detailOf(result.bytes, 'xl/worksheets/sheet1.xml');
    expect(cellOf(cover, 'G11')).toContain(`'${result.systems[0]!.sheetName}'!`);
    expect(cellOf(cover, 'G12')).toContain(`'${result.systems[1]!.sheetName}'!`);
  });

  it('B2 — 다중 시스템 고객용에도 금지 단어·금지 파트가 없다', () => {
    const { projection, guideBySystemId } = build(['general', 'ds']);
    const result = buildMultiSystemCustomerGuideWorkbook({ exported: projection, guideBySystemId });
    const found = scanCostLeak(result.bytes, {
      costValues: [],
      allowedCells: result.writtenCells,
    });
    expect(found.filter((f) => f.kind === 'forbidden-word' || f.kind === 'forbidden-part')).toEqual(
      [],
    );
  });

  it('고객용 혼합 산출물을 .local 에 써서 Excel 로 직접 확인할 수 있게 한다', () => {
    const { projection, guideBySystemId } = build(['general', 'ds']);
    const result = buildMultiSystemCustomerGuideWorkbook({ exported: projection, guideBySystemId });
    const dir = resolve(ROOT, '.local/out/multi-system');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'general-ds-mixed-level2.xlsx'), result.bytes);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
  });
});
