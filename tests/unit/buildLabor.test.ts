import { describe, it, expect } from 'vitest';
import { buildLabor } from '@/data/catalog/buildLabor';
import { calculateLaborUnitPrice } from '@/domain/labor/calculateLabor';
import type { RawSheet } from '@/data/catalog/rawTypes';

/** 계획 Task 4. 노임은 원본 3행 실측값이다. */

const COMMON_WAGES: RawSheet['wages'] = [
  { trade: '통신관련기사', unit: 'M/D', amount: '320449', quantityColumn: 'T' },
  { trade: '통신관련산업기사', unit: 'M/D', amount: '304509', quantityColumn: 'V' },
  { trade: '통신설비공', unit: 'M/D', amount: '315528', quantityColumn: 'X' },
  { trade: '보통인부', unit: 'M/D', amount: '172068', quantityColumn: 'Z' },
];

const CMS_WAGES: RawSheet['wages'] = [
  ...COMMON_WAGES,
  { trade: '응용 SW개발자', unit: 'M/M', amount: '6395094', quantityColumn: 'BL' },
  { trade: 'NW엔지니어', unit: 'M/M', amount: '6846793', quantityColumn: 'BR' },
];

function sheet(name: string, rows: RawSheet['rows'], wages = COMMON_WAGES): RawSheet {
  return { name, wages, rows };
}

describe('buildLabor — 노임표', () => {
  it('직종과 단위와 금액을 그대로 옮긴다', () => {
    const { wageTable } = buildLabor([sheet('CCTV', [])]);
    expect(wageTable.wages['통신관련기사']).toEqual({ amount: '320449', unit: 'M/D' });
    expect(wageTable.wages['보통인부']).toEqual({ amount: '172068', unit: 'M/D' });
  });

  it('CMS 전용 직종은 M/M으로 담는다 (결정 D1)', () => {
    const { wageTable } = buildLabor([sheet('CMS', [], CMS_WAGES)]);
    expect(wageTable.wages['응용 SW개발자']).toEqual({ amount: '6395094', unit: 'M/M' });
    expect(wageTable.wages['NW엔지니어']!.unit).toBe('M/M');
  });

  it('여러 시트의 노임을 합치되 값이 어긋나면 보고한다', () => {
    const conflicting: RawSheet['wages'] = [
      { trade: '보통인부', unit: 'M/D', amount: '999999', quantityColumn: 'Z' },
    ];
    const { conflicts } = buildLabor([
      sheet('CCTV', []),
      sheet('영상', [], conflicting),
    ]);
    expect(conflicts.some((c) => c.includes('보통인부'))).toBe(true);
  });

  it('기간 라벨을 쓴다', () => {
    const { wageTable } = buildLabor([sheet('CCTV', [])], { periodLabel: '26년 상반기' });
    expect(wageTable.periodLabel).toBe('26년 상반기');
  });
});

describe('buildLabor — 품셈 항목', () => {
  const rows: RawSheet['rows'] = [
    {
      row: 6,
      name: 'IP카메라',
      unit: 'EA',
      materialUnitPrice: '654000',
      laborCode: '9-2-1-1-CCTV_촬상부',
      itemRate: '0.63',
      trades: [
        { trade: '통신설비공', quantity: '0.32' },
        { trade: '보통인부', quantity: '0.1' },
      ],
    },
  ];

  it('품셈 코드와 직종별 품을 담는다', () => {
    const { laborItems } = buildLabor([sheet('CCTV', rows)]);
    expect(laborItems).toHaveLength(1);
    expect(laborItems[0]).toMatchObject({
      code: '9-2-1-1-CCTV_촬상부',
      baseUnit: 'EA',
      wageUnit: 'M/D',
    });
    expect(laborItems[0]!.trades).toEqual([
      { trade: '통신설비공', quantity: '0.32' },
      { trade: '보통인부', quantity: '0.1' },
    ]);
  });

  it('M/M 직종만 쓰는 품셈은 wageUnit이 M/M이다', () => {
    const cms: RawSheet['rows'] = [
      {
        row: 6,
        name: 'CMS 구축',
        unit: '식',
        laborCode: 'CMS-1',
        itemRate: '1',
        trades: [{ trade: '응용 SW개발자', quantity: '0.5' }],
      },
    ];
    const { laborItems } = buildLabor([sheet('CMS', cms, CMS_WAGES)]);
    expect(laborItems[0]!.wageUnit).toBe('M/M');
  });

  it('M/D와 M/M을 섞어 쓰는 품셈은 보고하고 만들지 않는다', () => {
    const mixed: RawSheet['rows'] = [
      {
        row: 6,
        name: '혼합',
        unit: '식',
        laborCode: 'MIX-1',
        itemRate: '1',
        trades: [
          { trade: '보통인부', quantity: '0.5' },
          { trade: '응용 SW개발자', quantity: '0.1' },
        ],
      },
    ];
    const { laborItems, conflicts } = buildLabor([sheet('CMS', mixed, CMS_WAGES)]);
    expect(laborItems).toHaveLength(0);
    expect(conflicts.some((c) => c.includes('MIX-1') || c.includes('혼합'))).toBe(true);
  });
});

describe('buildLabor — 매핑 (Review Focus 5)', () => {
  it('품셈 코드가 없으면 매핑을 만들지 않는다 — 0원 노무비가 조용히 들어가면 안 된다', () => {
    const noCode: RawSheet['rows'] = [
      { row: 6, name: 'A', unit: 'EA', materialUnitPrice: '1000' },
    ];
    const { mappings, unmappedSkus } = buildLabor([sheet('CCTV', noCode)]);
    expect(mappings).toHaveLength(0);
    expect(unmappedSkus).toContain('CCT-0006');
  });

  it('품셈 코드가 있어도 품 값이 없으면 매핑을 만들지 않는다', () => {
    const noTrades: RawSheet['rows'] = [
      { row: 6, name: 'A', unit: 'EA', laborCode: 'X-1', itemRate: '0.63' },
    ];
    const { mappings, unmappedSkus } = buildLabor([sheet('CCTV', noTrades)]);
    expect(mappings).toHaveLength(0);
    expect(unmappedSkus).toContain('CCT-0006');
  });

  it('요율이 비면 1을 쓴다 — 0이면 노무 단가가 통째로 0이 된다', () => {
    const noRate: RawSheet['rows'] = [
      {
        row: 6,
        name: 'A',
        unit: 'EA',
        laborCode: 'X-1',
        trades: [{ trade: '보통인부', quantity: '0.5' }],
      },
    ];
    const { mappings } = buildLabor([sheet('CCTV', noRate)]);
    expect(mappings[0]!.itemRate).toBe('1');
  });

  it('할증이 비면 0을 쓴다', () => {
    const noSurcharge: RawSheet['rows'] = [
      {
        row: 6,
        name: 'A',
        unit: 'EA',
        laborCode: 'X-1',
        itemRate: '0.63',
        trades: [{ trade: '보통인부', quantity: '0.5' }],
      },
    ];
    const { mappings } = buildLabor([sheet('CCTV', noSurcharge)]);
    expect(mappings[0]!.surcharge).toBe('0');
  });

  it('매핑을 confirmed: false로 만든다 — 자동 추출을 확인 완료로 올리지 않는다', () => {
    const rows: RawSheet['rows'] = [
      {
        row: 6,
        name: 'A',
        unit: 'EA',
        laborCode: 'X-1',
        itemRate: '0.63',
        trades: [{ trade: '보통인부', quantity: '0.5' }],
      },
    ];
    const { mappings } = buildLabor([sheet('CCTV', rows)]);
    expect(mappings[0]!.confirmed).toBe(false);
    expect(mappings[0]!.note).toContain('자동');
  });

  it('SKU와 품셈 항목 id를 맞춘다', () => {
    const rows: RawSheet['rows'] = [
      {
        row: 6,
        name: 'A',
        unit: 'EA',
        laborCode: 'X-1',
        itemRate: '0.63',
        trades: [{ trade: '보통인부', quantity: '0.5' }],
      },
    ];
    const { mappings, laborItems } = buildLabor([sheet('CCTV', rows)]);
    expect(mappings[0]!.sku).toBe('CCT-0006');
    expect(mappings[0]!.laborMappingId).toBe('CCT-0006');
    expect(mappings[0]!.laborItemId).toBe(laborItems[0]!.laborItemId);
  });
});

describe('기존 계산 엔진과의 연결', () => {
  it('생성한 품셈·노임으로 원본 I열 수식과 같은 값이 나온다', () => {
    // 원본: I = INT(SUM((R*S),S)*Q),  S = Σ(품 × 노임)
    // 0.15 × 320449 + 0.31 × 172068 = 48067.35 + 53341.08 = 101408.43
    // 할증 0, 요율 0.63 → INT(101408.43 × 0.63) = INT(63887.3109) = 63887
    const out = buildLabor([
      sheet('CCTV', [
        {
          row: 6,
          name: 'A',
          unit: 'EA',
          laborCode: '7-11-1',
          itemRate: '0.63',
          surcharge: '0',
          trades: [
            { trade: '통신관련기사', quantity: '0.15' },
            { trade: '보통인부', quantity: '0.31' },
          ],
        },
      ]),
    ]);

    const breakdown = calculateLaborUnitPrice(
      out.laborItems[0]!,
      out.mappings[0]!,
      out.wageTable,
    );
    expect(breakdown.standardUnitPrice.toFixed()).toBe('101408.43');
    expect(breakdown.appliedUnitPrice.toFixed()).toBe('63887');
  });

  it('자동 매핑이라 확정은 막힌다', () => {
    const out = buildLabor([
      sheet('CCTV', [
        {
          row: 6,
          name: 'A',
          unit: 'EA',
          laborCode: '7-11-1',
          itemRate: '0.63',
          trades: [{ trade: '보통인부', quantity: '0.31' }],
        },
      ]),
    ]);
    const breakdown = calculateLaborUnitPrice(out.laborItems[0]!, out.mappings[0]!, out.wageTable);
    expect(breakdown.blocking).toBe(true);
    expect(breakdown.warnings.some((w) => w.code === 'mapping-unconfirmed')).toBe(true);
  });
});
