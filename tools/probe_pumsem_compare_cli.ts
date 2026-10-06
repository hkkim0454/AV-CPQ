/**
 * 읽기 전용 하반기 품셈 대조. 실행: npx vite-node tools/probe_pumsem_compare_cli.ts
 * 배포 자료나 준비 자료를 쓰지 않는다. 출력은 집계와 검증된 제품 예시뿐이다.
 */
import { readFileSync } from 'node:fs';
import Decimal from 'decimal.js';
import { buildCatalog, buildLaborReference } from '../src/data/catalog/load';
import { proposeSkuMigration, summarizeSkuMigration } from '../src/data/catalog/skuMigration';
import { calculateLaborForRows } from '../src/domain/labor/calculateLabor';
import { calculateQuote } from '../src/domain/calculation/calculate';
import type { QuoteDocument, SheetRow } from '../src/domain/quote/types';
import { syntheticQuote } from '../tests/fixtures/syntheticQuote';
import { compareMatchedPrices, oneToOneMatches } from './probe_pumsem_compare';

const read = (base: string, name: string): unknown =>
  JSON.parse(readFileSync(`${base}/${name}.json`, 'utf8'));

function load(base: string) {
  const catalog = buildCatalog(read(base, 'products'), read(base, 'prices'));
  if (!catalog.pricesAvailable) throw new Error(`${base}: 단가 자료를 읽을 수 없다`);
  const labor = buildLaborReference(
    read(base, 'labor-items'), read(base, 'wage-table'), read(base, 'labor-mappings'),
  );
  return { catalog, labor };
}

const old = load('data/approved');
const next = load('.local/staging/approved');
const migration = proposeSkuMigration(old.catalog, next.catalog);
const summary = summarizeSkuMigration(migration, old.catalog, next.catalog);
const mapped = migration.entries.filter((entry) => entry.status === 'mapped' && entry.targetSku !== undefined)
  .map((entry) => ({ sourceSku: entry.sourceSku, targetSku: entry.targetSku! }));
const priceMatches = oneToOneMatches(mapped);
const prices = compareMatchedPrices(
  Object.fromEntries([...old.catalog.prices].map(([sku, sellingUnitPrice]) => [sku, { sellingUnitPrice }])),
  Object.fromEntries([...next.catalog.prices].map(([sku, sellingUnitPrice]) => [sku, { sellingUnitPrice }])),
  priceMatches,
);

const mappingCount = (data: typeof old) => new Set(data.labor.mappings.map((m) => m.sku));
const oldMapped = mappingCount(old);
const newMapped = mappingCount(next);
const matchedMapping = { both: 0, removed: 0, added: 0, neither: 0 };
for (const pair of mapped) {
  const a = oldMapped.has(pair.sourceSku);
  const b = newMapped.has(pair.targetSku);
  if (a && b) matchedMapping.both++;
  else if (a) matchedMapping.removed++;
  else if (b) matchedMapping.added++;
  else matchedMapping.neither++;
}

const oldWages = old.labor.wages.wages;
const newWages = next.labor.wages.wages;
const wageChanges = [...new Set([...Object.keys(oldWages), ...Object.keys(newWages)])].sort()
  .map((trade) => ({
    trade,
    old: oldWages[trade]?.amount ?? null,
    next: newWages[trade]?.amount ?? null,
    oldUnit: oldWages[trade]?.unit ?? null,
    nextUnit: newWages[trade]?.unit ?? null,
    difference: oldWages[trade] && newWages[trade]
      ? new Decimal(newWages[trade].amount).minus(oldWages[trade].amount).toString()
      : null,
    oldItemUses: old.labor.items.filter((item) => item.trades.some((t) => t.trade === trade)).length,
    newItemUses: next.labor.items.filter((item) => item.trades.some((t) => t.trade === trade)).length,
  }));

function groupCounts(data: typeof old): Record<string, { products: number; mappings: number }> {
  const groups: Record<string, { products: number; mappings: number }> = {};
  const mappingSkus = mappingCount(data);
  for (const product of data.catalog.products) {
    const key = product.options['group'] || product.options['category'] || '(무명)';
    const cell = groups[key] ??= { products: 0, mappings: 0 };
    cell.products++;
    if (mappingSkus.has(product.sku)) cell.mappings++;
  }
  return groups;
}
const oldGroups = groupCounts(old);
const newGroups = groupCounts(next);
const migrationByOldSku = new Map(migration.entries.map((entry) => [entry.sourceSku, entry]));
const vanishedGroups = Object.entries(oldGroups)
  .filter(([group, count]) => count.mappings > 0 && (newGroups[group]?.mappings ?? 0) === 0)
  .map(([group, count]) => {
    const sourceSkus = old.catalog.products
      .filter((p) => p.options['group'] === group && oldMapped.has(p.sku))
      .map((p) => p.sku);
    return {
      group, oldMappings: count.mappings, newProducts: newGroups[group]?.products ?? 0,
      autoMatchedElsewhere: sourceSkus.filter((sku) => migrationByOldSku.get(sku)?.status === 'mapped').length,
      undecided: sourceSkus.filter((sku) => migrationByOldSku.get(sku)?.status === 'undecided').length,
      unmappable: sourceSkus.filter((sku) => migrationByOldSku.get(sku)?.status === 'unmappable').length,
    };
  });

function quoteFor(data: typeof old, sourceSkus: string[], sourceToTarget: Map<string, string>) {
  const base = syntheticQuote();
  const products = new Map(data.catalog.products.map((p) => [p.sku, p]));
  const rows: Array<Extract<SheetRow, { type: 'item' }>> = sourceSkus.map((sourceSku, index) => {
    const sku = sourceToTarget.get(sourceSku);
    if (!sku) throw new Error(`신원이 확인되지 않은 SKU: ${sourceSku}`);
    const product = products.get(sku);
    if (!product) throw new Error(`제품 없음: ${sku}`);
    const price = data.catalog.prices.get(sku);
    if (price === undefined) throw new Error(`판매단가 미등록: ${sku}`);
    if (!product.laborMappingId || !mappingCount(data).has(sku)) throw new Error(`품셈 매핑 없음: ${sku}`);
    return {
      type: 'item', rowId: `r${index + 1}`, systemId: 'S1', productId: product.productId,
      sku, name: product.quoteName, specification: product.quoteSpec, unit: product.unit,
      quantity: '1', sellingUnitPrice: price, laborMode: 'mapped',
      laborMappingId: product.laborMappingId, remark: '', origin: 'manual',
    };
  });
  const document: QuoteDocument = {
    ...base,
    systems: [base.systems[0]!],
    coverGroups: [{ ...base.coverGroups[0]!, systemIds: ['S1'] }],
    rows,
    derivedRows: [],
    negoDeduction: '0',
  };
  const requests = rows.map((row) => ({
      rowId: row.rowId, laborMappingId: row.laborMappingId!,
      identity: { productId: row.productId, sku: row.sku, unit: row.unit, quantity: row.quantity, ruleVersion: document.versions.rule },
    }));
  const laborResult = calculateLaborForRows(requests, data.labor);
  const calculation = calculateQuote(document, { laborUnitPrices: laborResult.unitPrices });
  const system = calculation.systems[0]!;
  return {
    items: rows.map((row) => ({ sku: row.sku, name: row.name, spec: row.specification, quantity: row.quantity })),
    material: system.directMaterial.toString(),
    labor: system.directLabor.toString(),
    indirect: system.indirectTotal.toString(),
    systemTotal: system.systemTotal.toString(),
    finalTotal: calculation.cover.finalTotal.toString(),
    calculationBlocking: calculation.warnings.filter((w) => w.blocking).length,
    laborBlocking: laborResult.warnings.filter((w) => w.blocking).length,
  };
}

const quoteSourceSkus = ['VID-', 'AUD-'].map((prefix) => {
  const pair = priceMatches
    .filter(({ sourceSku, targetSku }) =>
      sourceSku.startsWith(prefix) &&
      old.catalog.prices.has(sourceSku) && next.catalog.prices.has(targetSku) &&
      oldMapped.has(sourceSku) && newMapped.has(targetSku),
    )
    .sort((a, b) => {
      const change = (pair: typeof a) => new Decimal(next.catalog.prices.get(pair.targetSku)!)
        .minus(old.catalog.prices.get(pair.sourceSku)!).abs();
      return change(b).cmp(change(a));
    })[0];
  if (!pair) throw new Error(`${prefix}: 양쪽 단가·품셈이 있는 자동 대응 제품이 없다`);
  return pair.sourceSku;
});
const quoteOld = quoteFor(old, quoteSourceSkus, new Map(quoteSourceSkus.map((sku) => [sku, sku])));
const quoteNew = quoteFor(next, quoteSourceSkus, new Map(mapped.map((pair) => [pair.sourceSku, pair.targetSku])));

const tenfoldUp = prices.changes.filter((c) => c.ratio !== null && new Decimal(c.ratio).gte(10));
const tenfoldDown = prices.changes.filter((c) => c.ratio !== null && new Decimal(c.ratio).lte(0.1));
const positiveChanges = prices.changes.filter((c) => c.ratio !== null && new Decimal(c.difference).gt(0));
const negativeChanges = prices.changes.filter((c) => c.ratio !== null && new Decimal(c.difference).lt(0));
const mappedOldSkus = new Set(mapped.map((p) => p.sourceSku));
const mappedNewSkus = new Set(mapped.map((p) => p.targetSku));
const targetUse = new Map<string, string[]>();
for (const pair of mapped) {
  const sourceSkus = targetUse.get(pair.targetSku) ?? [];
  sourceSkus.push(pair.sourceSku);
  targetUse.set(pair.targetSku, sourceSkus);
}
const summaryOutput = {
  sources: { old: old.catalog.sourceSha256, next: next.catalog.sourceSha256 },
  counts: {
    products: [old.catalog.products.length, next.catalog.products.length],
    priced: [old.catalog.prices.size, next.catalog.prices.size],
    zeroPriced: [
      [...old.catalog.prices.values()].filter((price) => new Decimal(price).isZero()).length,
      [...next.catalog.prices.values()].filter((price) => new Decimal(price).isZero()).length,
    ],
    laborItems: [old.labor.items.length, next.labor.items.length],
    mappings: [old.labor.mappings.length, next.labor.mappings.length],
    unmapped: [old.labor.unmappedSkus.length, next.labor.unmappedSkus.length],
    wageTrades: [Object.keys(oldWages).length, Object.keys(newWages).length],
  },
  migration: summary,
  matchedPrices: {
    ...Object.fromEntries(Object.entries(prices).filter(([key]) => key !== 'changes')),
    excludedManyToOnePairs: mapped.length - priceMatches.length,
    tenfoldUp: tenfoldUp.length,
    tenfoldDown: tenfoldDown.length,
    largestRelativeIncrease: [...positiveChanges].sort((a, b) => new Decimal(b.ratio!).cmp(a.ratio!))[0] ?? null,
    largestRelativeDecrease: [...negativeChanges].sort((a, b) => new Decimal(a.ratio!).cmp(b.ratio!))[0] ?? null,
    topIncrease: [...prices.changes].sort((a, b) => new Decimal(b.difference).cmp(a.difference)).slice(0, 8),
    topDecrease: [...prices.changes].sort((a, b) => new Decimal(a.difference).cmp(b.difference)).slice(0, 8),
    tenfoldExamples: [...tenfoldUp, ...tenfoldDown].slice(0, 20),
    zeroExamples: prices.changes.filter((c) => c.newPrice === '0').slice(0, 20),
  },
  matchedMapping,
  mappedTargetCollisions: [...targetUse].filter(([, sources]) => sources.length > 1)
    .map(([targetSku, sources]) => ({ targetSku, sourceSkus: sources })),
  unmatchedByExactIdentity: {
    oldProducts: old.catalog.products.length - mapped.length,
    newProducts: next.catalog.products.length - mappedNewSkus.size,
    oldPriced: [...old.catalog.prices.keys()].filter((sku) => !mappedOldSkus.has(sku)).length,
    newPriced: [...next.catalog.prices.keys()].filter((sku) => !mappedNewSkus.has(sku)).length,
    oldMappings: [...oldMapped].filter((sku) => !mappedOldSkus.has(sku)).length,
    newMappings: [...newMapped].filter((sku) => !mappedNewSkus.has(sku)).length,
  },
  wageChanges,
  vanishedGroups,
  quote: {
    old: quoteOld,
    next: quoteNew,
    difference: new Decimal(quoteNew.finalTotal).minus(quoteOld.finalTotal).toString(),
  },
};
console.log(JSON.stringify(summaryOutput, null, 2));
