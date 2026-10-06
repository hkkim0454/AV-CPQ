/**
 * 현행·준비 자료만 읽고 사람이 고르는 문서를 docs/에 만든다.
 * 실행: npx vite-node tools/probe_pumsem_review_cli.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildCatalog, buildLaborReference } from '../src/data/catalog/load';
import { proposeSkuMigration } from '../src/data/catalog/skuMigration';
import { renderPumsemReview } from './probe_pumsem_review';

const read = (dir: string, name: string): unknown =>
  JSON.parse(readFileSync(`${dir}/${name}.json`, 'utf8'));

function load(dir: string) {
  const catalog = buildCatalog(read(dir, 'products'), read(dir, 'prices'));
  if (!catalog.pricesAvailable) throw new Error(`${dir}: 판매단가를 읽지 못했다`);
  const labor = buildLaborReference(
    read(dir, 'labor-items'), read(dir, 'wage-table'), read(dir, 'labor-mappings'),
  );
  return { catalog, labor };
}

const old = load('data/approved');
const next = load('.local/staging/approved');
const migration = proposeSkuMigration(old.catalog, next.catalog);
const undecided = migration.entries.filter((entry) => entry.status === 'undecided').length;
const unmappable = migration.entries.filter((entry) => entry.status === 'unmappable').length;
if (undecided !== 173 || unmappable !== 33) {
  throw new Error(`검토 대상 수가 바뀌었다: 후보 있음 ${undecided}, 후보 없음 ${unmappable}`);
}

const markdown = renderPumsemReview(
  old.catalog,
  next.catalog,
  migration,
  new Set(old.labor.mappings.map((mapping) => mapping.sku)),
  new Set(next.labor.mappings.map((mapping) => mapping.sku)),
);
const path = 'docs/pumsem-2026h2-sku-review.md';
writeFileSync(path, markdown, 'utf8');
console.log(`${path}: 후보 있음 ${undecided}건, 후보 없음 ${unmappable}건`);
