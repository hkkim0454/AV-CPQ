import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  GUIDE_IDS,
  readGuideTemplate,
  type GuideId,
  type GuideManifest,
} from '@/export/ooxml/guideTemplate';
import { GuideLayoutError, planGuideSheet } from '@/export/ooxml/guideLayout';
import * as F from '@/export/ooxml/guideFormulas';

const ROOT = resolve(__dirname, '../..');
const manifest = (): GuideManifest =>
  JSON.parse(
    readFileSync(resolve(ROOT, 'templates/sanitized/guide-manifest.json'), 'utf8'),
  ) as GuideManifest;

const guide = (id: GuideId) =>
  readGuideTemplate(
    id,
    new Uint8Array(readFileSync(resolve(ROOT, `templates/sanitized/guide-${id}.xlsx`))),
    manifest(),
  );

const plan = (id: GuideId, items: number, derived = 2) =>
  planGuideSheet({
    guide: guide(id),
    bodyRows: [
      ...Array.from({ length: items }, (_, i) => ({
        rowId: `r${i + 1}`,
        kind: 'item' as const,
      })),
      ...Array.from({ length: derived }, (_, i) => ({
        rowId: `d${i + 1}`,
        kind: 'derived' as const,
        derivedKind:
          i === 0 ? ('single-row-material' as const) : ('material-sum-to-here' as const),
      })),
    ],
  });

describe('planGuideSheet — 원본과 같은 줄 수', () => {
  it('품목 7줄이면 원본 주소 그대로다', () => {
    const layout = plan('pumsem', 7);
    expect(layout.itemRows.map((r) => r.row)).toEqual([6, 7, 8, 9, 10, 11, 12]);
    expect(layout.derivedRows.map((r) => r.row)).toEqual([13, 14]);
    expect(layout.directSubtotalRow).toBe(15);
    expect(layout.indirectRows.map((r) => r.row)).toEqual([17, 18, 19, 20, 21, 22, 23]);
    expect(layout.indirectSubtotalRow).toBe(24);
    expect(layout.grandTotalRow).toBe(25);
    expect(layout.shift).toBe(0);
  });

  it('DS 는 간접비가 9항목이라 합계가 27행이다', () => {
    const layout = plan('ds', 7);
    expect(layout.indirectRows).toHaveLength(9);
    expect(layout.indirectSubtotalRow).toBe(26);
    expect(layout.grandTotalRow).toBe(27);
    expect(layout.shift).toBe(0);
  });
});

describe('planGuideSheet — 품목이 늘면 아래가 전부 밀린다', () => {
  it.each([0, 1, 7, 8, 9, 10, 40, 100, 206])('품목 %i줄', (count) => {
    const layout = plan('pumsem', count);
    const shift = count - 7;
    expect(layout.itemRows).toHaveLength(count);
    expect(layout.directSubtotalRow).toBe(15 + shift);
    expect(layout.indirectRows[0]!.row).toBe(17 + shift);
    expect(layout.grandTotalRow).toBe(25 + shift);
    expect(layout.shift).toBe(shift);
  });

  it('파생 행이 품목 바로 뒤에 온다', () => {
    const layout = plan('won', 40);
    const lastItem = layout.itemRows[layout.itemRows.length - 1]!.row;
    expect(layout.derivedRows.map((r) => r.row)).toEqual([lastItem + 1, lastItem + 2]);
    expect(layout.directSubtotalRow).toBe(lastItem + 3);
  });

  it('품목이 7줄을 넘으면 마지막 품목 행 서식을 되쓴다', () => {
    const layout = plan('pumsem', 10);
    expect(layout.itemRows.map((r) => r.styleFromRow)).toEqual([
      6, 7, 8, 9, 10, 11, 12, 12, 12, 12,
    ]);
  });

  it('인쇄 영역이 합계 행까지 따라간다', () => {
    expect(plan('pumsem', 7).printArea).toBe('A1:L25');
    expect(plan('pumsem', 40).printArea).toBe('A1:L58');
    expect(plan('ds-won', 7).printArea).toBe('A1:O27');
    expect(plan('ds-won', 40).printArea).toBe('A1:O60');
  });

  it('파생 행이 자리보다 많으면 던진다 — 서식을 지어내지 않는다', () => {
    expect(() => plan('pumsem', 5, 3)).toThrow(GuideLayoutError);
  });

  it('모르는 열 역할을 물으면 던진다', () => {
    expect(() => plan('pumsem', 5).column('없는역할')).toThrow(GuideLayoutError);
    // `_품셈` 에는 원가 열이 없다. 기본값으로 떨어뜨리면 엉뚱한 열에 원가가 간다.
    expect(() => plan('pumsem', 5).column('cost.unit')).toThrow(GuideLayoutError);
    expect(plan('won', 5).column('cost.unit')).toBe('G');
  });
});

describe('guideFormulas — 열이 가이드마다 다르다', () => {
  it('합계 열이 _원 은 M, _품셈 은 K 다', () => {
    expect(F.grandTotal(plan('won', 7))).toBe('M15+M24');
    expect(F.grandTotal(plan('pumsem', 7))).toBe('K15+K24');
    expect(F.grandTotal(plan('ds-won', 7))).toBe('M15+M26');
  });

  it('행 금액은 수량 × 단가다', () => {
    expect(F.amount(plan('pumsem', 7), 7, 'material.unit')).toBe('F7*G7');
    expect(F.amount(plan('won', 7), 7, 'cost.unit')).toBe('F7*G7');
    expect(F.amount(plan('won', 7), 7, 'material.unit')).toBe('F7*I7');
  });

  it('직접비계가 파생 행까지 덮는다', () => {
    const layout = plan('pumsem', 10);
    expect(F.directSubtotal(layout, 'material.amount')).toEqual({
      formula: 'SUM(H6:H17)',
    });
  });

  it('품목이 하나도 없으면 역전 범위 대신 상수 0 이다', () => {
    const layout = plan('pumsem', 0, 0);
    expect(F.directSubtotal(layout, 'material.amount')).toEqual({ constant: 0 });
  });

  it('잡자재비가 배관 기타자재를 포함한다', () => {
    const layout = plan('pumsem', 7);
    const conduitExtra = layout.derivedRows[0]!.row;
    expect(
      F.derivedFromRange(layout, 6, conduitExtra, 'material.amount', '2'),
    ).toBe('INT(SUM(H6:H13)*2%)');
  });

  it('배관 기타자재는 지정한 한 행만 기준이다', () => {
    const layout = plan('pumsem', 7);
    expect(F.derivedFromRow(layout, 12, 'material.amount', '40')).toBe('H12*40%');
  });
});

describe('guideFormulas — 간접비 기준', () => {
  const rowsById = (id: GuideId, items: number): ReadonlyMap<string, number> => {
    const layout = plan(id, items);
    return new Map(layout.indirectRows.map((r) => [r.itemId!, r.row]));
  };

  it('노무비 대비는 직접비계의 노무비 금액을 가리킨다', () => {
    const layout = plan('ds', 7);
    expect(
      F.indirectAmount(layout, { kind: 'labor' }, 'F17', rowsById('ds', 7)),
    ).toBe('INT(J15*F17)');
  });

  it('직접비 대비는 직접비계의 합계를 가리킨다', () => {
    const layout = plan('ds', 7);
    expect(
      F.indirectAmount(layout, { kind: 'direct' }, 'F23', rowsById('ds', 7)),
    ).toBe('INT(K15*F23)');
  });

  it('항목 기준은 그 항목 한 줄만 가리킨다 — 직접비를 더하지 않는다', () => {
    const layout = plan('pumsem', 7);
    const map = rowsById('pumsem', 7);
    const health = layout.indirectRows[5]!.itemId!;
    expect(F.indirectAmount(layout, { kind: 'item', itemId: health }, 'F23', map)).toBe(
      `INT(K${layout.indirectRows[5]!.row}*F23)`,
    );
  });

  it('공과잡비는 직접비계와 지정 항목들을 더한다', () => {
    const layout = plan('ds', 7);
    const map = rowsById('ds', 7);
    const ids = layout.indirectRows.map((r) => r.itemId!);
    const formula = F.indirectAmount(
      layout,
      { kind: 'composite', plusItemIds: [ids[0]!, ids[6]!] },
      'F25',
      map,
    );
    expect(formula).toBe('INT(SUM(K15,K17,K23)*F25)');
  });

  it('없는 기준 항목을 가리키면 던진다', () => {
    const layout = plan('ds', 7);
    expect(() =>
      F.indirectAmount(layout, { kind: 'item', itemId: '없음' }, 'F17', new Map()),
    ).toThrow(GuideLayoutError);
  });

  it('품목이 늘면 간접비가 가리키는 직접비계도 따라간다', () => {
    const layout = plan('ds', 40);
    expect(
      F.indirectAmount(layout, { kind: 'labor' }, 'F50', rowsById('ds', 40)),
    ).toBe('INT(J48*F50)');
  });
});

describe('guideFormulas — 갑지 참조', () => {
  it('품목이 늘면 갑지가 가리키는 합계 행도 밀린다', () => {
    expect(F.coverReference('세부내역', plan('pumsem', 7))).toBe('세부내역!K25');
    expect(F.coverReference('세부내역', plan('pumsem', 40))).toBe('세부내역!K58');
  });

  it('시트 이름에 공백이 있으면 따옴표로 감싼다', () => {
    expect(F.coverReference('교육장 영상', plan('pumsem', 7))).toBe(
      "'교육장 영상'!K25",
    );
  });

  it('시트 이름의 작은따옴표를 이중으로 만든다', () => {
    expect(F.coverReference("A'B", plan('pumsem', 7))).toBe("'A''B'!K25");
  });
});

describe('guideFormulas — 네 가이드 모두', () => {
  it.each(GUIDE_IDS)('%s 에서 필요한 열이 전부 있다', (id) => {
    const layout = plan(id, 9);
    for (const role of [
      'quantity',
      'material.unit',
      'material.amount',
      'labor.unit',
      'labor.amount',
      'total',
      'supplier',
      'itemRate',
      'surcharge',
      'standardUnitPrice',
      'tradeFirst',
    ]) {
      expect(() => layout.column(role), `${id}/${role}`).not.toThrow();
    }
  });

  it.each(GUIDE_IDS)('%s 의 품셈 블록이 인쇄 영역 밖이다', (id) => {
    const layout = plan(id, 9);
    const printLast = layout.printArea.split(':')[1]!.replace(/\d+$/, '');
    const index = (letter: string): number =>
      [...letter].reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
    expect(index(layout.column('supplier')), id).toBeGreaterThan(index(printLast));
    expect(index(layout.column('tradeFirst')), id).toBeGreaterThan(index(printLast));
  });
});
