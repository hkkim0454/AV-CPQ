import { describe, expect, it } from 'vitest';
import { matchByModel, normalizeModel } from '@/import/diagram/matchCatalog';
import { buildCatalog, type Catalog, type CatalogProduct } from '@/data/catalog/load';

/** 계획 2026-10-04 Task 2. 아래 모델명은 실물 카탈로그에서 가져온 것이다. */

const SHA = 'a'.repeat(64);

function product(sku: string, quoteName: string, quoteSpec: string): CatalogProduct {
  return {
    productId: sku,
    sku,
    brand: '',
    model: quoteSpec,
    quoteName,
    quoteSpec,
    unit: 'EA',
    options: {},
    currency: 'KRW',
    evidence: 'review-required',
  };
}

function catalog(
  products: CatalogProduct[],
  prices: Record<string, string> = {},
  sameSource = true,
): Catalog {
  return buildCatalog(
    { schemaVersion: 1, generatedOn: '2026-10-04', sourceSha256: SHA, products },
    {
      schemaVersion: 1,
      generatedOn: '2026-10-04',
      sourceSha256: sameSource ? SHA : 'b'.repeat(64),
      currency: 'KRW',
      prices: Object.fromEntries(
        Object.entries(prices).map(([sku, v]) => [sku, { sellingUnitPrice: v, currency: 'KRW' }]),
      ),
    },
  );
}

const base = () =>
  catalog(
    [
      product('VID-0138', 'UHD Matrix Frame', 'XDM-12'),
      product('VID-0009', 'HD PTZ Camera', 'SRG-X40UH'),
    ],
    { 'VID-0138': '5300000' },
  );

describe('normalizeModel', () => {
  it('대문자화하고 구분 기호를 없앤다', () => {
    expect(normalizeModel('XDM-CTR100')).toBe('XDMCTR100');
    expect(normalizeModel('xdm ctr 100')).toBe('XDMCTR100');
    expect(normalizeModel('XDM_CTR/100')).toBe('XDMCTR100');
  });

  it('괄호·쉼표·따옴표도 없앤다 — 실물 카탈로그에 섞여 있다', () => {
    expect(normalizeModel('P1.5 346인치(9X3)')).toBe('P15346인치9X3');
  });

  it('글자 X를 지우지 않는다 — 지우면 XDM-12가 DM12가 된다', () => {
    expect(normalizeModel('XDM-12')).toBe('XDM12');
    expect(normalizeModel('XRN-820S')).toBe('XRN820S');
    expect(normalizeModel('LS49CG954EKXKR')).toBe('LS49CG954EKXKR');
  });

  it('곱셈 기호는 지우지 않고 X로 바꾼다 — 지우면 9×3이 93이 된다', () => {
    expect(normalizeModel('9×3')).toBe('9X3');
    expect(normalizeModel('9x3')).toBe('9X3');
    expect(normalizeModel('9×3')).toBe(normalizeModel('9X3'));
  });
});

describe('matchByModel — 붙는 경우', () => {
  it('모델명이 정확히 같으면 붙는다', () => {
    const r = matchByModel('XDM-12', base());
    expect(r.product?.sku).toBe('VID-0138');
    expect(r.sellingUnitPrice).toBe('5300000');
    expect(r.matchedBy).toBe('model-exact');
  });

  it('하이픈·공백·대소문자 차이를 넘어 붙는다', () => {
    expect(matchByModel('xdm 12', base()).product?.sku).toBe('VID-0138');
    expect(matchByModel('XDM12', base()).matchedBy).toBe('model-normalized');
  });

  it('앞뒤 공백을 무시한다', () => {
    expect(matchByModel('  XDM-12  ', base()).product?.sku).toBe('VID-0138');
  });
});

describe('matchByModel — 미등록 가격 (설계서 §5.6)', () => {
  it('단가가 없는 제품은 sellingUnitPrice가 undefined다 — 0이 아니다', () => {
    const r = matchByModel('SRG-X40UH', base());
    expect(r.product?.sku).toBe('VID-0009');
    expect(r.sellingUnitPrice).toBeUndefined();
    expect(r.sellingUnitPrice).not.toBe('0');
  });

  it('가격 파일이 없을 때도 제품은 붙고 단가만 비어 있다 — 결정 D3', () => {
    const noPrices = buildCatalog({
      schemaVersion: 1,
      generatedOn: '2026-10-04',
      sourceSha256: SHA,
      products: [product('VID-0138', 'UHD Matrix Frame', 'XDM-12')],
    });
    expect(noPrices.pricesAvailable).toBe(false);
    const r = matchByModel('XDM-12', noPrices);
    expect(r.product?.sku).toBe('VID-0138');
    expect(r.sellingUnitPrice).toBeUndefined();
  });

  it('명시적인 0원은 0원으로 붙는다 — 미등록과 구분한다', () => {
    const withZero = catalog([product('VID-0138', 'UHD Matrix Frame', 'XDM-12')], {
      'VID-0138': '0',
    });
    expect(matchByModel('XDM-12', withZero).sellingUnitPrice).toBe('0');
  });
});

describe('matchByModel — 붙이지 않는 경우', () => {
  it('카탈로그에 없으면 product가 undefined다 — 행은 호출부가 만든다', () => {
    const r = matchByModel('D-Cerno AE', base());
    expect(r.product).toBeUndefined();
    expect(r.matchedBy).toBe('none');
  });

  it('부분일치로 붙이지 않는다 — MR-4S가 MR-4S-4K에 붙으면 다른 제품이 된다', () => {
    const c = catalog([product('X-1', '모듈러 프레임', 'MR-4S-4K')]);
    expect(matchByModel('MR-4S', c).matchedBy).toBe('none');
  });

  it('반대 방향 부분일치도 막는다', () => {
    const c = catalog([product('X-1', '모듈러 프레임', 'MR-4S')]);
    expect(matchByModel('MR-4S-4K', c).matchedBy).toBe('none');
  });

  it('model이 없으면 none이다', () => {
    expect(matchByModel(undefined, base()).matchedBy).toBe('none');
    expect(matchByModel('', base()).matchedBy).toBe('none');
    expect(matchByModel('   ', base()).matchedBy).toBe('none');
  });

  it('너무 짧은 모델명은 정규화 매칭을 하지 않는다 — 우연히 맞을 수 있다', () => {
    const c = catalog([product('X-1', '무엇', 'A-1')]);
    // 글자 그대로 같으면 붙는다
    expect(matchByModel('A-1', c).matchedBy).toBe('model-exact');
    // 정규화해야만 같아지는 경우는 붙이지 않는다
    expect(matchByModel('A1', c).matchedBy).toBe('none');
  });

  it('같은 모델명이 여러 제품에 걸리면 붙이지 않고 후보를 보고한다', () => {
    const c = catalog([
      product('VID-0006', '케이블 A', 'HDMI-5M'),
      product('CBL-0006', '케이블 B', 'HDMI-5M'),
    ]);
    const r = matchByModel('HDMI-5M', c);
    expect(r.matchedBy).toBe('none');
    expect(r.product).toBeUndefined();
    expect(r.ambiguousSkus).toEqual(['VID-0006', 'CBL-0006']);
  });

  it('정규화해서 여러 개에 걸려도 붙이지 않는다', () => {
    const c = catalog([
      product('A-0001', 'A', 'XDM-CTR100'),
      product('B-0001', 'B', 'XDMCTR100'),
    ]);
    const r = matchByModel('xdm ctr 100', c);
    expect(r.matchedBy).toBe('none');
    expect(r.ambiguousSkus).toHaveLength(2);
  });
});

describe('buildCatalog — 가격 파일 처리 (결정 D3)', () => {
  it('가격 파일이 없으면 pricesAvailable이 false다. 던지지 않는다', () => {
    const c = buildCatalog({
      schemaVersion: 1,
      generatedOn: '2026-10-04',
      sourceSha256: SHA,
      products: [],
    });
    expect(c.pricesAvailable).toBe(false);
    expect(c.pricesUnavailableReason).toContain('없다');
  });

  it('가격 파일이 깨져 있어도 던지지 않는다', () => {
    const c = buildCatalog(
      { schemaVersion: 1, generatedOn: '2026-10-04', sourceSha256: SHA, products: [] },
      { 엉뚱한: '구조' },
    );
    expect(c.pricesAvailable).toBe(false);
    expect(c.pricesUnavailableReason).toContain('형식');
  });

  it('제품과 가격이 다른 원본이면 섞어 쓰지 않는다 (설계서 §6.3)', () => {
    const c = catalog([product('VID-0138', 'A', 'XDM-12')], { 'VID-0138': '1' }, false);
    expect(c.pricesAvailable).toBe(false);
    expect(c.pricesUnavailableReason).toContain('다른 원본');
    expect(c.prices.size).toBe(0);
  });

  it('제품 파일이 깨져 있으면 던진다 — 제품 없이는 아무것도 못 한다', () => {
    expect(() => buildCatalog({ 엉뚱한: '구조' })).toThrow();
  });
});

describe('matchByModel — `/`로 묶인 모델명 (실측 22건 구제)', () => {
  const lfd = () =>
    catalog([product('TVD-0029', '삼성 98인치 LFD', 'LH98QMCEBGCXKR')], {
      'TVD-0029': '4200000',
    });

  it('조각 하나가 정확히 맞으면 붙는다 — 실물 구성도의 디스플레이', () => {
    const r = matchByModel('98인치 / LH98QMCEBGCXKR', lfd());
    expect(r.product?.sku).toBe('TVD-0029');
    expect(r.matchedBy).toBe('model-fragment');
    expect(r.matchedFragment).toBe('LH98QMCEBGCXKR');
    expect(r.sellingUnitPrice).toBe('4200000');
  });

  it('어느 조각이 맞았는지 남긴다 — 사람이 검토할 근거', () => {
    expect(matchByModel('98인치 / LH98QMCEBGCXKR', lfd()).matchedFragment).toBe(
      'LH98QMCEBGCXKR',
    );
  });

  it('맞는 조각이 없으면 붙이지 않는다', () => {
    expect(matchByModel('32인치 / 없는모델XYZ', lfd()).matchedBy).toBe('none');
  });

  it('조각 둘이 서로 다른 제품에 맞으면 붙이지 않는다', () => {
    const c = catalog([
      product('A-0001', '제품 A', 'MODEL-AAAA'),
      product('B-0001', '제품 B', 'MODEL-BBBB'),
    ]);
    const r = matchByModel('MODEL-AAAA / MODEL-BBBB', c);
    expect(r.matchedBy).toBe('none');
    expect(r.ambiguousSkus).toEqual(['A-0001', 'B-0001']);
  });

  it('`/`가 없으면 조각 매칭을 하지 않는다 — 부분일치가 아니다', () => {
    const c = catalog([product('X-1', '모듈러 프레임', 'MR-4S-4K')]);
    expect(matchByModel('MR-4S', c).matchedBy).toBe('none');
  });

  it('너무 짧은 조각은 무시한다', () => {
    const c = catalog([product('X-1', '무엇', 'AB')]);
    expect(matchByModel('AB / 없는것', c).matchedBy).toBe('none');
  });

  it('조각이 여럿이어도 같은 제품을 가리키면 붙는다', () => {
    const c = catalog([product('TVD-0029', '삼성 98인치 LFD', 'LH98QMCEBGCXKR')]);
    const r = matchByModel('LH98QMCEBGCXKR / LH98QMCEBGCXKR', c);
    expect(r.product?.sku).toBe('TVD-0029');
  });
});

/**
 * 품명·규격·설명 안에 섞여 있는 모델명 찾기 (계획 2026-10-06).
 *
 * `12배줌, BRC-H800`처럼 품명에 모델명이 섞여 있으면 1~3단계가 못 찾는다.
 * 4단계는 그런 경우를 **후보로만** 올린다. **자동으로 붙이지 않는다** —
 * 설명 칸에는 `CR-N700전용`처럼 **다른 제품의 모델명**이 적혀 있기 때문이다.
 */
function productWith(
  sku: string,
  quoteName: string,
  quoteSpec: string,
  description?: string,
): CatalogProduct {
  const p = product(sku, quoteName, quoteSpec);
  return description === undefined ? p : { ...p, options: { description } };
}

describe('4단계 — 이름 안에서 모델명 찾기', () => {
  it('품명에 섞여 있어도 후보로 올린다 — `12배줌, BRC-H800`', () => {
    const c = catalog([productWith('VID-0006', '1" Exmor R PTZ Camera', '12배줌, BRC-H800')]);
    const r = matchByModel('BRC-H800', c);
    expect(r.nameCandidates?.map((x) => x.sku)).toEqual(['VID-0006']);
  });

  it('후보를 올려도 제품과 단가를 채우지 않는다 — 사람이 고른다', () => {
    const c = catalog(
      [productWith('VID-0006', '1" Exmor R PTZ Camera', '12배줌, BRC-H800')],
      { 'VID-0006': '3552000' },
    );
    const r = matchByModel('BRC-H800', c);
    expect(r.product).toBeUndefined();
    expect(r.sellingUnitPrice).toBeUndefined();
    expect(r.matchedBy).toBe('none');
  });

  it('설명 칸에만 있어도 후보로 올린다 — `2분배기` / 설명 `WJD-2DV`', () => {
    const c = catalog([productWith('HEC-0031', 'CATV 분배기', '2분배기', 'WJD-2DV')]);
    const r = matchByModel('WJD-2DV', c);
    expect(r.nameCandidates?.map((x) => x.sku)).toEqual(['HEC-0031']);
  });

  it('어느 칸에서 맞았는지 남긴다 — 사람이 판단할 근거다', () => {
    const c = catalog([productWith('HEC-0031', 'CATV 분배기', '2분배기', 'WJD-2DV')]);
    expect(matchByModel('WJD-2DV', c).nameCandidates?.[0]?.fields).toEqual(['description']);
  });

  it('여러 칸에서 맞아도 후보는 한 번만 올리고 칸은 전부 남긴다', () => {
    const c = catalog([productWith('AUD-0045', 'Digital Signal Processor', 'BLU-101, AEC/Bluelink지원')]);
    const r = matchByModel('BLU-101', c);
    expect(r.nameCandidates).toHaveLength(1);
    expect(r.nameCandidates?.[0]?.fields).toEqual(['model', 'quoteSpec']);
  });

  /**
   * ⚠ 이 시험은 **경계 규칙을 검증하지 않는다.** `MR-4S`는 정규화하면 `MR4S`
   * 4글자라 `MIN_KEY_LENGTH`(5)에 막혀 4단계에 오지도 않는다. 경계 검증은
   * 아래 `VTX-A8` 시험이 한다. 여기서는 **길이 제한이 살아 있는지**만 본다.
   */
  it('길이 제한에 막혀 4단계에 오지 않는다 — `MR-4S` (정규화 4글자)', () => {
    const c = catalog([productWith('X-1', '모듈러 프레임', 'MR-4S-4K')]);
    const r = matchByModel('MR-4S', c);
    expect(r.product).toBeUndefined();
    expect(r.nameCandidates).toBeUndefined();
  });

  /**
   * **경계 규칙을 실제로 검증하는 시험.** `VTX-A8`은 정규화해도 5글자라
   * 4단계까지 온다. 경계에서 `-`를 빼면 이 시험이 실패한다(역방향 확인함).
   *
   * 실물: AUD-0289 `VTX A8` / AUD-0291 `VTX-A8-AF` — 서로 다른 제품이다.
   */
  it('뒤에 다른 글자가 붙은 제품에 걸리지 않는다 — `VTX-A8` vs `VTX-A8-AF`', () => {
    const c = catalog([productWith('AUD-0291', '라인어레이', 'VTX-A8-AF')]);
    expect(matchByModel('VTX-A8', c).nameCandidates).toBeUndefined();
  });

  /**
   * 기호를 전부 지우고 포함 관계만 보면 `loc(kinghd)micable`에 걸린다.
   * 원문에서 찾으므로 `g`와 `HD` 사이의 공백이 남아 걸리지 않는다.
   * **경계 규칙이 아니라 "원문에서 찾는다"는 설계를 지키는 시험이다.**
   */
  it('단어 내부에 우연히 들어 있어도 걸리지 않는다 — `KIN-GHD` vs `Locking HDMI Cable`', () => {
    const c = catalog([productWith('CBL-0016', 'Locking HDMI Cable 1m', 'UMC-001')]);
    expect(matchByModel('KIN-GHD', c).nameCandidates).toBeUndefined();
  });

  it('숫자가 앞에 붙은 다른 값에 걸리지 않는다 — `24인치모니터` vs `124인치모니터`', () => {
    const c = catalog([productWith('TVD-9999', '모니터', '삼성 124인치모니터')]);
    expect(matchByModel('24인치모니터', c).nameCandidates).toBeUndefined();
  });

  it('한글이 앞에 붙은 다른 값에 걸리지 않는다 — `대형모니터` vs `초대형모니터`', () => {
    const c = catalog([productWith('TVD-9998', '디스플레이', '삼성 초대형모니터')]);
    expect(matchByModel('대형모니터', c).nameCandidates).toBeUndefined();
  });

  it('1~3단계가 이미 붙였으면 4단계로 가지 않는다', () => {
    const c = catalog([
      productWith('VID-0138', 'UHD Matrix Frame', 'XDM-12'),
      productWith('VID-0139', 'Dante Module', 'XDM-DAN-M36', 'XDM-12, 20, 36 동일 적용'),
    ]);
    const r = matchByModel('XDM-12', c);
    expect(r.product?.sku).toBe('VID-0138');
    expect(r.nameCandidates).toBeUndefined();
  });

  it('1~3단계가 모호로 끝났으면 4단계로 좁히지 않는다', () => {
    const c = catalog([
      productWith('A-0001', '제품 A', 'SAME-MODEL'),
      productWith('B-0001', '제품 B', 'SAME-MODEL'),
    ]);
    const r = matchByModel('SAME-MODEL', c);
    expect(r.ambiguousSkus).toEqual(['A-0001', 'B-0001']);
    expect(r.nameCandidates).toBeUndefined();
  });

  it('너무 짧은 모델명은 4단계로 가지 않는다', () => {
    const c = catalog([productWith('X-1', '무엇', '어떤 AB 제품')]);
    expect(matchByModel('AB', c).nameCandidates).toBeUndefined();
  });
});
