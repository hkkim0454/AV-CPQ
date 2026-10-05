/**
 * 원시 덤프 → 배포 데이터 (계획 Task 5, 2026-10-05 하반기 품셈 교체 계획 Task 0).
 *
 *   .local/raw/catalog-raw.json  →  (기본) .local/staging/approved/*.json
 *
 * 실행:  npx vite-node tools/build-approved.ts [--raw <경로>] [--out <경로>] [--confirm-production-write]
 *
 * 다섯 파일을 만든다.
 *   products.json        제품 (가격 없음)
 *   prices.json          판매단가만        ← 결정 D3: 반드시 분리
 *   labor-items.json     품셈 항목
 *   wage-table.json      노임표
 *   labor-mappings.json  SKU ↔ 품셈 연결
 *
 * ## 무인자 기본 출력은 staging 이다
 *
 * `data/approved`(실제 배포 경로)로 쓰려면 **`--out data/approved`와
 * `--confirm-production-write`를 CLI 인자로 함께 줘야 한다** — 둘 중 하나라도
 * 빠지면 막는다. **환경변수만으로는 배포 경로에 닿을 수 없다**(Codex 재지적
 * — 전엔 `AVCPQ_APPROVED_OUT`만 배포 경로로 둬도 무인자 호출이 그대로
 * 덮어썼다). 그 경로를 실제로 쓰는 것은 하반기 교체 계획의 **Task 5 전용**이고
 * 이번 라운드에서는 쓰지 않는다.
 *
 * ## 쓰기 순서 — 검증 전부가 끝난 뒤에만 쓴다
 *
 * `labor.conflicts`(노임 단위 충돌 등)와 감사 게이트 둘 다 **파일을 쓰기 전에** 돈다.
 * 둘 중 하나라도 걸리면 **아무것도 쓰지 않는다.**
 *
 * ## 다섯 파일을 "완성된 세트"로 한 번에 자리를 바꾼다
 *
 * 임시 폴더에 다섯 파일을 전부 쓴 뒤에만 기존 자리와 통째로 바꾼다. 전환은
 * 두 단계(기존→백업, 임시→기존)로 이뤄지는 `rename` 두 번이라 완전한
 * 단일 연산은 아니다 — 각 단계의 실패를 전부 시험으로 재현했다
 * (`tests/unit/buildApproved.test.ts`). 두 rename 사이에 프로세스가 죽는
 * 경우는 코드로 막을 수 없으므로, 다음 실행이 그 흔적(`.bak-*`/`.tmp-*`)을
 * 발견하면 **조용히 치우지 않고 사람에게 알리고 멈춘다.**
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  rmSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { resolve, dirname, basename, sep } from 'node:path';
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

// ---------------------------------------------------------------------------
// 출력 대상 안전성 — writeApprovedSet은 rename·재귀 rm을 한다. 잘못된 대상을
// 겨냥하면 저장소나 입력 원본을 통째로 지울 수 있다(Codex 재지적).
// ---------------------------------------------------------------------------

export class UnsafeOutputTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeOutputTargetError';
  }
}

/** 대소문자·끝 구분자 차이를 없앤 비교용 문자열(윈도우는 대소문자를 구분하지 않는다). */
function fold(path: string): string {
  return path.replace(/[\\/]+$/, '').toLowerCase();
}

/**
 * 존재하지 않을 수 있는 경로를 **최대한** 실제 경로로 푼다 — 심볼릭 링크로
 * 우회하는 것을 막는다. 아직 없는 하위 경로는 가장 가까운 실재 조상까지만
 * `realpath`하고 나머지는 그대로 이어 붙인다.
 */
function existingAncestorRealpath(path: string): string {
  let current = resolve(path);
  const remainder: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break; // 드라이브/루트까지 올라갔다 — 더 못 간다.
    remainder.unshift(basename(current));
    current = parent;
  }
  const real = existsSync(current) ? realpathSync(current) : current;
  return remainder.length === 0 ? real : resolve(real, ...remainder);
}

/**
 * `writeApprovedSet`이 **절대** 겨냥하면 안 되는 대상 — 저장소 루트(또는 그
 * 상위), `data` 디렉터리 전체, 입력 원본이 들어있는 폴더. `data/approved`
 * 자체는 여기서 막지 않는다 — 그건 "위험"이 아니라 "명시 승인이 필요한
 * 대상"이라 `assertOutputAuthorized`가 따로 가른다.
 */
export function assertSafeWriteTarget(
  outDir: string,
  context: { repoRoot: string; rawPath?: string },
): void {
  const resolvedOut = fold(existingAncestorRealpath(outDir));
  const root = fold(existingAncestorRealpath(context.repoRoot));
  const dataDir = fold(resolve(context.repoRoot, 'data'));

  if (resolvedOut === '' || resolvedOut === root || root.startsWith(resolvedOut + sep)) {
    throw new UnsafeOutputTargetError(
      `출력 대상이 저장소 루트이거나 그보다 상위다 — 쓸 수 없다: ${outDir}`,
    );
  }
  if (resolvedOut === dataDir) {
    throw new UnsafeOutputTargetError(`data 디렉터리 전체를 출력 대상으로 쓸 수 없다: ${outDir}`);
  }
  if (context.rawPath !== undefined) {
    const rawDir = fold(dirname(existingAncestorRealpath(context.rawPath)));
    if (resolvedOut === rawDir || rawDir.startsWith(resolvedOut + sep)) {
      throw new UnsafeOutputTargetError(
        `입력 원본이 들어있는 폴더를 출력 대상으로 쓸 수 없다: ${outDir}`,
      );
    }
  }
}

export interface ParsedArgs {
  raw: string;
  out: string;
  /** `out`이 어디서 왔는가 — 배포 경로 인가 판단에 쓴다(환경변수만으로는 배포 경로에 못 닿는다). */
  outSource: 'cli' | 'env' | 'default';
  confirmProductionWrite: boolean;
}

/** `--raw`/`--out`/`--confirm-production-write` → 환경변수 → 기본값(staging) 순으로 가른다. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let rawArg: string | undefined;
  let outArg: string | undefined;
  let confirmProductionWrite = false;
  let i = 0;
  while (i < argv.length) {
    const token = argv[i]!;
    if (token === '--raw') {
      // 값 없는 옵션을 환경변수/기본값으로 조용히 흘려보내지 않는다 — 즉시 실패한다.
      if (i + 1 >= argv.length) throw new Error("'--raw' 뒤에 경로가 없다.");
      rawArg = argv[i + 1];
      i += 2;
      continue;
    }
    if (token === '--out') {
      if (i + 1 >= argv.length) throw new Error("'--out' 뒤에 경로가 없다.");
      outArg = argv[i + 1];
      i += 2;
      continue;
    }
    if (token === '--confirm-production-write') {
      confirmProductionWrite = true;
      i += 1;
      continue;
    }
    throw new Error(`알 수 없는 인자다: '${token}'`);
  }

  const raw = rawArg ?? process.env['AVCPQ_CATALOG_RAW'] ?? resolve(ROOT, '.local/raw/catalog-raw.json');
  const envOut = process.env['AVCPQ_APPROVED_OUT'];
  const out = outArg ?? envOut ?? resolve(ROOT, '.local/staging/approved');
  const outSource: ParsedArgs['outSource'] = outArg !== undefined ? 'cli' : envOut !== undefined ? 'env' : 'default';

  return { raw, out, outSource, confirmProductionWrite };
}

/**
 * 배포 경로(`data/approved`)에 쓰는 것을 CLI 명시 승인으로만 허용한다.
 *
 * **환경변수만으로는 배포 경로에 닿을 수 없다** — `AVCPQ_APPROVED_OUT`을
 * 배포 경로로 둬도 `--out`을 CLI로 주지 않았으면 막는다(Codex 재지적: 전엔
 * 환경변수만으로 무인자 호출이 배포 경로를 덮어쓸 수 있었다). `--out`으로
 * 배포 경로를 명시해도 `--confirm-production-write`가 없으면 막는다.
 * 배포 경로가 아니면(기본 staging 등) 아무 확인도 요구하지 않는다.
 */
export function assertOutputAuthorized(
  parsed: Pick<ParsedArgs, 'out' | 'outSource' | 'confirmProductionWrite'>,
  context: { repoRoot: string },
): void {
  const resolvedOut = fold(existingAncestorRealpath(parsed.out));
  const approvedDir = fold(existingAncestorRealpath(resolve(context.repoRoot, 'data/approved')));
  if (resolvedOut !== approvedDir) return; // 배포 경로가 아니면 승인이 필요 없다.

  if (parsed.outSource !== 'cli') {
    throw new Error(
      "배포 경로(data/approved)는 환경변수로 지정할 수 없다 — '--out' 인자로 명시해야 한다.",
    );
  }
  if (!parsed.confirmProductionWrite) {
    throw new Error(
      "배포 경로(data/approved)에 쓰려면 '--confirm-production-write'를 함께 줘야 한다 " +
        '(이번 라운드에서는 쓰지 않는다 — Task 5 전용).',
    );
  }
}

export interface ApprovedWriteFsApi {
  mkdirSync: typeof mkdirSync;
  writeFileSync: typeof writeFileSync;
  existsSync: typeof existsSync;
  renameSync: typeof renameSync;
  rmSync: typeof rmSync;
  readdirSync: typeof readdirSync;
}

const defaultFsApi: ApprovedWriteFsApi = {
  mkdirSync,
  writeFileSync,
  existsSync,
  renameSync,
  rmSync,
  readdirSync,
};

/** 치우기 실패는 원래 오류를 가리지 않는다 — 최선을 다해 치우고 삼킨다. */
function tryRemove(fsApi: ApprovedWriteFsApi, dir: string): void {
  try {
    fsApi.rmSync(dir, { recursive: true, force: true });
  } catch {
    // 무시 — 호출부가 원래 에러를 던진다.
  }
}

/** `outDir` 옆에 전 실행이 남긴 `.bak-*`/`.tmp-*`가 있는지 본다. */
function findLeftovers(outDir: string, fsApi: ApprovedWriteFsApi): string[] {
  const parent = dirname(outDir);
  const base = basename(outDir);
  let entries: string[];
  try {
    entries = fsApi.readdirSync(parent);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.startsWith(`${base}.bak-`) || name.startsWith(`${base}.tmp-`))
    .map((name) => resolve(parent, name));
}

/**
 * 완성된 다섯 파일을 `outDir`에 **한 번에** 반영한다.
 *
 * 1. 임시 폴더에 다섯 파일을 전부 쓴다 — 쓰는 도중 실패하면 임시 폴더만
 *    치우고 `outDir`은 전혀 건드리지 않는다.
 * 2. `outDir`이 이미 있으면 백업 이름으로 옮긴다 — 이 rename이 실패하면
 *    임시 폴더를 치우고 중단한다(`outDir`은 원래 그대로다).
 * 3. 임시 폴더를 `outDir` 자리로 옮긴다 — 실패하면 백업을 `outDir`로
 *    되돌리고 임시 폴더를 치운다. **되돌리기마저 실패하면 백업을 절대
 *    지우지 않고**, 수동 복구 경로를 명시한 오류를 던진다.
 * 4. 성공 뒤 백업 정리가 실패해도 **그건 전환 실패가 아니다** — 경고만
 *    남기고 정상 종료한다.
 *
 * 두 rename 사이에 프로세스가 죽으면 이 함수가 다시 돌 기회조차 없다 —
 * 그래서 **매 호출 시작에** 이전 실행의 흔적(`.bak-*`/`.tmp-*`)이 있는지
 * 먼저 본다. 있으면 **조용히 치우지 않고** 사람이 먼저 확인하도록 막는다.
 */
export function writeApprovedSet(
  files: Record<string, unknown>,
  outDir: string,
  safety: { repoRoot: string; rawPath?: string },
  fsApi: ApprovedWriteFsApi = defaultFsApi,
): void {
  assertSafeWriteTarget(outDir, safety);

  const leftovers = findLeftovers(outDir, fsApi);
  if (leftovers.length > 0) {
    throw new Error(
      '이전 실행이 중간에 멈춘 흔적이 있다 — 사람이 먼저 확인하고 치운 뒤 다시 실행한다:\n' +
        leftovers.map((p) => `  - ${p}`).join('\n'),
    );
  }

  const tmpDir = `${outDir}.tmp-${process.pid}-${Date.now()}`;
  fsApi.mkdirSync(tmpDir, { recursive: true });
  try {
    for (const [name, payload] of Object.entries(files)) {
      fsApi.writeFileSync(resolve(tmpDir, name), JSON.stringify(payload, null, 1) + '\n', 'utf8');
    }
  } catch (err) {
    tryRemove(fsApi, tmpDir);
    throw err;
  }

  const backupDir = fsApi.existsSync(outDir) ? `${outDir}.bak-${Date.now()}` : undefined;

  if (backupDir !== undefined) {
    try {
      fsApi.renameSync(outDir, backupDir);
    } catch (err) {
      // 기존 자리를 건드리지도 못했다 — 임시 폴더만 치우고 중단한다.
      tryRemove(fsApi, tmpDir);
      throw err;
    }
  }

  try {
    fsApi.renameSync(tmpDir, outDir);
  } catch (err) {
    if (backupDir === undefined) {
      // 원래 out이 없었다 — tmp만 치우면 전환 전과 같은 상태다.
      tryRemove(fsApi, tmpDir);
      throw err;
    }
    try {
      fsApi.renameSync(backupDir, outDir);
    } catch (restoreErr) {
      // 최악의 경우 — out이 비고 백업만 남는다. 백업도 임시 폴더도 **절대
      // 지우지 않는다** — 둘 다 사람이 복구에 쓸 수 있는 유일한 자료다.
      throw new Error(
        `자리 바꾸기도 되돌리기도 실패했다. '${outDir}'가 비어 있고, 기존 자료는 ` +
          `'${backupDir}'에, 준비된 새 자료는 '${tmpDir}'에 그대로 있다. 사람이 ` +
          `'${backupDir}' → '${outDir}'로 이름을 바꿔 기존 자료를 복구하거나, ` +
          `'${tmpDir}' → '${outDir}'로 바꿔 새 자료를 채택한 뒤 다시 실행해야 한다. ` +
          `(되돌리기 오류: ${restoreErr instanceof Error ? restoreErr.message : String(restoreErr)})`,
      );
    }
    // 되돌리기는 성공했다 — 못 들어간 새 세트(tmp)만 치운다.
    tryRemove(fsApi, tmpDir);
    throw err;
  }

  // 전환 자체는 끝났다 — 백업 정리 실패는 "전환 실패"와 다른, 가벼운 문제다.
  if (backupDir !== undefined) {
    try {
      fsApi.rmSync(backupDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn(
        `전환은 끝났다. 다만 백업 정리에 실패했다 — '${backupDir}'를 수동으로 지워도 된다. ` +
          `(${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)})`,
      );
    }
  }
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  assertOutputAuthorized(parsed, { repoRoot: ROOT });

  const raw = JSON.parse(readFileSync(parsed.raw, 'utf8')) as RawCatalog;

  const prepared = prepareApprovedFiles(raw);
  if (!prepared.ok) {
    console.error(`\n=== 중단 — ${prepared.reason} ===`);
    for (const finding of (prepared.findings ?? []).slice(0, 30)) console.error('  ! ' + finding);
    process.exit(1);
  }

  writeApprovedSet(prepared.files, parsed.out, { repoRoot: ROOT, rawPath: parsed.raw });

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

  console.log(`\n저장: ${parsed.out}`);
}

const entryPath = process.argv[1] !== undefined ? resolve(process.argv[1]) : undefined;
if (entryPath !== undefined && entryPath === fileURLToPath(import.meta.url)) {
  main();
}
