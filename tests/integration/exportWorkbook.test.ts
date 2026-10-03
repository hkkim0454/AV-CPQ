import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

import { calculateQuote } from '@/domain/calculation/calculate';
import { buildCustomerProjection } from '@/export/customer/projection';
import { buildQuoteWorkbook } from '@/export/ooxml/workbook';
import { planWorkbook } from '@/export/ooxml/layout';
import { parseXml, findChild, findChildren } from '@/export/ooxml/xml';
import { TEMPLATE_PATH } from '@/export/ooxml/anchors';
import {
  syntheticQuote,
  emptySystemQuote,
  SENTINEL_COST,
  SENTINEL_SUPPLIER,
} from '../fixtures/syntheticQuote';

const ROOT = resolve(__dirname, '../..');
const OUT_DIR = resolve(ROOT, 'tests/fixtures/out');

let templateBytes: Uint8Array;

beforeAll(() => {
  templateBytes = new Uint8Array(readFileSync(resolve(ROOT, TEMPLATE_PATH)));
  mkdirSync(OUT_DIR, { recursive: true });
});

function build(doc = syntheticQuote()) {
  const calculation = calculateQuote(doc);
  const projection = buildCustomerProjection(doc, calculation);
  const result = buildQuoteWorkbook(projection, templateBytes);
  return { doc, calculation, projection, result };
}

function parts(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}

function sheetXml(bytes: Uint8Array, index: number) {
  const raw = parts(bytes)[`xl/worksheets/sheet${index}.xml`];
  expect(raw, `sheet${index}.xml이 있어야 한다`).toBeDefined();
  return parseXml(strFromU8(raw!)).root;
}

function cellsOf(worksheet: ReturnType<typeof sheetXml>) {
  const map = new Map<string, { s?: string; t?: string; f?: string; v?: string }>();
  const sheetData = findChild(worksheet, 'sheetData')!;
  for (const row of findChildren(sheetData, 'row')) {
    for (const c of findChildren(row, 'c')) {
      const ref = c.attrs['r']!;
      const f = findChild(c, 'f');
      const v = findChild(c, 'v');
      const is = findChild(c, 'is');
      map.set(ref, {
        ...(c.attrs['s'] !== undefined ? { s: c.attrs['s'] } : {}),
        ...(c.attrs['t'] !== undefined ? { t: c.attrs['t'] } : {}),
        ...(f?.text !== undefined ? { f: f.text } : {}),
        ...(v?.text !== undefined
          ? { v: v.text }
          : is !== undefined
            ? { v: findChild(is, 't')?.text ?? '' }
            : {}),
      });
    }
  }
  return map;
}

describe('buildQuoteWorkbook — 패키지 구조', () => {
  it('시스템 수만큼 시트를 만든다 (갑지 + 2)', () => {
    const { result } = build();
    const files = parts(result.bytes);
    const sheetParts = Object.keys(files).filter((n) =>
      /^xl\/worksheets\/sheet\d+\.xml$/.test(n),
    );
    expect(sheetParts).toHaveLength(3);
    expect(result.sheetNames).toEqual(['갑지', '교육장 영상', '교육장 음향']);
  });

  it('외부 링크·계산체인·customProperties를 넣지 않는다 (설계서 §9.6)', () => {
    const { result } = build();
    const names = Object.keys(parts(result.bytes));
    expect(names.filter((n) => /externalLink/i.test(n))).toEqual([]);
    expect(names).not.toContain('xl/calcChain.xml');
    expect(names).not.toContain('docProps/custom.xml');
  });

  it('styles.xml을 그대로 복사한다 — 서식을 코드로 재생성하지 않는다', () => {
    const { result } = build();
    const before = parts(templateBytes)['xl/styles.xml']!;
    const after = parts(result.bytes)['xl/styles.xml']!;
    expect(after).toEqual(before);
  });

  it('워크시트 관계와 콘텐츠 타입이 시트 수와 맞는다', () => {
    const { result } = build();
    const files = parts(result.bytes);

    const rels = parseXml(strFromU8(files['xl/_rels/workbook.xml.rels']!)).root;
    const sheetRels = rels.children.filter((r) => r.attrs['Type']?.endsWith('/worksheet'));
    expect(sheetRels).toHaveLength(3);
    expect(new Set(rels.children.map((r) => r.attrs['Id'])).size).toBe(
      rels.children.length,
    );

    const ct = parseXml(strFromU8(files['[Content_Types].xml']!)).root;
    const sheetOverrides = ct.children.filter((c) =>
      c.attrs['ContentType']?.endsWith('worksheet+xml'),
    );
    expect(sheetOverrides.map((o) => o.attrs['PartName']).sort()).toEqual([
      '/xl/worksheets/sheet1.xml',
      '/xl/worksheets/sheet2.xml',
      '/xl/worksheets/sheet3.xml',
    ]);
  });

  it('[Content_Types].xml이 ZIP의 첫 엔트리다 — OPC 요구사항', () => {
    const { result } = build();
    expect(Object.keys(parts(result.bytes))[0]).toBe('[Content_Types].xml');
  });

  it('갑지의 회사 직인 이미지를 보존한다', () => {
    const { result } = build();
    const files = parts(result.bytes);
    expect(files['xl/media/image1.png']).toBeDefined();
    expect(files['xl/drawings/drawing1.xml']).toBeDefined();
    expect(files['xl/worksheets/_rels/sheet1.xml.rels']).toBeDefined();
    const cover = parseXml(strFromU8(files['xl/worksheets/sheet1.xml']!)).root;
    expect(findChild(cover, 'drawing')).toBeDefined();
  });

  it('XML 선언이 파트마다 최대 하나다 — 중복 선언은 Excel이 파일을 거부한다', () => {
    const { result } = build();
    for (const [name, data] of Object.entries(parts(result.bytes))) {
      if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue;
      const text = strFromU8(data);
      // XML 선언은 선택 사항이라 0개도 유효하다 (템플릿의 docProps/app.xml이 그렇다).
      // 2개 이상이면 XML 자체가 깨진다.
      expect(text.split('<?xml').length - 1, `${name}의 XML 선언 개수`).toBeLessThanOrEqual(1);
    }
  });

  it('fullCalcOnLoad를 세운다 (설계서 §9.3)', () => {
    const { result } = build();
    const wb = parseXml(strFromU8(parts(result.bytes)['xl/workbook.xml']!)).root;
    expect(findChild(wb, 'calcPr')?.attrs['fullCalcOnLoad']).toBe('1');
  });

  it('인쇄 영역과 반복 머리글을 행 수에 맞게 다시 만든다', () => {
    const { result } = build();
    const wb = parseXml(strFromU8(parts(result.bytes)['xl/workbook.xml']!)).root;
    const names = findChild(wb, 'definedNames')!;
    const texts = names.children.map((n) => `${n.attrs['name']}=${n.text}`);

    expect(texts).toContain(`_xlnm.Print_Titles='교육장 영상'!$1:$3`);
    // 시스템1: 머리글4 + 본문11(표시5+품목6) + 직접비계1 + 간접비머리1 + 간접비9 + 계2 = 27행
    expect(texts.some((t) => /_xlnm\.Print_Area='교육장 영상'!\$A\$1:\$K\$\d+/.test(t))).toBe(
      true,
    );
    expect(texts.some((t) => /_xlnm\.Print_Area='갑지'!\$A\$1:\$J\$\d+/.test(t))).toBe(true);
  });
});

describe('buildQuoteWorkbook — 내역 시트 수식', () => {
  it('2단 머리글을 병합한다', () => {
    const { result } = build();
    const merges = findChildren(findChild(sheetXml(result.bytes, 2), 'mergeCells')!, 'mergeCell');
    const refs = merges.map((m) => m.attrs['ref']);
    expect(refs).toContain('F2:G2');
    expect(refs).toContain('H2:I2');
    expect(refs).toContain('A2:A3');
    expect(refs).toContain('A1:K1');
  });

  it('품목 행의 금액이 수식이다', () => {
    const { result } = build();
    const cells = cellsOf(sheetXml(result.bytes, 2));
    // 본문 시작은 5행: group(5) subgroup(6) item(7) note(8) note(9) item(10) …
    expect(cells.get('G7')?.f).toBe('E7*F7');
    expect(cells.get('I7')?.f).toBe('E7*H7');
    expect(cells.get('J7')?.f).toBe('G7+I7');
  });

  it('첫 품목은 번호 1, 이후는 =A{이전}+1', () => {
    const { result } = build();
    const cells = cellsOf(sheetXml(result.bytes, 2));
    expect(cells.get('A7')?.v).toBe('1');
    expect(cells.get('A7')?.f).toBeUndefined();
    expect(cells.get('A10')?.f).toBe('A7+1');
  });

  it('설명 행에는 금액 수식이 없다', () => {
    const { result } = build();
    const cells = cellsOf(sheetXml(result.bytes, 2));
    expect(cells.get('G8')?.f).toBeUndefined();
    expect(cells.get('B8')?.v).toBe(' - 화면 크기');
  });

  it('파생 행이 기준 행을 참조한다 — 배관 기타자재 = INT(G{배관행}*20%)', () => {
    const { result } = build();
    const cells = cellsOf(sheetXml(result.bytes, 2));
    const entries = [...cells.entries()];
    const conduit = entries.find(([ref, c]) => ref.startsWith('F') && c.f?.includes('*20%'));
    expect(conduit, '배관 기타자재 수식이 있어야 한다').toBeDefined();
    expect(conduit![1].f).toMatch(/^INT\(G\d+\*20%\)$/);
  });

  it('잡자재비가 범위 합계를 참조한다 — INT(SUM(G..)*2%)', () => {
    const { result } = build();
    const cells = cellsOf(sheetXml(result.bytes, 2));
    const misc = [...cells.entries()].find(
      ([ref, c]) => ref.startsWith('F') && c.f?.includes('*2%'),
    );
    expect(misc, '잡자재비 수식이 있어야 한다').toBeDefined();
    expect(misc![1].f).toMatch(/^INT\(SUM\(G\d+:G\d+\)\*2%\)$/);
  });

  it('간접비 9행을 원본 기준대로 만든다', () => {
    const { result } = build();
    const cells = cellsOf(sheetXml(result.bytes, 2));
    const all = [...cells.entries()];

    const labels = all
      .filter(([ref]) => /^B\d+$/.test(ref))
      .map(([, c]) => c.v)
      .filter((v): v is string => v !== undefined);
    expect(labels).toContain('간접노무비');
    expect(labels).toContain('공과잡비');

    // 노무비 대비 → INT(I{직접비계}*E{행})
    const indirect = all.find(([ref, c]) => /^J\d+$/.test(ref) && /^INT\(I\d+\*E\d+\)$/.test(c.f ?? ''));
    expect(indirect).toBeDefined();

    // 직접비 대비 → INT(J{직접비계}*E{행})
    const safety = all.find(([ref, c]) => /^J\d+$/.test(ref) && /^INT\(J\d+\*E\d+\)$/.test(c.f ?? ''));
    expect(safety).toBeDefined();

    // 공과잡비 → INT(SUM(J{직접비계},J{간접노무비},J{산업안전})*E{행})
    const composite = all.find(([, c]) => /^INT\(SUM\(J\d+,J\d+,J\d+\)\*E\d+\)$/.test(c.f ?? ''));
    expect(composite).toBeDefined();
  });

  it('미적용 간접비는 요율을 남기고 금액을 상수 0으로 둔다 (원본과 동일)', () => {
    const { result } = build();
    const cells = cellsOf(sheetXml(result.bytes, 2));
    const all = [...cells.entries()];
    const pensionLabel = all.find(([ref, c]) => /^B\d+$/.test(ref) && c.v === '연금보험료');
    expect(pensionLabel).toBeDefined();
    const row = pensionLabel![0].slice(1);
    expect(cells.get(`E${row}`)?.v).toBe('0.01215');
    expect(cells.get(`J${row}`)?.v).toBe('0');
    expect(cells.get(`J${row}`)?.f).toBeUndefined();
  });

  it('시트 제목이 갑지의 공사명을 참조한다', () => {
    const { result } = build();
    const cells = cellsOf(sheetXml(result.bytes, 2));
    expect(cells.get('A1')?.f).toBe(`"▣ 공사명 : "&'갑지'!C5`);
    expect(cells.get('A1')?.t).toBe('str');
  });
});

describe('buildQuoteWorkbook — 갑지', () => {
  it('시스템 행이 해당 시트의 합계 셀을 참조한다', () => {
    const { result } = build();
    const cover = cellsOf(sheetXml(result.bytes, 1));
    const system = cellsOf(sheetXml(result.bytes, 2));

    const grandTotalRef = [...system.entries()].find(
      ([ref, c]) => /^J\d+$/.test(ref) && /^J\d+\+J\d+$/.test(c.f ?? ''),
    );
    expect(grandTotalRef).toBeDefined();
    const grandTotalRow = grandTotalRef![0].slice(1);

    expect(cover.get('G11')?.f).toBe(`'교육장 영상'!J${grandTotalRow}`);
    expect(cover.get('H11')?.f).toBe('F11*G11');
  });

  it('합계가 만원 미만 절사 수식이다', () => {
    const { result } = build();
    const cover = cellsOf(sheetXml(result.bytes, 1));
    // 10행 그룹, 11·12행 시스템 → 13행 합계
    expect(cover.get('H13')?.f).toBe('ROUNDDOWN(SUM(H11:H12),-4)');
    expect(cover.get('I13')?.v).toBe('만원미만절사');
  });

  it('NEGO는 음수 입력값이고 수식이 아니다', () => {
    const { result } = build();
    const cover = cellsOf(sheetXml(result.bytes, 1));
    expect(cover.get('H14')?.v).toBe('-120000');
    expect(cover.get('H14')?.f).toBeUndefined();
  });

  it('최종 합계 = SUM(절사, NEGO)', () => {
    const { result } = build();
    const cover = cellsOf(sheetXml(result.bytes, 1));
    expect(cover.get('H15')?.f).toBe('SUM(H13:H14)');
  });

  it('한글 금액이 NUMBERSTRING 수식으로 남는다 (설계서 §9.4)', () => {
    const { result, calculation } = build();
    const cover = cellsOf(sheetXml(result.bytes, 1));
    const c8 = cover.get('C8')!;
    expect(c8.t).toBe('str');
    expect(c8.f).toContain('NUMBERSTRING(H15,1)');
    expect(c8.f).toContain('TEXT(H15,"###,##0")');
    // 캐시 값이 계산 결과와 맞는다
    expect(c8.v).toContain(
      calculation.cover.finalTotal.toFixed().replace(/\B(?=(\d{3})+(?!\d))/g, ','),
    );
  });

  it('견적일을 원본 형식으로 쓴다', () => {
    const { result } = build();
    const cover = cellsOf(sheetXml(result.bytes, 1));
    expect(cover.get('C3')?.v).toBe('2026 년  08 월  26 일');
  });
});

describe('buildQuoteWorkbook — 캐시 값이 웹 계산과 일치한다 (인수 기준 A04)', () => {
  it('모든 수식 셀의 캐시가 계산 스냅샷과 같다', () => {
    const { result, calculation } = build();
    const cover = cellsOf(sheetXml(result.bytes, 1));
    const sys1 = cellsOf(sheetXml(result.bytes, 2));

    expect(cover.get('H13')?.v).toBe(calculation.cover.rounded.toFixed());
    expect(cover.get('H15')?.v).toBe(calculation.cover.finalTotal.toFixed());

    const s1 = calculation.systems[0]!;
    const grand = [...sys1.entries()].find(([ref, c]) => /^J\d+$/.test(ref) && /^J\d+\+J\d+$/.test(c.f ?? ''));
    expect(grand![1].v).toBe(s1.systemTotal.toFixed());
  });

  it('소수 수량을 그대로 쓴다', () => {
    const { result } = build();
    const sys2 = cellsOf(sheetXml(result.bytes, 3));
    const qty = [...sys2.entries()].find(([ref, c]) => /^E\d+$/.test(ref) && c.v === '120.5');
    expect(qty, '소수 수량 120.5가 있어야 한다').toBeDefined();
  });
});

describe('buildQuoteWorkbook — 경계 입력', () => {
  it('품목이 없는 시스템에 역전 SUM 범위를 만들지 않는다', () => {
    const { result } = build(emptySystemQuote());
    const cells = cellsOf(sheetXml(result.bytes, 2));
    for (const [, c] of cells) {
      if (c.f === undefined) continue;
      const match = /SUM\(([A-K])(\d+):\1(\d+)\)/.exec(c.f);
      if (match === null) continue;
      expect(
        Number(match[3]) >= Number(match[2]),
        `역전 범위: ${c.f}`,
      ).toBe(true);
    }
  });

  it('시트명 금지 문자·31자 초과·중복을 Excel이 받는 형태로 바꾼다', () => {
    const doc = syntheticQuote();
    doc.systems[0]!.name = 'A:B/C*D?E[F]';
    doc.systems[1]!.name = 'A\\B_C_D_E_F'; // 정규화하면 위와 같은 모양이 될 수 있다
    const { result } = build(doc);
    for (const name of result.sheetNames) {
      expect(name).not.toMatch(/[:\\/?*[\]]/);
      expect(name.length).toBeLessThanOrEqual(31);
    }
    expect(new Set(result.sheetNames).size).toBe(result.sheetNames.length);
  });

  it('긴 품명과 한글·특수문자를 깨뜨리지 않는다', () => {
    const doc = syntheticQuote();
    const longName = '합성 품명 ' + '가나다라마바사'.repeat(12) + ' <&"\'>';
    (doc.rows[2] as { name: string }).name = longName;
    const { result } = build(doc);
    const cells = cellsOf(sheetXml(result.bytes, 2));
    expect(cells.get('B7')?.v).toBe(longName);
  });
});

describe('buildQuoteWorkbook — 고객 파일 민감정보 (인수 기준 A08)', () => {
  it('sentinel 원가·매입처가 ZIP 어디에도 없다', () => {
    const { result } = build();
    const files = parts(result.bytes);
    for (const [name, data] of Object.entries(files)) {
      const text = strFromU8(data);
      expect(text, `${name}에 sentinel 원가`).not.toContain(SENTINEL_COST);
      expect(text, `${name}에 sentinel 매입처`).not.toContain(SENTINEL_SUPPLIER);
    }
  });

  it('내부 식별자와 수동 단가 사유를 싣지 않는다', () => {
    const { result } = build();
    const files = parts(result.bytes);
    for (const [name, data] of Object.entries(files)) {
      const text = strFromU8(data);
      expect(text, `${name}에 overrideReason`).not.toContain('합성 테스트 값');
      expect(text, `${name}에 documentId`).not.toContain('synthetic-0001');
    }
  });

  it('숨김 시트·숨김 행·숨김 열이 없다', () => {
    const { result } = build();
    const files = parts(result.bytes);
    const wb = parseXml(strFromU8(files['xl/workbook.xml']!)).root;
    for (const sheet of findChildren(findChild(wb, 'sheets')!, 'sheet')) {
      expect(sheet.attrs['state'] ?? 'visible').toBe('visible');
    }
    for (const [name, data] of Object.entries(files)) {
      if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
      const ws = parseXml(strFromU8(data)).root;
      const sheetData = findChild(ws, 'sheetData')!;
      for (const row of findChildren(sheetData, 'row')) {
        expect(row.attrs['hidden']).toBeUndefined();
      }
    }
  });
});

describe('산출물 저장 — 실제 Excel 검증용', () => {
  it('합성 견적 통합문서와 기대값을 tests/fixtures/out에 쓴다', () => {
    const { result, calculation, projection } = build();
    writeFileSync(resolve(OUT_DIR, 'synthetic-quote.xlsx'), result.bytes);
    expect(result.bytes.byteLength).toBeGreaterThan(1000);

    // 설계서 §9.7: "웹 금액과 Excel 값이 일치해야 한다."
    // 여기서 쓴 기대값을 tools/verify_in_excel.ps1이 실제 Excel 재계산 결과와 대조한다.
    const layout = planWorkbook(projection);
    const expectedByCell: Record<string, Record<string, string>> = {};

    const cover = layout.cover;
    expectedByCell['갑지'] = {
      [`H${cover.sumRow}`]: calculation.cover.rounded.toFixed(),
      [`H${cover.negoRow}`]: calculation.cover.negoAdjustment.toFixed(),
      [`H${cover.finalRow}`]: calculation.cover.finalTotal.toFixed(),
    };
    for (const row of cover.bodyRows) {
      if (row.kind !== 'system') continue;
      const amount = calculation.cover.systemAmounts.find((a) => a.systemId === row.systemId);
      if (amount === undefined) continue;
      expectedByCell['갑지']![`G${row.row}`] = amount.unitAmount.toFixed();
      expectedByCell['갑지']![`H${row.row}`] = amount.amount.toFixed();
    }

    for (const system of layout.systems) {
      const cells: Record<string, string> = {
        [`G${system.directTotalRow}`]: system.calculation.directMaterial.toFixed(),
        [`I${system.directTotalRow}`]: system.calculation.directLabor.toFixed(),
        [`J${system.directTotalRow}`]: system.calculation.directTotal.toFixed(),
        [`J${system.indirectTotalRow}`]: system.calculation.indirectTotal.toFixed(),
        [`J${system.grandTotalRow}`]: system.calculation.systemTotal.toFixed(),
      };
      for (const planned of system.bodyRows) {
        if (planned.calc === undefined) continue;
        const c = planned.calc;
        if (c.materialAmount !== undefined) cells[`G${planned.row}`] = c.materialAmount.toFixed();
        if (c.laborAmount !== undefined) cells[`I${planned.row}`] = c.laborAmount.toFixed();
        if (c.total !== undefined) cells[`J${planned.row}`] = c.total.toFixed();
      }
      const indirectById = new Map(system.calculation.indirect.map((i) => [i.itemId, i]));
      for (const planned of system.indirectRows) {
        const amount = indirectById.get(planned.rule.itemId);
        if (amount !== undefined) cells[`J${planned.row}`] = amount.amount.toFixed();
      }
      expectedByCell[system.sheetName] = cells;
    }

    writeFileSync(
      resolve(OUT_DIR, 'synthetic-quote.expected.json'),
      JSON.stringify(expectedByCell, null, 2),
      'utf8',
    );
  });
});
