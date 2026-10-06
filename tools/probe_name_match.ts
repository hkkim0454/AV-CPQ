/**
 * 모델명 4단계 대조의 실제 효과를 잰다 (계획 2026-10-06 Task 3).
 *
 * **건수가 아니라 연결 대상 SKU 를 본다.** 건수가 같아도 다른 제품에 붙을 수 있다.
 * 기존에 연결·후보가 있던 항목은 그대로여야 하고, 아무것도 없던 항목에만
 * 후보가 생길 수 있다.
 */
import { readFileSync } from 'node:fs';
import { buildCatalog } from '../src/data/catalog/load';
import { matchByModel } from '../src/import/diagram/matchCatalog';

const DIAGRAM =
  'C:\\Users\\khk00\\.paseo\\uploads\\upload_65e50d03-d489-4758-a42f-c563ef8f1413\\av-diagram-1791037942542.json';

interface Equipment {
  readonly model?: string;
  readonly name?: string;
  readonly category?: string;
}

const diagram = JSON.parse(readFileSync(DIAGRAM, 'utf-8')) as { equipmentDB: Equipment[] };
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const catalog = buildCatalog(
  read('data/approved/products.json'),
  read('data/approved/prices.json'),
);

const counts = {
  연결됨: 0,
  모호: 0,
  '후보 생김': 0,
  '아무것도 없음': 0,
  '빈 모델명': 0,
};
const newCandidates: Array<{ model: string; sku: string; fields: string }> = [];
const linked: Array<{ model: string; sku: string; by: string }> = [];

for (const item of diagram.equipmentDB) {
  const model = item.model?.trim() ?? '';
  if (model === '') {
    counts['빈 모델명'] += 1;
    continue;
  }
  const result = matchByModel(model, catalog);
  if (result.product !== undefined) {
    counts.연결됨 += 1;
    linked.push({ model, sku: result.product.sku, by: result.matchedBy });
  } else if (result.ambiguousSkus !== undefined) {
    counts.모호 += 1;
  } else if (result.nameCandidates !== undefined) {
    counts['후보 생김'] += 1;
    for (const c of result.nameCandidates) {
      newCandidates.push({ model, sku: c.sku, fields: c.fields.join('+') });
    }
  } else {
    counts['아무것도 없음'] += 1;
  }
}

console.log('=== av-builder equipmentDB 대조 ===');
let total = 0;
for (const [key, value] of Object.entries(counts)) {
  console.log(`  ${key.padEnd(14)} ${value}`);
  total += value;
}
console.log(`  ${'합계'.padEnd(14)} ${total}`);

console.log('\n=== 새로 생긴 후보 ===');
for (const c of newCandidates) {
  console.log(`  ${c.model.padEnd(24)} -> ${c.sku.padEnd(10)} [${c.fields}]`);
}

// 연결된 것은 전부 찍어 수정 전후 비교에 쓴다.
const out = linked.map((l) => `${l.model}\t${l.sku}\t${l.by}`).join('\n');
console.log(`\n=== 연결된 ${linked.length}건 (지문) ===`);
console.log(out.length > 0 ? `  첫 줄: ${out.split('\n')[0]}` : '  없음');
process.stdout.write(`\n__LINKED__\n${out}\n`);
