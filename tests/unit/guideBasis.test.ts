import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { assertSameBasis, buildGuideBasis } from '@/data/catalog/guideBasis';
import {
  readGuideTemplate,
  type GuideId,
  type GuideManifest,
} from '@/export/ooxml/guideTemplate';

const ROOT = resolve(__dirname, '../..');
const approvedJson = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(ROOT, 'data/approved', name), 'utf8'));

const guide = (id: GuideId) =>
  readGuideTemplate(
    id,
    new Uint8Array(readFileSync(resolve(ROOT, `templates/sanitized/guide-${id}.xlsx`))),
    JSON.parse(
      readFileSync(resolve(ROOT, 'templates/sanitized/guide-manifest.json'), 'utf8'),
    ) as GuideManifest,
  );

const raws = () => ({
  laborItemsRaw: approvedJson('labor-items.json'),
  wageTableRaw: approvedJson('wage-table.json'),
  laborMappingsRaw: approvedJson('labor-mappings.json'),
});

describe('buildGuideBasis — 기존 검사를 먼저 통과시킨다', () => {
  it('배포본을 그대로 쓰면 상반기 노임이다', () => {
    const basis = buildGuideBasis({ ...raws(), choice: { kind: 'approved' } });
    expect(basis.wageReplaced).toBe(false);
    expect(basis.reference.wages.periodLabel).toBe('26년 상반기');
    expect(basis.versions.wage).toMatch(/^WAGE-26년 상반기:/);
  });

  it('세 파일의 출처가 다르면 기존 검사가 막는다 — 없애지 않았다', () => {
    const broken = raws();
    const wage = JSON.parse(JSON.stringify(broken.wageTableRaw)) as {
      sourceSha256: string;
    };
    wage.sourceSha256 = 'f'.repeat(64);
    expect(() =>
      buildGuideBasis({ ...broken, wageTableRaw: wage, choice: { kind: 'approved' } }),
    ).toThrow(/서로 다른 원본/);
  });
});

describe('buildGuideBasis — 노임만 가이드 것으로', () => {
  it('품과 매핑은 배포본 그대로고 노임만 바뀐다', () => {
    const approved = buildGuideBasis({ ...raws(), choice: { kind: 'approved' } });
    const switched = buildGuideBasis({
      ...raws(),
      choice: { kind: 'guide', guide: guide('pumsem') },
    });
    expect(switched.wageReplaced).toBe(true);
    expect(switched.reference.items).toEqual(approved.reference.items);
    expect(switched.reference.mappings).toEqual(approved.reference.mappings);
    expect(switched.reference.wages.periodLabel).toContain('하반기');
  });

  it('하반기 노임이 실제로 다르다 — 바꾸는 의미가 있다', () => {
    const approved = buildGuideBasis({ ...raws(), choice: { kind: 'approved' } });
    const switched = buildGuideBasis({
      ...raws(),
      choice: { kind: 'guide', guide: guide('won') },
    });
    expect(approved.reference.wages.wages['통신관련기사']!.amount).toBe('320449');
    expect(switched.reference.wages.wages['통신관련기사']!.amount).toBe('324979');
  });

  it('노임 버전에 내용 해시가 붙는다 — 이름만 같고 값이 바뀌면 걸린다', () => {
    const basis = buildGuideBasis({
      ...raws(),
      choice: { kind: 'guide', guide: guide('ds') },
    });
    expect(basis.versions.wage).toMatch(/^WAGE-26년 하반기:[0-9a-f]{16}$/);
  });

  it('네 가이드 중 어느 것을 골라도 노임 버전이 같다', () => {
    const versions = (['won', 'pumsem', 'ds', 'ds-won'] as const).map(
      (id) =>
        buildGuideBasis({ ...raws(), choice: { kind: 'guide', guide: guide(id) } })
          .versions.wage,
    );
    expect(new Set(versions).size).toBe(1);
  });

  it('품 출처는 노임을 바꿔도 그대로다 — 둘을 따로 고른다', () => {
    const approved = buildGuideBasis({ ...raws(), choice: { kind: 'approved' } });
    const switched = buildGuideBasis({
      ...raws(),
      choice: { kind: 'guide', guide: guide('ds-won') },
    });
    expect(switched.versions.labor).toBe(approved.versions.labor);
    expect(switched.versions.wage).not.toBe(approved.versions.wage);
  });
});

describe('buildGuideBasis — 가이드에 없는 직종', () => {
  /**
   * 배포 품셈 1,331건 중 **2건**이 가이드에 없는 M/M 직종을 쓴다
   * (응용 SW개발자, 데이터베이스 운용자). 그 2건 때문에 전체를 막으면
   * 나머지 1,329건으로 만드는 견적까지 못 낸다. 그래서 **알려주기만** 하고,
   * 막는 일은 그 품셈이 붙은 행에서 계산 엔진이 한다.
   */
  it('무엇이 걸리는지 목록으로 돌려준다 — 전체를 막지 않는다', () => {
    const basis = buildGuideBasis({
      ...raws(),
      choice: { kind: 'guide', guide: guide('pumsem') },
    });
    expect(basis.unsupported.trades).toEqual([
      '데이터베이스 운용자',
      '응용 SW개발자',
    ]);
    expect(basis.unsupported.laborItemIds).toHaveLength(2);
  });

  it('배포본 노임을 쓰면 못 쓰는 직종이 없다', () => {
    const basis = buildGuideBasis({ ...raws(), choice: { kind: 'approved' } });
    expect(basis.unsupported.trades).toEqual([]);
    expect(basis.unsupported.unitMismatchLaborItemIds).toEqual([]);
  });

  it('단위가 어긋나는 품셈을 따로 모은다 (결정 D1)', () => {
    const data = raws();
    const items = JSON.parse(JSON.stringify(data.laborItemsRaw)) as {
      laborItems: Array<{
        laborItemId: string;
        wageUnit: string;
        trades: Array<{ trade: string; quantity: string }>;
      }>;
    };
    // 가이드에 **있는** 직종인데 품셈이 M/M 를 전제한다 — 섞으면 약 20배 틀린다.
    items.laborItems[0]!.wageUnit = 'M/M';
    items.laborItems[0]!.trades = [{ trade: '보통인부', quantity: '1' }];
    const basis = buildGuideBasis({
      ...data,
      laborItemsRaw: items,
      choice: { kind: 'guide', guide: guide('won') },
    });
    expect(basis.unsupported.unitMismatchLaborItemIds).toContain(
      items.laborItems[0]!.laborItemId,
    );
    // 직종 자체는 있으므로 '없는 직종'에는 안 들어간다.
    expect(basis.unsupported.trades).not.toContain('보통인부');
  });

  it('없는 직종을 상반기 값으로 채워 넣지 않는다', () => {
    const basis = buildGuideBasis({
      ...raws(),
      choice: { kind: 'guide', guide: guide('ds') },
    });
    expect(basis.reference.wages.wages['응용 SW개발자']).toBeUndefined();
    expect(Object.keys(basis.reference.wages.wages)).toHaveLength(17);
  });
});

describe('assertSameBasis — 기존 견적을 조용히 다시 계산하지 않는다', () => {
  const current = { labor: 'L1', wage: 'WAGE-26년 하반기:aaa' };

  it('기록이 없으면 통과한다 — 새 견적이다', () => {
    expect(() => assertSameBasis(undefined, current)).not.toThrow();
  });

  it('같으면 통과한다', () => {
    expect(() => assertSameBasis({ ...current }, current)).not.toThrow();
  });

  it('노임 기준이 다르면 막는다', () => {
    expect(() =>
      assertSameBasis({ labor: 'L1', wage: 'WAGE-26년 상반기:bbb' }, current),
    ).toThrow(/노임 기준/);
  });

  it('이름이 같아도 내용이 바뀌면 막는다', () => {
    expect(() =>
      assertSameBasis({ labor: 'L1', wage: 'WAGE-26년 하반기:zzz' }, current),
    ).toThrow(/노임 기준/);
  });

  it('품셈 기준이 다르면 막는다', () => {
    expect(() => assertSameBasis({ labor: 'L0', wage: current.wage }, current)).toThrow(
      /품셈 기준/,
    );
  });
});
