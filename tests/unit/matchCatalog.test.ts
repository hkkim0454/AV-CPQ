import { describe, expect, it } from 'vitest';
import { isDescriptionOnlyCandidate, matchByModel, normalizeModel } from '@/import/diagram/matchCatalog';
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
 * 계획 2026-10-06 모델명 기준 대조 3판 Task 1.
 *
 * 1~3 단계가 모두 못 찾았을 때만 도는 **네 번째 단계**다. 이 단계는
 * **후보만 올리고 자동으로 연결하지 않는다**(계획 §6) — `24인치 모니터`
 * 처럼 모델명이 아니라 일반 명칭인 경우가 있어서, 1건만 맞았다는 것이
 * 그 제품이라는 근거가 되지 않는다.
 */
describe('matchByModel — 4단계 모델명 검색 (후보 제시만 한다)', () => {
  it('BRC-H800 이 `12배줌, BRC-H800` 을 후보로 올린다 — 자동 연결하지는 않는다', () => {
    // 실물 카탈로그 VID-0006 의 값 그대로다.
    const c = catalog([product('VID-0006', '1" Exmor R PTZ Camera', '12배줌, BRC-H800')], {
      'VID-0006': '7000000',
    });

    const r = matchByModel('BRC-H800', c);

    // 후보로만 오른다 — 제품도 단가도 붙지 않는다.
    expect(r.product).toBeUndefined();
    expect(r.sellingUnitPrice).toBeUndefined();
    expect(r.matchedBy).toBe('model-search');
    expect(r.modelSearchCandidates?.map((x) => x.sku)).toEqual(['VID-0006']);
  });
});

/** 설명 칸까지 채울 수 있는 제품. 기존 `product()`는 options가 비어 있다. */
function productWith(
  sku: string,
  fields: {
    quoteName?: string;
    quoteSpec?: string;
    model?: string;
    description?: string;
  },
): CatalogProduct {
  // 스키마가 품명·규격에 최소 1글자를 요구한다. 검색에 걸리지 않을 기본값을 둔다.
  const spec = fields.quoteSpec ?? '규격없음';
  return {
    productId: sku,
    sku,
    brand: '',
    model: fields.model ?? spec,
    quoteName: fields.quoteName ?? '이름없음',
    quoteSpec: spec,
    unit: 'EA',
    options: fields.description !== undefined ? { description: fields.description } : {},
    currency: 'KRW',
    evidence: 'review-required',
  };
}

/** 계획 §4-3 검증표 8건을 그대로 옮긴 것이다. */
describe('4단계 — 계획 §4-3 검증표', () => {
  it('접미사가 붙은 다른 제품에 걸리지 않는다 — MR-4S / MR-4S-4K', () => {
    const c = catalog([product('X-1', '모듈러 프레임', 'MR-4S-4K')]);
    const r = matchByModel('MR-4S', c);
    expect(r.matchedBy).toBe('none');
    expect(r.modelSearchCandidates).toBeUndefined();
  });

  it('접두사가 붙은 다른 제품에 걸리지 않는다 — A40 / SRG-A40', () => {
    const c = catalog([product('X-1', 'PTZ 카메라', 'SRG-A40')]);
    expect(matchByModel('A40', c).modelSearchCandidates).toBeUndefined();
  });

  it('숫자 경계를 지킨다 — CS10 / CS100', () => {
    const c = catalog([product('X-1', '스피커', 'CS100')]);
    expect(matchByModel('CS10', c).modelSearchCandidates).toBeUndefined();
  });

  it('숫자 경계를 지킨다 — 24인치 / 124인치', () => {
    const c = catalog([product('X-1', '모니터', '124인치')]);
    expect(matchByModel('24인치', c).modelSearchCandidates).toBeUndefined();
  });

  it('단어 내부에 걸리지 않는다 — KIN-GHD / Locking HDMI Cable', () => {
    const c = catalog([product('X-1', '케이블', 'Locking HDMI Cable')]);
    expect(matchByModel('KIN-GHD', c).modelSearchCandidates).toBeUndefined();
  });

  it('정상 — MR-4S 는 MR-4S 에 붙는다 (1단계 exact. 4단계가 아니다)', () => {
    const c = catalog([product('X-1', '모듈러 프레임', 'MR-4S')]);
    const r = matchByModel('MR-4S', c);
    expect(r.matchedBy).toBe('model-exact');
    expect(r.product?.sku).toBe('X-1');
  });

  it('정상 — BRC-H800 이 `12배줌, BRC-H800` 에서 걸린다', () => {
    const c = catalog([product('VID-0006', 'PTZ 카메라', '12배줌, BRC-H800')]);
    expect(matchByModel('BRC-H800', c).modelSearchCandidates?.map((x) => x.sku)).toEqual(['VID-0006']);
  });

  it('정상 — BLU-101 이 `BLU-101, AEC/Bluelink지원` 에서 걸린다', () => {
    const c = catalog([product('AUD-0001', '프로세서', 'BLU-101, AEC/Bluelink지원')]);
    expect(matchByModel('BLU-101', c).modelSearchCandidates?.map((x) => x.sku)).toEqual(['AUD-0001']);
  });
});

/**
 * ⚠ 위 표의 부정 사례 넷(MR-4S·A40·CS10·24인치)은 **4단계에 도달하지도 못한다** —
 * 정규화 키가 `MIN_KEY_LENGTH`(5)보다 짧아 2단계 앞에서 끊긴다(계획 §4-5). 즉 위
 * 시험들은 "최종 결과가 안전하다"는 것은 증명하지만 **경계 규칙 자체는 건드리지
 * 않는다.** 경계 규칙을 실제로 시험하려면 키가 5자 이상이어야 한다.
 */
describe('4단계 — 경계 규칙 자체 (키 5자 이상이라 4단계에 실제로 도달한다)', () => {
  it('접미사 — MR-4S-4K 가 MR-4S-4K-PRO 에 걸리지 않는다', () => {
    const c = catalog([product('X-1', '프레임', 'MR-4S-4K-PRO')]);
    expect(matchByModel('MR-4S-4K', c).modelSearchCandidates).toBeUndefined();
  });

  it('접두사 — SRG-A40 이 XSRG-A40 에 걸리지 않는다', () => {
    const c = catalog([product('X-1', '카메라', 'XSRG-A40')]);
    expect(matchByModel('SRG-A40', c).modelSearchCandidates).toBeUndefined();
  });

  it('숫자 경계 — CS1000 이 CS10000 에 걸리지 않는다', () => {
    const c = catalog([product('X-1', '스피커', 'CS10000')]);
    expect(matchByModel('CS1000', c).modelSearchCandidates).toBeUndefined();
  });

  it('하이픈은 경계가 아니다 — BRC-H800 이 BRC-H800-X 에 걸리지 않는다', () => {
    const c = catalog([product('X-1', '카메라', 'BRC-H800-X')]);
    expect(matchByModel('BRC-H800', c).modelSearchCandidates).toBeUndefined();
  });

  it('구분자 차이는 넘는다 — `12배줌, BRC H800`·`12배줌(BRCH800)` 에 걸린다', () => {
    // 바깥에 다른 글자가 붙어 있어야 4단계까지 온다. 붙은 글자가 없으면
    // `BRC H800`·`BRCH800` 은 2단계 정규화에서 이미 자동 연결된다.
    expect(
      matchByModel('BRC-H800', catalog([product('X-1', '카메라', '12배줌, BRC H800')])).modelSearchCandidates,
    ).toHaveLength(1);
    expect(
      matchByModel('BRC-H800', catalog([product('X-1', '카메라', '12배줌(BRCH800)')])).modelSearchCandidates,
    ).toHaveLength(1);
  });

  it('대소문자를 구분하지 않는다', () => {
    const c = catalog([product('X-1', '카메라', '12배줌, brc-h800')]);
    expect(matchByModel('BRC-H800', c).modelSearchCandidates).toHaveLength(1);
  });

  it('⚠ 한글은 경계로 인정하지 않는다 — 모니터패널 이 대형모니터패널 에 걸린다', () => {
    // 계획 §4-2 의 경계 집합에 한글이 없다. 이것은 **현재 동작을 고정한 것**이지
    // 바람직하다고 판정한 것이 아니다. 4단계는 후보만 제시하므로 과잉 후보의
    // 비용은 사람의 검토 한 번이다.
    const c = catalog([product('X-1', '모니터', '대형모니터패널')]);
    expect(matchByModel('모니터패널', c).modelSearchCandidates?.map((x) => x.sku)).toEqual(['X-1']);
  });
});

/** 계획 Task 2 의 시험 네 개. */
describe('4단계 — 자동 연결로 번지지 않는다 (계획 Task 2)', () => {
  it('1. 기존 정확한 일치가 있으면 그 결과를 유지하고 4단계로 넘어가지 않는다', () => {
    const c = catalog(
      [
        product('VID-0138', 'UHD Matrix Frame', 'XDM-12'),
        productWith('VID-0139', { quoteSpec: 'XDM-DAN-M36', description: 'XDM-12, 20, 36 동일 적용' }),
      ],
      { 'VID-0138': '5300000' },
    );

    const r = matchByModel('XDM-12', c);

    expect(r.matchedBy).toBe('model-exact');
    expect(r.product?.sku).toBe('VID-0138');
    expect(r.sellingUnitPrice).toBe('5300000');
    // 설명 칸에 XDM-12 를 품은 부속품이 후보로 섞여 들지 않는다.
    expect(r.modelSearchCandidates).toBeUndefined();
  });

  it('2. 설명 칸에서만 찾은 것은 후보에만 오르고 product·단가는 비어 있다', () => {
    const c = catalog(
      [productWith('VID-0139', { quoteSpec: 'XDM-DAN-M36', description: 'XDM-99, 20, 36 동일 적용' })],
      { 'VID-0139': '1200000' },
    );

    const r = matchByModel('XDM-99', c);

    expect(r.matchedBy).toBe('model-search');
    expect(r.product).toBeUndefined();
    expect(r.sellingUnitPrice).toBeUndefined();
    const candidate = r.modelSearchCandidates?.[0];
    expect(candidate?.sku).toBe('VID-0139');
    expect(candidate?.matches.map((m) => m.field)).toEqual(['description']);
    expect(candidate !== undefined && isDescriptionOnlyCandidate(candidate)).toBe(true);
  });

  it('3. WJD-2DV 가 HEC-0031 을 후보로 올린다 — 설명 칸이다', () => {
    // 실물 카탈로그 HEC-0031 의 값 그대로다. 설명 칸을 검색에서 빼면 이 5건을 놓친다.
    const c = catalog([
      productWith('HEC-0031', { quoteName: 'CATV 분배기', quoteSpec: '2분배기', description: 'WJD-2DV' }),
      productWith('HEC-0032', { quoteName: 'CATV 분배기', quoteSpec: '4분배기', description: 'WJD-4DV' }),
    ]);

    const r = matchByModel('WJD-2DV', c);

    expect(r.product).toBeUndefined();
    expect(r.modelSearchCandidates?.map((x) => x.sku)).toEqual(['HEC-0031']);
  });

  it('4. BRC-H800 이 VID-0006 을 후보로 올린다 — 맞은 칸과 맞은 글자를 담는다', () => {
    const c = catalog([productWith('VID-0006', { quoteName: 'PTZ 카메라', quoteSpec: '12배줌, BRC-H800' })]);

    const candidate = matchByModel('BRC-H800', c).modelSearchCandidates?.[0];

    expect(candidate?.sku).toBe('VID-0006');
    // model 과 quoteSpec 이 같은 값이라 두 칸 모두에서 맞는다 — 한 번만 오르고 칸은 전부 남는다.
    expect(candidate?.matches.map((m) => m.field)).toEqual(['model', 'quoteSpec']);
    expect(candidate?.matches.map((m) => m.text)).toEqual(['BRC-H800', 'BRC-H800']);
    expect(candidate !== undefined && isDescriptionOnlyCandidate(candidate)).toBe(false);
  });

  it('1~3 단계가 후보를 여럿 찾은 상태는 4단계로 넘기지 않는다 — 사람에게 묻는 상태를 유지한다', () => {
    const c = catalog([
      productWith('A-0001', { quoteSpec: 'HDMI-5M' }),
      productWith('B-0001', { quoteSpec: 'HDMI-5M' }),
      productWith('C-0001', { quoteSpec: '다른제품', description: 'HDMI-5M 전용' }),
    ]);

    const r = matchByModel('HDMI-5M', c);

    expect(r.matchedBy).toBe('none');
    expect(r.ambiguousSkus).toEqual(['A-0001', 'B-0001']);
    expect(r.modelSearchCandidates).toBeUndefined();
  });

  it('너무 짧은 모델명은 4단계에도 오지 않는다 (계획 §4-5)', () => {
    const c = catalog([product('X-1', '무엇', '어떤 A1 짜리 제품')]);
    expect(matchByModel('A1', c).matchedBy).toBe('none');
    expect(matchByModel('A1', c).modelSearchCandidates).toBeUndefined();
  });

  it('후보가 여럿이면 전부 올린다 — 건수와 무관하게 자동 연결하지 않는다 (계획 §6)', () => {
    const c = catalog(
      [
        productWith('TVD-0056', { quoteName: '24인치 모니터', quoteSpec: '삼성, 24인치' }),
        productWith('TVD-0057', { quoteName: '24인치 모니터 거치형', quoteSpec: 'LG' }),
      ],
      { 'TVD-0056': '300000' },
    );

    const r = matchByModel('24인치 모니터', c);

    expect(r.product).toBeUndefined();
    expect(r.sellingUnitPrice).toBeUndefined();
    expect(r.modelSearchCandidates?.map((x) => x.sku)).toEqual(['TVD-0056', 'TVD-0057']);
  });
});
