// @vitest-environment jsdom
/**
 * 사용성 2차 Task B 보강 — **소비부**가 실제로 오래된 요청을 거부하는가.
 *
 * `decideNavigation` 단위 시험만으로는 부족하다. 그 함수를 호출하는 배선을
 * 지워도 순수 함수 시험은 그대로 통과하기 때문이다. 그래서 여기서는 진짜
 * `QuoteSheet` 와 `WarningList` 를 DOM 에 그리고 요청을 주입한다.
 *
 * ⛔ 생산 코드에 시험용 API 를 넣지 않았다. props 는 App 이 실제로 쓰는 것과
 * 같고, 여기서는 그 props 에 합성 값을 넣을 뿐이다.
 *
 * 사람이 화면에서 만들 수 없는 타이밍(요청을 보낸 뒤 계산 결과만 바뀐 상태)을
 * E2E 로 억지로 만들지 않는다 — 그 조합을 여기서 직접 준다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QuoteSheet } from '@/features/worksheet/QuoteSheet';
import { WarningList } from '@/features/worksheet/WarningList';
import type { PreparedQuote } from '@/export/variants/prepare';
import { calculateQuote } from '@/domain/calculation/calculate';
import type { QuoteDocument } from '@/domain/quote/types';
import type { ImportWarning } from '@/import/diagram/devices';
import type { Catalog } from '@/data/catalog/load';
import { identifyImportWarnings } from '@/features/worksheet/reviewItems';

// React 19 는 act 환경임을 이 전역으로 안다.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = window.document.createElement('div');
  window.document.body.appendChild(container);
  root = createRoot(container);
  // jsdom 에는 없다. 호출되었는지 세는 용도로도 쓴다.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: React.ReactNode): void {
  act(() => root.render(node));
}

// --- 합성 문서 ---------------------------------------------------------------
const ROW_A = 'row-a';
const ROW_B = 'row-b';

function documentOf(): QuoteDocument {
  const row = (rowId: string) => ({
    type: 'item' as const,
    rowId,
    systemId: 'S1',
    sku: 'FIX-0001',
    name: '합성 품목',
    specification: 'SPEC',
    unit: 'EA',
    quantity: '1',
    laborMode: 'mapped' as const,
    laborMappingId: 'LM-1',
    remark: '',
    origin: 'rule' as const,
  });
  return {
    schemaVersion: 1,
    documentId: 'doc-1',
    mode: 'material-and-labor',
    header: {},
    coverGroups: [],
    systems: [{ systemId: 'S1', name: '시스템 1', summarySpec: '', unit: '식', quantity: '1', remark: '', indirectCosts: [] }],
    rows: [row(ROW_A), row(ROW_B)],
    derivedRows: [],
    negoDeduction: '0',
    rounding: { coverTotalDigits: -3 },
    versions: {},
    equipment: [],
    connections: [],
    existingSupplies: [],
  } as unknown as QuoteDocument;
}

// 합성 문서를 **실제 계산 엔진**에 넣어 스냅샷을 얻는다 — 화면이 읽는 칸을
// 손으로 흉내내면 모양만 맞고 값이 비어 깨진다.
const calculation = calculateQuote(documentOf());

/** 계산 결과 두 개 — **참조가 다른** 것이 요점이다. */
const P1 = { tag: 'prepared-1' } as unknown as PreparedQuote;
const P2 = { tag: 'prepared-2' } as unknown as PreparedQuote;

const noop = () => {};

function sheet(over: Partial<Parameters<typeof QuoteSheet>[0]>) {
  return (
    <QuoteSheet
      document={documentOf()}
      calculation={calculation}
      laborBreakdowns={new Map()}
      laborWarnings={[]}
      onQuantityChange={noop}
      onDescriptionChange={noop}
      onRemarkChange={noop}
      onSupplierChange={noop}
      onSalesRemarkChange={noop}
      onRemoveRow={noop}
      onLaborModeChange={noop}
      onManualLaborUnitPriceChange={noop}
      onOverrideReasonChange={noop}
      onConfirmLaborRow={noop}
      {...over}
    />
  );
}

const openPanels = () => container.querySelectorAll('tr[data-labor-basis-for]').length;

// ---------------------------------------------------------------------------
describe('QuoteSheet 소비부 — 오래된 요청을 실제로 거부한다', () => {
  it('같은 계산 결과면 그 행을 열고 포커스한다', () => {
    render(sheet({ navigation: { rowId: ROW_B, kind: 'labor', sourcePrepared: P1, nonce: 1 }, prepared: P1 }));
    const panel = container.querySelector(`tr[data-labor-basis-for="${ROW_B}"]`);
    expect(panel).not.toBeNull();
    expect(container.querySelector(`tr[data-labor-basis-for="${ROW_A}"]`)).toBeNull();
    expect(window.document.activeElement?.className).toContain('q-labor-basis');
  });

  it('⛔ 요청을 만든 계산 결과가 지금과 다르면 열지도 포커스하지도 않는다', () => {
    const missed = vi.fn();
    render(sheet({
      navigation: { rowId: ROW_B, kind: 'labor', sourcePrepared: P1, nonce: 1 },
      prepared: P2,
      onNavigationMissed: missed,
    }));
    expect(openPanels()).toBe(0);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(missed).toHaveBeenCalledWith(expect.stringContaining('다시 선택'));
  });

  it('⛔ 그 사이 행이 사라졌으면 다른 행을 대신 열지 않는다', () => {
    const missed = vi.fn();
    render(sheet({
      navigation: { rowId: '없는행', kind: 'labor', sourcePrepared: P1, nonce: 1 },
      prepared: P1,
      onNavigationMissed: missed,
    }));
    expect(openPanels()).toBe(0);
    expect(missed).toHaveBeenCalledWith(expect.stringContaining('찾지 못했'));
  });

  it('같은 요청이 다시 렌더돼도 한 번만 소비한다', () => {
    const request = { rowId: ROW_B, kind: 'labor' as const, sourcePrepared: P1, nonce: 1 };
    render(sheet({ navigation: request, prepared: P1 }));
    const first = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length;
    // 다른 이유로 재렌더해도 옛 요청이 다시 스크롤하면 안 된다.
    render(sheet({ navigation: request, prepared: P1 }));
    expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length).toBe(first);
  });

  it('nonce 가 바뀌면 같은 자리라도 다시 이동한다', () => {
    render(sheet({ navigation: { rowId: ROW_B, kind: 'labor', sourcePrepared: P1, nonce: 1 }, prepared: P1 }));
    const first = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length;
    render(sheet({ navigation: { rowId: ROW_B, kind: 'labor', sourcePrepared: P1, nonce: 2 }, prepared: P1 }));
    expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(first);
  });

  it('⛔ 같은 식별자를 가진 다른 문서로 바뀌면 옛 요청을 쓰지 않는다', () => {
    const missed = vi.fn();
    // 문서 내용·rowId 는 같지만 계산 결과 객체가 새로 만들어졌다(실행취소 등).
    render(sheet({
      navigation: { rowId: ROW_B, kind: 'labor', sourcePrepared: P1, nonce: 7 },
      prepared: { tag: 'prepared-1' } as unknown as PreparedQuote,
      onNavigationMissed: missed,
    }));
    expect(openPanels()).toBe(0);
    expect(missed).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
const catalog = { sourceSha256: 'a', products: [], prices: new Map(), pricesAvailable: true } as unknown as Catalog;

const warningA: ImportWarning = {
  code: 'cable-item-unresolved', blocking: true, message: 'A 케이블을 찾을 수 없다.',
  edgeId: 'e1', sourceCableKey: 'ready:A:5', owner: 'cable-generation',
};
const warningB: ImportWarning = { ...warningA, message: 'B 케이블을 찾을 수 없다.', sourceCableKey: 'bulk:B' };
const idOf = (w: ImportWarning) => identifyImportWarnings([warningA, warningB]).find((x) => x.warning === w)!.id;

function list(over: {
  navigation?: Parameters<typeof WarningList>[0]['navigation'];
  prepared?: unknown;
  onNavigationMissed?: (m: string) => void;
}) {
  return (
    <WarningList
      warnings={[warningA, warningB]}
      catalog={catalog}
      onResolveDevice={noop}
      onResolveOption={noop}
      onResolveConduit={noop}
      onResolveCable={noop}
      onResolveRow={noop}
      {...over}
    />
  );
}

describe('WarningList 소비부 — 구성도 경고 이동도 같은 계약을 지킨다', () => {
  it('같은 계산 결과면 그 항목으로 스크롤하고 포커스한다', () => {
    render(list({ navigation: { warningId: idOf(warningB), sourcePrepared: P1, nonce: 1 }, prepared: P1 }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect((window.document.activeElement as HTMLElement).dataset['warningId']).toBe(idOf(warningB));
  });

  it('⛔ 오래된 요청이면 스크롤하지도 포커스하지도 않는다', () => {
    const missed = vi.fn();
    render(list({
      navigation: { warningId: idOf(warningB), sourcePrepared: P1, nonce: 1 },
      prepared: P2,
      onNavigationMissed: missed,
    }));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(missed).toHaveBeenCalledWith(expect.stringContaining('다시 선택'));
  });

  it('⛔ 대응하는 경고가 사라졌으면 다른 항목을 대신 고르지 않는다', () => {
    const missed = vi.fn();
    render(list({
      navigation: { warningId: '["import","없는경고"]', sourcePrepared: P1, nonce: 1 },
      prepared: P1,
      onNavigationMissed: missed,
    }));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(missed).toHaveBeenCalled();
  });

  it('같은 항목을 다시 눌러도(nonce 증가) 다시 이동한다', () => {
    render(list({ navigation: { warningId: idOf(warningA), sourcePrepared: P1, nonce: 1 }, prepared: P1 }));
    const first = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length;
    render(list({ navigation: { warningId: idOf(warningA), sourcePrepared: P1, nonce: 2 }, prepared: P1 }));
    expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(first);
  });

  it('같은 요청이 다시 렌더돼도 한 번만 소비한다', () => {
    const request = { warningId: idOf(warningA), sourcePrepared: P1, nonce: 1 };
    render(list({ navigation: request, prepared: P1 }));
    const first = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length;
    render(list({ navigation: request, prepared: P1 }));
    expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length).toBe(first);
  });
});

// ---------------------------------------------------------------------------
describe('WarningList — 경고가 0건에서 생겨도 화면이 죽지 않는다', () => {
  /**
   * 실측 결함: 이동용 `useEffect` 를 조기 반환(`warnings.length === 0`) **뒤**에
   * 두었더니, 경고가 처음 생기는 순간 훅 수가 달라져 React 가
   * "Rendered more hooks than during the previous render" 로 화면을 통째로
   * 죽였다. 배관 거리를 입력하자 견적 화면 전체가 사라졌다(E2E 13건 실패).
   */
  const withWarnings = (warnings: ImportWarning[]) => (
    <WarningList
      warnings={warnings}
      catalog={catalog}
      onResolveDevice={noop}
      onResolveOption={noop}
      onResolveConduit={noop}
      onResolveCable={noop}
      onResolveRow={noop}
    />
  );

  it('0건으로 그린 뒤 1건이 생겨도 같은 트리가 유지된다', () => {
    render(withWarnings([]));
    expect(container.querySelector('.q-warning-list')).toBeNull();
    // 같은 root 에 경고가 생긴 상태로 다시 그린다 — 훅 순서가 어긋나면 던진다.
    render(withWarnings([warningA]));
    expect(container.querySelector('.q-warning-list')).not.toBeNull();
  });

  it('1건에서 0건으로 줄어도 죽지 않는다', () => {
    render(withWarnings([warningA]));
    expect(container.querySelector('.q-warning-list')).not.toBeNull();
    render(withWarnings([]));
    expect(container.querySelector('.q-warning-list')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
/**
 * 사용성 2차 Task C — **blur 없이** 상세 열을 숨겼다 보여도 치던 값이 남는가.
 *
 * E2E 에서 단추를 누르면 그 클릭이 입력에서 포커스를 뺏어 `onBlur` 가 먼저
 * 돌고, 값이 이미 문서에 커밋되어 버린다. 그러면 "지역 draft 가 살아남았다"가
 * 아니라 "문서에 저장된 값을 다시 읽었다"를 본 것이 되어, CSS 숨김을 조건부
 * 렌더로 바꿔도 시험이 통과한다.
 *
 * 그래서 여기서는 **포커스를 전혀 건드리지 않고** 열 숨김만 전환해,
 * 커밋되지 않은 지역 draft 자체가 보존되는지 직접 본다
 * (2026-10-12 독립 검토 지적).
 */
describe('상세 열 숨김 — blur 없이도 지역 draft 가 보존된다', () => {
  /** React 가 가로채는 value setter 를 거쳐야 onChange 가 실제로 돈다. */
  function type(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  const supplierInput = () =>
    container.querySelector<HTMLInputElement>('input[aria-label="합성 품목 거래처"]')!;

  const toggle = () =>
    Array.from(container.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('상세 열'),
    )!;

  it('숨겼다 다시 보여도 커밋되지 않은 값이 그대로 있다', () => {
    const commits: string[] = [];
    render(sheet({ onSupplierChange: (_rowId: string, v: string) => commits.push(v) }));

    act(() => toggle().click());   // 상세 열을 펼친다(기본은 숨김이다)
    const input = supplierInput();
    type(input, '아직 저장 안 한 값');
    // ⛔ blur 하지 않는다 — 문서에는 아직 아무것도 들어가지 않았다.
    expect(commits).toEqual([]);

    act(() => toggle().click());   // 숨긴다
    act(() => toggle().click());   // 다시 보여준다

    // 같은 DOM 노드가 그대로 살아 있고, 치던 값도 그대로다.
    expect(supplierInput()).toBe(input);
    expect(supplierInput().value).toBe('아직 저장 안 한 값');
    // 숨기는 조작이 값을 몰래 커밋하지도 않았다.
    expect(commits).toEqual([]);
  });

  it('숨긴 동안에도 입력이 DOM 에 남아 있다 — 떼어내지 않는다', () => {
    render(sheet({}));
    const input = supplierInput();
    // 기본은 숨김이다. 그래도 입력은 DOM 에 있고 CSS 로만 가려져 있다.
    expect(container.contains(input)).toBe(true);
    expect(input.closest('td')?.className).toContain('q-detail-hidden');

    act(() => toggle().click());
    // 펼치면 같은 노드가 그대로 드러난다 — 새로 만들지 않는다.
    expect(supplierInput()).toBe(input);
    expect(input.closest('td')?.className).not.toContain('q-detail-hidden');
  });
});
