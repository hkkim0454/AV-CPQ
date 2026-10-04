import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

/**
 * 가이드 템플릿 (계획 2026-10-04 Task 2).
 *
 * ## 왜 원본이 아니라 정리된 템플릿을 보는가
 *
 * 원본 4종은 사용자 PC에만 있다 (설계서 §4.5). 저장소에 넣지 않는다.
 * 그래서 테스트는 **정리된 산출물**을 본다. 원본이 없는 PC에서도 돌아야 한다.
 *
 * 정리 전 원본에는 실제로 이런 게 들어 있었다 — 추측이 아니라 실측이다.
 *
 * ```
 * docProps/custom.xml   이전 직원 PC 경로 + 삼성SDI 프로젝트 파일명
 * workbook.xml          사내 공유폴더 \\192.168.1.51\03_영업팀 자료\…
 * definedNames          #REF! 더미, C:\msoffice\CD\남가내역.mdb, 사용자 지정 보기 잔재
 * 세부내역 6~14행        예시 품목의 원가·판매가·거래처·설명
 * ```
 *
 * 시트 셀만 지워서는 안 되는 이유다.
 */

const ROOT = resolve(__dirname, '../..');
const GUIDE_IDS = ['won', 'pumsem', 'ds', 'ds-won'] as const;
type GuideId = (typeof GUIDE_IDS)[number];

const templatePath = (id: GuideId): string =>
  resolve(ROOT, `templates/sanitized/guide-${id}.xlsx`);

const MANIFEST_PATH = resolve(ROOT, 'templates/sanitized/guide-manifest.json');

function parts(id: GuideId): Record<string, Uint8Array> {
  return unzipSync(new Uint8Array(readFileSync(templatePath(id))));
}

/** 모든 XML 파트를 이어 붙인 문자열. 민감정보 검사는 시트 밖도 봐야 한다. */
function allXml(id: GuideId): string {
  let text = '';
  for (const [path, bytes] of Object.entries(parts(id))) {
    if (path.endsWith('.xml') || path.endsWith('.rels')) text += strFromU8(bytes);
  }
  return text;
}

interface Manifest {
  schemaVersion: number;
  guides: Record<
    string,
    {
      profile: 'general' | 'ds';
      hasCost: boolean;
      sheets: { cover: string; detail: string };
      printArea: { cover: string; detail: string };
      detailScale: number;
      freezePane: string;
      printTitles: string;
      columns: Record<string, string>;
      rows: {
        firstItem: number;
        lastItem: number;
        derived: number[];
        directSubtotal: number;
        indirectFirst: number;
        indirectLast: number;
        indirectSubtotal: number;
        grandTotal: number;
      };
      trades: string[];
      wage: { periodLabel: string; unit: string; contentHash: string };
      indirect: Array<{
        name: string;
        basisLabel: string;
        rate: string;
        applied: boolean;
        conditionText?: string;
      }>;
    }
  >;
}

const manifest = (): Manifest =>
  JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;

describe('가이드 템플릿 — 존재와 무결성', () => {
  it.each(GUIDE_IDS)('%s 템플릿이 있다', (id) => {
    expect(
      existsSync(templatePath(id)),
      `${templatePath(id)} 없음. npm run build:guides 를 먼저 돌린다`,
    ).toBe(true);
  });

  it('manifest 가 네 가이드를 모두 담는다', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
    expect(Object.keys(manifest().guides).sort()).toEqual([...GUIDE_IDS].sort());
  });

  it.each(GUIDE_IDS)('%s 에 외부 링크·매크로·사용자지정속성이 없다', (id) => {
    const names = Object.keys(parts(id));
    expect(
      names.filter((p) => /externalLink|vbaProject|docProps\/custom/.test(p)),
      id,
    ).toEqual([]);
  });

  it.each(GUIDE_IDS)('%s 에 계산 캐시(calcChain)·프린터 설정이 없다', (id) => {
    const names = Object.keys(parts(id));
    // calcChain 은 옛 계산 순서다. 행이 바뀌면 Excel 이 복구 경고를 띄운다.
    // printerSettings 는 특정 PC 의 프린터 이름을 담는다.
    expect(names.filter((p) => /calcChain|printerSettings/.test(p)), id).toEqual([]);
  });
});

describe('가이드 템플릿 — 민감정보가 남지 않았다', () => {
  it.each(GUIDE_IDS)('%s 에 사내 경로·PC 경로가 없다', (id) => {
    const text = allXml(id);
    // 실측으로 나온 것들: 사내 공유 IP, 윈도우 사용자 경로, mdb 참조
    expect(text, `${id}: UNC 사내 경로`).not.toMatch(/\\\\\d+\.\d+\.\d+\.\d+/);
    expect(text, `${id}: 윈도우 사용자 경로`).not.toMatch(/[A-Za-z]:\\Users\\/);
    expect(text, `${id}: msoffice 경로`).not.toMatch(/msoffice/i);
    expect(text, `${id}: 외부 DB`).not.toMatch(/\.mdb/i);
  });

  it.each(GUIDE_IDS)('%s 에 예시 거래처·고객 실명이 없다', (id) => {
    const text = allXml(id);
    expect(text, `${id}: 삼성SDI 프로젝트명`).not.toMatch(/삼성SDI/);
    expect(text, `${id}: 예시 메모`).not.toMatch(/가격확인/);
  });

  it.each(GUIDE_IDS)('%s 에 다른 통합문서 파일명이 없다', (id) => {
    expect(allXml(id), id).not.toMatch(/\.xls[xmb]?(?![a-z])/i);
  });

  it.each(GUIDE_IDS)('%s 의 품목 행이 비어 있다', (id) => {
    const m = manifest().guides[id]!;
    const sheet = strFromU8(parts(id)['xl/worksheets/sheet2.xml']!);
    const nameCol = m.columns['name']!;
    for (let row = m.rows.firstItem; row <= m.rows.lastItem; row += 1) {
      // 품명 칸에 값이 남아 있으면 예시 품목이 안 지워진 것이다.
      expect(sheet, `${id}: ${nameCol}${row} 에 예시 품목이 남았다`).not.toMatch(
        new RegExp(`<c r="${nameCol}${row}"[^>]*>\\s*<v>`),
      );
    }
  });

  it('원가 머리글은 _원 쪽에만 있다', () => {
    const m = manifest().guides;
    expect(m['won']!.hasCost).toBe(true);
    expect(m['ds-won']!.hasCost).toBe(true);
    expect(m['pumsem']!.hasCost).toBe(false);
    expect(m['ds']!.hasCost).toBe(false);
  });

  it('빈 제조사/구매처 머리글은 남긴다 — 값만 지운다', () => {
    // 0·1단계가 이 열을 채운다. 머리글까지 지우면 열을 이름으로 찾을 수 없다.
    for (const id of GUIDE_IDS) {
      expect(manifest().guides[id]!.columns['supplier'], id).toBeTruthy();
    }
  });
});

describe('가이드 템플릿 — 실측 구조 (회귀 고정)', () => {
  it('열 역할이 원본 실측과 같다', () => {
    const g = manifest().guides;
    expect(g['pumsem']!.columns).toMatchObject({
      quantity: 'F',
      'material.unit': 'G',
      'material.amount': 'H',
      'labor.unit': 'I',
      'labor.amount': 'J',
      total: 'K',
      remark: 'L',
      supplier: 'M',
      salesRemark: 'N',
    });
    expect(g['won']!.columns).toMatchObject({
      quantity: 'F',
      'cost.unit': 'G',
      'cost.amount': 'H',
      'material.unit': 'I',
      'material.amount': 'J',
      'labor.unit': 'K',
      'labor.amount': 'L',
      total: 'M',
      profit: 'N',
      remark: 'O',
      supplier: 'P',
      salesRemark: 'Q',
    });
    // _원 = _품셈 + 원가 G·H + 이윤 N. 세 열 차이다.
    expect(g['ds-won']!.columns).toMatchObject(g['won']!.columns);
    expect(g['ds']!.columns).toMatchObject(g['pumsem']!.columns);
  });

  it('행 역할이 원본 실측과 같다 — 품목 6~12, 13·14는 파생 행', () => {
    for (const id of GUIDE_IDS) {
      const r = manifest().guides[id]!.rows;
      expect(r.firstItem, id).toBe(6);
      expect(r.lastItem, id).toBe(12);
      expect(r.derived, id).toEqual([13, 14]);
      expect(r.directSubtotal, id).toBe(15);
      expect(r.indirectFirst, id).toBe(17);
    }
  });

  it('간접비 항목 수가 프로파일을 결정하고 합계 행이 따라간다', () => {
    const g = manifest().guides;
    // DS 합계가 일반+2 라고 계산하지 않는다. 실제 블록에서 읽은 값이다.
    expect(g['pumsem']!.indirect).toHaveLength(7);
    expect(g['won']!.indirect).toHaveLength(7);
    expect(g['ds']!.indirect).toHaveLength(9);
    expect(g['ds-won']!.indirect).toHaveLength(9);

    expect(g['pumsem']!.rows.indirectSubtotal).toBe(24);
    expect(g['pumsem']!.rows.grandTotal).toBe(25);
    expect(g['ds']!.rows.indirectSubtotal).toBe(26);
    expect(g['ds']!.rows.grandTotal).toBe(27);
  });

  it('일반 프로파일의 노인장기요양은 건강보험료 대비다 — 기존 축에 없는 기준', () => {
    const rule = manifest()
      .guides['pumsem']!.indirect.find((i) => i.name.includes('노인장기요양'))!;
    expect(rule.basisLabel).toBe('건강보험료 대비');
    expect(rule.rate).toBe('0.1295');
    expect(rule.applied).toBe(false);
  });

  it('DS 프로파일의 조건 문구를 보존한다', () => {
    const ds = manifest().guides['ds-won']!.indirect;
    expect(ds.find((i) => i.name === '연금보험료')!.conditionText).toBe(
      '1개월 이상 공사 限',
    );
    expect(ds.find((i) => i.name === '퇴직공제부금비')!.conditionText).toBe(
      '1억원 이상 공사 限',
    );
  });

  it('인쇄 설정이 원본과 같다', () => {
    const g = manifest().guides;
    expect(g['won']!.printArea.detail).toBe('A1:O25');
    expect(g['ds-won']!.printArea.detail).toBe('A1:O27');
    expect(g['pumsem']!.printArea.detail).toBe('A1:L25');
    expect(g['ds']!.printArea.detail).toBe('A1:L27');
    for (const id of GUIDE_IDS) {
      expect(manifest().guides[id]!.freezePane, id).toBe('G4');
      expect(manifest().guides[id]!.printTitles, id).toBe('1:3');
    }
    expect(g['won']!.detailScale).toBe(58);
    expect(g['ds-won']!.detailScale).toBe(58);
    expect(g['pumsem']!.detailScale).toBe(70);
    expect(g['ds']!.detailScale).toBe(70);
  });
});

describe('가이드 템플릿 — 노임', () => {
  it('17직종이고 전부 M/D 다 — M/M 4직종은 가이드에 없다', () => {
    for (const id of GUIDE_IDS) {
      const w = manifest().guides[id]!;
      expect(w.trades, id).toHaveLength(17);
      expect(w.trades[0], id).toBe('통신관련기사');
      expect(w.trades[16], id).toBe('건축목공');
      expect(w.wage.unit, id).toBe('M/D');
      // CMS 전용 M/M 직종을 임의로 채워 넣지 않는다.
      expect(w.trades, id).not.toContain('응용 SW개발자');
    }
  });

  it('네 가이드의 노임 내용 해시가 같다 — 같은 기간의 같은 표다', () => {
    const hashes = GUIDE_IDS.map((id) => manifest().guides[id]!.wage.contentHash);
    expect(new Set(hashes).size, `해시가 갈린다: ${hashes.join(' / ')}`).toBe(1);
  });

  it('하반기 노임이다 — 배포된 상반기와 다르다', () => {
    for (const id of GUIDE_IDS) {
      expect(manifest().guides[id]!.wage.periodLabel, id).toContain('하반기');
    }
  });
});

/**
 * 아래 셋은 **실제로 Excel 이 거부했던** 결함을 고정한다.
 * 셋 다 ZIP·XML 검사는 통과했고 테스트도 통과했는데 Excel 만 "파일 형식이
 * 잘못되었습니다" 라고 했다. 열어 보지 않으면 보이지 않는 종류다.
 */
describe('가이드 템플릿 — Excel 이 거부했던 자리', () => {
  it.each(GUIDE_IDS)('%s 에 끊긴 관계가 없다', (id) => {
    const files = parts(id);
    const names = new Set(Object.keys(files));
    const resolvePart = (base: string, target: string): string => {
      if (target.startsWith('/')) return target.slice(1);
      const stack = base.split('/').filter(Boolean);
      for (const piece of target.split('/')) {
        if (piece === '..') stack.pop();
        else if (piece !== '' && piece !== '.') stack.push(piece);
      }
      return stack.join('/');
    };

    const dangling: string[] = [];
    for (const [path, bytes] of Object.entries(files)) {
      if (!path.endsWith('.rels')) continue;
      const owner = path.replace('_rels/', '').slice(0, -'.rels'.length);
      const base = owner.includes('/') ? owner.slice(0, owner.lastIndexOf('/')) : '';
      for (const m of strFromU8(bytes).matchAll(/<Relationship [^>]*\/>/g)) {
        if (m[0].includes('External')) continue;
        const target = /Target="([^"]*)"/.exec(m[0])?.[1];
        if (target === undefined) continue;
        if (!names.has(resolvePart(base, target))) dangling.push(`${path} -> ${target}`);
      }
    }
    // 루트 `_rels/.rels` 의 기준 경로를 잘못 계산해 **세 관계를 모두** 지운 적이
    // 있다. workbook.xml 로 가는 길이 끊겨 Excel 이 파일을 알아보지 못했다.
    expect(dangling, `${id}: 끊긴 관계`).toEqual([]);
    const rootRels = strFromU8(files['_rels/.rels']!);
    expect(rootRels, `${id}: 루트 관계가 비었다`).toMatch(/xl\/workbook\.xml/);
  });

  it.each(GUIDE_IDS)('%s 의 인쇄 설정이 살아 있다', (id) => {
    const sheet = strFromU8(parts(id)['xl/worksheets/sheet2.xml']!);
    const expected = manifest().guides[id]!.detailScale;
    // 끊긴 관계를 지우면서 `<pageSetup .../>` 를 통째로 지운 적이 있다.
    // 배율·용지·방향이 함께 사라졌다. 속성만 떼야 한다.
    expect(sheet, `${id}: pageSetup 이 없다`).toMatch(/<pageSetup[^>]*>/);
    expect(sheet, `${id}: 배율 ${expected} 이 없다`).toMatch(
      new RegExp(`<pageSetup[^>]*scale="${expected}"`),
    );
  });

  it.each(GUIDE_IDS)('%s 의 품목 행은 값도 수식도 없다', (id) => {
    const m = manifest().guides[id]!;
    const sheet = strFromU8(parts(id)['xl/worksheets/sheet2.xml']!);
    // 수식에 민감한 값이 박혀 있었다 — `I6=G6*1.2`(원가→판매가 배율),
    // `W6=0.7+0.59`(예시 품목의 직종별 품). 수식만 남겨 두면 그게 남는다.
    for (let row = m.rows.firstItem; row <= m.rows.lastItem; row += 1) {
      // 자기닫기 꼴을 **먼저** 둔다. 뒤에 두면 `[^>]*` 가 `/` 를 먹고
      // `>.*?</c>` 분기가 이겨서 다음 셀까지 한 덩어리로 잡힌다.
      for (const cell of sheet.matchAll(
        new RegExp(`<c r="[A-Z]+${row}"[^>]*/>|<c r="[A-Z]+${row}"[^>]*>.*?</c>`, 'gs'),
      )) {
        expect(cell[0], `${id}: ${row}행에 내용이 남았다`).not.toMatch(/<[fv][ >/]/);
      }
    }
  });

  it.each(GUIDE_IDS)('%s 의 파생 행 수식은 살아 있다 — 공유 수식을 펼쳤다', (id) => {
    const m = manifest().guides[id]!;
    const sheet = strFromU8(parts(id)['xl/worksheets/sheet2.xml']!);
    const amountCol = m.columns['material.amount']!;
    // 9~12행과 13·14행의 수식은 6~8행의 공유 수식 원본을 가리켰다.
    // 원본을 지우기 전에 펼치지 않으면 13·14행이 끊긴다.
    for (const row of m.rows.derived) {
      const cell = new RegExp(`<c r="${amountCol}${row}"[^>]*>.*?</c>`, 's').exec(sheet);
      expect(cell, `${id}: ${amountCol}${row} 가 없다`).not.toBeNull();
      expect(cell![0], `${id}: ${amountCol}${row} 수식이 끊겼다`).toMatch(/<f[ >]/);
    }
  });

  it.each(GUIDE_IDS)('%s 에 수식 캐시가 없다 — 예시 금액이 결과로 남는다', (id) => {
    for (const path of ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
      const sheet = strFromU8(parts(id)[path]!);
      for (const cell of sheet.matchAll(/<c [^>]*\/>|<c [^>]*>.*?<\/c>/gs)) {
        if (!/<f[ >/]/.test(cell[0])) continue;
        // 예시 품목을 지워도 `G13=4800`·직접비계·간접비 금액이 캐시로 남았다.
        expect(cell[0], `${id}: ${path} 에 계산 결과가 캐시로 남았다`).not.toMatch(
          /<v>/,
        );
      }
    }
  });

  it.each(GUIDE_IDS)('%s 는 열 때 전부 다시 계산한다', (id) => {
    // 캐시를 버렸으니 Excel 이 직접 계산해야 한다. 이 표시가 없으면 빈 칸으로
    // 보이다가 사용자가 아무 칸이나 건드릴 때 값이 나타난다.
    expect(strFromU8(parts(id)['xl/workbook.xml']!), id).toMatch(
      /fullCalcOnLoad="1"/,
    );
  });

  it.each(GUIDE_IDS)('%s 에 미아가 된 공유 수식이 없다', (id) => {
    const sheet = strFromU8(parts(id)['xl/worksheets/sheet2.xml']!);
    const masters = new Set<string>();
    const followers: string[] = [];
    for (const f of sheet.matchAll(
      /<f [^>]*t="shared"[^>]*\/>|<f [^>]*t="shared"[^>]*>.*?<\/f>/gs,
    )) {
      const si = /si="(\d+)"/.exec(f[0])?.[1];
      if (si === undefined) continue;
      if (/ref="/.test(f[0])) masters.add(si);
      else followers.push(si);
    }
    const orphans = followers.filter((si) => !masters.has(si));
    expect(orphans, `${id}: 원본 없는 공유 수식 ${orphans.join(',')}`).toEqual([]);
  });
});
