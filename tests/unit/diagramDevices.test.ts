import { describe, expect, it } from 'vitest';
import { buildDeviceLines } from '@/import/diagram/devices';
import { cat, diagram, node } from '../fixtures/diagram';

/** 계획 2026-10-04 Task 3. */

describe('장비 행', () => {
  it('노드 하나가 행 하나가 된다', () => {
    const { lines } = buildDeviceLines(diagram([node('n1', 'PTZ 카메라', 'SRG-X40UH')]), cat());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      sku: 'VID-0009',
      name: 'HD PTZ Camera',
      quantity: '1',
      isAccessory: false,
    });
  });

  it('카탈로그 품명을 쓴다 — 구성도 이름은 설계자가 붙인 별명일 수 있다', () => {
    const { lines } = buildDeviceLines(
      diagram([node('n1', '비디오 매트릭스', 'XDM-12')]),
      cat(),
    );
    expect(lines[0]!.name).toBe('UHD Matrix Frame');
    expect(lines[0]!.specification).toBe('XDM-12');
  });

  it('같은 모델 노드 3개는 한 행 수량 3이 된다 — 견적서 실물이 그렇다', () => {
    const { lines } = buildDeviceLines(
      diagram([
        node('n1', 'PTZ 카메라', 'SRG-X40UH'),
        node('n2', 'PTZ 카메라', 'SRG-X40UH'),
        node('n3', 'PTZ 카메라', 'SRG-X40UH'),
      ]),
      cat(),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.quantity).toBe('3');
    expect(lines[0]!.sourceNodeIds).toEqual(['n1', 'n2', 'n3']);
  });

  it('카탈로그에 없는 장비끼리도 모델명이 같으면 합친다', () => {
    const { lines } = buildDeviceLines(
      diagram([
        node('n1', '델리게이트', 'D-Cerno AE'),
        node('n2', '델리게이트', 'D-Cerno AE'),
      ]),
      cat(),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.quantity).toBe('2');
  });

  it('모델이 다르면 합치지 않는다', () => {
    const { lines } = buildDeviceLines(
      diagram([node('n1', 'PTZ', 'SRG-X40UH'), node('n2', '매트릭스', 'XDM-12')]),
      cat(),
    );
    expect(lines).toHaveLength(2);
  });
});

describe('장비 행 — 못 찾았을 때 (설계서 §5.6, §7.5)', () => {
  it('카탈로그에 없는 장비도 행을 만든다 — 빼면 견적에서 장비가 사라진다', () => {
    const { lines, warnings } = buildDeviceLines(
      diagram([node('n1', '델리게이트', 'D-Cerno AE')]),
      cat(),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ name: '델리게이트', quantity: '1' });
    // 키 자체가 없어야 한다. `sku: undefined`로 들고 있으면 직렬화에 섞인다.
    expect(Object.keys(lines[0]!)).not.toContain('sku');
    expect(lines[0]!.sellingUnitPrice).toBeUndefined();
    expect(warnings.some((w) => w.code === 'device-not-in-catalog' && w.blocking)).toBe(true);
  });

  it('못 찾은 장비는 구성도의 이름과 모델을 그대로 쓴다', () => {
    const { lines } = buildDeviceLines(
      diagram([node('n1', '델리게이트', 'D-Cerno AE')]),
      cat(),
    );
    expect(lines[0]!.name).toBe('델리게이트');
    expect(lines[0]!.specification).toBe('D-Cerno AE');
  });

  it('단가 미등록은 0으로 채우지 않는다 (설계서 §5.6)', () => {
    const { lines, warnings } = buildDeviceLines(
      diagram([node('n1', 'PTZ', 'SRG-X40UH')]),
      cat(),
    );
    // 카탈로그에는 있지만 가격표에 없는 제품
    expect(lines[0]!.sku).toBe('VID-0009');
    expect(lines[0]!.sellingUnitPrice).toBeUndefined();
    expect(lines[0]!.sellingUnitPrice).not.toBe('0');
    expect(warnings.some((w) => w.code === 'price-not-registered' && w.blocking)).toBe(true);
  });

  it('모호한 매칭은 따로 보고한다 — 없는 것과 다르다', () => {
    const ambiguous = cat([
      { ...cat().products[0]!, sku: 'A-0001', model: 'DUP-100', quoteSpec: 'DUP-100' },
      { ...cat().products[0]!, sku: 'B-0001', model: 'DUP-100', quoteSpec: 'DUP-100' },
    ]);
    const { warnings } = buildDeviceLines(
      diagram([node('n1', '중복품', 'DUP-100')]),
      ambiguous,
    );
    const w = warnings.find((x) => x.code === 'device-ambiguous-match');
    expect(w?.blocking).toBe(true);
    expect(w?.message).toContain('A-0001');
  });

  it('어떻게 붙었는지 남긴다 — 사람이 검토할 근거', () => {
    const { lines } = buildDeviceLines(
      diagram([node('n1', 'LFD', '98인치 / LH98QMCEBGCXKR')]),
      cat(),
    );
    expect(lines[0]!.matchedBy).toBe('model-fragment');
    expect(lines[0]!.matchedFragment).toBe('LH98QMCEBGCXKR');
  });
});

describe('옵션 카드 (Review Focus #1)', () => {
  const matrix = (q: Record<string, number>) =>
    node('m1', '비디오 매트릭스', 'XDM-12', { selectedOptionQuantities: q });

  it('options에 정의가 있으면 그 모델로 행을 만든다', () => {
    const d = diagram([matrix({ 'eqopt-454': 4 })]);
    d.options = [
      { id: 'eqopt-454', model: 'XDM-HOS100', name: 'HDMI 4채널 output card' },
    ];
    const { lines, warnings } = buildDeviceLines(d, cat());
    const card = lines.find((l) => l.isAccessory);
    expect(card).toMatchObject({
      name: 'HDMI 4채널 output card',
      quantity: '4',
      isAccessory: true,
      sku: 'VID-0142',
    });
    expect(card!.sellingUnitPrice).toBe('1900000');
    expect(warnings.some((w) => w.code === 'option-definition-missing')).toBe(false);
  });

  it('options가 없으면 행은 만들되 blocking 경고를 세운다 — 카드가 조용히 사라지면 안 된다', () => {
    const { lines, warnings } = buildDeviceLines(
      diagram([matrix({ 'eqopt-454': 4 })]),
      cat(),
    );
    const card = lines.find((l) => l.isAccessory);
    expect(card).toBeDefined();
    expect(card!.quantity).toBe('4');
    expect(card!.sellingUnitPrice).toBeUndefined();
    expect(card!.specification).toContain('eqopt-454');
    expect(card!.name).toContain('미상');
    const w = warnings.find((x) => x.code === 'option-definition-missing');
    expect(w?.blocking).toBe(true);
  });

  it('옵션 카드는 주 장비 바로 다음에 온다', () => {
    const d = diagram([matrix({ 'eqopt-454': 2 }), node('n9', 'PTZ', 'SRG-X40UH')]);
    d.options = [{ id: 'eqopt-454', model: 'XDM-HOS100' }];
    const { lines } = buildDeviceLines(d, cat());
    expect(lines[0]!.isAccessory).toBe(false);
    expect(lines[1]!.isAccessory).toBe(true);
    expect(lines[2]!.isAccessory).toBe(false);
  });

  it('수량 0인 옵션은 행을 만들지 않는다', () => {
    const { lines } = buildDeviceLines(diagram([matrix({ 'eqopt-454': 0 })]), cat());
    expect(lines.filter((l) => l.isAccessory)).toHaveLength(0);
  });

  it('같은 옵션이 장비 두 대에 걸리면 수량을 합친다', () => {
    const d = diagram([
      node('m1', '매트릭스', 'XDM-12', { selectedOptionQuantities: { 'eqopt-454': 2 } }),
      node('m2', '매트릭스', 'XDM-12', { selectedOptionQuantities: { 'eqopt-454': 3 } }),
    ]);
    const { lines } = buildDeviceLines(d, cat());
    const cards = lines.filter((l) => l.isAccessory);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.quantity).toBe('5');
  });

  it('같은 옵션 id는 경고를 한 번만 낸다', () => {
    const d = diagram([
      node('m1', '매트릭스', 'XDM-12', { selectedOptionQuantities: { 'eqopt-454': 2 } }),
      node('m2', '매트릭스', 'XDM-12', { selectedOptionQuantities: { 'eqopt-454': 3 } }),
    ]);
    const { warnings } = buildDeviceLines(d, cat());
    expect(warnings.filter((w) => w.code === 'option-definition-missing')).toHaveLength(1);
  });

  it('옵션이 여러 종류면 각각 행을 만든다', () => {
    const { lines } = buildDeviceLines(
      diagram([matrix({ 'eqopt-454': 4, 'eqopt-456': 4 })]),
      cat(),
    );
    const cards = lines.filter((l) => l.isAccessory);
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.specification).sort()).toEqual(['eqopt-454', 'eqopt-456']);
  });
});

describe('멱등성 (설계서 §7.3)', () => {
  it('같은 구성도를 두 번 변환해도 결과가 같다 — 수량이 누적되지 않는다', () => {
    const build = () =>
      buildDeviceLines(
        diagram([
          node('n1', 'PTZ', 'SRG-X40UH'),
          node('n2', 'PTZ', 'SRG-X40UH'),
          node('m1', '매트릭스', 'XDM-12', { selectedOptionQuantities: { 'eqopt-454': 4 } }),
        ]),
        cat(),
      );
    const a = build();
    const b = build();
    expect(JSON.stringify(a.lines)).toBe(JSON.stringify(b.lines));
    expect(a.lines.find((l) => !l.isAccessory)!.quantity).toBe('2');
  });

  it('같은 구성도 객체를 두 번 넣어도 결과가 같다', () => {
    const d = diagram([node('n1', 'PTZ', 'SRG-X40UH'), node('n2', 'PTZ', 'SRG-X40UH')]);
    const c = cat();
    const a = buildDeviceLines(d, c);
    const b = buildDeviceLines(d, c);
    expect(a.lines[0]!.quantity).toBe('2');
    expect(b.lines[0]!.quantity).toBe('2');
    expect(a.lines[0]!.sourceNodeIds).toEqual(b.lines[0]!.sourceNodeIds);
  });
});
