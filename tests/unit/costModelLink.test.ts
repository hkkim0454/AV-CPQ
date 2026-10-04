import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';

import { readTable } from '@/services/private-cost/readTable';
import { parsePrivatePrices } from '@/services/private-cost/parse';
import { createSession } from '@/services/private-cost/session';
import { internalLines } from '@/services/private-cost/calculate';

/**
 * 사용자의 원가 파일을 읽을 수 있는가 (계획 2026-10-04, 사용자 확정 입력 흐름).
 *
 * ## 실제 파일의 모양
 *
 * ```
 * B열  품명        PTZ 카메라
 * C열  '규격'      SRG-A40        ← 머리글은 '규격'인데 내용은 모델명이다
 * G열  매입단가    1,200,000
 * H열  총액        2,400,000      ← 그 파일을 만들 때의 수량으로 계산된 값
 * ```
 *
 * **내부 SKU 가 없다.** 그래서 SKU 를 열쇠로 쓰는 기존 경로로는 못 읽는다.
 *
 * 여기 숫자는 전부 **합성**이다 (설계서 §8.4). 실제 원가 파일은 사용자 PC 에만
 * 있고, 브라우저 메모리에서만 계산되며, 어디로도 올라가지 않는다.
 */

const MAPPING = {
  model: '규격',
  name: '품명',
  purchaseUnitPrice: '매입단가',
  currency: '통화',
  unit: '단위',
} as const;

const csv = (text: string): Uint8Array => strToU8(text);

const costFile = (...rows: string[]): ReturnType<typeof parsePrivatePrices> =>
  parsePrivatePrices(
    readTable(csv(['품명,규격,매입단가,통화,단위', ...rows].join('\n')), 'csv'),
    MAPPING,
  );

describe('SKU 없는 원가 파일 — 모델명을 열쇠로 읽는다', () => {
  it('품명과 모델명을 함께 읽는다', () => {
    const result = costFile('PTZ 카메라,SRG-A40,1200000,KRW,EA');
    expect(result.errors).toEqual([]);
    expect(result.entries[0]).toMatchObject({
      model: 'SRG-A40',
      name: 'PTZ 카메라',
      purchaseUnitPrice: '1200000',
    });
    expect(result.entries[0]!.sku).toBeUndefined();
    expect(result.entries[0]!.entryId).toBeTruthy();
  });

  it('SKU 열도 모델명 열도 없으면 읽지 않는다', () => {
    const table = readTable(csv('매입단가,통화,단위\n1000,KRW,EA\n'), 'csv');
    const result = parsePrivatePrices(table, {
      purchaseUnitPrice: '매입단가',
      currency: '통화',
      unit: 'EA',
    });
    expect(result.errors[0]!.code).toBe('key-column-missing');
    expect(result.entries).toEqual([]);
  });

  it('모델명이 빈 줄은 막는다', () => {
    const result = costFile('이름만 있는 줄,,1000,KRW,EA');
    expect(result.errors.map((e) => e.code)).toEqual(['model-empty']);
  });

  it('같은 모델이 두 줄이면 어느 쪽인지 사람이 정한다 — 먼저 온 것을 고르지 않는다', () => {
    const result = costFile(
      'PTZ 카메라,SRG-A40,1200000,KRW,EA',
      'PTZ 카메라 (재고),SRG-A40,1100000,KRW,EA',
    );
    expect(result.errors.map((e) => e.code)).toEqual(['duplicate-model']);
    expect(result.entries).toHaveLength(1);
  });

  it('오류 메시지에 금액을 담지 않는다 (설계서 §8.4)', () => {
    const result = costFile('PTZ 카메라,SRG-A40,abc,KRW,EA');
    expect(result.errors[0]!.message).not.toContain('abc');
  });
});

describe('세션 — 후보를 돌려주고 고르지 않는다', () => {
  const session = () =>
    createSession(
      costFile(
        'PTZ 카메라,SRG-A40,1200000,KRW,EA',
        '천장 마이크,MXA920,2500000,KRW,EA',
      ).entries,
    );

  it('모델명으로 후보를 찾는다', () => {
    const found = session().candidatesByModel('SRG-A40');
    expect(found).toHaveLength(1);
    expect(found[0]!.model).toBe('SRG-A40');
  });

  it('공백과 대소문자만 맞춘다', () => {
    expect(session().candidatesByModel(' srg-a40 ')).toHaveLength(1);
  });

  it('비슷한 모델명을 추측해서 연결하지 않는다', () => {
    // `SRG-A40` 과 `SRG-A40T` 는 다른 제품이다. 비슷하다고 붙이면
    // 조용히 틀린 원가가 들어간다.
    expect(session().candidatesByModel('SRG-A40T')).toEqual([]);
    expect(session().candidatesByModel('SRG')).toEqual([]);
  });

  it('없는 모델은 빈 목록이다 — 가장 가까운 것을 주지 않는다', () => {
    expect(session().candidatesByModel('없는모델')).toEqual([]);
  });

  it('모델 목록을 보여주되 금액은 주지 않는다', () => {
    const models = session().knownModels();
    expect(models.sort()).toEqual(['MXA920', 'SRG-A40']);
    expect(JSON.stringify(session())).not.toContain('1200000');
  });

  it('SKU 가 없는 세션이라도 직렬화에 원가가 안 나온다', () => {
    expect(JSON.stringify({ session: session() })).not.toContain('2500000');
  });
});

describe('견적 행에 원가를 잇는다 — 사람이 확인한 연결만', () => {
  const session = () =>
    createSession(costFile('PTZ 카메라,SRG-A40,1000000,KRW,EA').entries);

  it('자리표로 이으면 원가가 붙는다', () => {
    const s = session();
    const entryId = s.candidatesByModel('SRG-A40')[0]!.entryId;
    const [line] = internalLines(
      [
        {
          rowId: 'r1',
          costEntryId: entryId,
          quantity: '3',
          sellingUnitPrice: '1500000',
        },
      ],
      s,
    );
    expect(line!.costRegistered).toBe(true);
    expect(line!.purchaseUnitPrice!.toFixed()).toBe('1000000');
  });

  it('총액은 견적의 수량으로 다시 곱한다 — 원가 파일의 총액 칸을 믿지 않는다', () => {
    const s = session();
    const entryId = s.candidatesByModel('SRG-A40')[0]!.entryId;
    const [line] = internalLines(
      [{ rowId: 'r1', costEntryId: entryId, quantity: '3' }],
      s,
    );
    // 원가 파일이 수량 2로 2,000,000 을 적어 뒀더라도 견적 수량은 3이다.
    expect(line!.purchaseAmount!.toFixed()).toBe('3000000');
  });

  it('연결하지 않은 행은 미등록이다 — 모델이 같아 보여도 자동으로 붙지 않는다', () => {
    const [line] = internalLines(
      [{ rowId: 'r1', specification: 'SRG-A40', quantity: '1' }],
      session(),
    );
    expect(line!.costRegistered).toBe(false);
    expect(line!.purchaseUnitPrice).toBeUndefined();
  });

  it('사람이 정한 연결이 SKU 조회보다 앞선다', () => {
    const s = createSession(
      costFile(
        'PTZ 카메라,SRG-A40,1000000,KRW,EA',
        '다른 카메라,SRG-B50,2000000,KRW,EA',
      ).entries,
    );
    const second = s.candidatesByModel('SRG-B50')[0]!.entryId;
    const [line] = internalLines(
      // SKU 가 있어도 사람이 고른 줄을 쓴다.
      [{ rowId: 'r1', sku: 'VID-0001', costEntryId: second, quantity: '1' }],
      s,
    );
    expect(line!.purchaseUnitPrice!.toFixed()).toBe('2000000');
  });

  it('잘못된 자리표는 미등록이다 — 아무 줄이나 붙이지 않는다', () => {
    const [line] = internalLines(
      [{ rowId: 'r1', costEntryId: 'row-9999', quantity: '1' }],
      session(),
    );
    expect(line!.costRegistered).toBe(false);
  });
});
