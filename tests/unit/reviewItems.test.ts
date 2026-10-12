/**
 * 사용성 2차 Task A — 지금 문서의 **확인 항목 목록**을 파생한다.
 *
 * 목록은 세 출처(`importWarnings` · `priced.laborWarnings` ·
 * `priced.calculation.warnings`)와 `pendingCableEdit` 에서 **매번 새로**
 * 만든다. 닫아서 없애는 별도 state 를 두지 않는다 — 그래야 실행취소와
 * 항상 맞는다.
 *
 * ⛔ **메시지 문구로 경고 종류를 추측하지 않는다.** `code` 와 구조화된
 * 식별자만 쓴다. 문구가 같다는 이유로 합치지도 않는다 — 같은 품명을 쓰는
 * 두 행은 **서로 다른 확인 항목**이다.
 */
import { describe, it, expect } from 'vitest';
import { buildReviewItems, decideNavigation, identifyImportWarnings } from '@/features/worksheet/reviewItems';
import type { PreparedQuote } from '@/export/variants/prepare';
import type { ImportWarning } from '@/import/diagram/devices';
import type { LaborWarning } from '@/domain/labor/types';
import type { CalculationWarning } from '@/domain/calculation/calculate';

// --- 합성 prepared ------------------------------------------------------------
//
// `buildReviewItems` 가 읽는 것은 세 배열뿐이다. 나머지 칸은 타입을 맞추기
// 위한 빈 값이며, 이 시험은 계산 엔진을 돌리지 않는다.

function preparedOf(input: {
  importWarnings?: readonly ImportWarning[];
  laborWarnings?: readonly LaborWarning[];
  calculationWarnings?: readonly CalculationWarning[];
}): PreparedQuote {
  return {
    document: { rows: [] },
    profileBySystem: new Map(),
    importWarnings: input.importWarnings ?? [],
    blocking: true,
    priced: {
      laborBreakdowns: new Map(),
      laborWarnings: input.laborWarnings ?? [],
      blocking: true,
      calculation: {
        systems: [],
        cover: {},
        warnings: input.calculationWarnings ?? [],
        blocking: true,
        versions: {},
      },
    },
  } as unknown as PreparedQuote;
}

/** 전용 해소 UI 가 없는 **계산** 경고. 목록에서 사라지면 안 된다. */
const unsupported: CalculationWarning = {
  code: 'derived-source-missing',
  blocking: true,
  message: '파생 행의 기준 행을 찾을 수 없다.',
  systemId: 'S1',
};

const cableA: ImportWarning = {
  code: 'cable-item-unresolved',
  blocking: true,
  message: "'HDMI 케이블'을 카탈로그에서 찾을 수 없다.",
  edgeId: 'e1',
  sourceCableKey: 'ready:HDMI 케이블:5',
  owner: 'cable-generation',
};

/** 같은 edge 의 **다른 품목**. 합치면 한쪽을 해소할 수 없다. */
const cableB: ImportWarning = {
  ...cableA,
  message: "'UTP 케이블'을 카탈로그에서 찾을 수 없다.",
  sourceCableKey: 'bulk:UTP 케이블',
};

function fullPrepared(): PreparedQuote {
  return preparedOf({
    importWarnings: [cableA, cableB],
    laborWarnings: [
      { code: 'mapping-unconfirmed', blocking: true, message: '품셈 연결이 미확인이다.', rowId: 'row-a', laborMappingId: 'LM-1' },
      { code: 'mapping-unconfirmed', blocking: true, message: '품셈 연결이 미확인이다.', rowId: 'row-b', laborMappingId: 'LM-1' },
      { code: 'wage-missing', blocking: true, message: '직종의 노임이 없다.', rowId: 'row-a' },
      // rowId 가 없다 — 고칠 행을 특정할 수 없지만 목록에서 빠지면 안 된다.
      { code: 'wage-unit-mismatch', blocking: true, message: 'M/D 와 M/M 이 섞였다.' },
    ],
    calculationWarnings: [
      { code: 'quantity-unresolved', blocking: true, message: '수량을 확인해야 한다.', rowId: 'row-c', systemId: 'S1' },
      unsupported,
    ],
  });
}

// ---------------------------------------------------------------------------
describe('buildReviewItems — 세 출처와 pending 케이블을 한 목록으로', () => {
  it('같은 문구라도 행이 다르면 따로 남는다', () => {
    const items = buildReviewItems(fullPrepared(), false);
    expect(
      items.filter((x) => x.source === 'labor' && x.code === 'mapping-unconfirmed').map((x) => x.rowId),
    ).toEqual(['row-a', 'row-b']);
  });

  it('같은 edge 의 서로 다른 케이블 품목을 합치지 않는다', () => {
    const items = buildReviewItems(fullPrepared(), false);
    const imports = items.filter((x) => x.target.kind === 'import');
    expect(imports).toHaveLength(2);
    expect(new Set(imports.map((x) => x.id)).size).toBe(2);
  });

  it('행을 특정할 수 없는 노무 경고는 상세 목적지로 남긴다', () => {
    const items = buildReviewItems(fullPrepared(), false);
    expect(items.find((x) => x.source === 'labor' && x.rowId === undefined)?.target.kind).toBe('detail');
  });

  it('pendingCableEdit 은 별도 항목이다', () => {
    expect(buildReviewItems(fullPrepared(), true).some((x) => x.target.kind === 'cables')).toBe(true);
    expect(buildReviewItems(fullPrepared(), false).some((x) => x.target.kind === 'cables')).toBe(false);
  });

  it('전용 해소 UI 가 없는 계산 경고도 차단 항목으로 남는다', () => {
    const items = buildReviewItems(fullPrepared(), false);
    expect(items.find((x) => x.message === unsupported.message)?.blocking).toBe(true);
  });

  it('분류를 code 로 정한다 — 문구를 읽지 않는다', () => {
    const items = buildReviewItems(fullPrepared(), false);
    const categoryOf = (code: string) => items.find((x) => x.code === code)?.category;
    expect(categoryOf('mapping-unconfirmed')).toBe('labor');
    expect(categoryOf('quantity-unresolved')).toBe('quantity');
    expect(categoryOf('cable-item-unresolved')).toBe('product');
    expect(categoryOf('derived-source-missing')).toBe('calculation');
  });

  it('행이 있는 노무·수량 경고는 그 행으로 간다', () => {
    const items = buildReviewItems(fullPrepared(), false);
    expect(items.find((x) => x.code === 'wage-missing')?.target).toEqual({ kind: 'labor', rowId: 'row-a' });
    expect(items.find((x) => x.code === 'quantity-unresolved')?.target).toEqual({ kind: 'quantity', rowId: 'row-c' });
  });

  it('입력 prepared 를 바꾸지 않는다', () => {
    const prepared = fullPrepared();
    const before = JSON.stringify({
      i: prepared.importWarnings,
      l: prepared.priced.laborWarnings,
      c: prepared.priced.calculation.warnings,
    });
    buildReviewItems(prepared, true);
    expect(
      JSON.stringify({
        i: prepared.importWarnings,
        l: prepared.priced.laborWarnings,
        c: prepared.priced.calculation.warnings,
      }),
    ).toBe(before);
  });

  it('모든 항목의 id 가 서로 다르다 — 출처가 달라도 겹치지 않는다', () => {
    const items = buildReviewItems(fullPrepared(), true);
    expect(new Set(items.map((x) => x.id)).size).toBe(items.length);
  });
});

// ---------------------------------------------------------------------------
/**
 * 같은 문구의 두 항목을 **사람이 눈으로 구분**할 수 있어야 한다.
 *
 * id 가 다른 것만으로는 부족하다 — 화면에는 문구만 보이기 때문에, 어느
 * 시스템의 몇 번째 줄인지를 함께 적어야 어느 쪽을 고치는지 알 수 있다
 * (2026-10-12 독립 검토 지적).
 */
describe('항목의 위치 표시', () => {
  /** 품명·규격까지 완전히 같은 두 행 — 가장 구분하기 어려운 경우다. */
  function preparedWithTwinRows(): PreparedQuote {
    return {
      ...fullPrepared(),
      document: {
        systems: [{ systemId: 'S1', name: '회의실 A' }, { systemId: 'S2', name: '교육장 B' }],
        rows: [
          { type: 'item', rowId: 'row-a', systemId: 'S1', name: '합성 장비', specification: 'FIX-SPEC' },
          { type: 'item', rowId: 'row-b', systemId: 'S1', name: '합성 장비', specification: 'FIX-SPEC' },
          { type: 'item', rowId: 'row-c', systemId: 'S2', name: '다른 장비', specification: '' },
        ],
        derivedRows: [],
      },
    } as unknown as PreparedQuote;
  }

  it('품명·규격이 똑같아도 시스템과 줄 번호로 갈린다', () => {
    const items = buildReviewItems(preparedWithTwinRows(), false);
    const labor = items.filter((x) => x.code === 'mapping-unconfirmed');
    expect(labor.map((x) => x.location)).toEqual([
      '회의실 A · 1번째 줄 · 합성 장비 (FIX-SPEC)',
      '회의실 A · 2번째 줄 · 합성 장비 (FIX-SPEC)',
    ]);
    expect(new Set(labor.map((x) => x.location)).size).toBe(2);
  });

  it('규격이 비면 괄호를 붙이지 않는다', () => {
    const items = buildReviewItems(preparedWithTwinRows(), false);
    expect(items.find((x) => x.code === 'quantity-unresolved')?.location).toBe(
      '교육장 B · 1번째 줄 · 다른 장비',
    );
  });

  it('행이 없고 시스템만 있는 경고는 시스템 이름만 적는다', () => {
    const items = buildReviewItems(preparedWithTwinRows(), false);
    expect(items.find((x) => x.code === 'derived-source-missing')?.location).toBe('회의실 A');
  });

  it('행도 시스템도 없는 경고에는 위치를 지어내지 않는다', () => {
    const items = buildReviewItems(preparedWithTwinRows(), false);
    expect(items.find((x) => x.code === 'wage-unit-mismatch')?.location).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe('한 행을 확인하면 그 행 항목만 사라진다', () => {
  it('같은 매핑을 쓰는 다른 행의 항목은 남는다', () => {
    const after = buildReviewItems(
      preparedOf({
        laborWarnings: [
          { code: 'mapping-unconfirmed', blocking: true, message: '품셈 연결이 미확인이다.', rowId: 'row-b', laborMappingId: 'LM-1' },
        ],
      }),
      false,
    );
    const rows = after.filter((x) => x.code === 'mapping-unconfirmed').map((x) => x.rowId);
    expect(rows).toEqual(['row-b']);
  });
});

// ---------------------------------------------------------------------------
describe('identifyImportWarnings — 값이 아니라 구조로 식별한다', () => {
  it('거리(requiredCableMeters)만 바뀌면 id 는 그대로다', () => {
    const near: ImportWarning = { ...cableA, requiredCableMeters: '5' };
    const far: ImportWarning = { ...cableA, requiredCableMeters: '30', message: '다시 계산한 안내' };
    expect(identifyImportWarnings([near])[0]!.id).toBe(identifyImportWarnings([far])[0]!.id);
    // 표시값은 갱신된다 — id 가 같다고 옛 내용을 쓰지 않는다.
    expect(identifyImportWarnings([far])[0]!.warning.requiredCableMeters).toBe('30');
    expect(buildReviewItems(preparedOf({ importWarnings: [far] }), false)[0]!.message).toBe('다시 계산한 안내');
  });

  it('구별에 쓰는 칸이 하나라도 다르면 id 가 다르다', () => {
    const base: ImportWarning = { code: 'device-not-in-catalog', blocking: true, message: 'x' };
    const variants: ImportWarning[] = [
      base,
      { ...base, nodeId: 'n1' },
      { ...base, edgeId: 'e1' },
      { ...base, rowId: 'r1' },
      { ...base, optionId: 'o1' },
      { ...base, sourceCableKey: 'k1' },
      { ...base, installationSystemId: 'S1' },
      { ...base, owner: 'cable-generation' },
    ];
    expect(new Set(identifyImportWarnings(variants).map((x) => x.id)).size).toBe(variants.length);
  });

  it('⛔ nodeId 와 edgeId 를 한 자리로 뭉개지 않는다', () => {
    const byNode: ImportWarning = { code: 'device-not-in-catalog', blocking: true, message: 'x', nodeId: 'same' };
    const byEdge: ImportWarning = { code: 'device-not-in-catalog', blocking: true, message: 'x', edgeId: 'same' };
    const [a, b] = identifyImportWarnings([byNode, byEdge]);
    expect(a!.id).not.toBe(b!.id);
  });

  it('완전히 같은 경고가 두 번 와도 둘 다 남고 id 는 다르다', () => {
    const twice = identifyImportWarnings([cableA, cableA]);
    expect(twice).toHaveLength(2);
    expect(twice[0]!.id).not.toBe(twice[1]!.id);
  });

  it('같은 입력이면 id 가 항상 같다 — 재렌더로 remount 되지 않는다', () => {
    expect(identifyImportWarnings([cableA, cableB]).map((x) => x.id))
      .toEqual(identifyImportWarnings([cableA, cableB]).map((x) => x.id));
  });
});

// ---------------------------------------------------------------------------
/**
 * 이동 요청을 받아들일지 가르는 판단.
 *
 * ⚠ 이 분기는 **화면 조작만으로는 닿을 수 없다.** `QuoteSheet` 안에서
 * nonce 가 요청을 같은 렌더에서 소비해 버리기 때문이다. 그래도 분기가
 * 살아 있어야 하므로 여기서 직접 시험한다(E2E 역방향 시험으로는 증명되지
 * 않는다는 사실을 함께 기록한다).
 */
describe('decideNavigation — 오래되거나 사라진 요청을 거부한다', () => {
  const P1 = { tag: 'prepared-1' };
  const P2 = { tag: 'prepared-2' };

  it('같은 계산 결과이고 행도 있으면 간다', () => {
    expect(decideNavigation({ sourcePrepared: P1, currentPrepared: P1, targetExists: true }))
      .toEqual({ kind: 'go' });
  });

  it('그 사이 계산 결과가 바뀌었으면 거부한다', () => {
    const d = decideNavigation({ sourcePrepared: P1, currentPrepared: P2, targetExists: true });
    expect(d.kind).toBe('stale');
    expect(d.kind !== 'go' && d.message).toContain('다시 선택');
  });

  it('지금 계산 결과가 없으면 거부한다', () => {
    expect(decideNavigation({ sourcePrepared: P1, currentPrepared: undefined, targetExists: true }).kind)
      .toBe('stale');
  });

  it('대상이 사라졌으면 거부한다 — 다른 것을 대신 고르지 않는다', () => {
    const d = decideNavigation({ sourcePrepared: P1, currentPrepared: P1, targetExists: false });
    expect(d.kind).toBe('missing');
  });

  it('내용이 같아도 참조가 다르면 거부한다 — undo 로 새 객체가 온 경우', () => {
    expect(decideNavigation({ sourcePrepared: { a: 1 }, currentPrepared: { a: 1 }, targetExists: true }).kind)
      .toBe('stale');
  });
});
