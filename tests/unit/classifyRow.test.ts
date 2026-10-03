import { describe, it, expect } from 'vitest';
import { classifyRow, classifySheet } from '@/data/catalog/classifyRow';
import type { RawRow } from '@/data/catalog/rawTypes';

/**
 * 행 분류 (계획 Task 2).
 *
 * 아래 행들은 원본 품셈 파일에서 **실제로 관측한 형태**다 (2026-10-03 덤프).
 * 지어낸 사례가 아니다 — Review Focus 2가 경고한 "브랜드행이 제품으로 섞여 들어감"을
 * 실제 데이터로 고정한다 (B열 머리글은 브랜드가 아니라 품목 그룹이다).
 */

const row = (partial: Partial<RawRow> & { row: number }): RawRow => partial;

describe('classifyRow — 분류 머리글', () => {
  it('대괄호로 감싼 이름은 분류 머리글이다', () => {
    expect(classifyRow(row({ row: 4, name: '[ DSP, I/O, 라이센스 ]' })).kind).toBe('category');
    expect(classifyRow(row({ row: 4, name: '[ CCTV ]' })).kind).toBe('category');
  });

  it('분류 머리글의 이름에서 대괄호와 공백을 벗긴다', () => {
    const result = classifyRow(row({ row: 4, name: '[ Conference System ]' }));
    expect(result.kind).toBe('category');
    expect(result.label).toBe('Conference System');
  });
});

describe('classifyRow — 품목 그룹 머리글 (Review Focus 2)', () => {
  it('단위가 없는 이름 행은 품목 그룹 머리글이다 — 제품이 아니다', () => {
    expect(classifyRow(row({ row: 5, name: '한화테크윈_CCTV' })).kind).toBe('group');
    expect(classifyRow(row({ row: 4, name: 'HDMI 젠더' })).kind).toBe('group');
    expect(classifyRow(row({ row: 10, name: 'DVI to HDMI 케이블&젠더' })).kind).toBe('group');
  });

  it('품셈만 있고 단위가 없는 행도 제품이 아니다', () => {
    // 원본 오디오!171 — 품셈 참고용 행. 단위가 없어 견적에 넣을 수 없다.
    const result = classifyRow(
      row({
        row: 171,
        name: '기본 AMP (300W 이상 / 4CH)',
        spec: 'AMP 기능만 수행 시',
        laborCode: '방송설비-앰프',
      }),
    );
    expect(result.kind).toBe('labor-reference');
  });
});

describe('classifyRow — 제품 (단위가 판별 기준)', () => {
  it('단위가 있으면 제품이다', () => {
    const result = classifyRow(
      row({
        row: 6,
        name: 'DP to HDMI 변환젠더',
        spec: '4K 60p 지원',
        unit: 'EA',
        materialUnitPrice: '23000',
        laborCode: '9-2-1-1 부대장치',
      }),
    );
    expect(result.kind).toBe('product');
  });

  it('단가가 없어도 단위가 있으면 제품이다 — 미등록으로 다룬다', () => {
    // 원본 케이블!177 — 단가 없이 품셈만 있다
    const result = classifyRow(
      row({ row: 177, name: '광 케이블 시험/측정', spec: 'S/M', unit: 'CORE' }),
    );
    expect(result.kind).toBe('product');
  });

  it('품셈이 없어도 단위가 있으면 제품이다', () => {
    const result = classifyRow(
      row({ row: 196, name: 'W/L Hand Mic', spec: 'ULXD2/BETA58', unit: 'EA', materialUnitPrice: '890000' }),
    );
    expect(result.kind).toBe('product');
  });

  it('`- `로 시작하는 딸림 품목도 독립 제품이다', () => {
    // 원본 CCTV!7 — 브라켓. 견적에서 따로 고를 수 있어야 한다.
    const result = classifyRow(
      row({ row: 7, name: '- 벽부 브라켓', spec: 'SBP-300WM1', unit: 'EA', materialUnitPrice: '38600' }),
    );
    expect(result.kind).toBe('product');
    expect(result.label).toBe('- 벽부 브라켓');
  });
});

describe('classifyRow — 파생 단가 행', () => {
  it('단가가 수식인 행은 파생 행이다', () => {
    // 원본 케이블!269 — `=INT(H268*20%)`
    const result = classifyRow(
      row({
        row: 269,
        name: '배관 기타자재',
        spec: '배관자재20%',
        unit: '식',
        materialUnitPriceFormula: '=INT(H268*20%)',
      }),
    );
    expect(result.kind).toBe('product');
    expect(result.derivedPricing).toBe(true);
  });

  it('파생 행에는 고정 단가를 붙이지 않는다', () => {
    const result = classifyRow(
      row({ row: 269, name: '배관 기타자재', unit: '식', materialUnitPriceFormula: '=INT(H268*20%)' }),
    );
    expect(result.kind === 'product' && result.sellingUnitPrice).toBeUndefined();
  });
});

describe('classifyRow — 빈 행', () => {
  it('이름이 없으면 무시한다', () => {
    expect(classifyRow(row({ row: 300 })).kind).toBe('ignore');
    expect(classifyRow(row({ row: 300, name: '   ' })).kind).toBe('ignore');
  });

  it('이름이 없는데 단위만 있는 행도 무시한다', () => {
    expect(classifyRow(row({ row: 300, unit: 'EA' })).kind).toBe('ignore');
  });
});

describe('classifySheet — 분류·그룹 맥락을 제품에 붙인다', () => {
  const rows: RawRow[] = [
    { row: 4, name: '[ CCTV ]' },
    { row: 5, name: '한화테크윈_CCTV' },
    { row: 6, name: 'IP카메라', spec: 'XNP-6040H', unit: 'EA', materialUnitPrice: '654000' },
    { row: 7, name: '- 벽부 브라켓', spec: 'SBP-300WM1', unit: 'EA', materialUnitPrice: '38600' },
    { row: 8, name: '[ 저장장치 ]' },
    { row: 9, name: 'NVR', spec: 'XRN-820S', unit: 'EA', materialUnitPrice: '1200000' },
  ];

  it('직전 분류 머리글을 제품에 전달한다', () => {
    const result = classifySheet('CCTV', rows);
    expect(result.products[0]).toMatchObject({ category: 'CCTV', group: '한화테크윈_CCTV' });
    expect(result.products[2]).toMatchObject({ category: '저장장치' });
  });

  it('새 분류 머리글이 나오면 그룹 맥락을 지운다', () => {
    const result = classifySheet('CCTV', rows);
    // 8행 `[ 저장장치 ]` 뒤에는 그룹 행이 없다
    expect(result.products[2]!.group).toBeUndefined();
  });

  it('시트 이름을 최상위 분류로 쓴다', () => {
    const result = classifySheet('CCTV', rows);
    expect(result.sheetCategory).toBe('CCTV');
  });

  it('제품만 세고 머리글은 세지 않는다', () => {
    const result = classifySheet('CCTV', rows);
    expect(result.products).toHaveLength(3);
    expect(result.counts.category).toBe(2);
    expect(result.counts.group).toBe(1);
    expect(result.counts.product).toBe(3);
  });
});
