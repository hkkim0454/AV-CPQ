/**
 * 실물 카탈로그와 구성도로 매칭률을 측정한다. 진단용이며 제품 코드가 아니다.
 *
 * 실행:  npx vite-node tools/probe_match.ts
 */
import { readFileSync } from 'node:fs';
import { buildCatalog } from '../src/data/catalog/load';
import { matchByModel } from '../src/import/diagram/matchCatalog';
import { parseDiagram } from '../src/import/diagram/schema';

const catalog = buildCatalog(
  JSON.parse(readFileSync('data/approved/products.json', 'utf8')),
  JSON.parse(readFileSync('data/approved/prices.json', 'utf8')),
);
console.log(
  `카탈로그 제품 ${catalog.products.length}, 가격 ${catalog.prices.size}, pricesAvailable=${catalog.pricesAvailable}`,
);

const diagram = parseDiagram(
  JSON.parse(readFileSync('.local/samples/av-diagram.json', 'utf8')),
);
const db = (diagram.equipmentDB ?? []) as Array<{ id?: string; model?: string }>;

let exact = 0;
let normalized = 0;
let fragment = 0;
let none = 0;
let ambiguous = 0;
let priced = 0;
const misses: string[] = [];

for (const item of db) {
  const result = matchByModel(item.model, catalog);
  if (result.matchedBy === 'model-exact') exact += 1;
  else if (result.matchedBy === 'model-normalized') normalized += 1;
  else if (result.matchedBy === 'model-fragment') fragment += 1;
  else {
    none += 1;
    if (result.ambiguousSkus !== undefined) ambiguous += 1;
    if (misses.length < 12 && item.model) misses.push(item.model);
  }
  if (result.sellingUnitPrice !== undefined) priced += 1;
}

const hit = exact + normalized + fragment;
console.log('');
console.log(`equipmentDB ${db.length}건`);
console.log(`  정확 일치   ${exact}`);
console.log(`  정규화 일치 ${normalized}`);
console.log(`  조각 일치   ${fragment}`);
console.log(`  미매칭      ${none}  (그중 모호 ${ambiguous})`);
console.log(`  매칭률 ${hit}/${db.length} = ${((hit / db.length) * 100).toFixed(1)}%`);
console.log(`  단가까지 붙은 것 ${priced}`);
console.log('');
console.log('미매칭 샘플:');
for (const m of misses) console.log(`  - ${m}`);

console.log('');
console.log('구성도에 실제 쓰인 노드:');
for (const node of diagram.nodes) {
  const result = matchByModel(node.data.model, catalog);
  const price = result.sellingUnitPrice !== undefined ? '단가 있음' : '단가 미등록';
  console.log(
    `  ${String(node.data.model).slice(0, 30).padEnd(32)} ${result.matchedBy.padEnd(18)} ${result.product?.sku ?? '-'}  ${price}`,
  );
}
