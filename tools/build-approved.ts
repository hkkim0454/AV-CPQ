/**
 * 원시 덤프 → 배포 데이터 (계획 Task 5).
 *
 *   .local/raw/catalog-raw.json  →  data/approved/*.json
 *
 * 실행:  npx vite-node tools/build-approved.ts
 *
 * 다섯 파일을 만든다.
 *   products.json        제품 (가격 없음)
 *   prices.json          판매단가만        ← 결정 D3: 반드시 분리
 *   labor-items.json     품셈 항목
 *   wage-table.json      노임표
 *   labor-mappings.json  SKU ↔ 품셈 연결
 *
 * 쓰기 전에 **감사 게이트**를 통과해야 한다. 하나라도 걸리면 아무것도 쓰지 않는다.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildProducts } from '../src/data/catalog/buildProducts';
import { buildLabor } from '../src/data/catalog/buildLabor';
import {
  productsFileSchema,
  pricesFileSchema,
  laborItemsFileSchema,
  wageTableFileSchema,
  laborMappingsFileSchema,
} from '../src/data/catalog/schema';
import { auditApprovedPayload } from '../src/data/catalog/audit';
import type { RawCatalog } from '../src/data/catalog/rawTypes';

const ROOT = resolve(import.meta.dirname, '..');
const RAW = resolve(ROOT, '.local/raw/catalog-raw.json');
const OUT = resolve(ROOT, 'data/approved');

function main(): void {
  const raw = JSON.parse(readFileSync(RAW, 'utf8')) as RawCatalog;
  const generatedOn = new Date().toISOString().slice(0, 10);
  const sourceSha256 = raw.source.sha256;

  const { products, prices, stats } = buildProducts(raw.sheets);
  const labor = buildLabor(raw.sheets);

  if (stats.duplicateSkus.length > 0) {
    throw new Error(`SKU 중복 ${stats.duplicateSkus.length}건: ${stats.duplicateSkus.join(', ')}`);
  }

  const files = {
    'products.json': productsFileSchema.parse({
      schemaVersion: 1,
      generatedOn,
      sourceSha256,
      products,
    }),
    'prices.json': pricesFileSchema.parse({
      schemaVersion: 1,
      generatedOn,
      sourceSha256,
      currency: 'KRW',
      prices,
    }),
    'labor-items.json': laborItemsFileSchema.parse({
      schemaVersion: 1,
      generatedOn,
      sourceSha256,
      laborItems: labor.laborItems,
    }),
    'wage-table.json': wageTableFileSchema.parse({
      schemaVersion: 1,
      generatedOn,
      sourceSha256,
      wageTable: labor.wageTable,
    }),
    'labor-mappings.json': laborMappingsFileSchema.parse({
      schemaVersion: 1,
      generatedOn,
      sourceSha256,
      mappings: labor.mappings,
      unmappedSkus: labor.unmappedSkus,
    }),
  };

  // --- 감사 게이트: 하나라도 걸리면 아무것도 쓰지 않는다 ---
  const findings = auditApprovedPayload(files);
  if (findings.length > 0) {
    console.error(`\n=== 감사 실패 ${findings.length}건 — 파일을 쓰지 않는다 ===`);
    for (const finding of findings.slice(0, 30)) console.error('  ! ' + finding);
    process.exit(1);
  }

  mkdirSync(OUT, { recursive: true });
  for (const [name, payload] of Object.entries(files)) {
    writeFileSync(resolve(OUT, name), JSON.stringify(payload, null, 1) + '\n', 'utf8');
  }

  // --- 보고 ---
  console.log(`원본 SHA-256: ${sourceSha256}`);
  console.log(`\n제품 ${stats.totalProducts}  판매단가 ${stats.totalPriced}  품셈코드 ${stats.totalWithLaborCode}`);
  console.log(`품셈 항목 ${labor.laborItems.length}  매핑 ${labor.mappings.length}  매핑 없음 ${labor.unmappedSkus.length}`);
  console.log(`노임 직종 ${Object.keys(labor.wageTable.wages).length}`);

  console.log('\n시트별:');
  const rows = Object.entries(stats.bySheet).sort((a, b) => b[1].products - a[1].products);
  for (const [sheet, s] of rows) {
    console.log(`  ${sheet.padEnd(26)} 제품 ${String(s.products).padStart(4)}  단가 ${String(s.priced).padStart(4)}  품셈 ${String(s.withLaborCode).padStart(4)}`);
  }

  if (labor.conflicts.length > 0) {
    console.log(`\n사람이 확인할 것 ${labor.conflicts.length}건:`);
    for (const conflict of labor.conflicts.slice(0, 20)) console.log('  - ' + conflict);
    if (labor.conflicts.length > 20) console.log(`  … 외 ${labor.conflicts.length - 20}건`);
  }

  console.log(`\n저장: ${OUT}`);
}

main();
