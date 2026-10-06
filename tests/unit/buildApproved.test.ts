/**
 * `tools/build-approved.ts` — 하반기 품셈 교체 계획 Task 0.
 *
 * 생성 경로 분리(무인자 기본은 staging)·배포 경로 CLI 명시 승인·완성 세트
 * 전환(중간 실패·되돌리기 실패·전 실행 흔적까지)을 직접 확인한다.
 *
 * ⛔ 이 파일의 어떤 시험도 실제 `data/approved`에 쓰지 않는다 — 전부 합성
 * 임시 경로(`os.tmpdir()`)나 이번 시험만을 위한 가짜 저장소 구조를 쓴다.
 * `assertSafeWriteTarget`/`assertOutputAuthorized`는 경로만 읽고 비교할 뿐
 * 아무것도 쓰지 않는 순수 함수라, 가짜 저장소 안의 경로만으로 시험한다.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  renameSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
  prepareApprovedFiles,
  writeApprovedSet,
  parseArgs,
  assertSafeWriteTarget,
  assertOutputAuthorized,
  UnsafeOutputTargetError,
  type ApprovedWriteFsApi,
} from '../../tools/build-approved';
import type { RawCatalog, RawSheet } from '@/data/catalog/rawTypes';

const SHA = 'a'.repeat(64);

const COMMON_WAGES: RawSheet['wages'] = [
  { trade: '통신설비공', unit: 'M/D', amount: '315528', quantityColumn: 'X' },
  { trade: '보통인부', unit: 'M/D', amount: '172068', quantityColumn: 'Z' },
];

function validRow(): RawSheet['rows'][number] {
  return {
    row: 6,
    name: 'IP카메라',
    unit: 'EA',
    materialUnitPrice: '654000',
    laborCode: '9-2-1-1-CCTV_촬상부',
    itemRate: '0.63',
    trades: [
      { trade: '통신설비공', quantity: '0.32' },
      { trade: '보통인부', quantity: '0.1' },
    ],
  };
}

function validCatalog(): RawCatalog {
  return {
    schemaVersion: 1,
    // 반기 표기가 없으면 `prepareApprovedFiles`가 막는다(하반기 계획 Task 2).
    source: { sha256: SHA, extractedOn: '2026-10-05', periodLabel: '26년 하반기' },
    sheets: [{ name: 'CCTV', wages: COMMON_WAGES, rows: [validRow()] }],
  };
}

// --- 모든 시험이 공유하는 스크래치 루트 정리 ---------------------------------
const scratchRoots: string[] = [];
afterEach(() => {
  for (const root of scratchRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function freshScratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'avcpq-build-approved-'));
  scratchRoots.push(root);
  return root;
}

function freshOutDir(): string {
  return join(freshScratchRoot(), 'approved');
}

/** 저장소 흉내 — 실제 data/approved를 절대 참조하지 않는, 이 시험 전용 가짜 구조. */
function makeFakeRepo(): { root: string; rawPath: string } {
  const root = freshScratchRoot();
  mkdirSync(join(root, 'data', 'approved'), { recursive: true });
  mkdirSync(join(root, '.local', 'raw'), { recursive: true });
  mkdirSync(join(root, '.local', 'staging'), { recursive: true });
  const rawPath = join(root, '.local', 'raw', 'catalog-raw.json');
  writeFileSync(rawPath, '{}', 'utf8');
  return { root, rawPath };
}

describe('prepareApprovedFiles — 쓰기 전 검증', () => {
  it('정상 자료는 다섯 파일을 준비하고 전부 같은 sourceSha256을 쓴다', () => {
    const result = prepareApprovedFiles(validCatalog());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(Object.keys(result.files).sort()).toEqual(
      ['labor-items.json', 'labor-mappings.json', 'prices.json', 'products.json', 'wage-table.json'].sort(),
    );
    const hashes = new Set(Object.values(result.files).map((f) => (f as { sourceSha256: string }).sourceSha256));
    expect(hashes).toEqual(new Set([SHA]));
  });

  it('노임 단위/금액 충돌이 있으면 아무것도 준비하지 않고 중단한다(쓰기 전 차단)', () => {
    const catalog = validCatalog();
    catalog.sheets.push({
      name: '영상',
      wages: [{ trade: '보통인부', unit: 'M/D', amount: '999999', quantityColumn: 'Z' }],
      rows: [],
    });
    const result = prepareApprovedFiles(catalog);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toContain('충돌');
    expect(result.findings?.some((f) => f.includes('보통인부'))).toBe(true);
  });

  it('금지 문구(매입처 등)가 설명/비고에 섞이면 감사 게이트가 막는다', () => {
    const catalog = validCatalog();
    catalog.sheets[0]!.rows[0]!.description = '매입처 변경 — SONY/한국에빅스';
    const result = prepareApprovedFiles(catalog);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toContain('감사');
  });
});

describe('assertSafeWriteTarget — writeApprovedSet이 절대 겨냥하면 안 되는 대상', () => {
  it('저장소 루트를 거부한다', () => {
    const { root } = makeFakeRepo();
    expect(() => assertSafeWriteTarget(root, { repoRoot: root })).toThrow(UnsafeOutputTargetError);
  });

  it('data 디렉터리 전체를 거부한다', () => {
    const { root } = makeFakeRepo();
    expect(() => assertSafeWriteTarget(join(root, 'data'), { repoRoot: root })).toThrow(UnsafeOutputTargetError);
  });

  it('data/approved 자체는 일반 안전성 검사에서는 막지 않는다 — 승인 검사가 따로 가른다', () => {
    const { root } = makeFakeRepo();
    expect(() => assertSafeWriteTarget(join(root, 'data', 'approved'), { repoRoot: root })).not.toThrow();
  });

  it('입력 원본이 들어있는 폴더를 거부한다', () => {
    const { root, rawPath } = makeFakeRepo();
    expect(() =>
      assertSafeWriteTarget(join(root, '.local', 'raw'), { repoRoot: root, rawPath }),
    ).toThrow(UnsafeOutputTargetError);
  });

  it('합성 staging 경로는 허용한다', () => {
    const { root } = makeFakeRepo();
    expect(() =>
      assertSafeWriteTarget(join(root, '.local', 'staging', 'approved'), { repoRoot: root }),
    ).not.toThrow();
  });
});

describe('assertOutputAuthorized — 배포 경로는 CLI 명시 승인만 허용한다', () => {
  it('배포 경로가 아니면 승인 없이도 통과한다', () => {
    const { root } = makeFakeRepo();
    expect(() =>
      assertOutputAuthorized(
        { out: join(root, '.local', 'staging', 'approved'), outSource: 'default', confirmProductionWrite: false },
        { repoRoot: root },
      ),
    ).not.toThrow();
  });

  it('환경변수로만 배포 경로를 줬으면 거부한다(CLI 인자가 아니다)', () => {
    const { root } = makeFakeRepo();
    expect(() =>
      assertOutputAuthorized(
        { out: join(root, 'data', 'approved'), outSource: 'env', confirmProductionWrite: false },
        { repoRoot: root },
      ),
    ).toThrow(/환경변수/);
  });

  it('CLI로 배포 경로를 줘도 승인 플래그가 없으면 거부한다', () => {
    const { root } = makeFakeRepo();
    expect(() =>
      assertOutputAuthorized(
        { out: join(root, 'data', 'approved'), outSource: 'cli', confirmProductionWrite: false },
        { repoRoot: root },
      ),
    ).toThrow(/confirm-production-write/);
  });

  it('CLI 인자 + 승인 플래그가 둘 다 있으면 통과한다(실제로 쓰지는 않는다)', () => {
    const { root } = makeFakeRepo();
    expect(() =>
      assertOutputAuthorized(
        { out: join(root, 'data', 'approved'), outSource: 'cli', confirmProductionWrite: true },
        { repoRoot: root },
      ),
    ).not.toThrow();
  });
});

describe('parseArgs — 무인자 기본은 staging, 잘못된 옵션은 즉시 실패', () => {
  it('인자도 환경변수도 없으면 .local/staging/approved로 떨어진다', () => {
    const before = { raw: process.env['AVCPQ_CATALOG_RAW'], out: process.env['AVCPQ_APPROVED_OUT'] };
    delete process.env['AVCPQ_CATALOG_RAW'];
    delete process.env['AVCPQ_APPROVED_OUT'];
    try {
      const { out, outSource } = parseArgs([]);
      expect(out.split(sep).join('/')).toContain('.local/staging/approved');
      expect(out.split(sep).join('/')).not.toContain('data/approved');
      expect(outSource).toBe('default');
    } finally {
      if (before.raw !== undefined) process.env['AVCPQ_CATALOG_RAW'] = before.raw;
      if (before.out !== undefined) process.env['AVCPQ_APPROVED_OUT'] = before.out;
    }
  });

  it('--out을 명시하면 그 값을 그대로 쓰고 출처를 cli로 기록한다', () => {
    const { out, outSource } = parseArgs(['--out', 'data/approved']);
    expect(out).toBe('data/approved');
    expect(outSource).toBe('cli');
  });

  it("'--out' 뒤에 값이 없으면 즉시 실패한다 — 환경변수/기본값으로 조용히 안 흘러간다", () => {
    expect(() => parseArgs(['--out'])).toThrow(/--out/);
  });

  it("'--raw' 뒤에 값이 없으면 즉시 실패한다", () => {
    expect(() => parseArgs(['--raw'])).toThrow(/--raw/);
  });

  it('알 수 없는 인자는 즉시 실패한다', () => {
    expect(() => parseArgs(['--bogus'])).toThrow();
  });

  it('--confirm-production-write 플래그를 인식한다', () => {
    const { confirmProductionWrite } = parseArgs(['--out', 'data/approved', '--confirm-production-write']);
    expect(confirmProductionWrite).toBe(true);
  });

  it("'--out' 뒤에 다른 옵션(--raw)이 오면 그걸 값으로 삼키지 않고 '--out' 자체를 사유로 거부한다", () => {
    // 전엔 '--raw'를 '--out'의 값으로 삼켜서, 나중에 'file.json'이
    // "알 수 없는 인자"로 걸려 엉뚱한 이유로 실패했다(Codex 재지적).
    expect(() => parseArgs(['--out', '--raw', 'file.json'])).toThrow(/--out/);
  });

  it("'--raw' 뒤에 다른 옵션(--out)이 오면 값으로 삼키지 않고 거부한다", () => {
    // 전엔 raw='--out'으로 **조용히 통과**했다(에러조차 없었다) — 가장 나쁜 경우.
    expect(() => parseArgs(['--raw', '--out'])).toThrow(/--raw/);
  });

  it("'--out' 값이 빈 문자열이면 거부한다", () => {
    expect(() => parseArgs(['--out', ''])).toThrow(/--out/);
  });

  it("'--raw' 값이 빈 문자열이면 거부한다", () => {
    expect(() => parseArgs(['--raw', ''])).toThrow(/--raw/);
  });

  it('정상적인 두 옵션 조합은 그대로 통과한다(과잉 거부가 아니다)', () => {
    const { out, raw } = parseArgs(['--out', 'data/approved', '--raw', 'x.json']);
    expect(out).toBe('data/approved');
    expect(raw).toBe('x.json');
  });
});

describe('writeApprovedSet — 완성 세트 전환', () => {
  const REPO_ROOT_FOR_SAFETY = tmpdir(); // outDir은 늘 이 밑의 스크래치라, 저장소 경로와 겹칠 일이 없다.
  function safety(rawPath?: string): { repoRoot: string; rawPath?: string } {
    return rawPath === undefined ? { repoRoot: REPO_ROOT_FOR_SAFETY } : { repoRoot: REPO_ROOT_FOR_SAFETY, rawPath };
  }

  function writeOldFiles(outDir: string, content = '{"old":true}'): void {
    mkdirSync(outDir, { recursive: true });
    for (const name of ['products.json', 'prices.json', 'labor-items.json', 'wage-table.json', 'labor-mappings.json']) {
      writeFileSync(join(outDir, name), content, 'utf8');
    }
  }

  function siblingsOf(outDir: string): string[] {
    return readdirSync(join(outDir, '..'));
  }

  it('다섯 파일을 실제로 쓴다(새 outDir)', () => {
    const outDir = freshOutDir();
    const result = prepareApprovedFiles(validCatalog());
    if (!result.ok) throw new Error('unreachable');
    writeApprovedSet(result.files, outDir, safety());

    const written = JSON.parse(readFileSync(join(outDir, 'products.json'), 'utf8'));
    expect(written.sourceSha256).toBe(SHA);
  });

  it('성공하면 기존 다섯 파일을 새 내용으로 완전히 바꾸고, 흔적을 남기지 않는다', () => {
    const outDir = freshOutDir();
    writeOldFiles(outDir);
    const result = prepareApprovedFiles(validCatalog());
    if (!result.ok) throw new Error('unreachable');

    writeApprovedSet(result.files, outDir, safety());

    for (const name of ['products.json', 'prices.json', 'labor-items.json', 'wage-table.json', 'labor-mappings.json']) {
      const content = JSON.parse(readFileSync(join(outDir, name), 'utf8'));
      expect(content.old, name).toBeUndefined();
      expect(content.sourceSha256, name).toBe(SHA);
    }
    const siblings = siblingsOf(outDir);
    expect(siblings.some((n) => n.includes('.bak-'))).toBe(false);
    expect(siblings.some((n) => n.includes('.tmp-'))).toBe(false);
  });

  it('세 번째 파일을 쓰다 실패해도 기존 다섯 파일이 전부 그대로다', () => {
    const outDir = freshOutDir();
    const oldText = '{"old":"sentinel"}';
    writeOldFiles(outDir, oldText);

    const result = prepareApprovedFiles(validCatalog());
    if (!result.ok) throw new Error('unreachable');

    let writeCount = 0;
    const flaky: ApprovedWriteFsApi = {
      mkdirSync,
      existsSync,
      renameSync,
      rmSync,
      readdirSync,
      writeFileSync: ((path, data, options) => {
        writeCount += 1;
        if (writeCount === 3) throw new Error('디스크가 가득 찼다(주입된 시험 실패)');
        return writeFileSync(path, data, options);
      }) as typeof writeFileSync,
    };

    expect(() => writeApprovedSet(result.files, outDir, safety(), flaky)).toThrow('주입된 시험 실패');

    for (const name of ['products.json', 'prices.json', 'labor-items.json', 'wage-table.json', 'labor-mappings.json']) {
      expect(readFileSync(join(outDir, name), 'utf8'), name).toBe(oldText);
    }
    const siblings = siblingsOf(outDir);
    expect(siblings.some((n) => n.includes('.tmp-'))).toBe(false);
    expect(siblings.some((n) => n.includes('.bak-'))).toBe(false);
  });

  it('첫 번째 자리바꿈(기존→백업)이 실패하면 임시 폴더를 치우고 기존 outDir은 그대로다', () => {
    const outDir = freshOutDir();
    const oldText = '{"old":"first-rename-fails"}';
    writeOldFiles(outDir, oldText);

    const result = prepareApprovedFiles(validCatalog());
    if (!result.ok) throw new Error('unreachable');

    let renameCount = 0;
    const flaky: ApprovedWriteFsApi = {
      mkdirSync,
      existsSync,
      rmSync,
      readdirSync,
      writeFileSync,
      renameSync: ((from: Parameters<typeof renameSync>[0], to: Parameters<typeof renameSync>[1]) => {
        renameCount += 1;
        if (renameCount === 1) throw new Error('첫 번째 rename 주입 실패');
        return renameSync(from, to);
      }) as typeof renameSync,
    };

    expect(() => writeApprovedSet(result.files, outDir, safety(), flaky)).toThrow('첫 번째 rename 주입 실패');

    expect(readFileSync(join(outDir, 'products.json'), 'utf8')).toBe(oldText);
    const siblings = siblingsOf(outDir);
    expect(siblings.some((n) => n.includes('.tmp-'))).toBe(false);
    expect(siblings.some((n) => n.includes('.bak-'))).toBe(false);
  });

  it('두 번째 자리바꿈(임시→기존)이 실패하면 백업에서 되돌리고 임시 폴더를 치운다', () => {
    const outDir = freshOutDir();
    const oldText = '{"old":"second-rename-fails"}';
    writeOldFiles(outDir, oldText);

    const result = prepareApprovedFiles(validCatalog());
    if (!result.ok) throw new Error('unreachable');

    let renameCount = 0;
    const flaky: ApprovedWriteFsApi = {
      mkdirSync,
      existsSync,
      rmSync,
      readdirSync,
      writeFileSync,
      renameSync: ((from: Parameters<typeof renameSync>[0], to: Parameters<typeof renameSync>[1]) => {
        renameCount += 1;
        // 1번째: 기존→백업(성공시킨다). 2번째: 임시→기존(실패시킨다).
        // 3번째(되돌리기: 백업→기존)는 실제로 수행되어야 한다.
        if (renameCount === 2) throw new Error('두 번째 rename 주입 실패');
        return renameSync(from, to);
      }) as typeof renameSync,
    };

    expect(() => writeApprovedSet(result.files, outDir, safety(), flaky)).toThrow('두 번째 rename 주입 실패');

    // 되돌려져서 기존 내용 그대로다.
    expect(readFileSync(join(outDir, 'products.json'), 'utf8')).toBe(oldText);
    // 백업도, 못 들어간 임시 세트도 남지 않는다.
    const siblings = siblingsOf(outDir);
    expect(siblings.some((n) => n.includes('.tmp-'))).toBe(false);
    expect(siblings.some((n) => n.includes('.bak-'))).toBe(false);
  });

  it('되돌리기마저 실패하면 백업을 절대 지우지 않고 복구 경로를 알린다', () => {
    const outDir = freshOutDir();
    const oldText = '{"old":"rollback-also-fails"}';
    writeOldFiles(outDir, oldText);

    const result = prepareApprovedFiles(validCatalog());
    if (!result.ok) throw new Error('unreachable');

    let renameCount = 0;
    const flaky: ApprovedWriteFsApi = {
      mkdirSync,
      existsSync,
      rmSync,
      readdirSync,
      writeFileSync,
      renameSync: ((from: Parameters<typeof renameSync>[0], to: Parameters<typeof renameSync>[1]) => {
        renameCount += 1;
        // 1번째(기존→백업)만 성공시키고, 2번째(임시→기존)·3번째(되돌리기)는 둘 다 실패시킨다.
        if (renameCount >= 2) throw new Error(`rename 주입 실패 #${renameCount}`);
        return renameSync(from, to);
      }) as typeof renameSync,
    };

    let thrown: unknown;
    try {
      writeApprovedSet(result.files, outDir, safety(), flaky);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('되돌리기도 실패');
    expect((thrown as Error).message).toMatch(/\.bak-/);
    expect((thrown as Error).message).toMatch(/\.tmp-/);

    // outDir 자리는 비어 있고(원래 디렉터리가 사라졌다), 백업도 임시 폴더도
    // 둘 다 지워지지 않고 그대로 남아 있다(복구에 쓸 유일한 자료라 지우지 않는다).
    expect(existsSync(outDir)).toBe(false);
    const siblings = siblingsOf(outDir);
    const backups = siblings.filter((n) => n.includes('.bak-'));
    const tmps = siblings.filter((n) => n.includes('.tmp-'));
    expect(backups).toHaveLength(1);
    expect(tmps).toHaveLength(1);
    expect(readFileSync(join(outDir, '..', backups[0]!, 'products.json'), 'utf8')).toBe(oldText);
    const recoveredNew = JSON.parse(readFileSync(join(outDir, '..', tmps[0]!, 'products.json'), 'utf8'));
    expect(recoveredNew.sourceSha256).toBe(SHA);
  });

  it('이전 실행이 중간에 멈춘 흔적(.tmp-*)이 있으면 거부하고 아무것도 건드리지 않는다', () => {
    const outDir = freshOutDir();
    const oldText = '{"old":"leftover-guard"}';
    writeOldFiles(outDir, oldText);
    const staleTmp = `${outDir}.tmp-stale-leftover`;
    mkdirSync(staleTmp, { recursive: true });

    const result = prepareApprovedFiles(validCatalog());
    if (!result.ok) throw new Error('unreachable');

    expect(() => writeApprovedSet(result.files, outDir, safety())).toThrow(/중간에 멈춘 흔적/);

    // outDir도, 가짜 stale tmp도 전혀 건드리지 않았다.
    expect(readFileSync(join(outDir, 'products.json'), 'utf8')).toBe(oldText);
    expect(existsSync(staleTmp)).toBe(true);
  });

  it('전환 자체는 성공했는데 백업 정리만 실패하면 던지지 않고 경고만 남긴다', () => {
    const outDir = freshOutDir();
    writeOldFiles(outDir, '{"old":"cleanup-only-fails"}');

    const result = prepareApprovedFiles(validCatalog());
    if (!result.ok) throw new Error('unreachable');

    const flaky: ApprovedWriteFsApi = {
      mkdirSync,
      existsSync,
      renameSync,
      readdirSync,
      writeFileSync,
      rmSync: ((path: Parameters<typeof rmSync>[0], options: Parameters<typeof rmSync>[1]) => {
        if (String(path).includes('.bak-')) throw new Error('백업 정리 주입 실패');
        return rmSync(path, options);
      }) as typeof rmSync,
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => writeApprovedSet(result.files, outDir, safety(), flaky)).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();

    // 전환은 성공했다 — 새 내용이 들어갔다.
    const content = JSON.parse(readFileSync(join(outDir, 'products.json'), 'utf8'));
    expect(content.sourceSha256).toBe(SHA);
    // 정리만 실패해 백업이 남아 있다(지우지 않은 것이지, 잃어버린 게 아니다).
    expect(siblingsOf(outDir).some((n) => n.includes('.bak-'))).toBe(true);
  });

  describe('outDir 표현 — 끝 구분자·상대경로·".."를 전부 같은 대상으로 정규화한다', () => {
    // Codex 재지적: 검사용 경로만 resolve하고 실제 파일 연산은 원문
    // outDir 문자열을 그대로 썼다. 끝에 '/'가 있으면 `${outDir}.tmp-...`
    // 이어붙이기가 outDir **안쪽의 자식**이 되어, 나중에 outDir(부모)을
    // 그 자식 자리로 rename하려 드는 상태가 됐다.

    it('끝에 구분자가 있어도 임시/백업을 안쪽 자식이 아니라 형제로 만든다', () => {
      const outDir = freshOutDir();
      const result = prepareApprovedFiles(validCatalog());
      if (!result.ok) throw new Error('unreachable');

      writeApprovedSet(result.files, outDir + sep, safety());

      // 다섯 파일이 정확히 outDir 자리에 들어갔다.
      const written = JSON.parse(readFileSync(join(outDir, 'products.json'), 'utf8'));
      expect(written.sourceSha256).toBe(SHA);
      // outDir **자신의 내용물**에 '.tmp-'/'.bak-'로 시작하는 하위 폴더가
      // 없다 — 있었다면 자식으로 잘못 만들어진 것이다.
      const ownEntries = readdirSync(outDir);
      expect(ownEntries.some((n) => n.startsWith('.tmp-') || n.startsWith('.bak-'))).toBe(false);
      // 형제 레벨(부모 디렉터리)에도 흔적이 없다 — 전환이 깔끔히 끝났다.
      expect(siblingsOf(outDir).some((n) => n.includes('.tmp-') || n.includes('.bak-'))).toBe(false);
    });

    it("상대경로·'..'가 섞인 표현도 끝 구분자 없는 표현과 같은 대상에 쓴다", () => {
      const root = freshScratchRoot();
      const canonical = join(root, 'approved');
      const viaDotDot = join(root, 'nested-detour', '..', 'approved');
      const viaTrailingSlash = `${canonical}${sep}`;

      const result = prepareApprovedFiles(validCatalog());
      if (!result.ok) throw new Error('unreachable');
      writeApprovedSet(result.files, viaDotDot, safety());

      // '..'로 돌아간 표현이 실제로 canonical 경로에 썼다.
      expect(existsSync(canonical)).toBe(true);
      expect(JSON.parse(readFileSync(join(canonical, 'products.json'), 'utf8')).sourceSha256).toBe(SHA);

      // 이미 자리가 있으니, 끝 슬래시 표현으로 다시 써도(=같은 대상) 정상적으로 교체된다.
      writeOldFiles(canonical, '{"neverUsed":true}'); // 교체 전 상태를 확실히 갈아둔다
      writeApprovedSet(result.files, viaTrailingSlash, safety());
      expect(JSON.parse(readFileSync(join(canonical, 'products.json'), 'utf8')).sourceSha256).toBe(SHA);
      expect(siblingsOf(canonical).some((n) => n.includes('.tmp-') || n.includes('.bak-'))).toBe(false);
    });
  });
});
