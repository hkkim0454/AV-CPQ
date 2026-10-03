/**
 * 합성 견적 — Excel 출력 검증용.
 *
 * 설계서 §4.5 / §8.4: 개발 테스트에 실제 매입 원가나 회사 판매가를 쓰지 않는다.
 * 여기 숫자는 전부 지어낸 값이고, 일부는 `SENTINEL_*`로 ZIP 감사에서 찾을 수 있게 했다.
 */
import type {
  QuoteDocument,
  IndirectCostRule,
  SheetRow,
  DerivedRow,
  QuoteSystem,
} from '@/domain/quote/types';

/** 원본에서 확인한 간접비 9항목. mapping.md §3.6. */
export function standardIndirectCosts(): IndirectCostRule[] {
  const of = (
    itemId: string,
    name: string,
    basisLabel: string,
    basis: IndirectCostRule['basis'],
    rate: string,
    applied: boolean,
  ): IndirectCostRule => ({
    itemId,
    name,
    basisLabel,
    basis,
    rate,
    applied,
    source: '원본 양식 2026-08 기준',
  });

  return [
    of('i1', '간접노무비', '노무비 대비', { kind: 'labor' }, '0.0486', true),
    of('i2', '고용보험료', '노무비 대비', { kind: 'labor' }, '0.00424', true),
    of('i3', '산재보험료', '노무비 대비', { kind: 'labor' }, '0.00961', true),
    of('i4', '연금보험료', '노무비 대비', { kind: 'labor' }, '0.01215', false),
    of('i5', '건강보험료', '노무비 대비', { kind: 'labor' }, '0.00957', false),
    of('i6', '노인장기요양보험료', '노무비 대비', { kind: 'labor' }, '0.00124', false),
    of('i7', '산업안전보건관리비', '직접비 대비', { kind: 'direct' }, '0.0311', true),
    of('i8', '퇴직공제부금비', '노무비 대비', { kind: 'labor' }, '0.00621', true),
    of(
      'i9',
      '공과잡비',
      '직접비+간접노무비+산업안전관리비',
      { kind: 'composite', plusItemIds: ['i1', 'i7'] },
      '0.1',
      true,
    ),
  ];
}

/** ZIP 감사에서 찾을 sentinel 값. 고객 파일에 절대 나오면 안 되는 것들. */
export const SENTINEL_COST = '7777777';
export const SENTINEL_SUPPLIER = 'SENTINEL_매입처_주식회사';
export const SENTINEL_INTERNAL_NOTE = 'SENTINEL_내부메모_마진40퍼센트';

function system(systemId: string, name: string, summarySpec: string): QuoteSystem {
  return {
    systemId,
    name,
    summarySpec,
    unit: '식',
    quantity: '1',
    remark: '',
    indirectCosts: standardIndirectCosts(),
  };
}

function display(
  rowId: string,
  systemId: string,
  kind: 'group' | 'subgroup' | 'note',
  name: string,
  specification?: string,
): SheetRow {
  return {
    type: 'display',
    rowId,
    systemId,
    kind,
    name,
    ...(specification !== undefined ? { specification } : {}),
  };
}

function item(
  rowId: string,
  systemId: string,
  name: string,
  specification: string,
  unit: string,
  quantity: string,
  price: string,
  laborPrice?: string,
  remark = '',
): SheetRow {
  return {
    type: 'item',
    rowId,
    systemId,
    name,
    specification,
    unit,
    quantity,
    sellingUnitPrice: price,
    laborMode: laborPrice === undefined ? 'not-applicable' : 'manual',
    ...(laborPrice !== undefined
      ? { manualLaborUnitPrice: laborPrice, overrideReason: '합성 테스트 값' }
      : {}),
    remark,
    origin: 'manual',
  };
}

/**
 * 2시스템·그룹 머리글·설명 행·파생 행을 모두 포함한 견적.
 * 원본 구조를 한 번에 재현하는 최소 사례다.
 */
export function syntheticQuote(): QuoteDocument {
  const rows: SheetRow[] = [
    display('d1', 'S1', 'group', '[ 교육장 영상 ]'),
    display('d2', 'S1', 'subgroup', 'Main Display'),
    item('r1', 'S1', '합성 디스플레이', 'SYNTH-DP-100', 'EA', '2', '1500000', '120000'),
    display('d3', 'S1', 'note', ' - 화면 크기', '합성 86인치'),
    display('d4', 'S1', 'note', ' - 해상도', '3840 x 2160'),
    item('r2', 'S1', '합성 벽걸이 브래킷', 'SYNTH-MNT-02', 'EA', '2', '85000', '30000'),
    item('r3', 'S1', '합성 HDMI 케이블 5m', 'SYNTH-HDMI-005', 'EA', '4', '42000'),
    display('d5', 'S1', 'subgroup', '배관배선'),
    item(
      'r4',
      'S1',
      'Flexible Conduit (고장력,비방수)',
      '28㎜_SF-28',
      '10M',
      '6',
      '23000',
      '18000',
    ),
  ];

  const rows2: SheetRow[] = [
    display('d6', 'S2', 'group', '[ 교육장 음향 ]'),
    item('r5', 'S2', '합성 파워앰프', 'SYNTH-AMP-240', 'EA', '1', '980000', '150000'),
    item('r6', 'S2', '합성 천장 스피커', 'SYNTH-SPK-C6', 'EA', '8', '110000', '25000'),
    item('r7', 'S2', '합성 스피커 케이블', 'SYNTH-SPC-2C', 'M', '120.5', '1800', '900'),
  ];

  const derivedRows: DerivedRow[] = [
    {
      rowId: 'dv1',
      systemId: 'S1',
      name: '배관 기타자재',
      specification: '배관자재20%',
      unit: '식',
      quantity: '1',
      laborMode: 'not-applicable',
      remark: '',
      origin: 'rule',
      derived: { kind: 'single-row-material', sourceRowId: 'r4' },
      rate: '0.2',
    },
    {
      rowId: 'dv2',
      systemId: 'S1',
      name: '잡자재비',
      specification: '자재비의 2%',
      unit: '식',
      quantity: '1',
      laborMode: 'not-applicable',
      remark: '',
      origin: 'rule',
      derived: { kind: 'material-sum-to-here' },
      rate: '0.02',
    },
  ];

  return {
    schemaVersion: 1,
    documentId: 'synthetic-0001',
    mode: 'material-and-labor',
    header: {
      quoteNumber: 'SYNTH-260826-01',
      quoteDate: '2026-08-26',
      customer: '합성 고객사',
      projectName: '합성 교육장 AV시스템 구축',
      contact: '합성 담당자',
      conditions: [' - 합성 조건 1: 선급금 30%', ' - 합성 조건 2: 견적 유효기간 30일'],
    },
    coverGroups: [
      { groupId: 'g1', marker: 'Ⅰ', name: '합성 현장 3층 교육장', systemIds: ['S1', 'S2'] },
    ],
    systems: [
      system('S1', '교육장 영상', '합성 86인치 2대'),
      system('S2', '교육장 음향', '천장형 8본'),
    ],
    rows: [...rows, ...rows2],
    derivedRows,
    negoDeduction: '120000',
    rounding: { coverTotalDigits: -4 },
    versions: {
      catalog: 'synthetic',
      labor: 'synthetic',
      wage: 'synthetic',
      template: 'sanitized-2026-10-03',
      rule: 'synthetic',
    },
    equipment: [],
    connections: [],
    existingSupplies: [],
  };
}

/** 품목이 하나도 없는 시스템 — 역전 SUM 범위를 만들지 않는지 확인용. */
export function emptySystemQuote(): QuoteDocument {
  const base = syntheticQuote();
  return {
    ...base,
    systems: [system('E1', '빈 시스템', '')],
    coverGroups: [{ groupId: 'g1', marker: 'Ⅰ', name: '빈 구역', systemIds: ['E1'] }],
    rows: [],
    derivedRows: [],
    negoDeduction: '0',
  };
}

/**
 * 100행 규모 견적 — 다페이지 출력 검증용 (열린 항목 O2a).
 *
 * 페이지 나눔·반복 머리글·행 잘림은 **다페이지에서만** 드러난다.
 * 품명 길이도 함께 흔든다. 원본 카탈로그에 28자가 넘는 한글 품명이 있고
 * B열 너비가 28.625라, 긴 품명과 페이지 경계가 겹칠 때 문제가 난다.
 */
export function longQuote(itemCount = 100): QuoteDocument {
  const base = syntheticQuote();
  const rows: SheetRow[] = [display('g1', 'L1', 'group', '[ 다페이지 검증 ]')];

  for (let index = 0; index < itemCount; index += 1) {
    // 20행마다 소그룹 머리글을 끼워 넣는다 — 머리글이 페이지 경계에 걸리는 경우.
    if (index > 0 && index % 20 === 0) {
      rows.push(display(`sg${index}`, 'L1', 'subgroup', `소그룹 ${index / 20}`));
    }
    // 10행마다 아주 긴 품명 — B열 너비 28.625를 넘는다.
    const longName =
      index % 10 === 0
        ? `합성 장비 ${index} 삼성 데스크탑PC+추가옵션, 본사별도문의 (그래픽카드, SSD 증설)`
        : `합성 장비 ${index}`;
    rows.push(
      item(
        `lr${index}`,
        'L1',
        longName,
        index % 7 === 0 ? 'SYNTH-LONG-SPEC-0123456789-ABCDEFGHIJ' : `SYNTH-${index}`,
        index % 3 === 0 ? 'EA' : index % 3 === 1 ? '10M' : '식',
        index % 5 === 0 ? '12.5' : String((index % 9) + 1),
        String(10000 + index * 137),
        index % 4 === 0 ? String(3000 + index * 11) : undefined,
        index % 11 === 0 ? '긴 비고 — 현장 확인 필요, 사다리차 반입 조건 검토' : '',
      ),
    );
  }

  return {
    ...base,
    documentId: 'synthetic-long',
    header: { ...base.header, projectName: '합성 다페이지 검증 공사' },
    coverGroups: [
      { groupId: 'g1', marker: 'Ⅰ', name: '합성 현장', systemIds: ['L1'] },
    ],
    systems: [system('L1', '다페이지 시스템', `합성 품목 ${itemCount}행`)],
    rows,
    derivedRows: [],
    negoDeduction: '0',
  };
}
