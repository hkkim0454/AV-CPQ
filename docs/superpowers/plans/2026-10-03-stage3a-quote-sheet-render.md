# 단계 3-A 견적 표 화면 출력 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 견적 문서를 RTCOM 시각 언어로, 원본 Excel 과 같은 열·머리글·행 구조로 화면에 **정확히 그린다.** 편집은 다음 계획(단계 3-B)이다.

**Architecture:** 읽기 전용 렌더 계층만 만든다. 상태 변경 경로를 두지 않아 이 계획의 모든 컴포넌트가 순수 함수에 가깝다. 데이터는 `data/approved/*.json` 을 **fetch** 로 읽고 Zod 로 검증한다(빌드 타임 import 아님 — 결정 D3 의 가역성이 거기 걸려 있다). 계산은 기존 `calculateQuote` 를 그대로 호출하고 UI 는 결과를 그리기만 한다 — 화면에서 금액을 다시 계산하지 않는다.

**Tech Stack:** React 19.2, TypeScript 5.9, Vite 7.1, Zod 4.1, Vitest 3.2 + Testing Library

**Spec:**
- `docs/design-spec.md` — §2.2 토큰, §2.3 화면 구성, §2.4 편집 화면 원칙, §4.2 최종 내역서 열, §5.6 미등록 가격, §8.4 유출 방지, §10.3 편집기 범위
- `docs/decisions/2026-10-03-scope-and-data.md` — D3 파일 분리
- `docs/design/reference-map.md` — **토큰 실측값 전부. 추정하지 않는다**
- `docs/stage-status.md` — 끝난 것과 전제. **착수 전 읽는다**
- `docs/template/mapping.md` — 원본 셀·병합·간접비 9행

---

## Global Constraints

- **이 계획은 상태를 바꾸지 않는다.** 행 추가·삭제·수정·실행취소는 단계 3-B 다. 여기서 만들지 않는다.
- **화면에서 금액을 계산하지 않는다.** `calculateQuote` 의 `CalculationSnapshot` 을 받아 그리기만 한다. UI 에 `*`, `+`, `Math.floor` 가 나오면 잘못된 것이다(열 너비·픽셀 계산 제외).
- **`undefined` 는 `미등록`, `0` 은 숫자 `0`.** 설계서 §5.6. 둘을 같게 그리면 이 계획은 실패다. `RowCalculation.materialAmount?: Decimal` 의 `?` 가 그 구분이다.
- **카탈로그는 `fetch`.** 빌드 타임 `import` 금지. `prices.json` 은 **없을 수 있다고 가정**하고 짠다(404 → 전 품목 미등록). 결정 D3 의 "파일만 빼면 된다"가 여기 걸려 있다.
- **토큰 값을 새로 만들지 않는다.** `docs/design/reference-map.md` §2 에 적힌 값만 쓴다. 거기 없는 값이 필요하면 멈추고 보고한다(설계서 §2.1: "아직 확인하지 않은 디자인 토큰 값을 만들어 확정하지 않는다").
- **외부 CDN·글꼴·아이콘·분석 SDK 금지** (설계서 §8.4). `vite.config.ts` 가 이미 그 전제다.
- **localStorage 에 견적을 저장하지 않는다** (설계서 §8.8 — RTCOM 자동 저장은 계승하지 않는 것). Task 0 의 정적 검사가 강제한다.
- **Task 완료 조건은 `npm run verify`** (typecheck → test → audit:exports). "테스트 통과"만 쓰지 않는다 — 없는 값은 테스트가 쳐다보지 않는다(`docs/stage-status.md` 참조).
- 새 npm 런타임 의존성을 추가하지 않는다. 테스트용 `@testing-library/react` + `@testing-library/user-event` + `jsdom` 은 devDependency 로 추가한다.
- 커밋 메시지는 한국어 한 줄.

### 작업 공간

Task 0 은 **반드시 `main`(`AV-CPQ`)** 에서 한다. Task 1~6 은 사용자가 배정한 워크트리에서 한다.
UI 워크트리(`AV-CPQ-ui`, `ui-work`)에서 한다면 **먼저 `git merge main` + `npm install` + `npm run verify` 301/301** 을 확인한다 (`AV-CPQ-ui/HANDOFF-UI.md` §0).

---

## Review Focus

1. **미등록 가격과 0원이 화면에서 같아 보임** — `materialAmount` 가 `undefined` 인 행과 `0` 인 행이 둘 다 빈칸이거나 둘 다 `0` 으로 보이면, 사용자가 견적을 완성했다고 믿고 내보낸다. 설계서 §5.6 이 금지한 바로 그 상황이다. Task 4 가 두 행을 나란히 렌더해 서로 다른 텍스트가 나오는지 고정한다.
2. **`prices.json` 이 없을 때 화면이 깨짐** — 결정 D3 의 전환 경로가 404 다. 빈 배열도 `null` 도 아니고 **파일 자체가 없다**. `fetch` 가 404 면 `res.json()` 이 던지거나 HTML 을 파싱한다. Task 3 이 404·빈 파일·깨진 JSON 세 가지를 고정한다.
3. **갑지를 시스템 시트와 같은 컴포넌트로 그림** — 갑지는 **A열이 폭 1.625 의 여백**이고 내용이 B~I(`B순위 C품명 D규격 E단위 F수량 G금액 H합계 I비고`)다. 시스템 시트의 A~K 9열과 **열 구성이 다르다**. 하나로 묶으면 둘 중 하나가 틀린다. Task 5 가 갑지를 별도 컴포넌트로 고정한다.
4. **blocking 경고가 있는데 Excel 다운로드가 눌림** — `CalculationSnapshot.blocking === true` 는 "확정·고객 출력 차단"이다(설계서 §5.6, §7.5). 버튼이 살아 있으면 미해결 견적이 고객에게 나간다. Task 2 가 버튼 비활성과 사유 표시를 고정한다.
5. **390px 에서 페이지 전체가 가로로 넘침** — 설계서 §2.4 는 "표 구조를 보존한 **가로 스크롤**"과 "페이지 전체의 가로 넘침과 표 내부 스크롤을 구분한다"를 요구한다. 표가 아니라 `body` 가 넘치면 머리글·툴바까지 밀린다. Task 6 이 표 바깥 요소의 너비가 뷰포트를 넘지 않음을 고정한다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `vite.config.ts` | **수정(main)** `data/approved` 를 빌드 산출물로 복사 |
| `tools/audit-exports.mjs` | **수정(main)** 검사 대상에 `src/features/**` 추가 |
| `src/styles/tokens.css` | **신규** reference-map §2 의 토큰. 값만 옮긴다 |
| `src/styles/base.css` | **신규** 리셋·본문 배경·인쇄 미디어 쿼리 |
| `src/app/App.tsx` | **신규** 셸 — 헤더·툴바·탭·본문 슬롯 |
| `src/app/Toolbar.tsx` | **신규** 샘플/새 견적/열기/저장/Excel. 이 계획에서는 **Excel 버튼의 활성 여부만** 동작 |
| `src/app/Tabs.tsx` | **신규** 갑지/시스템/일위대가/합계 segmented control |
| `src/data/catalog/load.ts` | **신규** fetch + Zod. `prices.json` 선택적 |
| `src/features/worksheet/QuoteSheet.tsx` | **신규** 시스템 시트 1장 — 2단 머리글·9열·직접비·간접비·합계 |
| `src/features/worksheet/SheetRowView.tsx` | **신규** 행 1줄. 품목/그룹/파생 분기 |
| `src/features/worksheet/money.ts` | **신규** 금액·수량 표시 변환. **미등록/0 구분의 단일 지점** |
| `src/features/worksheet/CoverSheet.tsx` | **신규** 갑지 — **열 구성이 다르다** |
| `src/features/worksheet/WarningList.tsx` | **신규** 경고 목록. blocking 구분 |
| `tests/unit/money.test.ts` | 미등록/0/소수 표시 |
| `tests/unit/loadCatalog.test.ts` | 404·빈 파일·깨진 JSON |
| `tests/unit/QuoteSheet.test.tsx` | 열 순서·2단 머리글·미등록 렌더 |
| `tests/unit/CoverSheet.test.tsx` | 갑지 열 구성 |
| `tests/unit/App.test.tsx` | blocking 시 Excel 버튼 비활성 |

---

### Task 0: 배포 경로와 정적 검사 범위 (main 전용)

**Files:**
- Modify: `vite.config.ts`
- Modify: `tools/audit-exports.mjs`
- Test: `tests/integration/buildOutput.test.ts`

**Interfaces:**
- Produces: 빌드 산출물의 `dist/data/approved/*.json`. UI 가 `fetch('./data/approved/products.json')` 로 읽는 경로가 이것이다.

**이 Task 는 main 에서만 한다.** UI 워크트리가 `vite.config.ts` 를 고치면 병합 충돌이 난다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/integration/buildOutput.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIST = 'dist/data/approved';

describe('빌드 산출물의 승인 데이터', () => {
  it('products.json 이 dist 에 복사된다 — 없으면 `npm run build` 를 먼저 돌린다', () => {
    expect(existsSync(`${DIST}/products.json`), `${DIST}/products.json 없음`).toBe(true);
  });

  it('다섯 파일이 전부 복사된다', () => {
    for (const f of ['products.json', 'prices.json', 'labor-items.json', 'wage-table.json', 'labor-mappings.json']) {
      expect(existsSync(`${DIST}/${f}`), f).toBe(true);
    }
  });

  it('복사본에 매입처 흔적이 없다 — 빌드가 섞어 넣지 않았는지 재확인', () => {
    for (const f of ['products.json', 'prices.json']) {
      const text = readFileSync(`${DIST}/${f}`, 'utf8');
      for (const pat of [/매입처/, /매입단가/, /구매처/, /구입처/]) {
        expect(text, `${f} 에 ${pat}`).not.toMatch(pat);
      }
    }
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npm run build
npx vitest run tests/integration/buildOutput.test.ts
```

Expected: FAIL — `dist/data/approved/products.json 없음`

- [ ] **Step 3: `vite.config.ts` 수정**

`publicDir` 을 바꾸면 기존 `public/` 이 죽는다. 복사 플러그인을 쓴다.

```ts
// vite.config.ts — plugins 배열에 추가
import { cpSync, existsSync } from 'node:fs';

/**
 * `data/approved/` 를 빌드 산출물로 복사한다.
 *
 * 왜 `import` 가 아니라 복사인가: 결정 D3 이 "prices.json 을 배포에서 빼기만 하면
 * 판매가가 가려지는" 가역성을 요구한다. 번들에 박으면 코드를 고쳐야 한다.
 * 설계서 §8.4: 외부에서 받아오지 않는다. 같은 origin 의 정적 파일이다.
 */
function copyApprovedData() {
  return {
    name: 'copy-approved-data',
    closeBundle() {
      if (!existsSync('data/approved')) {
        this.warn('data/approved 가 없다. `npm run build:approved` 를 먼저 돌린다.');
        return;
      }
      cpSync('data/approved', 'dist/data/approved', { recursive: true });
    },
  };
}
```

`plugins: [react(), copyApprovedData()]` 로 바꾼다.

개발 서버(`vite dev`)에서도 같은 경로로 읽히게 `server.fs.allow` 가 아니라 **`publicDir` 대신 심볼릭한 방법을 쓰지 말고**, `vite.config.ts` 의 `resolve` 아래에 다음을 추가한다:

```ts
  // dev 서버에서 `/data/approved/*` 를 저장소 파일로 직접 서빙한다.
  // 빌드에서는 위 복사 플러그인이 같은 경로를 만든다.
  server: {
    fs: { allow: ['.'] },
  },
```

그리고 dev 와 build 에서 경로가 같도록, 로더는 **`import.meta.env.BASE_URL` 기준 상대 경로**를 쓴다(Task 3).

> dev 서버에서 `data/` 가 서빙되지 않으면 `public/data/approved` 로 심볼릭 링크를 만드는 대신, `copyApprovedData` 플러그인에 `configureServer` 훅을 더해 `vite dev` 시작 시에도 `public/data/approved` 로 복사하도록 한다. `public/data/` 는 `.gitignore` 에 넣는다 — 생성물이다.

- [ ] **Step 4: `tools/audit-exports.mjs` 에 `src/features/**` 추가**

현재 검사 대상에 UI 디렉터리가 없다. 추가하고, UI 가 어기면 안 되는 것 2가지를 검사 항목으로 넣는다.

```js
// tools/audit-exports.mjs 에 추가할 검사
// 설계서 §8.8: RTCOM 의 localStorage 자동 저장은 계승하지 않는다.
// 설계서 §8.1: 원가는 어떤 영속 저장소에도 넣지 않는다.
const UI_FORBIDDEN = [
  { pattern: /\blocalStorage\b/, why: '견적 문서를 브라우저에 자동 저장하지 않는다 (설계서 §8.8)' },
  { pattern: /\bsessionStorage\b/, why: '같음' },
  { pattern: /\bindexedDB\b/i, why: '같음 (설계서 §8.1)' },
  { pattern: /\bfetch\s*\(\s*['"`]https?:/, why: '외부 origin 요청 금지 (설계서 §8.4, CSP connect-src none)' },
];
// 검사 대상 glob 에 'src/features/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}' 추가
```

같은 파일에 테스트를 건다:

```ts
// tests/unit/auditExports.test.ts 에 추가 (파일이 없으면 생성)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('audit:exports 가 UI 금지 패턴을 잡는다', () => {
  it('localStorage 를 쓰면 실패한다', () => {
    // 임시 파일을 src/features 아래 만들고 감사기를 돌린 뒤 지운다.
    const dir = 'src/features/__audit_probe__';
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'probe.ts');
    writeFileSync(file, 'export const x = () => localStorage.setItem("a", "b");\n');
    try {
      expect(() => execFileSync('node', ['tools/audit-exports.mjs'], { stdio: 'pipe' })).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 5: 통과 확인**

```bash
npm run build
npm run verify
npx vitest run tests/integration/buildOutput.test.ts
```

Expected: 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
git add vite.config.ts tools/audit-exports.mjs tests/integration/buildOutput.test.ts tests/unit/auditExports.test.ts .gitignore
git commit -m "빌드: 승인 데이터 배포 경로와 UI 금지 패턴 정적 검사"
```

---

### Task 1: 디자인 토큰

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/base.css`
- Test: `tests/unit/tokens.test.ts`

**Interfaces:**
- Produces: `--q-*` CSS 변수 전체. 이후 모든 컴포넌트가 이것만 쓴다. 하드코딩 색상값을 쓰지 않는다.

값은 **`docs/design/reference-map.md` §2 의 표를 그대로 옮긴다.** 새로 만들지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

토큰이 "있는지"가 아니라 **"reference-map 의 값과 같은지"** 를 검사한다. 값이 틀리면 디자인 계승이 깨진 것이다.

```ts
// tests/unit/tokens.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = () => readFileSync('src/styles/tokens.css', 'utf8');

/** reference-map.md §2 에서 그대로 옮긴 값. 이 표를 고치려면 reference-map 을 먼저 고친다. */
const EXPECTED: ReadonlyArray<readonly [string, string]> = [
  ['--q-bg', '#fff'],
  ['--q-soft', '#f3f6fb'],
  ['--q-ink', '#1f2532'],
  ['--q-muted', '#687386'],
  ['--q-line', '#dfe6f0'],
  ['--q-accent', '#3978ee'],
  ['--q-tint', '#edf4ff'],
  ['--q-cta-ink', '#fff'],
  ['--q-page-bg', '#f4f7ff'],
  ['--q-glass-fill', '#ffffffd9'],
  ['--q-glass-stroke', '#ffffffc7'],
  ['--q-glass-shadow', '0 18px 50px #53698a14'],
  ['--q-glass-blur', 'blur(18px)'],
  ['--q-r-shell', '24px'],
  ['--q-r-panel', '22px'],
  ['--q-r-main', '28px'],
  ['--q-r-card', '20px'],
  ['--q-r-chip', '14px'],
  ['--q-r-pill', '999px'],
  ['--q-r-seg', '11px'],
  ['--q-gutter', '16px'],
  ['--q-pad-main', '34px'],
  ['--q-h-control', '42px'],
  ['--q-h-input', '40px'],
  ['--q-h-touch', '44px'],
  ['--q-btn-face', '#edf2f8'],
  ['--q-btn-ink', '#456181'],
  ['--q-btn-face-hover', '#e3ebf7'],
  ['--q-btn-ink-hover', '#326bd5'],
  ['--q-fw-strong', '750'],
  ['--q-fw-medium', '650'],
  ['--q-max-w', '1440px'],
  ['--q-err', '#c64545'],
  ['--q-ok', '#34835b'],
  ['--q-seg-thumb', '#FFFFFF'],
];

describe('tokens.css', () => {
  it.each(EXPECTED)('%s 가 reference-map 값 %s 과 같다', (name, value) => {
    const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(css());
    expect(m, `${name} 선언 없음`).not.toBeNull();
    expect(m![1].trim()).toBe(value);
  });

  it('판정 5단계 색이 전부 있다 — 설계서 §7.2', () => {
    for (const n of ['--q-v-ok', '--q-v-rec', '--q-v-cond', '--q-v-edge', '--q-v-no']) {
      expect(css(), n).toMatch(new RegExp(`${n}\\s*:`));
    }
  });

  it('LED 의 #007AFF 를 앱 강조색으로 쓰지 않는다 — reference-map §2.2', () => {
    const accent = /--q-accent\s*:\s*([^;]+);/.exec(css())![1].trim();
    expect(accent).toBe('#3978ee');
    // #007AFF 는 auto-addable 판정 배지에서만 허용된다.
    const rec = /--q-v-rec\s*:\s*([^;]+);/.exec(css())![1].trim();
    expect(rec).toBe('#007AFF');
  });

  it('외부 글꼴을 불러오지 않는다 — 설계서 §8.4', () => {
    expect(css()).not.toMatch(/@import/);
    expect(css()).not.toMatch(/https?:/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/unit/tokens.test.ts`
Expected: FAIL — 파일 없음

- [ ] **Step 3: 구현**

`docs/design/reference-map.md` §2.1 과 §2.2 의 표를 **전부** `:root` 에 옮긴다. 위 테스트에 없는 토큰(`--q-cta`, `--q-font`, `--q-page-wash`, `--q-mark-grad`, `--q-mark-shadow`, `--q-field-fill`, `--q-focus-ring`, `--q-seg-track`, `--q-seg-thumb-shadow`, 판정색의 `-ink`/`-tint`/`-border` 변형)도 빠짐없이 넣는다. 테스트는 표본이지 전부가 아니다.

`base.css` 는 다음만 한다:
- 박스 모델 리셋, `html{background:var(--q-page-bg)}`, `body{background:var(--q-page-wash);font-family:var(--q-font)}`
- 숫자 우측 정렬용 유틸 1개 (설계서 §2.4)
- `@media print{@page{size:A4 landscape}}` — 편집 화면과 인쇄 미리보기를 분리하는 기반 (설계서 §2.4)

Pretendard 는 **자체 호스팅**한다. 폰트 파일이 저장소에 없으면 `--q-font` 의 폴백 체인이 동작하므로 이 계획에서는 `@font-face` 를 넣지 않는다. 넣으려면 폰트 파일 반입이 선행이며 별도 결정이다.

- [ ] **Step 4: 통과 확인**

Run: `npm run verify && npx vitest run tests/unit/tokens.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/styles/tokens.css src/styles/base.css tests/unit/tokens.test.ts
git commit -m "화면: RTCOM 토큰 계승 — reference-map 실측값"
```

---

### Task 2: 앱 셸과 Excel 버튼 차단

**Files:**
- Create: `src/app/App.tsx`, `src/app/Toolbar.tsx`, `src/app/Tabs.tsx`
- Create: `src/main.tsx`, `index.html`
- Test: `tests/unit/App.test.tsx`
- Modify: `package.json` (devDependency 3개), `vitest.config.ts` (jsdom 환경)

**Interfaces:**
- Consumes: `CalculationSnapshot` (`src/domain/calculation/calculate.ts:116`)
- Produces:
  ```tsx
  export type TabKey = 'cover' | 'system' | 'labor' | 'total';
  export interface AppProps {
    document: QuoteDocument;
    calculation: CalculationSnapshot;
    tab: TabKey;
    onTabChange: (t: TabKey) => void;
    /** 이 계획에서는 전부 선택. 단계 3-B 가 채운다. */
    onDownloadExcel?: () => void;
  }
  export function App(props: AppProps): JSX.Element;
  ```

툴바 버튼 5개(`샘플 선택`·`새 견적`·`작업 파일 열기`·`저장`·`Excel 다운로드`) 중 **이 계획에서 동작하는 것은 없다.** `Excel 다운로드` 의 **비활성 여부만** 동작한다 — 나머지는 자리만 잡는다(설계서 §13-10: UI 모형을 완성품으로 간주하지 않는다).

- [ ] **Step 1: devDependency 추가와 테스트 환경 설정**

```bash
npm install -D @testing-library/react@16 @testing-library/user-event@14 jsdom@25
```

`vitest.config.ts` 에 추가:

```ts
    environment: 'node',
    environmentMatchGlobs: [['tests/unit/**/*.test.tsx', 'jsdom']],
```

- [ ] **Step 2: 실패하는 테스트 작성**

```tsx
// tests/unit/App.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/app/App.js';
import { calculateQuote } from '../../src/domain/calculation/calculate.js';
import { sampleDocument } from '../fixtures/document.js';

const noop = () => {};

describe('앱 셸', () => {
  it('헤더에 제목과 포털 복귀 링크가 있다 — 설계서 §2.3', () => {
    const doc = sampleDocument();
    render(<App document={doc} calculation={calculateQuote(doc)} tab="system" onTabChange={noop} />);
    expect(screen.getByRole('banner')).toHaveTextContent('AV 견적');
    expect(screen.getByRole('link', { name: '포털로 돌아가기' })).toBeTruthy();
  });

  it('툴바 버튼 5개가 설계서 §2.3 순서로 있다', () => {
    const doc = sampleDocument();
    render(<App document={doc} calculation={calculateQuote(doc)} tab="system" onTabChange={noop} />);
    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels).toEqual(['샘플 선택', '새 견적', '작업 파일 열기', '저장', 'Excel 다운로드']);
  });

  it('탭 4개가 있다', () => {
    const doc = sampleDocument();
    render(<App document={doc} calculation={calculateQuote(doc)} tab="system" onTabChange={noop} />);
    for (const t of ['갑지', '시스템별 내역', '일위대가', '합계']) {
      expect(screen.getByRole('tab', { name: t })).toBeTruthy();
    }
  });
});

describe('blocking 경고와 Excel 다운로드 — 설계서 §5.6 / §7.5', () => {
  it('blocking 이 없으면 Excel 버튼이 활성이다', () => {
    const doc = sampleDocument();
    const calc = calculateQuote(doc);
    expect(calc.blocking).toBe(false);
    render(<App document={doc} calculation={calc} tab="system" onTabChange={noop} />);
    expect(screen.getByRole('button', { name: 'Excel 다운로드' })).not.toBeDisabled();
  });

  it('blocking 이면 Excel 버튼이 비활성이다', () => {
    const doc = sampleDocument();
    const calc = { ...calculateQuote(doc), blocking: true,
      warnings: [{ code: 'price-not-registered' as const, blocking: true, message: '판매 단가가 미등록이다.' }] };
    render(<App document={doc} calculation={calc} tab="system" onTabChange={noop} />);
    expect(screen.getByRole('button', { name: 'Excel 다운로드' })).toBeDisabled();
  });

  it('비활성 사유를 화면에 보여준다 — 왜 못 받는지 알 수 있어야 한다', () => {
    const doc = sampleDocument();
    const calc = { ...calculateQuote(doc), blocking: true,
      warnings: [{ code: 'price-not-registered' as const, blocking: true, message: '판매 단가가 미등록이다.' }] };
    render(<App document={doc} calculation={calc} tab="system" onTabChange={noop} />);
    expect(screen.getByRole('alert')).toHaveTextContent('판매 단가가 미등록이다.');
  });

  it('blocking 이 아닌 경고는 Excel 버튼을 막지 않는다', () => {
    const doc = sampleDocument();
    const calc = { ...calculateQuote(doc), blocking: false,
      warnings: [{ code: 'empty-system' as const, blocking: false, message: '빈 시스템이 있다.' }] };
    render(<App document={doc} calculation={calc} tab="system" onTabChange={noop} />);
    expect(screen.getByRole('button', { name: 'Excel 다운로드' })).not.toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('빈 시스템이 있다.');
  });
});
```

> `sampleDocument()` 가 `tests/fixtures/document.ts` 에 이미 있다. 내보내는 이름과 반환 형태를 먼저 읽고 위 호출을 맞춘다. 없으면 이 Task 에서 추가한다 — blocking 이 `false` 인 완전한 문서여야 한다.

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/unit/App.test.tsx`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 구현**

`App.tsx` 는 레이아웃만 한다. 구조는 `reference-map.md` §3 의 대응표를 따른다 — RTCOM `.rt-top` → 헤더, `.rt-tools .rt-button` → pill 툴바, LED `.seg` → 탭.

```tsx
// src/app/App.tsx (골격)
export function App({ document: doc, calculation, tab, onTabChange, onDownloadExcel }: AppProps) {
  const blocking = calculation.warnings.filter((w) => w.blocking);
  const notices = calculation.warnings.filter((w) => !w.blocking);
  return (
    <div className="q-shell">
      <header role="banner" className="q-top">
        <span className="q-brand">AV 견적</span>
        <a className="q-portal" href="../">포털로 돌아가기</a>
      </header>
      <Toolbar excelDisabled={calculation.blocking} onDownloadExcel={onDownloadExcel} />
      {blocking.length > 0 && (
        <div role="alert" className="q-notice q-notice-error">
          {blocking.map((w, i) => <p key={i}>{w.message}</p>)}
        </div>
      )}
      {notices.length > 0 && (
        <div role="status" className="q-notice">
          {notices.map((w, i) => <p key={i}>{w.message}</p>)}
        </div>
      )}
      <Tabs value={tab} onChange={onTabChange} />
      <main className="q-main">{/* Task 4·5 가 채운다 */}</main>
    </div>
  );
}
```

`Toolbar.tsx` 의 버튼 5개는 `type="button"` 이고, `Excel 다운로드` 외에는 `disabled` 가 아니라 **핸들러가 없다**. 눌러도 아무 일이 없는 것이 이 단계의 정직한 상태다.

`index.html` 과 `src/main.tsx` 는 `tokens.css` → `base.css` 순으로 import 한다.

- [ ] **Step 5: 통과 확인**

Run: `npm run verify && npx vitest run tests/unit/App.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/app/ src/main.tsx index.html tests/unit/App.test.tsx package.json package-lock.json vitest.config.ts
git commit -m "화면: 앱 셸과 blocking 시 Excel 다운로드 차단"
```

---

### Task 3: 카탈로그 로더

**Files:**
- Create: `src/data/catalog/load.ts`
- Test: `tests/unit/loadCatalog.test.ts`

**Interfaces:**
- Consumes: `productsSchema`·`pricesSchema` 등 (`src/data/catalog/schema.ts`)
- Produces:
  ```ts
  export interface Catalog {
    readonly version: string;
    readonly products: readonly CatalogProduct[];
    /** SKU → 판매단가. **비어 있을 수 있다** — prices.json 이 배포에서 빠진 경우 (결정 D3). */
    readonly prices: ReadonlyMap<string, DecimalText>;
    /** 판매가 파일이 실제로 있었는지. 화면이 "단가 미등록" 안내를 띄울지 판단한다. */
    readonly pricesAvailable: boolean;
  }
  export function loadCatalog(baseUrl?: string): Promise<Catalog>;
  ```

`products.json` 은 **필수**다. 없으면 던진다 — 제품 없이 견적을 만들 수 없다.
`prices.json` 은 **선택**이다. 404·빈 파일·파싱 실패 모두 `pricesAvailable: false` 로 떨어지고 **던지지 않는다.**

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/loadCatalog.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCatalog } from '../../src/data/catalog/load.js';

const VERSION = '0123456789ab-20261003';
const products = {
  version: VERSION,
  products: [{
    productId: 'VID-6', sku: 'VID-6', brand: '', model: '12배줌',
    quoteName: 'BRC-H800', quoteSpec: '12배줌', unit: 'EA',
    options: { category: 'PTZ', sheet: '영상', sourceRow: '6' },
    currency: 'KRW', evidence: 'review-required',
  }],
};
const prices = { version: VERSION, prices: [{ sku: 'VID-6', sellingUnitPrice: '11475000' }] };

function mockFetch(routes: Record<string, { status: number; body?: unknown; text?: string }>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    const r = key ? routes[key]! : { status: 404 };
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => r.text ?? JSON.stringify(r.body ?? {}),
    } as Response;
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('loadCatalog', () => {
  it('제품과 가격을 읽는다', async () => {
    mockFetch({ 'products.json': { status: 200, body: products }, 'prices.json': { status: 200, body: prices } });
    const c = await loadCatalog();
    expect(c.version).toBe(VERSION);
    expect(c.products).toHaveLength(1);
    expect(c.prices.get('VID-6')).toBe('11475000');
    expect(c.pricesAvailable).toBe(true);
  });

  it('prices.json 이 404 여도 던지지 않는다 — 결정 D3 의 전환 경로', async () => {
    mockFetch({ 'products.json': { status: 200, body: products }, 'prices.json': { status: 404 } });
    const c = await loadCatalog();
    expect(c.products).toHaveLength(1);
    expect(c.prices.size).toBe(0);
    expect(c.pricesAvailable).toBe(false);
  });

  it('prices.json 이 깨진 JSON 이어도 던지지 않는다', async () => {
    mockFetch({ 'products.json': { status: 200, body: products }, 'prices.json': { status: 200, text: '<!doctype html>' } });
    const c = await loadCatalog();
    expect(c.pricesAvailable).toBe(false);
  });

  it('prices.json 이 스키마에 안 맞아도 던지지 않는다', async () => {
    mockFetch({ 'products.json': { status: 200, body: products }, 'prices.json': { status: 200, body: { nope: 1 } } });
    const c = await loadCatalog();
    expect(c.pricesAvailable).toBe(false);
  });

  it('products.json 이 없으면 던진다 — 제품 없이는 견적이 불가능하다', async () => {
    mockFetch({ 'products.json': { status: 404 } });
    await expect(loadCatalog()).rejects.toThrow(/products\.json/);
  });

  it('products.json 이 스키마에 안 맞으면 던진다', async () => {
    mockFetch({ 'products.json': { status: 200, body: { version: 'bad', products: [] } } });
    await expect(loadCatalog()).rejects.toThrow();
  });

  it('제품과 가격의 version 이 다르면 던진다 — 조용한 불일치 방지 (설계서 §6.3)', async () => {
    mockFetch({
      'products.json': { status: 200, body: products },
      'prices.json': { status: 200, body: { ...prices, version: 'ffffffffffff-20261001' } },
    });
    await expect(loadCatalog()).rejects.toThrow(/version/);
  });

  it('외부 origin 을 부르지 않는다 — 설계서 §8.4', async () => {
    const spy = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(products) }) as Response);
    vi.stubGlobal('fetch', spy);
    await loadCatalog();
    for (const call of spy.mock.calls) {
      expect(String(call[0])).not.toMatch(/^https?:/);
    }
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/unit/loadCatalog.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// src/data/catalog/load.ts
/**
 * 승인 데이터를 같은 origin 의 정적 파일에서 읽는다.
 *
 * 왜 `import` 가 아니라 `fetch` 인가 (결정 D3):
 *   `prices.json` 을 배포에서 빼기만 하면 판매가가 가려지는 가역성이 D3 의 핵심이다.
 *   번들에 박으면 코드를 고쳐야 한다.
 *
 * 설계서 §8.4: 외부 origin 을 부르지 않는다. 상대 경로만 쓴다.
 * 설계서 §5.6: 가격이 없는 상태는 오류가 아니라 **정상 경로**다.
 */
import type { DecimalText } from '../../domain/quote/types.js';
import type { CatalogProduct } from './buildProducts.js';
import { pricesSchema, productsSchema } from './schema.js';

export interface Catalog {
  readonly version: string;
  readonly products: readonly CatalogProduct[];
  readonly prices: ReadonlyMap<string, DecimalText>;
  readonly pricesAvailable: boolean;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return JSON.parse(await res.text());
}

export async function loadCatalog(baseUrl = './data/approved'): Promise<Catalog> {
  // 제품은 필수. 없으면 견적 자체가 불가능하므로 던진다.
  const productsRaw = await fetchJson(`${baseUrl}/products.json`).catch((e: unknown) => {
    throw new Error(`products.json 을 읽지 못했다: ${String(e)}`);
  });
  const parsed = productsSchema.parse(productsRaw);

  // 가격은 선택. 404·깨진 JSON·스키마 불일치 전부 "없음"으로 떨어진다 (결정 D3).
  let prices = new Map<string, DecimalText>();
  let pricesAvailable = false;
  let priceVersion: string | undefined;
  try {
    const p = pricesSchema.parse(await fetchJson(`${baseUrl}/prices.json`));
    priceVersion = p.version;
    prices = new Map(p.prices.map((e) => [e.sku, e.sellingUnitPrice]));
    pricesAvailable = true;
  } catch {
    // 의도된 경로다. 로그를 남기지 않는다 — 설계서 §8.3: 파서가 파일 정보를 밖으로 내보내지 않는다.
  }

  // 버전이 어긋나면 조용히 섞지 않는다 (설계서 §6.3).
  if (pricesAvailable && priceVersion !== parsed.version) {
    throw new Error(`승인 데이터 version 불일치: products ${parsed.version} vs prices ${priceVersion}`);
  }

  return { version: parsed.version, products: parsed.products, prices, pricesAvailable };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run verify && npx vitest run tests/unit/loadCatalog.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/data/catalog/load.ts tests/unit/loadCatalog.test.ts
git commit -m "화면: 승인 데이터 로더 — prices.json 없이도 동작 (결정 D3)"
```

---

### Task 4: 견적 표 — 시스템 시트

**Files:**
- Create: `src/features/worksheet/money.ts`
- Create: `src/features/worksheet/SheetRowView.tsx`
- Create: `src/features/worksheet/QuoteSheet.tsx`
- Test: `tests/unit/money.test.ts`, `tests/unit/QuoteSheet.test.tsx`

**Interfaces:**
- Consumes: `SheetRow`·`QuoteSystem` (`src/domain/quote/types.ts`), `SystemCalculation`·`RowCalculation` (`src/domain/calculation/calculate.ts:51`)
- Produces:
  ```ts
  // money.ts — 미등록/0 구분의 단일 지점
  export const UNREGISTERED = '미등록';
  /** 금액 표시. undefined → '미등록', 0 → '0', 그 외 → 천단위 쉼표. */
  export function amountText(v: Decimal | undefined): string;
  /** 수량 표시. 소수는 불필요한 0 을 떨어뜨린다. */
  export function quantityText(v: Decimal): string;
  /** 미등록인지 — className 분기용. */
  export function isUnregistered(v: Decimal | undefined): boolean;
  ```
  ```tsx
  export interface QuoteSheetProps {
    system: QuoteSystem;
    rows: readonly SheetRow[];            // 이 시스템의 행만, 표시 순서대로
    calculation: SystemCalculation;
  }
  export function QuoteSheet(props: QuoteSheetProps): JSX.Element;
  ```

열 순서는 설계서 §4.2 고정: `번호 · 품명 · 규격 · 단위 · 수량 · 재료비(단가/금액) · 노무비(단가/금액) · 합계 · 비고`.
2단 머리글: 1행에 `재료비`·`노무비` 가 2칸씩 가로 병합, 나머지는 2행 세로 병합.

- [ ] **Step 1: `money.ts` 실패 테스트**

```ts
// tests/unit/money.test.ts
import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/domain/calculation/rounding.js';
import { amountText, isUnregistered, quantityText, UNREGISTERED } from '../../src/features/worksheet/money.js';

describe('amountText — 설계서 §5.6', () => {
  it('undefined 는 미등록이다', () => {
    expect(amountText(undefined)).toBe(UNREGISTERED);
    expect(UNREGISTERED).toBe('미등록');
  });

  it('0 은 0 이다 — 미등록과 다르다', () => {
    expect(amountText(new Decimal(0))).toBe('0');
    expect(amountText(new Decimal(0))).not.toBe(amountText(undefined));
  });

  it('천단위 쉼표를 넣는다', () => {
    expect(amountText(new Decimal(11475000))).toBe('11,475,000');
  });

  it('음수를 그대로 보여준다 — NEGO 조정액', () => {
    expect(amountText(new Decimal(-80000))).toBe('-80,000');
  });

  it('isUnregistered 가 0 과 undefined 를 가른다', () => {
    expect(isUnregistered(undefined)).toBe(true);
    expect(isUnregistered(new Decimal(0))).toBe(false);
  });
});

describe('quantityText', () => {
  it('정수는 소수점을 붙이지 않는다', () => {
    expect(quantityText(new Decimal(2))).toBe('2');
  });

  it('소수는 그대로 보여준다 — 설계서 §5.2 소수 수량', () => {
    expect(quantityText(new Decimal('12.5'))).toBe('12.5');
  });

  it('불필요한 끝자리 0 을 떨어뜨린다', () => {
    expect(quantityText(new Decimal('2.50'))).toBe('2.5');
  });

  it('수량 0 은 0 이다', () => {
    expect(quantityText(new Decimal(0))).toBe('0');
  });
});
```

- [ ] **Step 2: 실패 확인 → `money.ts` 구현 → 통과 확인**

Run: `npx vitest run tests/unit/money.test.ts`
Expected: 먼저 FAIL(모듈 없음) → 구현 후 PASS (9 tests)

```ts
// src/features/worksheet/money.ts
/**
 * 화면 표시 변환. **미등록과 0 을 가르는 단일 지점이다.**
 *
 * 설계서 §5.6: 단가 미등록을 0원으로 표시해 견적을 완성시키지 않는다.
 * 설계서 §8.3: 0원은 명시적으로 입력된 유효한 0과 구분한다.
 */
import type { Decimal } from '../../domain/calculation/rounding.js';

export const UNREGISTERED = '미등록';

export function isUnregistered(v: Decimal | undefined): boolean {
  return v === undefined;
}

export function amountText(v: Decimal | undefined): string {
  if (v === undefined) return UNREGISTERED;
  return v.toNumber().toLocaleString('ko-KR', { maximumFractionDigits: 0 });
}

export function quantityText(v: Decimal): string {
  return v.toString();   // Decimal 은 '2.50' → '2.5' 로 정규화한다
}
```

> `Decimal.toString()` 이 `'2.50'` 을 `'2.5'` 로 정규화하는지 테스트가 확인한다. 아니면 `v.toDecimalPlaces(…)` 등으로 맞추되 **기대값은 바꾸지 않는다.**

- [ ] **Step 3: `QuoteSheet` 실패 테스트**

```tsx
// tests/unit/QuoteSheet.test.tsx
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QuoteSheet } from '../../src/features/worksheet/QuoteSheet.js';
// 픽스처는 tests/fixtures/document.ts 의 것을 쓰되, 아래 3행을 포함하도록 구성한다.
// (a) 단가 등록된 행  (b) 단가 미등록 행  (c) 단가가 명시적 0 인 행

describe('견적 표 열 구조 — 설계서 §4.2', () => {
  it('열 순서가 번호·품명·규격·단위·수량·재료비(단가/금액)·노무비(단가/금액)·합계·비고 다', () => {
    render(<QuoteSheet {...fixture()} />);
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent?.replace(/\s/g, ''));
    expect(heads).toEqual([
      '번호', '품명', '규격', '단위', '수량', '재료비', '노무비', '합계', '비고',
      '단가', '금액', '단가', '금액',
    ]);
  });

  it('재료비·노무비가 2칸씩 가로 병합이다', () => {
    render(<QuoteSheet {...fixture()} />);
    expect(screen.getByRole('columnheader', { name: '재료비' })).toHaveAttribute('colspan', '2');
    expect(screen.getByRole('columnheader', { name: '노무비' })).toHaveAttribute('colspan', '2');
  });

  it('나머지 머리글은 2행 세로 병합이다', () => {
    render(<QuoteSheet {...fixture()} />);
    for (const n of ['번호', '품 명', '규 격', '단위', '수량', '합 계', '비 고']) {
      const h = screen.queryByRole('columnheader', { name: n });
      if (h) expect(h).toHaveAttribute('rowspan', '2');
    }
  });

  it('인쇄 견적 표에 없는 열을 넣지 않는다 — 설계서 §2.4', () => {
    render(<QuoteSheet {...fixture()} />);
    expect(screen.getAllByRole('columnheader')).toHaveLength(13); // 9 + 하단 4
  });
});

describe('미등록과 0 — 설계서 §5.6', () => {
  it('단가 미등록 행은 "미등록"으로, 0원 행은 "0"으로 나온다', () => {
    render(<QuoteSheet {...fixture()} />);
    const unreg = screen.getByRole('row', { name: /단가미등록품목/ });
    const zero = screen.getByRole('row', { name: /무상제공품목/ });
    expect(within(unreg).getByText('미등록')).toBeTruthy();
    expect(within(zero).queryByText('미등록')).toBeNull();
    expect(within(zero).getAllByText('0').length).toBeGreaterThan(0);
  });

  it('미등록 셀에 구분 가능한 표시가 붙는다 — 색만으로 구분하지 않는다', () => {
    render(<QuoteSheet {...fixture()} />);
    const cell = screen.getAllByText('미등록')[0]!;
    expect(cell.closest('td')).toHaveAttribute('data-unregistered', 'true');
  });
});

describe('소계 구조 — 설계서 §4.2', () => {
  it('직접비계 → 간접비 항목 → 간접비계 → 합계 순으로 나온다', () => {
    render(<QuoteSheet {...fixture()} />);
    const text = screen.getByRole('table').textContent ?? '';
    const order = ['직접비계', '간접비계', '합 계'].map((s) => text.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it('간접비 9개 항목이 전부 나온다 — 미적용 3개 포함', () => {
    render(<QuoteSheet {...fixture()} />);
    for (const n of ['간접노무비', '고용보험료', '산재보험료', '연금보험료', '건강보험료',
                     '노인장기요양보험료', '산업안전보건관리비', '퇴직공제부금비', '공과잡비']) {
      expect(screen.getByText(n), n).toBeTruthy();
    }
  });

  it('미적용 간접비는 금액 0 이고 요율은 그대로 보인다 — stage-status 참조', () => {
    render(<QuoteSheet {...fixture()} />);
    const row = screen.getByRole('row', { name: /연금보험료/ });
    expect(within(row).getByText('0')).toBeTruthy();
    expect(row.textContent).toMatch(/0\.01215|1\.215/);
  });
});

describe('숫자 정렬 — 설계서 §2.4', () => {
  it('금액 셀이 우측 정렬이다', () => {
    render(<QuoteSheet {...fixture()} />);
    const cell = screen.getAllByText('11,475,000')[0]!.closest('td')!;
    expect(cell.className).toMatch(/num|right/);
  });
});
```

> `fixture()` 는 이 테스트 파일 안에 만든다. `QuoteSystem` + `SheetRow[]` + `SystemCalculation` 세 개를 반환하며, 품목 3행(등록·미등록·명시적 0)과 간접비 9항목을 포함해야 한다. `calculateQuote` 를 돌려 `SystemCalculation` 을 얻는 쪽이 손으로 만드는 것보다 안전하다 — 계산 결과와 화면이 어긋날 여지가 없어진다.

- [ ] **Step 4: 실패 확인**

Run: `npx vitest run tests/unit/QuoteSheet.test.tsx`
Expected: FAIL — 모듈 없음

- [ ] **Step 5: 구현**

`QuoteSheet.tsx` 는 `<table>` 하나를 그린다. 가상 스크롤을 쓰지 않는다 — 설계서 §10.3 이 "인쇄 DOM 과 접근성을 손상시키지 않는다" 를 조건으로 달았고, 이 계획 범위에서는 필요 없다.

머리글은 `<thead>` 2행:

```tsx
<thead>
  <tr>
    <th rowSpan={2}>번호</th><th rowSpan={2}>품 명</th><th rowSpan={2}>규 격</th>
    <th rowSpan={2}>단위</th><th rowSpan={2}>수량</th>
    <th colSpan={2}>재료비</th><th colSpan={2}>노무비</th>
    <th rowSpan={2}>합 계</th><th rowSpan={2}>비 고</th>
  </tr>
  <tr><th>단 가</th><th>금 액</th><th>단 가</th><th>금 액</th></tr>
</thead>
```

`<tbody>` 는 `rows` 를 순서대로 `SheetRowView` 로 그린 뒤, 직접비계 → 간접비 9행 → 간접비계 → 합계 행을 `<tfoot>` 이 아니라 `<tbody>` 끝에 이어 붙인다(인쇄 시 `<tfoot>` 이 페이지마다 반복되면 원본과 달라진다).

`SheetRowView.tsx` 는 `SheetRow` 의 `type` 으로 분기한다 — `item`(품목), `display`(그룹·소그룹·메모), `derived`(파생). 그룹 행은 품명만 쓰고 나머지 칸을 비운다.

금액 셀은 전부 `money.ts` 를 거친다. 미등록이면 `data-unregistered="true"` 를 단다 — **색만으로 구분하지 않는다**(접근성).

- [ ] **Step 6: 통과 확인**

Run: `npm run verify && npx vitest run tests/unit/QuoteSheet.test.tsx tests/unit/money.test.ts`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add src/features/worksheet/money.ts src/features/worksheet/SheetRowView.tsx src/features/worksheet/QuoteSheet.tsx tests/unit/money.test.ts tests/unit/QuoteSheet.test.tsx
git commit -m "화면: 시스템 시트 견적 표 — 미등록과 0원 구분"
```

---

### Task 5: 갑지

**Files:**
- Create: `src/features/worksheet/CoverSheet.tsx`
- Test: `tests/unit/CoverSheet.test.tsx`

**Interfaces:**
- Consumes: `QuoteHeader`·`CoverGroup`·`QuoteSystem`, `CoverCalculation` (`src/domain/calculation/calculate.ts:104`)
- Produces:
  ```tsx
  export interface CoverSheetProps {
    header: QuoteHeader;
    groups: readonly CoverGroup[];
    systems: readonly QuoteSystem[];
    calculation: CoverCalculation;
  }
  export function CoverSheet(props: CoverSheetProps): JSX.Element;
  ```

**갑지는 시스템 시트와 열 구성이 다르다.** `QuoteSheet` 를 재사용하지 않는다.

| 원본 열 | 내용 |
|---|---|
| A | **폭 1.625 의 여백 열** |
| B | 순위 |
| C | 품명 |
| D | 규격 |
| E | 단위 |
| F | 수량 |
| G | 금액 (= 시스템 시트 합계) |
| H | 합계 (= F×G) |
| I | 비고 |

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
// tests/unit/CoverSheet.test.tsx
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CoverSheet } from '../../src/features/worksheet/CoverSheet.js';

describe('갑지 열 구성 — 시스템 시트와 다르다', () => {
  it('머리글이 순위·품명·규격·단위·수량·금액·합계·비고 다', () => {
    render(<CoverSheet {...fixture()} />);
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent?.replace(/\s/g, ''));
    expect(heads).toEqual(['순위', '품명', '규격', '단위', '수량', '금액', '합계', '비고']);
  });

  it('재료비·노무비 2단 머리글이 없다 — 시스템 시트와 섞이지 않았는지', () => {
    render(<CoverSheet {...fixture()} />);
    expect(screen.queryByRole('columnheader', { name: '재료비' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: '노무비' })).toBeNull();
  });
});

describe('갑지 금액 — 설계서 §5.5', () => {
  it('절사 전 합계·절사액·NEGO·최종 공급금액을 보여준다', () => {
    render(<CoverSheet {...fixture()} />);
    for (const n of ['절사 전 합계', '만원미만절사', 'NEGO', '최종 공급금액']) {
      expect(screen.getByText(new RegExp(n)), n).toBeTruthy();
    }
  });

  it('NEGO 를 음수로 보여준다 — 웹 입력은 양수, 표시는 음수', () => {
    render(<CoverSheet {...fixture()} />);  // fixture 의 negoDeduction = '80000'
    const row = screen.getByRole('row', { name: /NEGO/ });
    expect(within(row).getByText('-80,000')).toBeTruthy();
  });

  it('VAT 별도를 명시한다', () => {
    render(<CoverSheet {...fixture()} />);
    expect(screen.getByText(/V\.A\.T|VAT/)).toHaveTextContent(/별도/);
  });

  it('한글 금액을 보여준다 — 설계서 §9.4', () => {
    render(<CoverSheet {...fixture()} />);
    expect(screen.getByText(/일금.*원정/)).toBeTruthy();
  });
});

describe('머리 정보 — 설계서 §2.3', () => {
  it('공사명·고객명·작성일·견적번호를 보여준다', () => {
    const f = fixture();
    render(<CoverSheet {...f} />);
    expect(screen.getByText(f.header.projectName)).toBeTruthy();
    expect(screen.getByText(f.header.customer)).toBeTruthy();
    expect(screen.getByText(f.header.quoteNumber)).toBeTruthy();
  });

  it('작성일을 YYYY 년 MM 월 DD 일 로 보여준다 — 원본 표기', () => {
    render(<CoverSheet {...fixture()} />);   // quoteDate = '2026-08-26'
    expect(screen.getByText(/2026\s*년\s*08\s*월\s*26\s*일/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인**

Run: `npx vitest run tests/unit/CoverSheet.test.tsx`
Expected: FAIL → 구현 후 PASS (9 tests)

한글 금액은 `src/export/ooxml/koreanAmount.ts` 의 `koreanAmountSentence` 를 **재사용한다.** 화면과 Excel 이 같은 함수를 쓰면 어긋날 수 없다. 함수 이름과 시그니처를 먼저 읽고 맞춘다.

A열 여백은 `<col style={{width:'1.625ch'}}/>` 가 아니라 표 컨테이너의 좌측 패딩으로 표현한다 — 화면에 빈 `<td>` 를 두면 접근성 트리에 빈 셀이 생긴다. 원본의 열 번호와 화면 DOM 이 1:1 일 필요는 없다. **1:1 이어야 하는 것은 exporter 쪽이고 그건 이미 끝났다.**

- [ ] **Step 3: 커밋**

```bash
git add src/features/worksheet/CoverSheet.tsx tests/unit/CoverSheet.test.tsx
git commit -m "화면: 갑지 — 시스템 시트와 다른 열 구성"
```

---

### Task 6: 반응형과 인쇄 미리보기 분리

**Files:**
- Modify: `src/styles/base.css`, `src/app/App.tsx`
- Test: `tests/unit/responsive.test.tsx`

**Interfaces:**
- Produces: 없음(스타일). `data-print-preview` 속성으로 편집/인쇄 모드를 가른다.

설계서 §2.4 의 두 요구를 구현한다.

1. 모바일은 **표 구조를 보존한 가로 스크롤**. 카드로 바꾸지 않는다.
2. **페이지 전체의 가로 넘침과 표 내부 스크롤을 구분한다.**

- [ ] **Step 1: 실패하는 테스트 작성**

jsdom 은 레이아웃을 계산하지 않으므로 **픽셀을 재지 않는다.** 대신 넘침을 만드는 **구조적 조건**을 검사한다.

```tsx
// tests/unit/responsive.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/app/App.js';

describe('가로 넘침 — 설계서 §2.4', () => {
  it('표만 가로 스크롤 컨테이너 안에 있다', () => {
    render(<App {...appFixture()} />);
    const table = screen.getByRole('table');
    const scroller = table.closest('[data-hscroll]');
    expect(scroller, '표를 감싼 가로 스크롤 컨테이너가 없다').not.toBeNull();
  });

  it('머리글·툴바·탭은 스크롤 컨테이너 밖에 있다 — 표와 함께 밀리면 안 된다', () => {
    render(<App {...appFixture()} />);
    for (const el of [screen.getByRole('banner'), screen.getByRole('tablist')]) {
      expect(el.closest('[data-hscroll]')).toBeNull();
    }
  });

  it('스크롤 컨테이너가 min-width 를 갖지 않는다 — 뷰포트를 밀어내는 원인', () => {
    render(<App {...appFixture()} />);
    const scroller = screen.getByRole('table').closest('[data-hscroll]') as HTMLElement;
    expect(scroller.style.minWidth || '').toBe('');
  });
});

describe('인쇄 미리보기 분리 — 설계서 §2.4', () => {
  it('기본은 편집 모드다', () => {
    render(<App {...appFixture()} />);
    expect(document.querySelector('[data-print-preview="true"]')).toBeNull();
  });

  it('인쇄 미리보기에서는 툴바를 숨긴다', () => {
    render(<App {...appFixture()} printPreview />);
    const root = document.querySelector('[data-print-preview="true"]');
    expect(root).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Excel 다운로드' })).toBeNull();
  });
});
```

`base.css` 에는 다음을 둔다. 실제 눈 확인은 Step 3 이 사람에게 넘긴다.

```css
/* 설계서 §2.4: 페이지 전체가 넘치지 않고 표만 내부에서 스크롤한다. */
[data-hscroll] { overflow-x: auto; max-width: 100%; }
[data-hscroll] > table { min-width: max-content; }   /* 표 자신은 넓어도 된다 */
.q-shell { max-width: var(--q-max-w); margin-inline: auto; overflow-x: clip; }

@media print {
  @page { size: A4 landscape; }
  .q-top, .q-tools, [role='tablist'] { display: none; }
  [data-hscroll] { overflow: visible; }
}
```

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인**

Run: `npm run verify && npx vitest run tests/unit/responsive.test.tsx`
Expected: FAIL → 구현 후 PASS (5 tests)

- [ ] **Step 3: 사람 눈 확인 — 1440 / 1024 / 390**

```bash
npm run dev
```

브라우저를 1440px·1024px·390px 로 두고 확인하고, 결과를 `docs/design/visual-check.md` 에 적는다.

| 확인할 것 | 기준 |
|---|---|
| 페이지 가로 스크롤바 | **없어야 한다.** 표 안에만 있다 |
| 머리글 높이·패널 모서리·그림자·버튼 높이·글꼴 | RTCOM 공개 화면과 나란히 놓고 비교 (reference-map §5) |
| 390px 에서 툴바 | 줄바꿈되거나 가로 스크롤. 잘리지 않는다 |
| 표 머리글 | 세로 스크롤 시 고정 (설계서 §2.4) |

RTCOM 화면: https://seoulav.github.io/rtcom-configurator/

차이가 나면 **토큰을 고치지 말고 기록한다.** 토큰은 실측값이므로, 다르면 구조나 레이아웃이 틀린 것이다.

- [ ] **Step 4: 커밋**

```bash
git add src/styles/base.css src/app/App.tsx tests/unit/responsive.test.tsx docs/design/visual-check.md
git commit -m "화면: 가로 스크롤 경계와 인쇄 미리보기 분리"
```

---

## 이 계획이 끝나면

견적 문서를 **원본 Excel 과 같은 구조로 화면에서 볼 수 있다.** 갑지와 시스템 시트, 간접비 9행, 절사·NEGO·한글 금액까지.

열리는 것: **단계 3-B 편집** — 이 계획의 렌더 컴포넌트에 상태 변경을 붙인다.

## 이 계획이 하지 않는 것

| 항목 | 어디로 |
|---|---|
| 행 추가·삭제·복제·이동 | 단계 3-B |
| 실행 취소·키보드·붙여넣기 | 단계 3-B |
| `ProductPicker` | 단계 3-B |
| `SamplePicker` | **사용자 샘플 파일 대기** — 상상해서 만들지 않는다 |
| 일위대가 화면 (`LaborBreakdown`) | 단계 4 |
| 원가표 불러오기 UI | 단계 6 잔여 |
| 실제 Excel 다운로드 동작 | 단계 3-B (exporter 는 이미 있다) |

## 남은 결정

| 항목 | 상태 |
|---|---|
| UI 작업을 어느 워크트리에서 할지 | **사용자 결정 대기** — Task 0 은 어느 쪽이든 main |
| Pretendard 폰트 파일 반입 | 미결. 지금은 폴백 체인으로 동작 |
| 샘플 견적서 | **사용자 파일 대기** |
