import { describe, it, expect } from 'vitest';
import { captureCableSource } from '@/domain/quote/cableSource';
import { diagram, edge, node, cat, catalogProduct } from '../fixtures/diagram';
import { buildCableLines } from '@/import/diagram/cables';
import { diagramToQuote } from '@/import/diagram/toQuote';

describe('케이블 원본 보존 경계', () => {
  it('길이 변경으로 행이 분할돼도 원본 BOM 구성원 식별자는 유지한다', () => {
    const product = catalogProduct('C3', 'Cable', 'CABLE-3M');
    product.options = { group: 'HDMI' };
    const longer = { ...product, productId: 'C5', sku: 'C5', model: 'CABLE-5M', quoteSpec: 'CABLE-5M' };
    const catalog = cat([product, longer], { C3: '100', C5: '200' });
    const input = diagram([node('n1', '소스', '')], ['e1', 'e2'].map(id => edge(id, 'n1', 'n1', 'video', {
      bomRows: [{ cableType: 'ready-made', productName: 'CABLE-3M', length: '3', quantity: '1' }],
    })));
    const merged = buildCableLines(input, catalog);
    const split = buildCableLines(input, catalog, new Map([['e1', {
      edgeId: 'e1', systemId: 'S1', source: 'confirmed-total', confirmedTotalMeters: '5',
    }]]));
    expect(merged.lines).toHaveLength(1);
    expect(split.lines).toHaveLength(2);
    expect(split.lines.flatMap(line => line.sourceCableMembers!).sort()).toEqual(merged.lines[0]!.sourceCableMembers!.slice().sort());
    expect(new Set(split.lines.flatMap(line => line.sourceCableMembers!)).size).toBe(2);
    const loaded = diagramToQuote(input, catalog, { defaultSystemName: '공간', header: {
      quoteNumber: 'source', quoteDate: '', customer: '', projectName: '', contact: '', conditions: [],
    } });
    expect(loaded.document.cableSource?.edges).toHaveLength(2);
  });

  it('재산출에 필요한 원본 값만 복사하고 카탈로그·알 수 없는 필드는 버린다', () => {
    const input = diagram([node('n1', '소스', 'MODEL', { secret: 'private-note' })], [
      edge('e1', 'n1', 'n2', 'video', { bomRows: [
        { productName: 'CABLE', cableType: 'ready-made', length: '3', quantity: '2' },
      ] }),
    ]);
    input.equipmentDB = [{ private: 'private-note' }];
    const source = captureCableSource(input);
    expect(JSON.stringify(source)).not.toContain('private-note');
    expect(source.edges[0]!.data!.bomRows![0]!.length).toBe('3');
    input.edges[0]!.data!.bomRows![0]!.length = '20';
    expect(source.edges[0]!.data!.bomRows![0]!.length).toBe('3');
  });
});
