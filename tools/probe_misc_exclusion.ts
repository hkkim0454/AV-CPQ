/** 합성 LED/부속품/배관의 잡자재비를 실제 Excel에서 대사할 6종을 만든다. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Decimal from 'decimal.js';
import { buildQuoteDocument } from '../src/domain/quote/buildDocument';
import { calculateQuote } from '../src/domain/calculation/calculate';
import { buildCustomerProjection } from '../src/export/customer/projection';
import { buildGuideBase, buildCustomerGuideWorkbook } from '../src/export/customer/guideWorkbook';
import { buildSalesGuideWorkbook } from '../src/export/internal/guideWorkbook';
import { GUIDE_IDS, readGuideTemplate, selectGuide, indirectCostsFor, type GuideTemplateSet } from '../src/export/ooxml/guideTemplate';
import type { InternalLine } from '../src/services/private-cost/calculate';

const root = process.cwd();
const out = resolve(root, '.local/out/misc-exclusion', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(out, { recursive: true });
const manifest = JSON.parse(readFileSync(resolve(root, 'templates/sanitized/guide-manifest.json'), 'utf8'));
const guides = Object.fromEntries(GUIDE_IDS.map(id => [id, readGuideTemplate(id,
  new Uint8Array(readFileSync(resolve(root, `templates/sanitized/guide-${id}.xlsx`))), manifest)])) as GuideTemplateSet;

for (const profile of ['general', 'ds'] as const) for (const level of [0, 1, 2] as const) {
  const document = buildQuoteDocument({ documentId: 'misc-probe', rowIdPrefix: 'misc',
    header: { quoteNumber: 'SYNTHETIC', quoteDate: '2026-10-04', customer: '합성', projectName: 'LED 제외 검증', contact: '', conditions: [] },
    systems: [{ name: '합성 공간', lines: [
      { name: '합성 캐비넷', specification: 'CAB', unit: 'EA', quantity: '1', sellingUnitPrice: '1000000' },
      { name: '합성 S-BOX', specification: 'BOX', unit: 'EA', quantity: '1', sellingUnitPrice: '10000' },
      { name: '합성 후렉시블', specification: 'PIPE', unit: '10M', quantity: '3', sellingUnitPrice: '1000' },
    ] }],
  });
  document.rows = document.rows.map(row => row.type === 'item' ? { ...row, laborMode: 'not-applicable' } : row);
  document.systems = document.systems.map(system => ({ ...system, indirectCosts: indirectCostsFor(profile, guides) }));
  document.derivedRows = [
    { rowId: 'extra', systemId: 'S1', name: '배관 기타자재', specification: '', unit: '식', quantity: '1',
      laborMode: 'not-applicable', remark: '', origin: 'rule', rate: '0.2',
      derived: { kind: 'single-row-material', sourceRowId: document.rows[2]!.rowId } },
    { rowId: 'misc', systemId: 'S1', name: '잡자재비', specification: '', unit: '식', quantity: '1',
      laborMode: 'not-applicable', remark: '', origin: 'rule', rate: '0.02',
      derived: { kind: 'material-sum-to-here', excludedRowIds: [document.rows[0]!.rowId] } },
  ];
  const projection = buildCustomerProjection(document, calculateQuote(document));
  const guide = selectGuide(guides, profile, level === 0);
  const costs: InternalLine[] = document.rows.flatMap((row, index) => row.type !== 'item' ? [] : [{
    rowId: row.rowId, name: row.name, specification: row.specification, unit: row.unit,
    quantity: new Decimal(row.quantity!), costRegistered: true,
    purchaseUnitPrice: new Decimal(['800000', '8000', '800'][index]!),
    purchaseAmount: new Decimal(['800000', '8000', '2400'][index]!),
  }]);
  const built = level === 0 ? buildSalesGuideWorkbook({
    shared: { customer: projection, details: { descriptionByRow: new Map(), laborByRow: new Map() },
      notes: { supplierByRow: new Map(), salesRemarkByRow: new Map() }, suspiciousNotes: [] },
    extras: { lines: costs, aiNotesByRow: new Map(), supplierByRow: new Map(), salesRemarkByRow: new Map() },
    guide, baseGuide: selectGuide(guides, profile, false),
  }) : level === 1 ? buildGuideBase(projection, guide) : buildCustomerGuideWorkbook(projection, guide);
  const { layout } = built;
  const miscRow = layout.derivedRows.find(row => row.rowId === 'misc')!.row;
  const extraRow = layout.derivedRows.find(row => row.rowId === 'extra')!.row;
  const material = layout.column('material.amount');
  const expected: Record<string, string> = {
    [`${material}${extraRow}`]: '600', [`${material}${miscRow}`]: '272',
  };
  if (level === 0) {
    expected[`${layout.column('cost.amount')}${extraRow}`] = profile === 'ds' ? '480' : '0';
    expected[`${layout.column('cost.amount')}${miscRow}`] = profile === 'ds' ? '217' : '208';
  }
  const tag = `${profile}-${level}`;
  writeFileSync(resolve(out, `${tag}.xlsx`), built.bytes);
  writeFileSync(resolve(out, `${tag}.expected.json`), JSON.stringify({ [guide.sheets.detail]: expected }, null, 2));
  writeFileSync(resolve(out, `${tag}.layout.json`), JSON.stringify({ detailSheetIndex: 2, coverSheetIndex: 1,
    quantityColumn: layout.column('quantity'), unitPriceColumn: layout.column('material.unit'),
    amountColumn: material, coverAmountTextCell: 'C8', grandTotalRow: layout.grandTotalRow, printArea: layout.printArea }, null, 2));
}
console.log(out);
