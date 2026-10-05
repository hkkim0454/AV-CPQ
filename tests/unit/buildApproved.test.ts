/**
 * `tools/build-approved.ts` — 하반기 품셈 교체 계획 Task 0.
 *
 * 생성 경로 분리(무인자 기본은 staging)·쓰기 순서 역전(검증 후에만 쓴다)·
 * 완성 세트 전환(중간 실패에도 기존 다섯 파일 보존)을 직접 확인한다.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  renameSync,
  rmSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
  prepareApprovedFiles,
  writeApprovedSet,
  parseArgs,
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
    source: { sha256: SHA, extractedOn: '2026-10-05' },
    sheets: [{ name: 'CCTV', wages: COMMON_WAGES, rows: [validRow()] }],
  };
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

describe('writeApprovedSet — 완성 세트 전환', () => {
  const scratchRoots: string[] = [];

  function freshOutDir(): string {
    const root = mkdtempSync(join(tmpdir(), 'avcpq-build-approved-'));
    scratchRoots.push(root);
    return join(root, 'approved');
  }

  afterEach(() => {
    for (const root of scratchRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('다섯 파일을 실제로 쓴다', () => {
    const outDir = freshOutDir();
    const result = prepareApprovedFiles(validCatalog());
    if (!result.ok) throw new Error('unreachable');
    writeApprovedSet(result.files, outDir);

    const written = JSON.parse(readFileSync(join(outDir, 'products.json'), 'utf8'));
    expect(written.sourceSha256).toBe(SHA);
  });

  it('세 번째 파일을 쓰다 실패해도 기존 다섯 파일이 전부 그대로다', () => {
    const outDir = freshOutDir();
    const oldFiles: Record<string, string> = {
      'products.json': '{"old":"products"}',
      'prices.json': '{"old":"prices"}',
      'labor-items.json': '{"old":"labor-items"}',
      'wage-table.json': '{"old":"wage-table"}',
      'labor-mappings.json': '{"old":"labor-mappings"}',
    };
    // 기존 다섯 파일을 outDir에 미리 둔다(이전 성공 교체분을 흉내).
    mkdirSync(outDir, { recursive: true });
    for (const [name, text] of Object.entries(oldFiles)) {
      writeFileSync(join(outDir, name), text, 'utf8');
    }

    const result = prepareApprovedFiles(validCatalog());
    if (!result.ok) throw new Error('unreachable');

    let writeCount = 0;
    const flakyFsApi: ApprovedWriteFsApi = {
      mkdirSync,
      existsSync,
      renameSync,
      rmSync,
      writeFileSync: ((path: Parameters<typeof writeFileSync>[0], data: Parameters<typeof writeFileSync>[1], options: Parameters<typeof writeFileSync>[2]) => {
        writeCount += 1;
        if (writeCount === 3) throw new Error('디스크가 가득 찼다(주입된 시험 실패)');
        return writeFileSync(path, data, options);
      }) as typeof writeFileSync,
    };

    expect(() => writeApprovedSet(result.files, outDir, flakyFsApi)).toThrow('주입된 시험 실패');

    // 기존 다섯 파일이 바이트 하나 안 바뀐 채 그대로다.
    for (const [name, text] of Object.entries(oldFiles)) {
      expect(readFileSync(join(outDir, name), 'utf8'), name).toBe(text);
    }
    // 버려진 임시 폴더가 남아 있지 않다.
    const siblings = readdirSync(join(outDir, '..'));
    expect(siblings.some((name) => name.includes('.tmp-'))).toBe(false);
    expect(siblings.some((name) => name.includes('.bak-'))).toBe(false);
  });
});

describe('parseArgs — 무인자 기본은 staging 하나다', () => {
  it('인자도 환경변수도 없으면 .local/staging/approved로 떨어진다', () => {
    const before = { raw: process.env['AVCPQ_CATALOG_RAW'], out: process.env['AVCPQ_APPROVED_OUT'] };
    delete process.env['AVCPQ_CATALOG_RAW'];
    delete process.env['AVCPQ_APPROVED_OUT'];
    try {
      const { out } = parseArgs([]);
      expect(out.split(sep).join('/')).toContain('.local/staging/approved');
      expect(out.split(sep).join('/')).not.toContain('data/approved');
    } finally {
      if (before.raw !== undefined) process.env['AVCPQ_CATALOG_RAW'] = before.raw;
      if (before.out !== undefined) process.env['AVCPQ_APPROVED_OUT'] = before.out;
    }
  });

  it('--out을 명시하면(예: data/approved) 그 값을 그대로 쓴다', () => {
    const { out } = parseArgs(['--out', 'data/approved']);
    expect(out).toBe('data/approved');
  });
});
