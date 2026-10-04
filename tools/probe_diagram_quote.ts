/**
 * 실물 구성도 → 견적서 Excel. 진단용이며 제품 코드가 아니다.
 *
 * 실행:  npx vite-node tools/probe_diagram_quote.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseDiagram } from '../src/import/diagram/schema';
import { diagramToQuote } from '../src/import/diagram/toQuote';
import { buildCatalog, buildLaborReference } from '../src/data/catalog/load';
import { calculateQuote } from '../src/domain/calculation/calculate';
import { calculateLaborForRows } from '../src/domain/labor/calculateLabor';
import { buildCustomerProjection } from '../src/export/customer/projection';
import { buildQuoteWorkbook } from '../src/export/ooxml/workbook';
import { formatKRW } from '../src/domain/calculation/rounding';
import { TEMPLATE_PATH } from '../src/export/ooxml/anchors';

const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

const catalog = buildCatalog(
  read('data/approved/products.json'),
  read('data/approved/prices.json'),
);
const labor = buildLaborReference(
  read('data/approved/labor-items.json'),
  read('data/approved/wage-table.json'),
  read('data/approved/labor-mappings.json'),
);

const diagram = parseDiagram(read(process.argv[2] ?? '.local/samples/av-diagram.json'));

const result = diagramToQuote(diagram, catalog, {
  header: {
    quoteNumber: 'DG-260804-01',
    quoteDate: '2026-10-04',
    customer: '합성 고객사',
    projectName: '구성도 변환 검증',
    contact: '합성 담당자',
    conditions: [' - 합성 조건'],
  },
  defaultSystemName: '회의실',
});

const requests = result.document.rows
  .filter(
    (r): r is typeof r & { type: 'item'; laborMappingId: string } =>
      r.type === 'item' && r.laborMode === 'mapped' && r.laborMappingId !== undefined,
  )
  .map((r) => ({ rowId: r.rowId, laborMappingId: r.laborMappingId }));

const laborResult = calculateLaborForRows(requests, labor);
const calculation = calculateQuote(result.document, {
  laborUnitPrices: laborResult.unitPrices,
});

console.log('=== 견적 행 ===');
const system = calculation.systems[0]!;
const calcByRow = new Map(system.rows.map((r) => [r.rowId, r]));

for (const row of result.document.rows) {
  if (row.type !== 'item') continue;
  const calc = calcByRow.get(row.rowId);
  const material = calc?.materialAmount === undefined ? '미등록' : formatKRW(calc.materialAmount);
  const labour = calc?.laborAmount === undefined ? '-' : formatKRW(calc.laborAmount);
  console.log(
    `  ${row.name.slice(0, 26).padEnd(28)} ${row.specification.slice(0, 18).padEnd(20)} ` +
      `${row.quantity.padStart(5)}${row.unit.padEnd(5)} 재료 ${material.padStart(12)}  노무 ${labour.padStart(10)}`,
  );
}

console.log('');
console.log(`직접비계   재료 ${formatKRW(system.directMaterial).padStart(14)}  노무 ${formatKRW(system.directLabor).padStart(12)}`);
console.log('간접비:');
for (const item of system.indirect) {
  if (!item.applied) continue;
  console.log(`  ${item.name.padEnd(22)} ${item.rate.toFixed().padStart(8)}  ${formatKRW(item.amount).padStart(12)}`);
}
console.log(`간접비계   ${formatKRW(system.indirectTotal).padStart(14)}`);
console.log(`시스템 합계 ${formatKRW(system.systemTotal).padStart(14)}`);
console.log(`갑지 최종   ${formatKRW(calculation.cover.finalTotal).padStart(14)}`);

console.log('');
console.log(`변환 경고 ${result.warnings.length}건 (차단 ${result.warnings.filter((w) => w.blocking).length}):`);
for (const w of result.warnings) console.log(`  [${w.code}] ${w.message}`);
console.log(`계산 경고 ${calculation.warnings.length}건 (차단 ${calculation.warnings.filter((w) => w.blocking).length})`);
for (const w of calculation.warnings.slice(0, 6)) console.log(`  [${w.code}] ${w.message}`);

// --- Excel ---
const projection = buildCustomerProjection(result.document, calculation);
const template = new Uint8Array(readFileSync(TEMPLATE_PATH));
const workbook = buildQuoteWorkbook(projection, template);
mkdirSync('tests/fixtures/out', { recursive: true });
const out = resolve('tests/fixtures/out/diagram-real-quote.xlsx');
writeFileSync(out, workbook.bytes);
console.log('');
console.log(`Excel 저장: ${out}  시트 ${workbook.sheetNames.join(' / ')}`);
