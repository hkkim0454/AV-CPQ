/**
 * 수정 전후 스냅샷을 **항목 성격별 규칙**으로 비교한다 (계획 2026-10-06 Task 3).
 * 진단용이며 제품 코드가 아니다.
 *
 * 실행:
 *   npx vite-node tools/probe_model_search_diff.ts 수정전.json 수정후.json
 *
 * ## 합격 조건 (계획 §Task 3 의 표 그대로)
 *
 * | 수정 전 상태        | 수정 후에 허용되는 것                               |
 * |---------------------|-----------------------------------------------------|
 * | 연결된 SKU 가 있다  | 그대로 유지. 바뀌면 위반                            |
 * | 후보가 여럿 있다    | 그 목록 그대로 유지. 바뀌면 위반                    |
 * | 아무것도 없다       | 후보가 생겨도 된다. 단 연결된 제품은 여전히 없어야  |
 *
 * ⛔ "새로 8건" 도 "미매칭이 줄었다" 도 합격 조건이 아니다. 건수는 참고 수치로만 적는다.
 */
import { readFileSync } from 'node:fs';

interface Snapshot {
  id: string;
  model: string;
  matchedBy: string;
  linkedSku?: string;
  ambiguousSkus?: string[];
  candidates?: Array<{ sku: string; fields: string[]; texts: string[] }>;
  skipped?: 'empty-model' | 'key-too-short';
}

const load = (path: string): Snapshot[] =>
  (JSON.parse(readFileSync(path, 'utf8')) as { snapshots: Snapshot[] }).snapshots;

const [beforePath, afterPath] = process.argv.slice(2);
if (beforePath === undefined || afterPath === undefined) {
  throw new Error('사용법: probe_model_search_diff.ts 수정전.json 수정후.json');
}

const before = load(beforePath);
const after = load(afterPath);

if (before.length !== after.length) {
  throw new Error(`항목 수가 다르다: 전 ${before.length} · 후 ${after.length}`);
}

const key = (s: Snapshot): string => `${s.id}|${s.model}`;
const afterById = new Map(after.map((s) => [key(s), s]));

const violations: string[] = [];
const newCandidates: Array<{ model: string; candidates: NonNullable<Snapshot['candidates']> }> = [];

let keptLinked = 0;
let keptAmbiguous = 0;
let stillNothing = 0;
let skippedShort = 0;
let skippedEmpty = 0;

for (const b of before) {
  const a = afterById.get(key(b));
  if (a === undefined) {
    violations.push(`[항목 소멸] ${b.model}`);
    continue;
  }

  if (b.linkedSku !== undefined) {
    // 1) 연결된 SKU 가 있던 항목 — 그대로여야 한다.
    if (a.linkedSku !== b.linkedSku) {
      violations.push(`[연결 변경] ${b.model}: ${b.linkedSku} → ${a.linkedSku ?? '없음'}`);
    } else if (a.matchedBy !== b.matchedBy) {
      violations.push(`[연결 경로 변경] ${b.model}: ${b.matchedBy} → ${a.matchedBy}`);
    } else {
      keptLinked += 1;
    }
    continue;
  }

  if (b.ambiguousSkus !== undefined) {
    // 2) 후보가 여럿이던 항목 — 그 목록이 그대로여야 한다.
    const same =
      a.ambiguousSkus !== undefined &&
      a.ambiguousSkus.length === b.ambiguousSkus.length &&
      a.ambiguousSkus.every((sku, i) => sku === b.ambiguousSkus![i]);
    if (!same) {
      violations.push(`[모호 목록 변경] ${b.model}: [${b.ambiguousSkus.join(',')}] → [${a.ambiguousSkus?.join(',') ?? '없음'}]`);
    } else if (a.linkedSku !== undefined) {
      violations.push(`[모호였는데 연결됨] ${b.model} → ${a.linkedSku}`);
    } else {
      keptAmbiguous += 1;
    }
    continue;
  }

  // 3) 아무것도 없던 항목 — 후보는 생겨도 되지만 연결된 제품은 여전히 없어야 한다.
  if (a.linkedSku !== undefined) {
    violations.push(`[빈 항목이 연결됨] ${b.model} → ${a.linkedSku}`);
    continue;
  }
  if (a.ambiguousSkus !== undefined) {
    violations.push(`[빈 항목에 모호 목록이 생김] ${b.model}`);
    continue;
  }
  if (a.candidates !== undefined && a.candidates.length > 0) {
    newCandidates.push({ model: b.model, candidates: a.candidates });
  } else {
    stillNothing += 1;
    if (a.skipped === 'key-too-short') skippedShort += 1;
    if (a.skipped === 'empty-model') skippedEmpty += 1;
  }
}

const line = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

line(`항목 ${before.length}건`);
line('');
line('=== 합격 조건 ===');
line(`  연결 유지      ${keptLinked}`);
line(`  모호 목록 유지 ${keptAmbiguous}`);
line(`  여전히 없음    ${stillNothing}  (그중 키가 짧아 제외 ${skippedShort} · 빈 모델명 ${skippedEmpty})`);
line(`  새 후보        ${newCandidates.length}  ← 참고 수치. 합격 조건이 아니다`);
line('');

if (violations.length > 0) {
  line(`=== ⛔ 위반 ${violations.length}건 — 중단해야 한다 ===`);
  for (const v of violations) line(`  ${v}`);
} else {
  line('=== 위반 0건 ===');
}

line('');
line('=== 새로 생긴 후보 — 근거(맞은 칸·맞은 글자)를 사람이 검토한다 ===');
for (const n of newCandidates) {
  line(`  ${n.model}`);
  for (const c of n.candidates) {
    const where = c.fields.map((f, i) => `${f}="${c.texts[i]}"`).join(' · ');
    const onlyDescription = c.fields.every((f) => f === 'description');
    line(`      ${c.sku}  ${where}${onlyDescription ? '   ⚠ 설명 칸에서만 맞음' : ''}`);
  }
}

process.exitCode = violations.length > 0 ? 1 : 0;
