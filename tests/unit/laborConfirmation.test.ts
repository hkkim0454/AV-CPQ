import { describe, expect, it } from 'vitest';
import {
  computeLaborConfirmationFingerprint,
  type LaborConfirmationFingerprintInput,
} from '@/domain/labor/laborConfirmation';
import { decodeWorkFile, encodeWorkFile } from '@/services/files/workFile';
import { makeDocument, itemRow, system } from '../fixtures/document';
import type { QuoteDocument } from '@/domain/quote/types';

/**
 * Task 6 노무 확인 보완 — Task A. "확인한 행의 품셈 공수를 바꾸면 확인이
 * 무효가 되는지"는 지문이 그 변화에 민감한지로 증명한다 — 실제 차단
 * 적용(무효화)은 Task B가 한다.
 */

function baseInput(): LaborConfirmationFingerprintInput {
  return {
    rowId: 'r1',
    productId: 'P-1',
    sku: 'SKU-1',
    laborMappingId: 'LM-1',
    laborItemId: 'LI-1',
    code: '9-2-1-1-CCTV_촬상부',
    trades: [
      { trade: '통신설비공', quantity: '0.32' },
      { trade: '보통인부', quantity: '0.1' },
    ],
    tradeWages: [
      { trade: '통신설비공', amount: '315528', unit: 'M/D' },
      { trade: '보통인부', amount: '172068', unit: 'M/D' },
    ],
    wageTableId: 'WAGE-26년 하반기',
    wageUnit: 'M/D',
    baseUnit: 'EA',
    rowUnit: 'EA',
    itemRate: '0.63',
    surcharge: '0',
    conversionFactor: '1',
    quantity: '1',
    ruleVersion: 'rule-v1',
  };
}

describe('computeLaborConfirmationFingerprint', () => {
  it('공수(직종별 품)가 바뀌면 지문이 달라진다', () => {
    const before = computeLaborConfirmationFingerprint(baseInput());
    const after = computeLaborConfirmationFingerprint({
      ...baseInput(),
      trades: [
        { trade: '통신설비공', quantity: '0.40' }, // 0.32 → 0.40
        { trade: '보통인부', quantity: '0.1' },
      ],
    });
    expect(after).not.toBe(before);
  });

  it('노임표(wageTableId)나 적용 노임이 바뀌면 지문이 달라진다', () => {
    const before = computeLaborConfirmationFingerprint(baseInput());
    const afterTable = computeLaborConfirmationFingerprint({
      ...baseInput(),
      wageTableId: 'WAGE-27년 상반기',
    });
    const afterAmount = computeLaborConfirmationFingerprint({
      ...baseInput(),
      tradeWages: [
        { trade: '통신설비공', amount: '999999', unit: 'M/D' },
        { trade: '보통인부', amount: '172068', unit: 'M/D' },
      ],
    });
    expect(afterTable).not.toBe(before);
    expect(afterAmount).not.toBe(before);
  });

  it('환산계수(conversionFactor)나 단위가 바뀌면 지문이 달라진다 — 같은 공수·노임이어도', () => {
    const before = computeLaborConfirmationFingerprint(baseInput());
    const afterFactor = computeLaborConfirmationFingerprint({ ...baseInput(), conversionFactor: '1.1' });
    const afterUnit = computeLaborConfirmationFingerprint({ ...baseInput(), rowUnit: 'SET' });
    expect(afterFactor).not.toBe(before);
    expect(afterUnit).not.toBe(before);
  });

  it('제품 identity(productId/SKU)가 바뀌면 지문이 달라진다 — 재연결이 확인을 복사하지 못하게 한다', () => {
    const before = computeLaborConfirmationFingerprint(baseInput());
    const after = computeLaborConfirmationFingerprint({ ...baseInput(), productId: 'P-2', sku: 'SKU-2' });
    expect(after).not.toBe(before);
  });

  it('rowId가 다르면 지문이 달라진다 — 같은 품셈을 쓰는 다른 행에 확인이 복사되지 않는다', () => {
    const before = computeLaborConfirmationFingerprint(baseInput());
    const after = computeLaborConfirmationFingerprint({ ...baseInput(), rowId: 'r2' });
    expect(after).not.toBe(before);
  });

  it("Decimal 표현이 다르지만 값이 같으면('0.30' vs '0.3') 같은 지문이다", () => {
    const a = computeLaborConfirmationFingerprint({ ...baseInput(), surcharge: '0.30' });
    const b = computeLaborConfirmationFingerprint({ ...baseInput(), surcharge: '0.3' });
    expect(a).toBe(b);
  });

  it('직종 순서가 바뀌어도(정렬하므로) 같은 지문이다', () => {
    const a = computeLaborConfirmationFingerprint(baseInput());
    const b = computeLaborConfirmationFingerprint({
      ...baseInput(),
      trades: [...baseInput().trades].reverse(),
      tradeWages: [...baseInput().tradeWages].reverse(),
    });
    expect(a).toBe(b);
  });

  it('계산 rule 버전이 바뀌면 지문이 달라진다', () => {
    const before = computeLaborConfirmationFingerprint(baseInput());
    const after = computeLaborConfirmationFingerprint({ ...baseInput(), ruleVersion: 'rule-v2' });
    expect(after).not.toBe(before);
  });

  it('confirmedAt은 입력에 아예 없다 — 지문이 확인 시각에 좌우되지 않는다(타입 수준 보장)', () => {
    // LaborConfirmationFingerprintInput에 confirmedAt 필드 자체가 없다 —
    // baseInput()을 두 번 호출해 같은 근거를 (서로 다른 시점에) 넣어도
    // 지문은 항상 같다.
    expect(computeLaborConfirmationFingerprint(baseInput())).toBe(computeLaborConfirmationFingerprint(baseInput()));
  });
});

describe('laborConfirmation — 작업 파일 왕복(Task A)', () => {
  function docWithConfirmation(): QuoteDocument {
    const fingerprint = computeLaborConfirmationFingerprint(baseInput());
    const row = itemRow('r1', 'S1', { quantity: '2', price: '10000' });
    if (row.type !== 'item') throw new Error('unreachable');
    return makeDocument({
      systems: [system('S1', { indirect: [] })],
      rows: [{ ...row, laborConfirmation: { basisFingerprint: fingerprint, confirmedAt: '2026-10-05T00:00:00.000Z' } }],
    });
  }

  it('laborConfirmation이 저장 → 다시 열기에서 그대로 복원된다', () => {
    const doc = docWithConfirmation();
    const result = decodeWorkFile(encodeWorkFile(doc));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document).toEqual(doc);
  });

  it('저장 당시와 같은 근거로 지문을 다시 계산하면(= 다시 열기 후 아무것도 안 바뀜) 저장된 지문과 같다', () => {
    const doc = docWithConfirmation();
    const row = doc.rows[0]!;
    if (row.type !== 'item' || row.laborConfirmation === undefined) throw new Error('unreachable');

    const recomputed = computeLaborConfirmationFingerprint(baseInput());
    expect(recomputed).toBe(row.laborConfirmation.basisFingerprint);
  });

  it('노임표가 바뀐 뒤(예: 다시 열기 시점 환경) 지문을 다시 계산하면 저장된 지문과 달라진다 — 확인이 무효가 될 근거', () => {
    const doc = docWithConfirmation();
    const row = doc.rows[0]!;
    if (row.type !== 'item' || row.laborConfirmation === undefined) throw new Error('unreachable');

    const afterWageTableReplaced = computeLaborConfirmationFingerprint({
      ...baseInput(),
      wageTableId: 'WAGE-27년 상반기', // 노임표가 교체됐다고 가정한다.
      tradeWages: [
        { trade: '통신설비공', amount: '320000', unit: 'M/D' },
        { trade: '보통인부', amount: '175000', unit: 'M/D' },
      ],
    });
    expect(afterWageTableReplaced).not.toBe(row.laborConfirmation.basisFingerprint);
  });
});
