/**
 * 품셈 교체 Task 2 — 검증을 추출에 넣는다.
 *
 * 두 가지를 본다.
 *
 * 1. **반기 표기**를 원시 덤프에서 읽어 명시적으로 넘긴다. 기본값
 *    (`'26년 상반기'`)에 기대면 하반기 자료에 상반기 이름이 붙는다.
 * 2. **노무비 역산** — `(공수 × 노임) 합계 × 품목별 요율 × (1 + 할증)` 이
 *    원본이 적어 둔 노무비 단가와 맞는지 전 행을 분류한다.
 *    `미검증`을 통과로 세지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { verifyLaborRows, compareGuideWages, type LaborVerdict } from '@/data/catalog/verifyLabor';
import { prepareApprovedFiles } from '../../tools/build-approved';
import type { RawCatalog, RawSheet } from '@/data/catalog/rawTypes';

const SHA = 'a'.repeat(64);

const WAGES: RawSheet['wages'] = [
  { trade: '통신설비공', unit: 'M/D', amount: '300000', quantityColumn: 'X' },
  { trade: '보통인부', unit: 'M/D', amount: '100000', quantityColumn: 'Z' },
];

/** 공수 0.5×300000 + 0.1×100000 = 160000. 요율 0.5 → 80000. 할증 0 → 80000. */
function verifiableRow(over: Partial<RawSheet['rows'][number]> = {}): RawSheet['rows'][number] {
  return {
    row: 6,
    name: '합성 품목',
    unit: 'EA',
    materialUnitPrice: '654000',
    laborCode: '9-2-1-1-합성',
    itemRate: '0.5',
    surcharge: '0',
    laborUnitPrice: '80000',
    trades: [
      { trade: '통신설비공', quantity: '0.5' },
      { trade: '보통인부', quantity: '0.1' },
    ],
    ...over,
  };
}

function sheetOf(rows: RawSheet['rows'], wages = WAGES): RawSheet {
  return { name: 'CCTV', wages, rows };
}

/** `periodLabel` 을 넘기지 않으면 **덤프에 반기가 없는** 상태를 만든다. */
function catalogOf(rows: RawSheet['rows'], periodLabel?: string): RawCatalog {
  return {
    schemaVersion: 1,
    source: { sha256: SHA, extractedOn: '2026-10-05', ...(periodLabel === undefined ? {} : { periodLabel }) },
    sheets: [sheetOf(rows)],
  };
}

const withPeriod = (rows: RawSheet['rows']) => catalogOf(rows, '26년 하반기');

function verdictOf(row: RawSheet['rows'][number]): LaborVerdict {
  const result = verifyLaborRows([sheetOf([row])]);
  return result.rows[0]!.verdict;
}

// ---------------------------------------------------------------------------
describe('반기 표기 — 기본값에 기대지 않는다', () => {
  it('원시 덤프에 반기가 없으면 아무것도 쓰지 않고 중단한다', () => {
    const prepared = prepareApprovedFiles(catalogOf([verifiableRow()]));
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.reason).toContain('반기');
  });

  it('원시 덤프의 반기를 노임표에 그대로 적는다 — 상반기 기본값이 붙지 않는다', () => {
    const prepared = prepareApprovedFiles(withPeriod([verifiableRow()]));
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.labor.wageTable.periodLabel).toBe('26년 하반기');
    expect(prepared.labor.wageTable.wageTableId).toBe('WAGE-26년 하반기');
  });
});

// ---------------------------------------------------------------------------
describe('노무비 역산 — 전 행을 네 갈래로 분류한다', () => {
  it('산식이 맞으면 통과다', () => {
    expect(verdictOf(verifiableRow())).toBe('통과');
  });

  it('할증은 ×할증이 아니라 ×(1+할증)이다', () => {
    // 할증 0.2 → 80000 × 1.2 = 96000. `×할증`이면 16000이 되어 틀린다.
    expect(verdictOf(verifiableRow({ surcharge: '0.2', laborUnitPrice: '96000' }))).toBe('통과');
    expect(verdictOf(verifiableRow({ surcharge: '0.2', laborUnitPrice: '16000' }))).toBe('불일치');
  });

  it('산식 결과가 원본과 다르면 불일치다', () => {
    expect(verdictOf(verifiableRow({ laborUnitPrice: '80001' }))).toBe('불일치');
  });

  it('요율이 0인 행은 통과로 세지 않는다 — 0을 곱하면 무엇을 넣어도 맞는다', () => {
    expect(verdictOf(verifiableRow({ itemRate: '0', laborUnitPrice: '0' }))).toBe('미검증');
  });

  it('공수·요율·노무비 중 하나라도 없으면 미검증이다', () => {
    expect(verdictOf(verifiableRow({ trades: [] }))).toBe('미검증');
    const { itemRate: _rate, ...noRate } = verifiableRow();
    expect(verdictOf(noRate as RawSheet['rows'][number])).toBe('미검증');
    const { laborUnitPrice: _price, ...noPrice } = verifiableRow();
    expect(verdictOf(noPrice as RawSheet['rows'][number])).toBe('미검증');
  });

  it('품셈 코드도 공수도 없는 행은 비대상이다 — 제목 행까지 미검증으로 세지 않는다', () => {
    expect(verdictOf({ row: 4, name: '[ 영상 ]' })).toBe('비대상');
  });

  it('네 갈래의 합이 전체 행 수와 맞는다', () => {
    const rows = [
      verifiableRow({ row: 6 }),
      verifiableRow({ row: 7, laborUnitPrice: '80001' }),
      verifiableRow({ row: 8, trades: [] }),
      { row: 9, name: '[ 분류 머리글 ]' },
    ];
    const result = verifyLaborRows([sheetOf(rows)]);
    const { 통과, 불일치, 미검증, 비대상 } = result.counts;
    expect(통과 + 불일치 + 미검증 + 비대상).toBe(rows.length);
    expect(result.counts).toMatchObject({ 통과: 1, 불일치: 1, 미검증: 1, 비대상: 1 });
  });

  it('미검증은 이유별로 나눠 센다', () => {
    const rows = [
      verifiableRow({ row: 6, trades: [] }),
      verifiableRow({ row: 7, itemRate: '0', laborUnitPrice: '0' }),
    ];
    const result = verifyLaborRows([sheetOf(rows)]);
    expect(Object.values(result.unverifiedReasons).reduce((a, b) => a + b, 0)).toBe(2);
    expect(Object.keys(result.unverifiedReasons).length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
describe('수식 캐시를 믿을 수 있는지 — 눈으로 확인되는 조건만 쓴다', () => {
  it('수식이 있는데 캐시가 없으면 미검증이다', () => {
    const { laborUnitPrice: _p, ...rest } = verifiableRow();
    expect(verdictOf({ ...rest, laborUnitPriceFormula: '=V6*T6' } as RawSheet['rows'][number])).toBe('미검증');
  });

  it('수식의 캐시값이 있으면 그 값으로 대조한다', () => {
    const { laborUnitPrice: _p, ...rest } = verifiableRow();
    const row = { ...rest, laborUnitPriceFormula: '=V6*T6', laborUnitPriceCached: '80000' };
    expect(verdictOf(row as RawSheet['rows'][number])).toBe('통과');
  });

  it('외부 통합문서를 참조하는 수식은 캐시가 있어도 미검증이다', () => {
    const { laborUnitPrice: _p, ...rest } = verifiableRow();
    const row = { ...rest, laborUnitPriceFormula: "='[2]영상'!V6", laborUnitPriceCached: '80000' };
    expect(verdictOf(row as RawSheet['rows'][number])).toBe('미검증');
  });

  it('오류값(#REF!·#VALUE!)은 미검증이다', () => {
    for (const bad of ['#REF!', '#VALUE!', '#N/A']) {
      const { laborUnitPrice: _p, ...rest } = verifiableRow();
      const row = { ...rest, laborUnitPriceFormula: '=V6*T6', laborUnitPriceCached: bad };
      expect(verdictOf(row as RawSheet['rows'][number])).toBe('미검증');
    }
  });
});

// ---------------------------------------------------------------------------
describe('역방향 — 이 검증이 죽어 있지 않다는 증거', () => {
  it('노임을 한 칸 밀면(직종이 어긋나면) 역산이 걸린다', () => {
    const shifted: RawSheet['wages'] = [
      { trade: '통신설비공', unit: 'M/D', amount: '100000', quantityColumn: 'X' },
      { trade: '보통인부', unit: 'M/D', amount: '300000', quantityColumn: 'Z' },
    ];
    const result = verifyLaborRows([sheetOf([verifiableRow()], shifted)]);
    expect(result.rows[0]!.verdict).toBe('불일치');
  });

  it('셀 하나만 바꿔도 걸린다 — 공수 끝자리 하나', () => {
    const row = verifiableRow({
      trades: [
        { trade: '통신설비공', quantity: '0.51' },
        { trade: '보통인부', quantity: '0.1' },
      ],
    });
    expect(verdictOf(row)).toBe('불일치');
  });

  it('소수 경계를 부동소수로 뭉개지 않는다', () => {
    // 0.1 + 0.2 를 부동소수로 더하면 0.30000000000000004 이 된다.
    const row = verifiableRow({
      trades: [
        { trade: '통신설비공', quantity: '0.1' },
        { trade: '보통인부', quantity: '0.2' },
      ],
      itemRate: '1',
      laborUnitPrice: '50000', // 0.1×300000 + 0.2×100000 = 50000
    });
    expect(verdictOf(row)).toBe('통과');
  });

  it('M/M 직종을 M/D와 섞어 계산하지 않는다 (D1 — 섞으면 약 20배 틀린다)', () => {
    const mixed: RawSheet['wages'] = [
      { trade: '통신설비공', unit: 'M/D', amount: '300000', quantityColumn: 'X' },
      { trade: '응용 SW개발자', unit: 'M/M', amount: '6000000', quantityColumn: 'BL' },
    ];
    const row = verifiableRow({
      trades: [
        { trade: '통신설비공', quantity: '0.5' },
        { trade: '응용 SW개발자', quantity: '0.1' },
      ],
      itemRate: '1',
      laborUnitPrice: '750000',
    });
    expect(verifyLaborRows([sheetOf([row], mixed)]).rows[0]!.verdict).toBe('미검증');
  });
});

// ---------------------------------------------------------------------------
describe('가이드 노임과 대조 — 둘이 다르면 한 견적서 안에서 숫자가 갈린다', () => {
  const guide = {
    통신설비공: { amount: '316875', unit: 'M/D' },
    보통인부: { amount: '172698', unit: 'M/D' },
  };

  it('같으면 차이가 없다', () => {
    expect(compareGuideWages(guide, guide)).toEqual({ same: 2, differences: [] });
  });

  it('금액이 다르면 직종마다 양쪽 값을 적는다', () => {
    const mine = { ...guide, 보통인부: { amount: '172068', unit: 'M/D' } };
    const result = compareGuideWages(mine, guide);
    expect(result.same).toBe(1);
    expect(result.differences).toEqual(['보통인부: 품셈 172068/M/D vs 가이드 172698/M/D']);
  });

  it('한쪽에만 있는 직종도 보고한다', () => {
    const mine = { ...guide, '응용 SW개발자': { amount: '6395094', unit: 'M/M' } };
    const result = compareGuideWages(mine, guide);
    expect(result.same).toBe(2);
    expect(result.differences).toEqual(['응용 SW개발자: 품셈 파일에만 있다 (6395094/M/M)']);
  });

  it('단위만 달라도 다른 것으로 본다 (D1)', () => {
    const mine = { ...guide, 통신설비공: { amount: '316875', unit: 'M/M' } };
    expect(compareGuideWages(mine, guide).differences).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('불일치는 한 건이라도 교체를 막는다', () => {
  it('역산 불일치가 있으면 아무것도 쓰지 않는다', () => {
    const prepared = prepareApprovedFiles(withPeriod([verifiableRow({ laborUnitPrice: '80001' })]));
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.reason).toContain('역산');
  });

  it('미검증 행만 있으면 막지 않는다 — 카탈로그 수록과 견적 출력은 다르다', () => {
    const prepared = prepareApprovedFiles(withPeriod([verifiableRow({ trades: [] })]));
    expect(prepared.ok).toBe(true);
  });

  it('미검증 행은 품셈 매핑을 받지 않는다 — 견적에서 unresolved 로 막힌다', () => {
    const prepared = prepareApprovedFiles(withPeriod([verifiableRow({ trades: [] })]));
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.labor.mappings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('승인 목록 — 통째로 면제하지 않는다', () => {
  const mismatching = () => withPeriod([verifiableRow({ row: 6, laborUnitPrice: '80001' })]);
  const approval = { sourceSha256: SHA, sheet: 'CCTV', row: 6, reason: '원본 수식에 열에 없는 계수가 있다 — 사용자 확인함' };

  it('출처·시트·행·사유가 전부 맞으면 그 행만 넘긴다', () => {
    const prepared = prepareApprovedFiles(mismatching(), { approvedMismatches: [approval] });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.verification.counts.불일치).toBe(1);
    expect(prepared.verification.approved).toHaveLength(1);
  });

  it('원본 해시가 다르면 넘기지 않는다 — 다른 판의 승인을 재사용하지 못한다', () => {
    const stale = { ...approval, sourceSha256: 'b'.repeat(64) };
    expect(prepareApprovedFiles(mismatching(), { approvedMismatches: [stale] }).ok).toBe(false);
  });

  it('행 번호가 다르면 넘기지 않는다', () => {
    expect(prepareApprovedFiles(mismatching(), { approvedMismatches: [{ ...approval, row: 7 }] }).ok).toBe(false);
  });

  it('사유가 비어 있으면 승인으로 보지 않는다', () => {
    expect(prepareApprovedFiles(mismatching(), { approvedMismatches: [{ ...approval, reason: '  ' }] }).ok).toBe(false);
  });

  it('승인한 행은 품셈 매핑을 받지 않는다 — 넘긴다고 맞는 값이 되지는 않는다', () => {
    const prepared = prepareApprovedFiles(mismatching(), { approvedMismatches: [approval] });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.labor.mappings).toHaveLength(0);
  });
});
