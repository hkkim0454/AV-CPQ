import { describe, expect, it } from 'vitest';
import { compareMatchedPrices, oneToOneMatches } from '../../tools/probe_pumsem_compare';

describe('품셈 자료 대조', () => {
  it('제품 번호가 밀려도 신원이 확인된 대응만 단가를 비교한다', () => {
    const oldPrices = {
      'VID-0138': { sellingUnitPrice: '100' },
      'VID-0140': { sellingUnitPrice: '250' },
    };
    const newPrices = {
      'VID-0138': { sellingUnitPrice: '9000' }, // 번호는 같지만 다른 제품
      'VID-0142': { sellingUnitPrice: '120' },
      'VID-0143': { sellingUnitPrice: '0' },
    };
    const result = compareMatchedPrices(oldPrices, newPrices, [
      { sourceSku: 'VID-0138', targetSku: 'VID-0142' },
      { sourceSku: 'VID-0140', targetSku: 'VID-0143' },
    ]);

    expect(result).toMatchObject({
      compared: 2,
      increased: 1,
      decreased: 1,
      becameZero: 1,
      oldMissing: 0,
      newMissing: 0,
    });
    expect(result.changes.map((change) => change.newPrice)).toEqual(['120', '0']);
  });

  it('미등록 단가와 0원 단가를 구분한다', () => {
    const result = compareMatchedPrices(
      { OLD: { sellingUnitPrice: '0' } },
      { NEW: { sellingUnitPrice: '0' }, NEW2: { sellingUnitPrice: '0' } },
      [{ sourceSku: 'OLD', targetSku: 'NEW' }, { sourceSku: 'MISSING', targetSku: 'NEW2' }],
    );
    expect(result).toMatchObject({ compared: 1, unchanged: 1, oldMissing: 1, newMissing: 0 });
  });

  it('여러 옛 번호가 새 번호 하나로 합쳐진 항목은 단가 대조에서 제외한다', () => {
    expect(oneToOneMatches([
      { sourceSku: 'OLD-1', targetSku: 'NEW-1' },
      { sourceSku: 'OLD-2', targetSku: 'NEW-1' },
      { sourceSku: 'OLD-3', targetSku: 'NEW-2' },
    ])).toEqual([{ sourceSku: 'OLD-3', targetSku: 'NEW-2' }]);
  });
});
