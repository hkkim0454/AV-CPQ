import { describe, it, expect } from 'vitest';
import { calculateQuote } from '@/domain/calculation/calculate';
import { makeDocument, itemRow, system } from '../fixtures/document';

/**
 * 설계서 §5.6 합성 검증 예제. 아래 값은 회사 가격이 아닌 테스트 값이다.
 */
describe('calculateQuote — 설계서 §5.6 표', () => {
  it('갑지: 시스템 1,234,567 + 2,345,678 → 절사 전 3,580,245', () => {
    const doc = makeDocument({
      systems: [system('S1', { indirect: [] }), system('S2', { indirect: [] })],
      rows: [
        itemRow('r1', 'S1', { quantity: '1', price: '1234567' }),
        itemRow('r2', 'S2', { quantity: '1', price: '2345678' }),
      ],
      negoDeduction: '0',
    });
    const snap = calculateQuote(doc);
    expect(snap.cover.subtotal.toFixed()).toBe('3580245');
  });

  it('절사: 위 합계를 만원 단위로 → 3,580,000', () => {
    const doc = makeDocument({
      systems: [system('S1', { indirect: [] })],
      rows: [itemRow('r1', 'S1', { quantity: '1', price: '3580245' })],
      negoDeduction: '0',
    });
    const snap = calculateQuote(doc);
    expect(snap.cover.rounded.toFixed()).toBe('3580000');
  });

  it('NEGO: 차감 80,000 → 3,500,000, VAT 별도', () => {
    const doc = makeDocument({
      systems: [system('S1', { indirect: [] })],
      rows: [itemRow('r1', 'S1', { quantity: '1', price: '3580245' })],
      negoDeduction: '80000',
    });
    const snap = calculateQuote(doc);
    expect(snap.cover.rounded.toFixed()).toBe('3580000');
    // 설계서 §5.5: 웹에서는 양수로 입력받고 출력에서 음수 조정액으로 바꾼다.
    expect(snap.cover.negoAdjustment.toFixed()).toBe('-80000');
    expect(snap.cover.finalTotal.toFixed()).toBe('3500000');
  });

  it('수량 × 단가로 재료비 금액을 만든다 (G = E*F)', () => {
    const doc = makeDocument({
      systems: [system('S1', { indirect: [] })],
      rows: [itemRow('r1', 'S1', { quantity: '3', price: '1000' })],
    });
    const snap = calculateQuote(doc);
    const row = snap.systems[0]!.rows[0]!;
    expect(row.materialAmount?.toFixed()).toBe('3000');
    expect(row.total?.toFixed()).toBe('3000');
  });
});

describe('calculateQuote — 미등록 단가 (설계서 §5.6 마지막 행)', () => {
  it('판매 단가가 없으면 0으로 처리하지 않고 금액을 비운다', () => {
    const doc = makeDocument({
      systems: [system('S1', { indirect: [] })],
      rows: [itemRow('r1', 'S1', { quantity: '2' })], // price 없음
    });
    const snap = calculateQuote(doc);
    const row = snap.systems[0]!.rows[0]!;
    expect(row.materialUnitPrice).toBeUndefined();
    expect(row.materialAmount).toBeUndefined();
  });

  it('미등록 단가가 있으면 확정을 차단한다', () => {
    const doc = makeDocument({
      systems: [system('S1', { indirect: [] })],
      rows: [itemRow('r1', 'S1', { quantity: '2' })],
    });
    const snap = calculateQuote(doc);
    expect(snap.blocking).toBe(true);
    expect(snap.warnings.some((w) => w.code === 'price-not-registered')).toBe(true);
  });

  it('명시적으로 입력된 0원은 미등록과 구분한다', () => {
    const doc = makeDocument({
      systems: [system('S1', { indirect: [] })],
      rows: [itemRow('r1', 'S1', { quantity: '2', price: '0' })],
    });
    const snap = calculateQuote(doc);
    const row = snap.systems[0]!.rows[0]!;
    expect(row.materialUnitPrice?.toFixed()).toBe('0');
    expect(row.materialAmount?.toFixed()).toBe('0');
    expect(snap.warnings.some((w) => w.code === 'price-not-registered')).toBe(false);
    expect(snap.blocking).toBe(false);
  });
});

describe('calculateQuote — 간접비 (설계서 §5.4, mapping.md §3.6)', () => {
  it('노무비 대비 항목은 직접비계의 노무비 금액을 기준으로 INT 적용', () => {
    const doc = makeDocument({
      systems: [
        system('S1', {
          indirect: [
            {
              itemId: 'i1',
              name: '간접노무비',
              basisLabel: '노무비 대비',
              basis: { kind: 'labor' },
              rate: '0.0486',
              applied: true,
              source: '원본 양식',
            },
          ],
        }),
      ],
      rows: [
        itemRow('r1', 'S1', { quantity: '1', price: '0', laborPrice: '1000000' }),
      ],
    });
    const snap = calculateQuote(doc);
    const sys = snap.systems[0]!;
    expect(sys.directLabor.toFixed()).toBe('1000000');
    // INT(1000000 * 0.0486) = INT(48600) = 48600
    expect(sys.indirect[0]!.amount.toFixed()).toBe('48600');
  });

  it('INT가 실제로 소수를 버린다', () => {
    const doc = makeDocument({
      systems: [
        system('S1', {
          indirect: [
            {
              itemId: 'i1',
              name: '고용보험료',
              basisLabel: '노무비 대비',
              basis: { kind: 'labor' },
              rate: '0.00424',
              applied: true,
              source: '원본 양식',
            },
          ],
        }),
      ],
      rows: [itemRow('r1', 'S1', { quantity: '1', price: '0', laborPrice: '1234567' })],
    });
    const snap = calculateQuote(doc);
    // 1234567 * 0.00424 = 5234.56408 → INT → 5234
    expect(snap.systems[0]!.indirect[0]!.amount.toFixed()).toBe('5234');
  });

  it('직접비 대비 항목은 직접비계의 합계(J)를 기준으로 한다', () => {
    const doc = makeDocument({
      systems: [
        system('S1', {
          indirect: [
            {
              itemId: 'i7',
              name: '산업안전보건관리비',
              basisLabel: '직접비 대비',
              basis: { kind: 'direct' },
              rate: '0.0311',
              applied: true,
              source: '원본 양식',
            },
          ],
        }),
      ],
      rows: [
        itemRow('r1', 'S1', { quantity: '1', price: '1000000', laborPrice: '500000' }),
      ],
    });
    const snap = calculateQuote(doc);
    const sys = snap.systems[0]!;
    expect(sys.directTotal.toFixed()).toBe('1500000');
    // INT(1500000 * 0.0311) = INT(46650) = 46650
    expect(sys.indirect[0]!.amount.toFixed()).toBe('46650');
  });

  it('공과잡비는 직접비계 + 지정한 간접비 항목들의 합을 기준으로 한다', () => {
    const doc = makeDocument({
      systems: [
        system('S1', {
          indirect: [
            {
              itemId: 'i1',
              name: '간접노무비',
              basisLabel: '노무비 대비',
              basis: { kind: 'labor' },
              rate: '0.1',
              applied: true,
              source: 't',
            },
            {
              itemId: 'i7',
              name: '산업안전보건관리비',
              basisLabel: '직접비 대비',
              basis: { kind: 'direct' },
              rate: '0.02',
              applied: true,
              source: 't',
            },
            {
              itemId: 'i9',
              name: '공과잡비',
              basisLabel: '직접비+간접노무비+산업안전관리비',
              basis: { kind: 'composite', plusItemIds: ['i1', 'i7'] },
              rate: '0.1',
              applied: true,
              source: 't',
            },
          ],
        }),
      ],
      rows: [
        itemRow('r1', 'S1', { quantity: '1', price: '1000000', laborPrice: '500000' }),
      ],
    });
    const snap = calculateQuote(doc);
    const sys = snap.systems[0]!;
    // 직접비계 J = 1,500,000 / I = 500,000
    // i1 = INT(500000*0.1)   = 50,000
    // i7 = INT(1500000*0.02) = 30,000
    // i9 = INT((1500000+50000+30000)*0.1) = INT(158000) = 158,000
    expect(sys.indirect[0]!.amount.toFixed()).toBe('50000');
    expect(sys.indirect[1]!.amount.toFixed()).toBe('30000');
    expect(sys.indirect[2]!.amount.toFixed()).toBe('158000');
    expect(sys.indirectTotal.toFixed()).toBe('238000');
    expect(sys.systemTotal.toFixed()).toBe('1738000');
  });

  it('applied=false 항목은 요율을 남기되 금액을 0으로 둔다 (원본의 연금·건강·노인장기요양)', () => {
    const doc = makeDocument({
      systems: [
        system('S1', {
          indirect: [
            {
              itemId: 'i4',
              name: '연금보험료',
              basisLabel: '노무비 대비',
              basis: { kind: 'labor' },
              rate: '0.01215',
              applied: false,
              source: '원본 양식 — 이 견적에서 미적용',
            },
          ],
        }),
      ],
      rows: [itemRow('r1', 'S1', { quantity: '1', price: '0', laborPrice: '1000000' })],
    });
    const snap = calculateQuote(doc);
    const item = snap.systems[0]!.indirect[0]!;
    expect(item.applied).toBe(false);
    expect(item.rate.toFixed()).toBe('0.01215');
    expect(item.amount.toFixed()).toBe('0');
  });
});

describe('calculateQuote — NEGO 한계 (설계서 §5.5)', () => {
  it('공급금액보다 큰 할인은 경고하고 확정을 차단한다', () => {
    const doc = makeDocument({
      systems: [system('S1', { indirect: [] })],
      rows: [itemRow('r1', 'S1', { quantity: '1', price: '1000000' })],
      negoDeduction: '2000000',
    });
    const snap = calculateQuote(doc);
    expect(snap.warnings.some((w) => w.code === 'nego-exceeds-total')).toBe(true);
    expect(snap.blocking).toBe(true);
  });

  it('음수 차감액은 거부한다 — 이중 차감 방지', () => {
    const doc = makeDocument({
      systems: [system('S1', { indirect: [] })],
      rows: [itemRow('r1', 'S1', { quantity: '1', price: '1000000' })],
      negoDeduction: '-50000',
    });
    const snap = calculateQuote(doc);
    expect(snap.warnings.some((w) => w.code === 'nego-negative-input')).toBe(true);
    expect(snap.blocking).toBe(true);
  });

  it('차감액과 정확히 같은 금액이면 0원이 되고 경고하지 않는다', () => {
    const doc = makeDocument({
      systems: [system('S1', { indirect: [] })],
      rows: [itemRow('r1', 'S1', { quantity: '1', price: '1000000' })],
      negoDeduction: '1000000',
    });
    const snap = calculateQuote(doc);
    expect(snap.cover.finalTotal.toFixed()).toBe('0');
    expect(snap.warnings.some((w) => w.code === 'nego-exceeds-total')).toBe(false);
  });
});

describe('calculateQuote — 시스템 수량과 소수 수량', () => {
  it('갑지 금액은 시스템 수량 × 시스템 합계다', () => {
    const doc = makeDocument({
      systems: [system('S1', { indirect: [], quantity: '2' })],
      rows: [itemRow('r1', 'S1', { quantity: '1', price: '1000000' })],
      negoDeduction: '0',
    });
    const snap = calculateQuote(doc);
    expect(snap.cover.systemAmounts[0]!.amount.toFixed()).toBe('2000000');
    expect(snap.cover.subtotal.toFixed()).toBe('2000000');
  });

  it('소수 수량을 반올림하지 않고 그대로 곱한다', () => {
    const doc = makeDocument({
      systems: [system('S1', { indirect: [] })],
      rows: [itemRow('r1', 'S1', { quantity: '2.5', price: '1000' })],
    });
    const snap = calculateQuote(doc);
    expect(snap.systems[0]!.rows[0]!.materialAmount?.toFixed()).toBe('2500');
  });
});

describe('calculateQuote — 결정성', () => {
  it('같은 입력은 같은 결과를 낸다', () => {
    const build = () =>
      makeDocument({
        systems: [
          system('S1', {
            indirect: [
              {
                itemId: 'i1',
                name: '간접노무비',
                basisLabel: '노무비 대비',
                basis: { kind: 'labor' },
                rate: '0.0486',
                applied: true,
                source: 't',
              },
            ],
          }),
        ],
        rows: [
          itemRow('r1', 'S1', { quantity: '7', price: '123457', laborPrice: '31337' }),
          itemRow('r2', 'S1', { quantity: '3', price: '7919', laborPrice: '104729' }),
        ],
        negoDeduction: '12345',
      });
    const a = calculateQuote(build());
    const b = calculateQuote(build());
    expect(a.cover.finalTotal.toFixed()).toBe(b.cover.finalTotal.toFixed());
    expect(a.systems[0]!.systemTotal.toFixed()).toBe(b.systems[0]!.systemTotal.toFixed());
  });
});

describe('calculateQuote — 항목 기준 간접비 (일반 프로파일, 계획 2026-10-04 Task 3)', () => {
  /**
   * 일반 프로파일의 노인장기요양보험료는 **건강보험료 대비** 12.95%다.
   * 기존 축에 없다 — `composite`는 **항상 직접비계에서 출발**하므로
   * 지정한 항목 금액'만' 기준으로 삼을 수 없다.
   *
   * 지금 두 항목 다 미적용이라 금액이 0이다. 하지만 누가 적용으로 바꾸는 순간
   * 직접비계가 더해진 값으로 **조용히** 틀린다. 그래서 축을 먼저 만든다.
   */
  const withHealth = (applied: boolean, longTermApplied: boolean) =>
    makeDocument({
      systems: [
        system('S1', {
          indirect: [
            {
              itemId: 'h',
              name: '국민건강보험료',
              basisLabel: '노무비 대비',
              basis: { kind: 'labor' },
              rate: '0.03545',
              applied,
              source: '가이드',
            },
            {
              itemId: 'l',
              name: '노인장기요양보험료',
              basisLabel: '건강보험료 대비',
              basis: { kind: 'item', itemId: 'h' },
              rate: '0.1295',
              applied: longTermApplied,
              source: '가이드',
            },
          ],
        }),
      ],
      rows: [
        itemRow('r1', 'S1', { quantity: '1', price: '0', laborPrice: '1000000' }),
      ],
    });

  it('지정 항목의 금액만 기준으로 한다 — 직접비를 더하지 않는다', () => {
    const snap = calculateQuote(withHealth(true, true));
    const indirect = snap.systems[0]!.indirect;
    // INT(1,000,000 × 0.03545) = 35,450
    expect(indirect[0]!.amount.toFixed()).toBe('35450');
    // INT(35,450 × 0.1295) = INT(4,590.775) = 4,590
    expect(indirect[1]!.amount.toFixed()).toBe('4590');
  });

  it('기준 항목이 미적용이면 기준 금액이 0이다', () => {
    const snap = calculateQuote(withHealth(false, true));
    expect(snap.systems[0]!.indirect[0]!.amount.toFixed()).toBe('0');
    expect(snap.systems[0]!.indirect[1]!.amount.toFixed()).toBe('0');
  });

  it('자기 자신을 기준으로 삼으면 막는다', () => {
    const doc = makeDocument({
      systems: [
        system('S1', {
          indirect: [
            {
              itemId: 'x',
              name: '자기참조',
              basisLabel: '자기 대비',
              basis: { kind: 'item', itemId: 'x' },
              rate: '0.1',
              applied: true,
              source: '시험',
            },
          ],
        }),
      ],
      rows: [itemRow('r1', 'S1', { quantity: '1', price: '0', laborPrice: '1000' })],
    });
    const snap = calculateQuote(doc);
    expect(snap.blocking).toBe(true);
    expect(snap.warnings.some((w) => w.code === 'indirect-basis-missing')).toBe(true);
  });

  it('뒤에 오는 항목을 기준으로 삼으면 막는다 — 가이드의 순서를 지킨다', () => {
    const doc = makeDocument({
      systems: [
        system('S1', {
          indirect: [
            {
              itemId: 'a',
              name: '앞',
              basisLabel: '뒤 대비',
              basis: { kind: 'item', itemId: 'b' },
              rate: '0.1',
              applied: true,
              source: '시험',
            },
            {
              itemId: 'b',
              name: '뒤',
              basisLabel: '노무비 대비',
              basis: { kind: 'labor' },
              rate: '0.1',
              applied: true,
              source: '시험',
            },
          ],
        }),
      ],
      rows: [itemRow('r1', 'S1', { quantity: '1', price: '0', laborPrice: '1000' })],
    });
    const snap = calculateQuote(doc);
    expect(snap.blocking).toBe(true);
  });
});
