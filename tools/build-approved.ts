/**
 * 원시 덤프 → 배포 데이터 (계획 Task 5, 2026-10-05 하반기 품셈 교체 계획 Task 0).
 *
 *   .local/raw/catalog-raw.json  →  (기본) .local/staging/approved/*.json
 *
 * 실행:  npx vite-node tools/build-approved.ts [--raw <경로>] [--out <경로>]
 *
 * 다섯 파일을 만든다.
 *   products.json        제품 (가격 없음)
 *   prices.json          판매단가만        ← 결정 D3: 반드시 분리
 *   labor-items.json     품셈 항목
 *   wage-table.json      노임표
 *   labor-mappings.json  SKU ↔ 품셈 연결
 *
 * ## 무인자 기본 출력은 staging 이다 (하반기 교체 계획 Task 0)
 *
 * `data/approved`(실제 배포 경로)로 쓰는 것은 **명시로 `--out data/approved`를
 * 줄 때만** 일어난다 — 그리고 그건 하반기 교체 계획의 **Task 5에서만** 쓴다.
 * 실수로 현행 배포 자료를 덮어쓰는 사고를 막으려고 기본값을 바꿨다
 * (Codex 지적: 예전엔 `OUT`이 `data/approved`로 고정이라, Task 1~4를
 * 검증하다가 현행 배포 자료를 덮어쓸 수 있었다).
 *
 * ## 쓰기 순서 — 검증 전부가 끝난 뒤에만 쓴다
 *
 * `labor.conflicts`(노임 단위 충돌 등)와 감사 게이트 둘 다 **파일을 쓰기 전에** 돈다.
 * 둘 중 하나라도 걸리면 **아무것도 쓰지 않는다** — 예전엔 충돌을 쓴 뒤에만 보고했다.
 *
 * ## 다섯 파일을 "완성된 세트"로 한 번에 자리를 바꾼다
 *
 * 검증을 통과해도 **쓰는 도중에 멈출 수 있다**(디스크가 차거나 프로세스가 죽는 등).
 * 그래서 임시 폴더에 다섯 파일을 전부 쓴 뒤에만 기존 자리와 통째로 바꾼다 —
 * 세 번째 파일을 쓰다 실패해도 기존 `out` 디렉터리는 전혀 건드리지 않는다
 * (`writeApprovedSet`, 시험: `tests/unit/buildApproved.test.ts`).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildProducts } from '../src/data/catalog/buildProducts';
import { buildLabor, type BuildLaborResult } from '../src/data/catalog/buildLabor';
import {
  productsFileSchema,
  pricesFileSchema,
  laborItemsFileSchema,
  wageTableFileSchema,
  laborMappingsFileSchema,
} from '../src/data/catalog/schema';
import { auditApprovedPayload } from '../src/data/catalog/audit';
import type { RawCatalog } from '../src/data/catalog/rawTypes';
import type { BuildProductsResult } from '../src/data/catalog/buildProducts';

const ROOT = resolve(import.meta.dirname, '..');

export interface PreparedApproved {
  ok: true;
  files: Record<string, unknown>;
  stats: BuildProductsResult['stats'];
  labor: BuildLaborResult;
}

export interface BlockedApproved {
  ok: false;
  /** 사람이 읽는 중단 사유 — 한 줄 요약. */
  reason: string;
  /** 구체적 항목 목록(있으면). 추론 실패 값 자체는 담지 않는다 — 호출부 책임. */
  findings?: readonly string[];
}

/**
 * 원시 덤프를 다섯 배포 파일로 **준비만** 한다 — 디스크에 쓰지 않는다.
 *
 * 노임 충돌·감사 실패·SKU 중복·sourceSha256 불일치 중 **하나라도 있으면**
 * `ok: false`를 돌려주고, 호출부는 그 경우 `writeApprovedSet`을 부르지 않는다.
 */
export function prepareApprovedFiles(raw: RawCatalog): PreparedApproved | BlockedApproved {
  const generatedOn = new Date().toISOString().slice(0, 10);
  const sourceSha256 = raw.source.sha256;

  const { products, prices, stats } = buildProducts(raw.sheets);
  const labor = buildLabor(raw.sheets);

  if (stats.duplicateSkus.length > 0) {
    return { ok: false, reason: `SKU 중복 ${stats.duplicateSkus.length}건: ${stats.duplicateSkus.join(', ')}` };
  }

  // 쓰기 순서를 뒤집는다 — 노임 충돌은 쓰기 전에 막는다(하반기 계획 Task 0).
  if (labor.conflicts.length > 0) {
    return {
      ok: false,
      reason: `품셈/노임 충돌 ${labor.conflicts.length}건 — 아무것도 쓰지 않는다.`,
      findings: labor.conflicts,
    };
  }

  const files: Record<string, unknown> = {
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

  const findings = auditApprovedPayload(files);
  if (findings.length > 0) {
    return { ok: false, reason: `감사 실패 ${findings.length}건 — 아무것도 쓰지 않는다.`, findings };
  }

  // 다섯 파일이 전부 같은 원본에서 나왔는지 명시로 확인한다(하반기 계획 Task 0 체크리스트).
  const hashes = new Set(
    Object.values(files).map((f) => (f as { sourceSha256: string }).sourceSha256),
  );
  if (hashes.size !== 1) {
    return {
      ok: false,
      reason: `다섯 파일의 sourceSha256이 서로 다르다 (${[...hashes].join(', ')}).`,
    };
  }

  return { ok: true, files, stats, labor };
}

export interface ApprovedWriteFsApi {
  mkdirSync: typeof mkdirSync;
  writeFileSync: typeof writeFileSync;
  existsSync: typeof existsSync;
  renameSync: typeof renameSync;
  rmSync: typeof rmSync;
}

const defaultFsApi: ApprovedWriteFsApi = { mkdirSync, writeFileSync, existsSync, renameSync, rmSync };

/**
 * 완성된 다섯 파일을 `outDir`에 **한 번에** 반영한다.
 *
 * 임시 폴더에 전부 쓴 뒤에만 기존 `outDir`과 자리를 바꾼다 — 쓰는 도중(예:
 * 세 번째 파일) 실패하면 임시 폴더만 버려지고 **기존 `outDir`은 전혀 건드리지
 * 않는다.** 자리 바꾸기 자체가 실패하면(드묾) 백업에서 되돌린다.
 */
export function writeApprovedSet(
  files: Record<string, unknown>,
  outDir: string,
  fsApi: ApprovedWriteFsApi = defaultFsApi,
): void {
  const tmpDir = `${outDir}.tmp-${process.pid}-${Date.now()}`;
  fsApi.mkdirSync(tmpDir, { recursive: true });
  try {
    for (const [name, payload] of Object.entries(files)) {
      fsApi.writeFileSync(resolve(tmpDir, name), JSON.stringify(payload, null, 1) + '\n', 'utf8');
    }
  } catch (err) {
    fsApi.rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }

  const backupDir = fsApi.existsSync(outDir) ? `${outDir}.bak-${Date.now()}` : undefined;
  if (backupDir !== undefined) fsApi.renameSync(outDir, backupDir);
  try {
    fsApi.renameSync(tmpDir, outDir);
  } catch (err) {
    if (backupDir !== undefined) fsApi.renameSync(backupDir, outDir);
    throw err;
  }
  if (backupDir !== undefined) fsApi.rmSync(backupDir, { recursive: true, force: true });
}

export interface ParsedArgs {
  raw: string;
  out: string;
}

/** `--raw`/`--out` → 환경변수 → 기본값(staging) 순으로 가른다. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let rawArg: string | undefined;
  let outArg: string | undefined;
  let i = 0;
  while (i < argv.length) {
    if (argv[i] === '--raw' && i + 1 < argv.length) {
      rawArg = argv[i + 1];
      i += 2;
      continue;
    }
    if (argv[i] === '--out' && i + 1 < argv.length) {
      outArg = argv[i + 1];
      i += 2;
      continue;
    }
    i += 1;
  }
  const raw = rawArg ?? process.env['AVCPQ_CATALOG_RAW'] ?? resolve(ROOT, '.local/raw/catalog-raw.json');
  // ⛔ 무인자 기본은 staging 하나다. data/approved는 명시 옵션으로만, Task 5에서만 쓴다.
  const out = outArg ?? process.env['AVCPQ_APPROVED_OUT'] ?? resolve(ROOT, '.local/staging/approved');
  return { raw, out };
}

function main(): void {
  const { raw: rawPath, out } = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(readFileSync(rawPath, 'utf8')) as RawCatalog;

  const prepared = prepareApprovedFiles(raw);
  if (!prepared.ok) {
    console.error(`\n=== 중단 — ${prepared.reason} ===`);
    for (const finding of (prepared.findings ?? []).slice(0, 30)) console.error('  ! ' + finding);
    process.exit(1);
  }

  writeApprovedSet(prepared.files, out);

  const { stats, labor } = prepared;
  console.log(`원본 SHA-256: ${raw.source.sha256}`);
  console.log(`\n제품 ${stats.totalProducts}  판매단가 ${stats.totalPriced}  품셈코드 ${stats.totalWithLaborCode}`);
  console.log(`품셈 항목 ${labor.laborItems.length}  매핑 ${labor.mappings.length}  매핑 없음 ${labor.unmappedSkus.length}`);
  console.log(`노임 직종 ${Object.keys(labor.wageTable.wages).length}`);

  console.log('\n시트별:');
  const rows = Object.entries(stats.bySheet).sort((a, b) => b[1].products - a[1].products);
  for (const [sheet, s] of rows) {
    console.log(`  ${sheet.padEnd(26)} 제품 ${String(s.products).padStart(4)}  단가 ${String(s.priced).padStart(4)}  품셈 ${String(s.withLaborCode).padStart(4)}`);
  }

  console.log(`\n저장: ${out}`);
}

const entryPath = process.argv[1] !== undefined ? resolve(process.argv[1]) : undefined;
if (entryPath !== undefined && entryPath === fileURLToPath(import.meta.url)) {
  main();
}
