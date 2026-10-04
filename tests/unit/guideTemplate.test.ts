import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  GUIDE_IDS,
  GuideTemplateError,
  indirectCostsFor,
  readGuideTemplate,
  selectGuide,
  type GuideId,
  type GuideManifest,
  type GuideTemplateSet,
} from '@/export/ooxml/guideTemplate';

const ROOT = resolve(__dirname, '../..');
const manifest = (): GuideManifest =>
  JSON.parse(
    readFileSync(resolve(ROOT, 'templates/sanitized/guide-manifest.json'), 'utf8'),
  ) as GuideManifest;

const bytesOf = (id: GuideId): Uint8Array =>
  new Uint8Array(readFileSync(resolve(ROOT, `templates/sanitized/guide-${id}.xlsx`)));

const read = (id: GuideId) => readGuideTemplate(id, bytesOf(id), manifest());

const allGuides = (): GuideTemplateSet =>
  Object.fromEntries(GUIDE_IDS.map((id) => [id, read(id)])) as GuideTemplateSet;

describe('readGuideTemplate — manifest 가 말한 자리를 템플릿에서 확인한다', () => {
  it.each(GUIDE_IDS)('%s 를 읽는다', (id) => {
    const guide = read(id);
    expect(guide.id).toBe(id);
    expect(guide.trades).toHaveLength(17);
    expect(guide.rows.firstItem).toBe(6);
    expect(guide.rows.lastItem).toBe(12);
    expect(guide.rows.derived).toEqual([13, 14]);
  });

  it('열 역할을 번호로 돌려준다', () => {
    const pumsem = read('pumsem');
    expect(pumsem.columns.get('quantity')).toBe(6); // F
    expect(pumsem.columns.get('total')).toBe(11); // K
    expect(pumsem.columns.get('supplier')).toBe(13); // M
    const won = read('won');
    expect(won.columns.get('cost.unit')).toBe(7); // G
    expect(won.columns.get('profit')).toBe(14); // N
  });

  it('품셈 블록은 인쇄 영역 밖이다', () => {
    for (const id of GUIDE_IDS) {
      const guide = read(id);
      expect(guide.columns.get('supplier')!, id).toBeGreaterThan(guide.printLastColumn);
      expect(guide.columns.get('tradeFirst')!, id).toBeGreaterThan(
        guide.printLastColumn,
      );
    }
  });

  it('manifest 가 템플릿과 어긋나면 던진다 — 조용히 넘어가지 않는다', () => {
    const broken = manifest();
    broken.guides['pumsem']!.columns['supplier'] = 'Z';
    expect(() => readGuideTemplate('pumsem', bytesOf('pumsem'), broken)).toThrow(
      GuideTemplateError,
    );
  });

  it('노임이 어긋나면 던진다', () => {
    const broken = manifest();
    broken.guides['ds']!.wage.wages['보통인부'] = { amount: '999999', unit: 'M/D' };
    expect(() => readGuideTemplate('ds', bytesOf('ds'), broken)).toThrow(/노임/);
  });
});

describe('readGuideTemplate — 노임', () => {
  it('17직종 전부 M/D 다', () => {
    const guide = read('won');
    expect(Object.keys(guide.wages.wages)).toHaveLength(17);
    for (const wage of Object.values(guide.wages.wages)) {
      expect(wage.unit).toBe('M/D');
    }
  });

  it('직종 이름의 공백을 지우지 않는다 — 노임표 키와 맞아야 한다', () => {
    expect(read('won').trades).toContain('통신관련 기능사');
  });

  it('하반기 노임이고 네 가이드의 내용 해시가 같다', () => {
    const prints = GUIDE_IDS.map((id) => read(id).wageFingerprint);
    expect(new Set(prints).size).toBe(1);
    expect(read('won').wages.periodLabel).toContain('하반기');
    expect(read('won').wages.wageTableId).toBe('WAGE-26년 하반기');
  });

  it('가이드에 없는 M/M 직종을 채워 넣지 않는다', () => {
    expect(read('ds').wages.wages['응용 SW개발자']).toBeUndefined();
  });
});

describe('readGuideTemplate — 간접비 기준', () => {
  it('일반 프로파일의 노인장기요양은 건강보험료 항목을 가리킨다', () => {
    const rules = indirectCostsFor('general', allGuides());
    expect(rules).toHaveLength(7);
    const health = rules.find((r) => r.name.includes('건강보험'))!;
    const longTerm = rules.find((r) => r.name.includes('노인장기요양'))!;
    expect(longTerm.basis).toEqual({ kind: 'item', itemId: health.itemId });
    expect(longTerm.basisLabel).toBe('건강보험료 대비');
    expect(longTerm.rate).toBe('0.1295');
  });

  it('DS 프로파일의 노인장기요양은 노무비 대비다 — 프로파일마다 기준이 다르다', () => {
    const rules = indirectCostsFor('ds', allGuides());
    expect(rules).toHaveLength(9);
    const longTerm = rules.find((r) => r.name.includes('노인장기요양'))!;
    expect(longTerm.basis).toEqual({ kind: 'labor' });
  });

  it('공과잡비는 직접비 + 앞선 두 항목을 더한다', () => {
    const rules = indirectCostsFor('ds', allGuides());
    const misc = rules.find((r) => r.name === '공과잡비')!;
    expect(misc.basis.kind).toBe('composite');
    const plus = (misc.basis as { plusItemIds: string[] }).plusItemIds;
    const labor = rules.find((r) => r.name === '간접노무비')!;
    const safety = rules.find((r) => r.name === '산업안전보건관리비')!;
    expect(plus).toEqual([labor.itemId, safety.itemId]);
  });

  it('조건 문구를 보존한다 — 왜 미적용인지 알 수 있어야 한다', () => {
    const rules = indirectCostsFor('ds', allGuides());
    expect(rules.find((r) => r.name === '연금보험료')!.conditionText).toBe(
      '1개월 이상 공사 限',
    );
    expect(rules.find((r) => r.name === '퇴직공제부금비')!.conditionText).toBe(
      '1억원 이상 공사 限',
    );
  });

  it('모르는 항목을 가리키는 기준은 던진다', () => {
    const broken = manifest();
    broken.guides['pumsem']!.indirect[2]!.basisLabel = '달나라 대비';
    // 'labor' 같은 기본값으로 떨어뜨리지 않는다. 요율만 맞고 기준이 틀리면
    // 금액이 조용히 달라진다.
    expect(() => readGuideTemplate('pumsem', bytesOf('pumsem'), broken)).toThrow(
      /찾지 못했다/,
    );
  });

  it('꼴 자체를 모르는 기준 문구도 던진다', () => {
    const broken = manifest();
    broken.guides['pumsem']!.indirect[2]!.basisLabel = '그때그때 다름';
    expect(() => readGuideTemplate('pumsem', bytesOf('pumsem'), broken)).toThrow(
      /해석할 수 없다/,
    );
  });

  it('뒤에 오는 항목을 가리키면 던진다 — 가이드의 순서를 지킨다', () => {
    const broken = manifest();
    // 1번째 항목이 마지막 항목을 가리키게 한다.
    const last = broken.guides['pumsem']!.indirect.at(-1)!.name;
    broken.guides['pumsem']!.indirect[0]!.basisLabel = `${last} 대비`;
    expect(() => readGuideTemplate('pumsem', bytesOf('pumsem'), broken)).toThrow(
      /찾지 못했다/,
    );
  });

  it('호출마다 독립 복사본을 준다 — 한 견적의 수정이 번지지 않는다', () => {
    const guides = allGuides();
    const a = indirectCostsFor('ds', guides);
    const b = indirectCostsFor('ds', guides);
    expect(a[0]).not.toBe(b[0]);
    a[0]!.rate = '0.99';
    expect(b[0]!.rate).not.toBe('0.99');
    const aMisc = a.find((r) => r.name === '공과잡비')!.basis as {
      plusItemIds: string[];
    };
    const bMisc = b.find((r) => r.name === '공과잡비')!.basis as {
      plusItemIds: string[];
    };
    expect(aMisc.plusItemIds).not.toBe(bMisc.plusItemIds);
  });
});

describe('selectGuide — 프로파일 × 원가 유무', () => {
  it('네 조합을 모두 고를 수 있다', () => {
    const guides = allGuides();
    expect(selectGuide(guides, 'general', false).id).toBe('pumsem');
    expect(selectGuide(guides, 'general', true).id).toBe('won');
    expect(selectGuide(guides, 'ds', false).id).toBe('ds');
    expect(selectGuide(guides, 'ds', true).id).toBe('ds-won');
  });
});
