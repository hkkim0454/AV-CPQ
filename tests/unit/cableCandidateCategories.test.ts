import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { productsFileSchema } from '@/data/catalog/schema';
import { classifyCableCandidate, groupCableCandidates } from '@/features/worksheet/cableCandidateCategories';

const group = (quoteName: string, groupName: string) => ({ quoteName, options: { group: groupName } });

describe('케이블 후보의 화면용 큰 분류', () => {
  it('품명과 묶음만으로 판정하므로 SKU가 밀려도 결과가 같다', () => {
    const oldProduct = productsFileSchema.parse(JSON.parse(readFileSync(resolve(__dirname, '../../data/approved/products.json'), 'utf8')))
      .products.find((product) => product.sku === 'CBL-0088')!;
    const movedProduct = { ...oldProduct, sku: 'CBL-9999' };
    expect(classifyCableCandidate(oldProduct)).toBe('S/FTP');
    expect(classifyCableCandidate(movedProduct)).toBe('S/FTP');
    expect(classifyCableCandidate(group('Pass Through RJ45 Connector', '벨덴_SFTP CABLE'))).toBe('미분류');
  });

  it('랜 묶음은 긴 차폐 표기를 먼저 판정하고 부품을 커넥터로 분리한다', () => {
    const lanGroup = '벨덴_SFTP CABLE';
    expect(classifyCableCandidate(group('SF/UTP CAT6 Cable', lanGroup))).toBe('SF/UTP');
    expect(classifyCableCandidate(group('S/FTP CAT6A Cable', lanGroup))).toBe('S/FTP');
    expect(classifyCableCandidate(group('F/UTP CAT6 Cable', lanGroup))).toBe('F/UTP');
    expect(classifyCableCandidate(group('SFTP CAT6 Cable', lanGroup))).toBe('S/FTP');
    expect(classifyCableCandidate(group('UTP Cable', lanGroup))).toBe('UTP 케이블');
    expect(classifyCableCandidate(group('- S/FTP Modular', lanGroup))).toBe('커넥터');
  });

  it('CISCO와 Intel i7 묶음은 품명으로 나누며 모르는 이름은 미분류로 드러낸다', () => {
    const intelGroup = '- Intel Core i7 / 16GB DDR4 / 256GB SSD / Win11 Pro  64Bit 포함';
    expect(classifyCableCandidate(group('Table Microphone Extension Cable', 'CISCO'))).toBe('오디오·마이크 케이블');
    expect(classifyCableCandidate(group('BNC Gender Cable', 'CISCO'))).toBe('SDI·동축·RF·안테나');
    expect(classifyCableCandidate(group('TCU Control Cable', intelGroup))).toBe('USB·제어 케이블');
    expect(classifyCableCandidate(group('Coaxial Cable', intelGroup))).toBe('SDI·동축·RF·안테나');
    expect(classifyCableCandidate(group('Other Cable', 'CISCO'))).toBe('미분류');
    expect(classifyCableCandidate(group('Other Cable', intelGroup))).toBe('미분류');
    expect(classifyCableCandidate(group('HDMI Cable', '새로운 묶음'))).toBe('미분류');
  });

  it('분류 중에도 모든 후보를 한 번씩 보존하고 없는 제품 번호까지 미분류에 보인다', () => {
    const bySku = new Map([
      ['FIRST', group('HDMI Cable', 'CS_HDMI 케이블')],
      ['SECOND', group('HDMI Cable', 'CS_HDMI 케이블')],
      ['NEW', group('HDMI Cable', '새로운 묶음')],
    ]);
    const candidates = ['SECOND', 'MISSING', 'NEW', 'FIRST'];
    expect(groupCableCandidates(candidates, bySku)).toEqual([
      { category: 'HDMI 일반·변환', skus: ['SECOND', 'FIRST'] },
      { category: '미분류', skus: ['MISSING', 'NEW'] },
    ]);
  });

  it('현행 케이블류 266개가 사용자 확정 문서의 SKU별·묶음별 배치와 모두 일치한다', () => {
    const products = productsFileSchema.parse(JSON.parse(readFileSync(resolve(__dirname, '../../data/approved/products.json'), 'utf8')))
      .products.filter((product) => product.sku.startsWith('CBL-') || /cable|케이블/i.test(product.quoteName));
    const document = readFileSync(resolve(__dirname, '../../docs/cable-candidate-category-draft.md'), 'utf8');
    const directGroups = new Map<string, string>();
    const splitGroups = new Set<string>();
    for (const match of document.matchAll(/^\| (.+?) \| `([^`]+)` \| (\d+) \|$/gm)) {
      const [, category, groupName] = match;
      if (category!.includes('SKU별')) splitGroups.add(groupName!);
      else directGroups.set(groupName!, category!);
    }
    const bySku = new Map<string, string>();
    for (const match of document.matchAll(/^\| `([A-Z]+-\d+)` \|.*\| \*\*([^*]+)\*\* \|$/gm)) {
      bySku.set(match[1]!, match[2]!);
    }
    expect(products).toHaveLength(266);
    expect(directGroups.size + splitGroups.size).toBe(56);
    expect(bySku.size).toBe(27);

    const actual = new Map<string, number>();
    for (const product of products) {
      const expected = bySku.get(product.sku) ?? directGroups.get(product.options['group'] ?? '');
      expect(expected, `${product.sku}의 문서 배치`).toBeDefined();
      expect(classifyCableCandidate(product), `${product.sku}: ${product.quoteName}`).toBe(expected);
      const category = classifyCableCandidate(product);
      actual.set(category, (actual.get(category) ?? 0) + 1);
    }
    expect(Object.fromEntries(actual)).toMatchObject({
      'UTP 케이블': 3, 'SF/UTP': 1, 'S/FTP': 3, 'F/UTP': 1,
      '커넥터': 24, '일반 광케이블·광 연결 부품': 72,
      'SDI·동축·RF·안테나': 26, '오디오·마이크 케이블': 9,
      'USB·제어 케이블': 5, '배관·설치 자재': 17, '기기 전용 케이블': 26,
    });
    expect(actual.get('미분류') ?? 0).toBe(0);
  });
});
