// 원가 모듈이 고객용 경로에 섞이지 않는지 정적으로 검사한다 (설계서 §10.4, §8.1).
//
// 설계서 §10.4: "고객용 exporter에서 원가 모듈 import를 금지하는 의존성 검사도 추가한다."
//
// 리뷰로 지키는 규칙은 언젠가 깨진다. 이 검사는 `npm run audit:exports`로 돌고
// CI에서 실패하면 병합을 막는다.
//
// 검사 내용:
//   1. 금지 import — 고객용/도메인/직렬화 경로가 services/private-cost를 참조하는가
//   2. 영속 저장 API — 원가를 다룰 수 있는 모듈이 localStorage 등에 닿는가
//   3. 네트워크 API — 원가를 다룰 수 있는 모듈이 fetch 등을 쓰는가
//   4. 위험한 실행 — eval, new Function, dynamic import (설계서 §8.3)
//   5. 화면 경로 — 견적 문서를 브라우저에 영속 저장하거나 외부 origin으로 보내는가 (§8.8, §8.4)
//   6. 시그니처 — calculateQuote/buildCustomerProjection이 PrivateCostSession을 받는가 (§10.4)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** 원가를 절대 만지면 안 되는 경로. */
const COST_FREE_PREFIXES = [
  'src/domain',
  'src/export/customer',
  'src/export/ooxml',
  'src/services/files',
  // 공유용(1단계)과 준비 단계는 **원가를 받지 않는다**.
  // 받는 곳은 src/export/internal 뿐이다.
  'src/export/shared',
  'src/export/variants',
];

/** 원가 모듈로 간주하는 경로. */
const COST_MODULE = /services[/\\]private-cost/;

/** 영속 저장 — 설계서 §8.1: 원가를 localStorage/IndexedDB에 넣지 않는다. */
const PERSISTENCE = /\b(localStorage|sessionStorage|indexedDB|openDatabase|caches)\b/;

/** 네트워크 — 설계서 §8.4: 네트워크 요청에 문서 상태를 싣는 공용 함수를 두지 않는다. */
const NETWORK = /\b(fetch|XMLHttpRequest|WebSocket|navigator\.sendBeacon|EventSource)\b/;

/** 설계서 §5.1, §8.3: eval 금지, dynamic import 금지. */
const DANGEROUS = /\beval\s*\(|new\s+Function\s*\(|(?<![.\w])import\s*\(/;

/**
 * 화면 경로. 설계서 §8.8이 "RTCOM의 localStorage 자동 저장을 계승하지 않는다"고 한 곳이다.
 *
 * 견적 문서에는 고객명·공사명·금액이 들어간다. 브라우저에 영속 저장하면
 * 같은 origin의 스크립트가 읽을 수 있고(설계서 §8.5), 사용자가 지웠다고 생각한 뒤에도 남는다.
 * 저장은 사용자가 명시적으로 파일로 내보낼 때만 한다 (설계서 §6.3).
 */
const UI_PREFIXES = ['src/features', 'src/app'];

/**
 * 화면이 **외부 origin**으로 나가는 요청.
 *
 * 설계서 §8.4: "네트워크 요청에 문서 상태를 싣는 공용 함수를 두지 않는다."
 * 같은 origin의 배포 데이터(`data/approved/*.json`)를 읽는 것은 허용한다 —
 * 읽기이고 문서 상태를 바깥으로 보내지 않는다.
 */
const EXTERNAL_ORIGIN = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(\s*[`'"]\s*https?:/;
const BEACON = /navigator\s*\.\s*sendBeacon/;

const findings = [];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function posix(path) {
  return path.split(sep).join('/');
}

/** 줄 단위 검사 — 주석 줄은 건너뛴다. 설명에 쓴 단어를 위반으로 잡지 않기 위해서다. */
function codeLines(source) {
  const lines = source.split('\n');
  const out = [];
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];
    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end === -1) continue;
      inBlockComment = false;
      line = line.slice(end + 2);
    }
    const blockStart = line.indexOf('/*');
    if (blockStart !== -1) {
      const end = line.indexOf('*/', blockStart + 2);
      if (end === -1) {
        inBlockComment = true;
        line = line.slice(0, blockStart);
      } else {
        line = line.slice(0, blockStart) + line.slice(end + 2);
      }
    }
    const lineComment = line.indexOf('//');
    if (lineComment !== -1) line = line.slice(0, lineComment);
    if (line.trim() === '') continue;
    out.push([i + 1, line]);
  }
  return out;
}

const files = walk(SRC);
if (files.length === 0) {
  console.error('src에서 검사할 파일을 찾지 못했다.');
  process.exit(1);
}

for (const file of files) {
  const rel = posix(relative(ROOT, file));
  const source = readFileSync(file, 'utf8');
  const lines = codeLines(source);
  const isCostFree = COST_FREE_PREFIXES.some((p) => rel.startsWith(p));
  const isCostModule = COST_MODULE.test(rel);
  const isUi = UI_PREFIXES.some((p) => rel.startsWith(p));

  for (const [number, line] of lines) {
    // 1. 금지 import
    if (isCostFree) {
      const match = /from\s+['"]([^'"]+)['"]/.exec(line);
      if (match && COST_MODULE.test(match[1])) {
        findings.push(
          `${rel}:${number}  원가 모듈 import 금지 경로에서 '${match[1]}'을 가져온다`,
        );
      }
    }

    // 2. 영속 저장 — 원가를 만질 수 있는 모듈 전부
    if ((isCostModule || isCostFree) && PERSISTENCE.test(line)) {
      findings.push(`${rel}:${number}  영속 저장 API 사용: ${line.trim()}`);
    }

    // 3. 네트워크 — 원가 모듈은 네트워크에 닿으면 안 된다
    if (isCostModule && NETWORK.test(line)) {
      findings.push(`${rel}:${number}  원가 모듈에서 네트워크 API 사용: ${line.trim()}`);
    }

    // 4. 위험한 실행 — 전 범위
    if (DANGEROUS.test(line)) {
      findings.push(`${rel}:${number}  eval/Function/dynamic import: ${line.trim()}`);
    }

    // 5. 화면 경로 — 견적 문서를 브라우저에 영속 저장하거나 외부로 보내지 않는다
    if (isUi) {
      if (PERSISTENCE.test(line)) {
        findings.push(
          `${rel}:${number}  화면에서 영속 저장 API 사용 (설계서 §8.8): ${line.trim()}`,
        );
      }
      if (EXTERNAL_ORIGIN.test(line)) {
        findings.push(
          `${rel}:${number}  화면에서 외부 origin 요청 (설계서 §8.4): ${line.trim()}`,
        );
      }
      if (BEACON.test(line)) {
        findings.push(`${rel}:${number}  sendBeacon 사용 (설계서 §8.4): ${line.trim()}`);
      }
    }
  }
}

// 6. 시그니처 검사 — 설계서 §10.4가 "PrivateCostSession을 인자로 받지 않는다"고 못박은 함수들
const SIGNATURE_RULES = [
  ['src/domain/calculation/calculate.ts', 'calculateQuote'],
  ['src/export/customer/projection.ts', 'buildCustomerProjection'],
  ['src/export/shared/projection.ts', 'buildSharedProjection'],
  ['src/export/variants/prepare.ts', 'prepareQuote'],
];
for (const [relPath, fn] of SIGNATURE_RULES) {
  const source = readFileSync(join(ROOT, relPath), 'utf8');
  const at = source.indexOf(`export function ${fn}`);
  if (at === -1) {
    findings.push(`${relPath}  ${fn}를 찾을 수 없다 — 검사 규칙이 낡았다`);
    continue;
  }
  const signature = source.slice(at, source.indexOf('{', at));
  if (/PrivateCostSession/.test(signature)) {
    findings.push(`${relPath}  ${fn}가 PrivateCostSession을 인자로 받는다 (설계서 §10.4 위반)`);
  }
}

const uiFiles = files.filter((f) =>
  UI_PREFIXES.some((p) => posix(relative(ROOT, f)).startsWith(p)),
);
console.log(`검사한 파일: ${files.length} (화면 경로 ${uiFiles.length})`);
if (findings.length > 0) {
  console.error(`\n=== 위반 ${findings.length}건 ===`);
  for (const f of findings) console.error('  ! ' + f);
  process.exit(1);
}
console.log('=== 통과: 원가 모듈이 고객용 경로에 섞이지 않았다 ===');
