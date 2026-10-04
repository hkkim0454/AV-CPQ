import { describe, expect, it } from 'vitest';
import { computeActiveWarnings } from '@/domain/quote/activeWarnings';
import { buildQuoteDocument } from '@/domain/quote/buildDocument';
import type { ImportWarning } from '@/import/diagram/devices';
import type { QuoteDocument, SheetRow } from '@/domain/quote/types';

function baseDocument(): QuoteDocument {
  return buildQuoteDocument({
    header: {
      quoteNumber: 'AW-1',
      quoteDate: '2026-10-04',
      customer: '',
      projectName: '',
      contact: '',
      conditions: [],
    },
    systems: [{ name: '시스템1', lines: [] }],
    documentId: 'doc-aw-1',
    rowIdPrefix: 'aw',
  });
}

function itemRow(partial: Partial<SheetRow> & { rowId: string; systemId: string }): SheetRow {
  return {
    type: 'item',
    name: '임시',
    specification: '',
    unit: 'EA',
    quantity: '1',
    laborMode: 'not-applicable',
    remark: '',
    origin: 'rule',
    ...partial,
  } as SheetRow;
}

describe('computeActiveWarnings', () => {
  it('본체 행이 아직 sku/판매단가를 안 갖췄으면 경고가 남는다', () => {
    const document = { ...baseDocument(), rows: [itemRow({ rowId: 'r1', systemId: 'S1', sourceNodeIds: ['n1'] })] };
    const warnings: ImportWarning[] = [
      { code: 'device-not-in-catalog', blocking: true, message: 'x', nodeId: 'n1' },
    ];
    expect(computeActiveWarnings(document, warnings)).toEqual(warnings);
  });

  it('본체 행이 sku와 판매단가를 둘 다 갖추면 그 경고만 사라진다', () => {
    const document = {
      ...baseDocument(),
      rows: [
        itemRow({ rowId: 'r1', systemId: 'S1', sourceNodeIds: ['n1'], sku: 'X', sellingUnitPrice: '100' }),
      ],
    };
    const warnings: ImportWarning[] = [
      { code: 'device-not-in-catalog', blocking: true, message: 'x', nodeId: 'n1' },
    ];
    expect(computeActiveWarnings(document, warnings)).toEqual([]);
  });

  it('본체만 해결해도 같은 노드의 옵션 경고는 그대로 남는다(옵션은 optionId로 독립 판정)', () => {
    const document = {
      ...baseDocument(),
      rows: [
        // 본체 행 — 해결됨.
        itemRow({ rowId: 'r1', systemId: 'S1', sourceNodeIds: ['n1'], sku: 'X', sellingUnitPrice: '100' }),
        // 옵션 행 — 같은 노드지만 optionId가 있고, 아직 미해결.
        itemRow({ rowId: 'r2', systemId: 'S1', sourceNodeIds: ['n1'], optionId: 'opt1' }),
      ],
    };
    const warnings: ImportWarning[] = [
      { code: 'device-not-in-catalog', blocking: true, message: '본체', nodeId: 'n1' },
      { code: 'option-definition-missing', blocking: true, message: '옵션', nodeId: 'n1', optionId: 'opt1' },
    ];
    expect(computeActiveWarnings(document, warnings)).toEqual([warnings[1]]);
  });

  it('옵션만 해결해도 본체 경고는 그대로 남는다', () => {
    const document = {
      ...baseDocument(),
      rows: [
        itemRow({ rowId: 'r1', systemId: 'S1', sourceNodeIds: ['n1'] }),
        itemRow({
          rowId: 'r2',
          systemId: 'S1',
          sourceNodeIds: ['n1'],
          optionId: 'opt1',
          sku: 'Y',
          sellingUnitPrice: '200',
        }),
      ],
    };
    const warnings: ImportWarning[] = [
      { code: 'device-not-in-catalog', blocking: true, message: '본체', nodeId: 'n1' },
      { code: 'option-definition-missing', blocking: true, message: '옵션', nodeId: 'n1', optionId: 'opt1' },
    ];
    expect(computeActiveWarnings(document, warnings)).toEqual([warnings[0]]);
  });

  it('여러 노드가 한 행으로 합쳐졌으면 하나만 해결해도 그 행에 속한 모든 노드의 경고가 같이 사라진다', () => {
    const document = {
      ...baseDocument(),
      rows: [
        itemRow({
          rowId: 'r1',
          systemId: 'S1',
          sourceNodeIds: ['n1', 'n2'],
          sku: 'X',
          sellingUnitPrice: '100',
        }),
      ],
    };
    const warnings: ImportWarning[] = [
      { code: 'device-not-in-catalog', blocking: true, message: 'n1용', nodeId: 'n1' },
      { code: 'device-not-in-catalog', blocking: true, message: 'n2용', nodeId: 'n2' },
    ];
    expect(computeActiveWarnings(document, warnings)).toEqual([]);
  });

  it('이 기능이 다루지 않는 경고 코드는 행 상태와 무관하게 항상 남는다', () => {
    const document = baseDocument();
    const warnings: ImportWarning[] = [
      { code: 'price-not-registered', blocking: true, message: 'x', nodeId: 'n1' },
      { code: 'cable-length-missing', blocking: false, message: 'y', edgeId: 'e1' },
    ];
    expect(computeActiveWarnings(document, warnings)).toEqual(warnings);
  });

  it('케이블 행이 sourceEdgeIds로 해소되면 cable-item-unresolved 경고가 사라진다', () => {
    const document = {
      ...baseDocument(),
      rows: [itemRow({ rowId: 'r1', systemId: 'S1', sourceEdgeIds: ['e1'], sku: 'X', sellingUnitPrice: '100' })],
    };
    const warnings: ImportWarning[] = [{ code: 'cable-item-unresolved', blocking: true, message: 'x', edgeId: 'e1' }];
    expect(computeActiveWarnings(document, warnings)).toEqual([]);
  });

  it('케이블 행이 아직 미해결이면 경고가 남고, 무관한 구간 경고는 각자 독립적이다', () => {
    const document = {
      ...baseDocument(),
      rows: [
        itemRow({ rowId: 'r1', systemId: 'S1', sourceEdgeIds: ['e1'], sku: 'X', sellingUnitPrice: '100' }),
        itemRow({ rowId: 'r2', systemId: 'S1', sourceEdgeIds: ['e2'] }),
      ],
    };
    const warnings: ImportWarning[] = [
      { code: 'cable-item-unresolved', blocking: true, message: 'e1용', edgeId: 'e1' },
      { code: 'cable-item-unresolved', blocking: true, message: 'e2용', edgeId: 'e2' },
    ];
    expect(computeActiveWarnings(document, warnings)).toEqual([warnings[1]]);
  });
});
