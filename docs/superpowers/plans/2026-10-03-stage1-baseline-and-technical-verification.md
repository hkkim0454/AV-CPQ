# 단계 1 — 기준 자료와 기술 검증 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원본 견적서를 수정하지 않고, 민감정보가 0인 정리된 빈 Excel 템플릿과 그 템플릿으로 합성 견적을 생성·실제 Excel에서 재계산/인쇄 검증하는 파이프라인을 만들어, 이후 단계의 exporter 방식을 근거 있게 확정한다.

**Architecture:** 두 개의 런타임을 명확히 분리한다. (1) **오프라인 준비 도구(Python, stdlib only)** — 원본을 읽기 전용으로 분석하고 `templates/sanitized/` 의 빈 템플릿을 1회 생성한다. 저장소에 커밋되는 것은 생성된 템플릿과 분석 문서뿐이며 원본은 절대 들어오지 않는다. (2) **런타임 exporter(TypeScript)** — 브라우저에서 템플릿을 로드해 행·시트·수식을 주입한다. 단계 1에서는 TS exporter의 최소 수직 절단(1행 → 다행 → 시스템 추가)만 만들어 보존성을 입증한다. 검증은 실제 Excel COM(PowerShell)으로 수행한다.

**Tech Stack:** Python 3.13 (stdlib `zipfile`/`xml.etree`, 의존성 없음) · TypeScript 5 + Vite + Vitest · fflate (ZIP) · PowerShell + Excel COM(M365 16.0 ko-KR) · Node 24 / npm 11

**Spec:** `_spec.md` (AV 견적 프로그램 구현 설계서 v1.0, 2026-10-03)

---

## Global Constraints

이 절의 항목은 모든 Task의 요구사항에 암묵적으로 포함된다.

- **원본 3개 파일은 읽기 전용이다.** ZIP은 반드시 `'r'` 모드로 연다. 원본을 저장소·`public/`·빌드 산출물로 복사하지 않는다. (spec §4.5, §9.1)
- **원본 경로(고정, 확인 완료 2026-10-03):**
  - NEGO 최종본: `C:/Users/khk00/.paseo/uploads/upload_a728fa9d-e438-46b8-a177-33293375409a/견적서(NEGO)_평택 사무3동 6층 CLEAN IEC 룸 AV시스템 납품설치_260826.xlsx` — SHA-256 `57ab58c19db062830d99eff4eebb1fd952e4c060673ced73008b47ce3c080922` (대조 완료, 일치)
  - 구양식 품셈 견적: `C:/Users/khk00/.paseo/uploads/upload_0b96eb24-d00d-478a-8ff1-a3e32ac8220d/견적서_6-3라인 6층 교육장 개선_260522_품셈.xlsx`
  - 표준품셈 DB: `C:/Users/khk00/.paseo/uploads/upload_08ec1814-0517-42c2-9ae0-6bbcff2cf3c4/원가삭제_2026상반기_표준품셈_260408.xlsx`
- **실제 금액·매입원가·매입처를 터미널 로그·커밋·문서에 출력하지 않는다.** 조사 도구는 숫자 셀을 `<num>` 으로 마스킹한 상태를 기본값으로 유지한다. (spec §4.5, §8.4)
- **문자열 정규식으로 수식·XML을 수정하지 않는다.** XML 파서와 OOXML 관계(rels) 구조를 사용한다. (spec §9.1)
- **`eval` 금지, 매크로 실행 금지, dynamic import 금지.** (spec §5.1, §8.3)
- **통화 연산은 Decimal.** 부동소수 금액 연산 금지. (spec §5.1)
- **커밋하지 않는다.** 사용자가 명시적으로 요청할 때만 커밋한다 (이번 세션 합의 사항). 각 Task의 "Commit" 단계는 **`git add` 까지만 수행하고 멈춘다**.
- **`.gitignore` 의 `*.xlsx` 차단을 해제하지 않는다.** 생성된 템플릿은 Task 5에서 `git add -f` 로 명시적 예외 처리하며, 그 전에 반드시 감사를 통과해야 한다.
- 지원 대상 Excel: **Microsoft 365 / Excel 16.0 / ko-KR / x64** (확인 완료). `NUMBERSTRING` 은 이 환경 기준으로 검증한다.

---

## Review Focus

spec이 요구하지만 어느 Task의 기본 테스트도 자연히 다루지 않는, 실제 사용자를 물 가능성이 높은 입력/실패 모드. 각 항목은 아래 지정된 Task에 테스트로 고정한다.

1. **시트 이름 끝 공백** — 원본 `LED Display ` 는 끝 공백이 있고 수식은 `='LED Display '!J35` 로 참조한다. 공백을 흘리면 갑지 참조가 전부 깨지는데 Excel은 조용히 `#REF!` 로 열린다. → **Task 6** 에 고정.
2. **시트명 금지 문자·31자 초과·중복** — 사용자가 시스템 이름을 자유 입력하므로 `: \ / ? * [ ]` 와 32자 이상, 동일 이름 재입력이 반드시 들어온다. Excel은 이런 통합문서를 "복구 필요"로 연다. → **Task 6** 에 고정.
3. **행 0개인 시스템** — 시스템을 만들고 품목을 넣지 않으면 `SUM(G7:G6)` 같은 역전 범위가 생성된다. → **Task 6** 에 고정.
4. **공유 수식(shared formula) 그룹** — 원본 LED 시트는 `G12:G18`, `J12:J21` 등을 shared formula 로 저장한다. 행을 삽입하면서 master 셀만 복사하면 종속 셀이 빈 수식이 되어 금액이 0이 된다. → **Task 4** 에 고정.
5. **`calcChain.xml` 과 실제 수식 불일치** — 행 수가 바뀐 뒤 옛 calcChain 이 남으면 Excel이 복구 경고를 띄운다. → **Task 5** 에 고정.

---

## 사전 조사 결과 (이 계획의 사실 근거)

아래는 2026-10-03 읽기 전용 조사로 **확인된** 내용이다. spec의 추정을 수정하는 항목은 ⚠ 로 표시했다.

### 확인된 구조

| 항목 | 확인 결과 |
|---|---|
| 시트 6개 | `갑지`, `LED Display `(끝 공백 O), `IP KVM시스템`, `월컨트롤 시스템`, `웹화상회의 시스템`, `랙 및 케이블 배관배선` — 모두 visible |
| 인쇄 범위 | 갑지 `A1:J21`, LED `A1:K35`, IP KVM `A1:K37`, 월컨트롤 `A1:K55`, 웹화상 `A1:K30`, 랙 `A1:K31` — **spec §4.1과 일치** |
| 반복 머리글 | 시스템 5개 시트 모두 `Print_Titles = $1:$3` |
| 용지 | 전 시트 landscape, paperSize=9(A4), `fitToPage=1`, `fitToHeight=0`, scale 갑지 98 / LED 83 |
| 바닥글 | `&C&P / &N&R㈜서울영상테크` |
| 2단 머리글 병합 | `A2:A3,B2:B3,C2:C3,D2:D3,E2:E3`(세로) + `F2:G2,H2:I2`(가로) + `J2:J3,K2:K3`(세로) — **spec §4.2와 일치** |
| 틀 고정 | 시스템 시트 `xSplit=5 ySplit=3` (F4) |
| 시스템 시트 제목 | `A1 = "▣ 공사명 : "&갑지!C5` |

### 확인된 수식 (LED Display 기준)

```text
G7  = E7*F7                      재료비 금액 = 수량 × 단가
I7  = E7*H7                      노무비 금액 = 수량 × 단가
J7  = G7+I7                      품목 합계
F18 = INT(G17*20%)               배관 기타자재 = 배관자재 20%
F22 = INT(SUM(G12:G21)*2%)       잡자재비 = 자재비의 2%
G23 = SUM(G7:G22)                직접비계(재료)
I23 = SUM(I7:I22)                직접비계(노무)
J23 = SUM(J7:J22)                직접비계(합계)
```

### ⚠ 간접비 — spec §5.4의 미해결 항목이 전부 해소됨

| 행 | 항목 | C열 기준 표기 | J열 실제 |
|---|---|---|---|
| 25 | 간접노무비 | 노무비 대비 | `=INT(I23*E25)` |
| 26 | 고용보험료 | 노무비 대비 | `=INT(I23*E26)` |
| 27 | 산재보험료 | 노무비 대비 | `=INT(I23*E27)` |
| 28 | 연금보험료 | 노무비 대비 | ⚠ **상수** (수식 없음) |
| 29 | 건강보험료 | 노무비 대비 | ⚠ **상수** (수식 없음) |
| 30 | 노인장기요양보험료 | 노무비 대비 | ⚠ **상수** (수식 없음) |
| 31 | 산업안전보건관리비 | 직접비 대비 | `=INT(J23*E31)` |
| 32 | 퇴직공제부금비 | 노무비 대비 | `=INT(I23*E32)` |
| 33 | 공과잡비 | 직접비+간접노무비+산업안전관리비 | `=INT((SUM(J23,J25,J31))*E33)` |
| 34 | 간접비계 | | `=SUM(J25:J33)` |
| 35 | 합계 | | `=J23+J34` |

→ spec §5.4의 "J28:J30 등에 존재하는 숫자 또는 빈칸은 확인 전 일괄 수식화하지 않는다" 는 **옳았다.** 28~30행은 E열에 요율이 있는데도 J열이 상수다. 이 계획은 28~30행을 **수식화하지 않고 상수 입력 항목으로 모델링**하며, 사용자 확인 전까지 `review-required` 로 표시한다.
→ 공과잡비 기준은 C33 라벨과 수식이 일치함을 확인했다(spec은 "원본 추가 대조 필요"로 남겨둔 항목).

### ⚠ 갑지 (spec §5.5 확인 및 보강)

```text
C8  = "일금"&NUMBERSTRING(H18,1)&"원정(\"&TEXT(H18,"###,##0")&") V.A.T별도"
G11 = 'LED Display '!J35        G12 = 'IP KVM시스템'!J37
G13 = '월컨트롤 시스템'!J55      G14 = '웹화상회의 시스템'!J30
G15 = '랙 및 케이블 배관배선'!J31
H11 = F11*G11   (…H15 동일)
H16 = ROUNDDOWN(SUM(H11:H15),-4)    만원미만절사
H17 = <음수 상수>                    NEGO
H18 = SUM(H16:H17)
```

⚠ 갑지 열 구성은 **A열이 폭 1.625 의 여백 열**이고 내용은 B열부터다. 머리글(9행)은 `B순위 C품명 D규격 E단위 F수량 G금액 H합계 I비고` 로, 시스템 시트의 A~K 구성과 다르다. spec §2.3 화면 설계 시 이 차이를 반영해야 한다.

### ⚠ 민감정보 — spec §9.6의 예상보다 넓음

| 위치 | 내용 |
|---|---|
| `xl/externalLinks/externalLink1.xml(.rels)` | **타 고객사 견적 파일** `…평택 사무1동 8층 DIFF IEC룸…_260826.xlsx` + 사내 `Y:\05_DS영업\…` 경로 3종 |
| 갑지 `L13` (인쇄범위 밖) | 타 프로젝트 금액 한글 문구 상수 |
| 갑지 `L16`, `N17` (인쇄범위 밖) | `[1]갑지!$H$16`, `[1]갑지!$H$17` 외부 통합문서 참조 |
| `월컨트롤 시스템` 57행 이하 | 인쇄범위 밖 **58셀**의 내부 작업 메모(RACK1/RACK2 장비 배치) |
| `docProps/custom.xml` | `NSCPROP_SA` = 개인 사용자명 + `삼성SDI 수원시 AV시스템 견적_180109…xlsx` 경로, SharePoint `ContentTypeId` |
| `docProps/core.xml` | creator / lastModifiedBy 개인명, lastPrinted |
| `customXml/item1~3.xml` + itemProps | SharePoint 컨텐츠 타입 메타데이터 (7.8KB) |
| 정의 이름 **470개**(고유 134) | 그중 **128개**가 타 프로젝트/외부 파일 참조 — `예술의전당.xls`, `도곡1실행.xls`, `서울냉천 3차.xls`, `TOTAL.xls`, `C:\msoffice\CD\남가내역.mdb`, 개인명 정의 이름 등 |
| `Z_1FA04683…_.wvu.PrintArea` | 사용자 지정 보기(custom view) 잔재 |
| `xl/printerSettings/*.bin` × 6 | 각 32KB, 프린터/드라이버 정보 |
| `xl/calcChain.xml` | 계산 체인 잔재 |

→ **결론: "원본을 복사한 뒤 지우는" 방식은 금지한다.** spec §9.1대로 **허용 목록(allowlist) 기반으로 템플릿을 새로 구성**한다. 이것이 Task 4의 설계 근거다.

### ⚠ 표준품셈 DB (spec §4.4 수치 정정)

- 시트 16개 ✔ (spec과 일치). 숨김 2개: `LED전광판 계산`, `단종, 미사용 제품`
- 캐시된 `#REF!` 셀 **12개** ✔ (`LED전광판 계산` 6 + `CMS` 6) — spec과 일치
- ⚠ 깨진 정의 이름은 spec이 말한 98개가 아니라 **132개** (전체 1163개, 고유 609개)
- ⚠ **`간접비_DS` 와 `간접비_SDC, SDI` 두 개의 발주처별 간접비 시트가 존재** — spec §5.4 "모든 공사에 같은 보험·경비 요율을 적용하지 않는다" 의 실제 근거. 간접비 요율은 **발주처별 프로파일**로 모델링해야 한다.
- ⚠ 품셈 시트에 **`M: 제조사/구매처`, `N: 영업비고`** 열 존재 → **매입처 정보**다. 카탈로그 추출 시 반드시 제외한다 (spec §8.1).
- 품셈 계산 열: `Q 품목별 요율%`, `R 할증`, `S 26년 상반기`, `T~` 직종별 (통신관련기사/통신관련산업기사/통신설비공/보통인부/통신내선공/무선안테나공/저압케이블공/통신케이블공 …) 각 2열(품·노임) 병합. 17~53열 숨김.

### 디자인 기준 소스 (로컬 확보 확인)

- `../rtcom-configurator/src/styles.css` — `#rtcom-design` 스코프. `--rt-accent:#3978ee`, `--rt-cta:linear-gradient(135deg,#3978ee,#7767f4)`, `--rt-ink:#1f2532`, `--rt-line:#dfe6f0`, 카드 `border-radius:24px`, pill `999px`, Pretendard Variable, glass `box-shadow:0 18px 50px #53698a14`
- `../svt-led-calculator/src/styles.css` — `:root` 전역. `--accent:#007AFF`(iOS systemBlue), `--r-card:24px`, `--r-field:13px`, `--r-pill:980px`, `--shadow-card`, `--mono`/`--sans`(Pretendard), 판정 등급 색 5종, dark 변형 존재
- ⚠ **두 앱의 accent가 다르다**(`#3978ee` vs `#007AFF`). spec §2.2는 "어느 앱의 패턴을 따랐는지 기록"을 요구한다 → Task 8에서 결정·기록하고 사용자 확인을 받는다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `tools/inspect/ooxml_probe.py` | (존재) 읽기 전용 OOXML 패키지/정의이름/외부링크 조사. 숫자 마스킹 |
| `tools/inspect/sheet_probe.py` | (존재) 시트별 치수·병합·인쇄설정·수식 덤프 |
| `tools/build_template.py` | **신규** 허용목록 기반 빈 템플릿 생성기 (원본에서 스타일/치수만 이식) |
| `tools/verify/excel_recalc.ps1` | **신규** Excel COM 재계산·복구경고·인쇄 페이지수 검증 |
| `templates/sanitized/quote-template.xlsx` | **생성물** 민감정보 0인 빈 템플릿 |
| `src/export/ooxml/packageAudit.ts` | **신규** ZIP 전체 금지 파트/sentinel/외부참조 감사 (고객용 출력 게이트) |
| `src/export/ooxml/sheetName.ts` | **신규** 시트명 정규화·escaping·중복 해소 |
| `src/export/ooxml/template.ts` | **신규** 템플릿 로드 → 행/시트 주입 |
| `src/export/ooxml/formulas.ts` | **신규** 행 수에 따른 수식 주소 바인딩(직접비계/간접비/갑지) |
| `docs/template/mapping.md` | 원본 ↔ 템플릿 셀 매핑 기록 |
| `docs/template/verification.md` | 기술 검증 결과 / 실패한 방식과 이유 |
| `docs/design/reference-map.md` | RTCOM·LED 기준 화면·토큰·컴포넌트 출처 |
| `docs/security/data-flow.md` | 원가 경계 및 금지 경로 |

---

### Task 1: 프로젝트 스캐폴드와 민감정보 차단 게이트

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `tests/unit/gitignore.test.ts`
- Modify: `.gitignore` (존재, 검증만)

**Interfaces:**
- Consumes: 없음
- Produces: `npm run test:unit` (vitest), `npm run typecheck` (tsc --noEmit), `npm run audit:exports` (Task 5에서 구현 연결)

- [ ] **Step 1: 실패하는 테스트 작성** — `.gitignore` 가 원본 반입을 실제로 막는지 git 자체에 물어본다

```ts
// tests/unit/gitignore.test.ts
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/** git 에게 "이 경로를 무시하느냐"를 직접 묻는다. 정규식 추측이 아니라 git 의 판정을 신뢰한다. */
function isIgnored(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', path], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('.gitignore 원본·원가 반입 차단', () => {
  it.each([
    'data/견적서(NEGO)_평택.xlsx',
    'templates/원본.xlsm',
    'SHURE社 매입내역.pdf',
    '.local/analysis/nego_sheets.txt',
    'src/원가표.csv',
  ])('%s 는 무시된다', (p) => {
    expect(isIgnored(p)).toBe(true);
  });

  it('문서용 마크다운은 무시되지 않는다', () => {
    expect(isIgnored('docs/security/data-flow.md')).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/unit/gitignore.test.ts`
Expected: FAIL — vitest/package.json 부재로 실행 불가

- [ ] **Step 3: 최소 구현**

```jsonc
// package.json
{
  "name": "av-cpq",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "audit:exports": "vitest run tests/integration/template.test.ts tests/integration/synthetic.test.ts"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "vitest": "^3.2.0",
    "fflate": "^0.8.2",
    "fast-xml-parser": "^5.2.0",
    "@types/node": "^24.0.0"
  }
}
```

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true,
    "noEmit": true, "skipLibCheck": true, "types": ["node", "vitest/globals"]
  },
  "include": ["src", "tests", "vitest.config.ts"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globals: true, environment: 'node' } });
```

- [ ] **Step 4: 통과 확인**

Run: `npm install && npx vitest run tests/unit/gitignore.test.ts && npm run typecheck`
Expected: PASS (6 tests), typecheck 오류 0

- [ ] **Step 5: 스테이징 (커밋하지 않음 — Global Constraints 참조)**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts tests/unit/gitignore.test.ts .gitignore
git status --short
```

---

### Task 2: OOXML 패키지 감사기 (`packageAudit.ts`)

고객용 산출물의 최종 게이트. spec §9.6/§9.7/A08 을 코드로 고정한다. 템플릿을 만들기 **전에** 만든다 — 템플릿의 합격 여부를 이 도구가 판정하기 때문이다.

**Files:**
- Create: `src/export/ooxml/packageAudit.ts`
- Test: `tests/unit/packageAudit.test.ts`

**Interfaces:**
- Consumes: `fflate.unzipSync`
- Produces:
  ```ts
  export type AuditSeverity = 'blocker' | 'warning';
  export interface AuditFinding {
    severity: AuditSeverity;
    code: string;        // 'external-link' | 'forbidden-part' | 'sentinel' | 'defined-name' | 'doc-props' | 'calc-chain' | 'custom-xml'
    part: string;
    detail: string;
  }
  export interface AuditOptions { sentinels?: readonly string[] }
  export function auditXlsx(zip: Uint8Array, options?: AuditOptions): AuditFinding[];
  export function assertClean(zip: Uint8Array, options?: AuditOptions): void; // blocker 1개라도 있으면 throw
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/packageAudit.test.ts
import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { auditXlsx, assertClean } from '../../src/export/ooxml/packageAudit.js';

const MINIMAL = {
  '[Content_Types].xml': strToU8('<Types/>'),
  'xl/workbook.xml': strToU8('<workbook><sheets/></workbook>'),
  'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData/></worksheet>'),
};
const codes = (z: Uint8Array, o?: Parameters<typeof auditXlsx>[1]) =>
  auditXlsx(z, o).filter(f => f.severity === 'blocker').map(f => f.code).sort();

describe('auditXlsx', () => {
  it('최소 통합문서는 blocker 가 없다', () => {
    expect(codes(zipSync(MINIMAL))).toEqual([]);
  });

  it('externalLinks 파트를 blocker 로 잡는다', () => {
    const z = zipSync({ ...MINIMAL, 'xl/externalLinks/externalLink1.xml': strToU8('<externalLink/>') });
    expect(codes(z)).toContain('external-link');
  });

  it('customXml 과 docProps/custom.xml 을 잡는다', () => {
    const z = zipSync({
      ...MINIMAL,
      'customXml/item1.xml': strToU8('<x/>'),
      'docProps/custom.xml': strToU8('<Properties/>'),
    });
    expect(codes(z)).toEqual(expect.arrayContaining(['custom-xml', 'doc-props']));
  });

  it('calcChain.xml 을 잡는다', () => {
    const z = zipSync({ ...MINIMAL, 'xl/calcChain.xml': strToU8('<calcChain/>') });
    expect(codes(z)).toContain('calc-chain');
  });

  it('수식 안의 외부 통합문서 참조 [1]갑지!$H$16 을 잡는다', () => {
    const z = zipSync({
      ...MINIMAL,
      'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row><c r="L16"><f>[1]갑지!$H$16+H16</f></c></row></sheetData></worksheet>'),
    });
    expect(codes(z)).toContain('external-link');
  });

  it('타 프로젝트를 참조하는 정의 이름을 잡는다', () => {
    const z = zipSync({
      ...MINIMAL,
      'xl/workbook.xml': strToU8('<workbook><definedNames><definedName name="기성집계">{"Book1","예술의전당.xls"}</definedName></definedNames></workbook>'),
    });
    expect(codes(z)).toContain('defined-name');
  });

  it('sentinel 문자열을 모든 파트에서 찾아낸다', () => {
    const z = zipSync({ ...MINIMAL, 'xl/sharedStrings.xml': strToU8('<sst><si><t>COSTSENTINEL8675309</t></si></sst>') });
    expect(codes(z, { sentinels: ['COSTSENTINEL8675309'] })).toContain('sentinel');
  });

  it('assertClean 은 blocker 가 있으면 throw 한다', () => {
    const z = zipSync({ ...MINIMAL, 'xl/calcChain.xml': strToU8('<calcChain/>') });
    expect(() => assertClean(z)).toThrow(/calc-chain/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/unit/packageAudit.test.ts`
Expected: FAIL — `Cannot find module '../../src/export/ooxml/packageAudit.js'`

- [ ] **Step 3: 최소 구현**

```ts
// src/export/ooxml/packageAudit.ts
import { unzipSync, strFromU8 } from 'fflate';

export type AuditSeverity = 'blocker' | 'warning';
export interface AuditFinding { severity: AuditSeverity; code: string; part: string; detail: string }
export interface AuditOptions { sentinels?: readonly string[] }

/** 고객용 산출물에 존재해서는 안 되는 파트. 원본 조사(2026-10-03)에서 실제로 발견된 것들. */
const FORBIDDEN_PARTS: ReadonlyArray<[RegExp, string, string]> = [
  [/^xl\/externalLinks\//, 'external-link', '외부 통합문서 링크'],
  [/^customXml\//, 'custom-xml', 'SharePoint 컨텐츠 타입 메타데이터'],
  [/^docProps\/custom\.xml$/, 'doc-props', '사용자 지정 속성(개인명·타 고객 경로 포함 이력)'],
  [/^xl\/calcChain\.xml$/, 'calc-chain', '계산 체인 잔재 — 행 수 변경 시 복구 경고 유발'],
  [/^xl\/vbaProject\.bin$/, 'forbidden-part', '매크로'],
  [/^xl\/pivotCache\//, 'forbidden-part', '피벗 캐시'],
  [/^xl\/printerSettings\//, 'forbidden-part', '프린터/드라이버 바이너리'],
];

/** 수식 내 외부 통합문서 참조: [1]Sheet!A1 형태 */
const EXTERNAL_REF = /\[\d+\][^!]*!/;
/** 정의 이름이 다른 .xls/.mdb 파일을 가리키는 경우 */
const FOREIGN_FILE = /\.(xls[xmb]?|mdb)\b/i;

export function auditXlsx(zip: Uint8Array, options: AuditOptions = {}): AuditFinding[] {
  const files = unzipSync(zip);
  const out: AuditFinding[] = [];

  for (const part of Object.keys(files)) {
    for (const [re, code, detail] of FORBIDDEN_PARTS) {
      if (re.test(part)) out.push({ severity: 'blocker', code, part, detail });
    }
  }

  for (const [part, bytes] of Object.entries(files)) {
    if (!part.endsWith('.xml') && !part.endsWith('.rels')) continue;
    const text = strFromU8(bytes);

    for (const m of text.matchAll(/<f[ >][^<]*<\/f>|<f>[^<]*<\/f>/g)) {
      if (EXTERNAL_REF.test(m[0])) {
        out.push({ severity: 'blocker', code: 'external-link', part, detail: `수식 외부 참조: ${m[0].slice(0, 80)}` });
      }
    }

    for (const m of text.matchAll(/<definedName\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/definedName>/g)) {
      const [, name = '', value = ''] = m;
      if (name.startsWith('_xlnm.Print_')) continue;
      if (FOREIGN_FILE.test(value) || EXTERNAL_REF.test(value)) {
        out.push({ severity: 'blocker', code: 'defined-name', part, detail: `${name} -> ${value.slice(0, 80)}` });
      }
    }

    for (const s of options.sentinels ?? []) {
      if (text.includes(s)) {
        out.push({ severity: 'blocker', code: 'sentinel', part, detail: `sentinel 발견: ${s}` });
      }
    }
  }
  return out;
}

export function assertClean(zip: Uint8Array, options: AuditOptions = {}): void {
  const blockers = auditXlsx(zip, options).filter((f) => f.severity === 'blocker');
  if (blockers.length > 0) {
    throw new Error(
      `패키지 감사 실패 (${blockers.length}건):\n` +
        blockers.map((f) => `  [${f.code}] ${f.part} — ${f.detail}`).join('\n'),
    );
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/unit/packageAudit.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 원본에 대해 감사기를 돌려 "실패하는지" 확인** — 감사기가 실제로 작동함을 입증하는 역방향 검증

```ts
// tests/integration/auditOriginal.test.ts
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { auditXlsx } from '../../src/export/ooxml/packageAudit.js';

const ORIGINAL =
  'C:/Users/khk00/.paseo/uploads/upload_a728fa9d-e438-46b8-a177-33293375409a/견적서(NEGO)_평택 사무3동 6층 CLEAN IEC 룸 AV시스템 납품설치_260826.xlsx';

describe('감사기 역방향 검증 — 원본은 반드시 불합격해야 한다', () => {
  it.runIf(existsSync(ORIGINAL))('원본에서 외부링크·customXml·calcChain 을 검출한다', () => {
    const findings = auditXlsx(readFileSync(ORIGINAL));
    const codes = new Set(findings.map((f) => f.code));
    expect(codes).toContain('external-link');
    expect(codes).toContain('custom-xml');
    expect(codes).toContain('calc-chain');
    expect(codes).toContain('defined-name');
    // 실제 금액이 메시지로 새지 않도록, 상세는 길이만 확인
    expect(findings.length).toBeGreaterThan(10);
  });
});
```

Run: `npx vitest run tests/integration/auditOriginal.test.ts`
Expected: PASS — 원본이 불합격 판정됨(= 감사기가 동작함)

- [ ] **Step 6: 스테이징**

```bash
git add src/export/ooxml/packageAudit.ts tests/unit/packageAudit.test.ts tests/integration/auditOriginal.test.ts
git status --short
```

---

### Task 3: 원본 구조 매핑 문서화 (`docs/template/mapping.md`)

**Files:**
- Create: `docs/template/mapping.md`
- Modify: `tools/inspect/sheet_probe.py` (전 시트 일괄 덤프 모드 추가)

**Interfaces:**
- Consumes: `tools/inspect/ooxml_probe.Book`
- Produces: `docs/template/mapping.md` — Task 4 템플릿 생성기의 입력 사양

- [ ] **Step 1: 전 시트 구조를 로컬 분석 파일로 재생성**

```bash
export PYTHONIOENCODING=utf-8
python tools/inspect/sheet_probe.py "C:/Users/khk00/.paseo/uploads/upload_a728fa9d-e438-46b8-a177-33293375409a/견적서(NEGO)_평택 사무3동 6층 CLEAN IEC 룸 AV시스템 납품설치_260826.xlsx" > .local/analysis/nego_sheets.txt
wc -l .local/analysis/nego_sheets.txt   # 기대: 약 1791행
```

- [ ] **Step 2: `docs/template/mapping.md` 작성**

본 계획서의 "사전 조사 결과" 절 전체를 옮기고, 추가로 시스템 시트 5종 각각에 대해 아래 표를 채운다. 값은 `.local/analysis/nego_sheets.txt` 에서 읽는다. **금액은 적지 않는다.**

| 시트 | 직접비 시작행 | 직접비계 행 | 간접비 시작행 | 간접비계 행 | 합계 행 | 갑지 참조 |
|---|---|---|---|---|---|---|
| `LED Display ` | 7 | 23 | 25 | 34 | 35 | G11 |
| `IP KVM시스템` | ? | ? | ? | ? | 37 | G12 |
| `월컨트롤 시스템` | ? | ? | ? | ? | 55 | G13 |
| `웹화상회의 시스템` | ? | ? | ? | ? | 30 | G14 |
| `랙 및 케이블 배관배선` | ? | ? | ? | ? | 31 | G15 |

각 시트의 간접비 9개 항목이 LED 와 **동일한 순서·동일한 기준**인지 대조하고, 다르면 차이를 표로 남긴다. (발주처별 간접비 프로파일 설계의 입력이 된다.)

- [ ] **Step 3: 미해결 항목을 문서 하단 "확인 필요" 절에 명시**

최소한 다음을 적는다: ① 28~30행 상수 처리 사유(사용자 확인 필요) ② `간접비_DS` vs `간접비_SDC, SDI` 중 기본 프로파일 ③ 품셈 기준 단위와 판매 단위 환산 계수.

- [ ] **Step 4: 스테이징**

```bash
git add docs/template/mapping.md tools/inspect/
git status --short   # .local/ 이 포함되지 않았는지 반드시 눈으로 확인
```

---

### Task 4: 허용목록 기반 빈 템플릿 생성기 (`tools/build_template.py`)

원본을 복사해 지우는 방식은 금지(사전 조사 결론). 원본에서 **스타일·열너비·행높이·병합·인쇄설정만** 이식하고 나머지는 새로 구성한다.

**Files:**
- Create: `tools/build_template.py`
- Create: `templates/sanitized/quote-template.xlsx` (생성물)
- Test: `tests/integration/template.test.ts`

**Interfaces:**
- Consumes: 원본 경로(읽기 전용), `tools/inspect/ooxml_probe.Book`
- Produces: `templates/sanitized/quote-template.xlsx` — 시트 6개, 머리글 3행과 간접비 블록 라벨만 존재하고 품목 행은 0개. `xl/styles.xml`, `xl/theme/theme1.xml` 은 원본에서 그대로 이식. `calcChain.xml`·`externalLinks`·`customXml`·`docProps/custom.xml`·`printerSettings` 없음. 정의 이름은 `_xlnm.Print_Area` / `_xlnm.Print_Titles` 만.

- [ ] **Step 1: 생성기 작성 — 포함할 파트를 명시적으로 열거**

```python
# tools/build_template.py (핵심 골격)
"""
허용목록 기반 빈 템플릿 생성기.
원본에서 가져오는 것: styles.xml, theme1.xml, 열너비, 행높이, 병합, pageSetup, pageMargins, headerFooter, 틀고정
원본에서 가져오지 않는 것: 모든 셀 값, sharedStrings, calcChain, externalLinks, customXml,
                          docProps/custom.xml, printerSettings, 정의 이름 470개 중 Print_* 외 전부
"""
ALLOWED_PARTS = (
    '[Content_Types].xml', '_rels/.rels',
    'docProps/app.xml', 'docProps/core.xml',      # 내용은 새로 생성(개인명 제거)
    'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
    'xl/styles.xml', 'xl/theme/theme1.xml', 'xl/sharedStrings.xml',
    'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml',
    'xl/worksheets/sheet4.xml', 'xl/worksheets/sheet5.xml', 'xl/worksheets/sheet6.xml',
)
```

시트 XML은 원본 시트에서 `<cols>`, `<mergeCells>`, `<pageSetup>`(단 `r:id` printerSettings 참조 제거), `<pageMargins>`, `<headerFooter>`, `<sheetPr>`, `<sheetViews>`(pane 포함), `<sheetFormatPr>` 엘리먼트를 **복사**하고, `<sheetData>` 는 머리글/라벨 행만 새로 쓴다. 반드시 `xml.etree.ElementTree` 로 조작한다 (정규식 금지).

**공유 수식 처리(Review Focus #4):** 템플릿에는 품목 행이 0개이므로 shared formula 를 담지 않는다. 생성기는 원본의 `<f t="shared">` 를 **일절 복사하지 않으며**, Task 6의 행 주입은 모든 셀에 독립 수식(`t` 속성 없음)을 쓴다. 이 결정을 `docs/template/verification.md` 에 "shared formula 미사용" 으로 기록한다.

- [ ] **Step 2: 생성 실행**

```bash
export PYTHONIOENCODING=utf-8
mkdir -p templates/sanitized
python tools/build_template.py \
  --source "C:/Users/khk00/.paseo/uploads/upload_a728fa9d-e438-46b8-a177-33293375409a/견적서(NEGO)_평택 사무3동 6층 CLEAN IEC 룸 AV시스템 납품설치_260826.xlsx" \
  --out templates/sanitized/quote-template.xlsx
```

- [ ] **Step 3: 원본이 수정되지 않았음을 해시로 재확인**

```bash
sha256sum "C:/Users/khk00/.paseo/uploads/upload_a728fa9d-e438-46b8-a177-33293375409a/견적서(NEGO)_평택 사무3동 6층 CLEAN IEC 룸 AV시스템 납품설치_260826.xlsx"
# 기대: 57ab58c19db062830d99eff4eebb1fd952e4c060673ced73008b47ce3c080922
```

- [ ] **Step 4: 다음 Task 로** — 템플릿 합격 판정은 Task 5가 담당한다

---

### Task 5: 템플릿 감사 통과 + 보존성 검증

**Files:**
- Create: `tests/integration/template.test.ts` (`npm run audit:exports` 의 전반부)

**Interfaces:**
- Consumes: `assertClean`, `auditXlsx` (Task 2), `templates/sanitized/quote-template.xlsx` (Task 4)
- Produces: `npm run audit:exports` 통과 상태

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/integration/template.test.ts
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it, beforeAll } from 'vitest';
import { auditXlsx } from '../../src/export/ooxml/packageAudit.js';

const TEMPLATE = 'templates/sanitized/quote-template.xlsx';
let zip: Uint8Array;
let parts: Record<string, Uint8Array>;
beforeAll(() => { zip = readFileSync(TEMPLATE); parts = unzipSync(zip); });

describe('정리된 템플릿', () => {
  it('blocker 가 0건이다', () => {
    const blockers = auditXlsx(zip).filter(f => f.severity === 'blocker');
    expect(blockers.map(f => `${f.code}:${f.part}`)).toEqual([]);
  });

  it('금지 파트가 존재하지 않는다', () => {
    const names = Object.keys(parts);
    expect(names.filter(n => n.startsWith('xl/externalLinks/'))).toEqual([]);
    expect(names.filter(n => n.startsWith('customXml/'))).toEqual([]);
    expect(names.filter(n => n.startsWith('xl/printerSettings/'))).toEqual([]);
    expect(names).not.toContain('xl/calcChain.xml');
    expect(names).not.toContain('docProps/custom.xml');
  });

  it('원본 고객·담당자·타 프로젝트 문자열이 한 바이트도 없다', () => {
    const all = Object.values(parts).map(strFromU8).join('\n');
    for (const needle of ['미래가', '김진영', '예술의전당', '도곡1실행', '서울냉천', '남가내역', 'SVTDSP260826', '평택 사무1동', '삼성SDI', 'NSCPROP_SA']) {
      expect(all, `잔류 문자열: ${needle}`).not.toContain(needle);
    }
  });

  it('정의 이름은 Print_Area / Print_Titles 만 남는다', () => {
    const wb = strFromU8(parts['xl/workbook.xml']!);
    const names = [...wb.matchAll(/<definedName[^>]*name="([^"]+)"/g)].map(m => m[1]!);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every(n => n.startsWith('_xlnm.Print_'))).toBe(true);
  });

  it('시트 6개와 이름(끝 공백 포함)이 원본과 같다', () => {
    const wb = strFromU8(parts['xl/workbook.xml']!);
    const sheets = [...wb.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map(m => m[1]!);
    expect(sheets).toEqual(['갑지', 'LED Display ', 'IP KVM시스템', '월컨트롤 시스템', '웹화상회의 시스템', '랙 및 케이블 배관배선']);
  });

  it('인쇄 설정과 2단 머리글 병합이 보존된다', () => {
    const led = strFromU8(parts['xl/worksheets/sheet2.xml']!);
    expect(led).toContain('orientation="landscape"');
    expect(led).toContain('paperSize="9"');
    for (const ref of ['A2:A3', 'B2:B3', 'C2:C3', 'D2:D3', 'E2:E3', 'F2:G2', 'H2:I2', 'J2:J3', 'K2:K3']) {
      expect(led, `병합 누락: ${ref}`).toContain(`"${ref}"`);
    }
  });

  it('styles.xml 과 theme1.xml 이 원본 크기와 동일하게 이식된다', () => {
    expect(parts['xl/styles.xml']!.byteLength).toBeGreaterThan(50_000);
    expect(parts['xl/theme/theme1.xml']!.byteLength).toBeGreaterThan(5_000);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/integration/template.test.ts`
Expected: FAIL — 템플릿이 아직 감사를 통과하지 못하는 항목이 나온다

- [ ] **Step 3: Task 4 생성기를 고쳐 통과시킨다**

실패한 항목마다 `tools/build_template.py` 의 허용목록/치환 로직을 수정하고 Step 2의 생성 명령을 다시 실행한다. **테스트를 느슨하게 고치지 않는다.**

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/integration/template.test.ts && npm run audit:exports`
Expected: PASS (7 tests)

- [ ] **Step 5: 실제 Excel 로 템플릿을 열어 복구 경고가 없는지 확인 (Review Focus #5)**

Run: Task 7의 `tools/verify/excel_recalc.ps1 -Path templates/sanitized/quote-template.xlsx`
Expected: `RepairLoad=False`, 외부 링크 요청 0건

- [ ] **Step 6: 템플릿을 `.gitignore` 예외로 명시 스테이징**

```bash
git add -f templates/sanitized/quote-template.xlsx
git add tests/integration/template.test.ts tools/build_template.py
git status --short
```

---

### Task 6: 합성 데이터 행/시스템 주입과 수식 주소 바인딩

**Files:**
- Create: `src/export/ooxml/sheetName.ts`
- Create: `src/export/ooxml/formulas.ts`
- Create: `src/export/ooxml/template.ts`
- Test: `tests/unit/sheetName.test.ts`, `tests/unit/formulas.test.ts`, `tests/integration/synthetic.test.ts`

**Interfaces:**
- Consumes: `templates/sanitized/quote-template.xlsx`, `assertClean`
- Produces:
  ```ts
  // sheetName.ts
  export function sanitizeSheetName(raw: string, taken: ReadonlySet<string>): string;
  export function quoteSheetRef(name: string): string;   // 'LED Display ' 처럼 홑따옴표+이스케이프

  // formulas.ts
  export interface SystemLayout {
    firstItemRow: number;          // 7
    itemCount: number;
    directSubtotalRow: number;     // firstItemRow + itemCount
    indirectFirstRow: number;      // directSubtotalRow + 2
    indirectSubtotalRow: number;   // indirectFirstRow + 9
    totalRow: number;              // indirectSubtotalRow + 1
  }
  export function layoutFor(itemCount: number): SystemLayout;
  export function systemFormulas(l: SystemLayout): Record<string, string>;
  export function coverFormulas(systemCount: number, refs: readonly string[]): Record<string, string>;

  // template.ts
  export interface SyntheticSystem { name: string; items: { name: string; qty: string; matUnit: string; labUnit: string }[] }
  export function buildWorkbook(template: Uint8Array, systems: readonly SyntheticSystem[]): Uint8Array;
  ```

- [ ] **Step 1: 시트명 테스트 작성 (Review Focus #1, #2)**

```ts
// tests/unit/sheetName.test.ts
import { describe, expect, it } from 'vitest';
import { sanitizeSheetName, quoteSheetRef } from '../../src/export/ooxml/sheetName.js';

describe('sanitizeSheetName', () => {
  const none = new Set<string>();
  it('금지 문자를 치환한다', () => {
    expect(sanitizeSheetName('A/V:시스템?[1]', none)).toBe('A_V_시스템___1_');
  });
  it('31자로 자른다', () => {
    expect(sanitizeSheetName('가'.repeat(40), none)).toHaveLength(31);
  });
  it('중복 시 접미사를 붙이고 31자를 넘지 않는다', () => {
    const taken = new Set(['음향']);
    const out = sanitizeSheetName('음향', taken);
    expect(out).not.toBe('음향');
    expect(out.length).toBeLessThanOrEqual(31);
  });
  it('빈 이름을 거부하지 않고 기본값을 준다', () => {
    expect(sanitizeSheetName('   ', none)).toBe('시스템');
  });
  it('끝 공백을 보존한다 — 원본 "LED Display " 호환', () => {
    expect(sanitizeSheetName('LED Display ', none)).toBe('LED Display ');
  });
});

describe('quoteSheetRef', () => {
  it('끝 공백이 있는 이름을 홑따옴표로 감싼다', () => {
    expect(quoteSheetRef('LED Display ')).toBe("'LED Display '");
  });
  it('이름 안의 홑따옴표를 두 번 쓴다', () => {
    expect(quoteSheetRef("A'B")).toBe("'A''B'");
  });
  it('단순 한글 이름도 감싼다(공백 포함 가능성)', () => {
    expect(quoteSheetRef('IP KVM시스템')).toBe("'IP KVM시스템'");
  });
});
```

- [ ] **Step 2: 수식 바인딩 테스트 작성 (Review Focus #3)**

```ts
// tests/unit/formulas.test.ts
import { describe, expect, it } from 'vitest';
import { layoutFor, systemFormulas, coverFormulas } from '../../src/export/ooxml/formulas.js';

describe('layoutFor', () => {
  it('원본 LED 시트(품목 16행)의 행 배치를 재현한다', () => {
    const l = layoutFor(16);
    expect(l).toMatchObject({
      firstItemRow: 7, directSubtotalRow: 23,
      indirectFirstRow: 25, indirectSubtotalRow: 34, totalRow: 35,
    });
  });
  it('품목 1행', () => {
    expect(layoutFor(1)).toMatchObject({ directSubtotalRow: 8, indirectFirstRow: 10, indirectSubtotalRow: 19, totalRow: 20 });
  });
  it('품목 100행', () => {
    expect(layoutFor(100)).toMatchObject({ directSubtotalRow: 107, totalRow: 119 });
  });
});

describe('systemFormulas', () => {
  it('직접비계·간접비·합계 수식이 원본과 같은 모양이다', () => {
    const f = systemFormulas(layoutFor(16));
    expect(f['G23']).toBe('SUM(G7:G22)');
    expect(f['I23']).toBe('SUM(I7:I22)');
    expect(f['J23']).toBe('SUM(J7:J22)');
    expect(f['J25']).toBe('INT(I23*E25)');     // 간접노무비
    expect(f['J31']).toBe('INT(J23*E31)');     // 산업안전보건관리비
    expect(f['J33']).toBe('INT((SUM(J23,J25,J31))*E33)'); // 공과잡비
    expect(f['J34']).toBe('SUM(J25:J33)');
    expect(f['J35']).toBe('J23+J34');
  });
  it('연금·건강·노인장기요양(28~30행)은 수식을 만들지 않는다 — 원본이 상수', () => {
    const f = systemFormulas(layoutFor(16));
    expect(f['J28']).toBeUndefined();
    expect(f['J29']).toBeUndefined();
    expect(f['J30']).toBeUndefined();
  });
  it('품목 0행이면 역전 범위를 만들지 않는다', () => {
    const f = systemFormulas(layoutFor(0));
    expect(f['G7']).toBeUndefined();
    expect(Object.values(f).some(v => /SUM\([A-Z]\d+:[A-Z]\d+\)/.test(v) && isReversed(v))).toBe(false);
    function isReversed(v: string) {
      const m = /SUM\([A-Z](\d+):[A-Z](\d+)\)/.exec(v);
      return m ? Number(m[1]) > Number(m[2]) : false;
    }
  });
});

describe('coverFormulas', () => {
  it('갑지가 시스템 합계 셀을 시트명으로 참조한다', () => {
    const c = coverFormulas(2, ["'LED Display '!J35", "'IP KVM시스템'!J37"]);
    expect(c['G11']).toBe("'LED Display '!J35");
    expect(c['H11']).toBe('F11*G11');
    expect(c['H16']).toBe('ROUNDDOWN(SUM(H11:H12),-4)');
    expect(c['H18']).toBe('SUM(H16:H17)');
    expect(c['C8']).toContain('NUMBERSTRING(H18,1)');
  });
  it('시스템 5개면 원본과 동일한 범위가 된다', () => {
    const c = coverFormulas(5, ['a!J1', 'b!J1', 'c!J1', 'd!J1', 'e!J1']);
    expect(c['H16']).toBe('ROUNDDOWN(SUM(H11:H15),-4)');
  });
  it('시스템 1개도 유효한 범위를 만든다', () => {
    const c = coverFormulas(1, ['a!J1']);
    expect(c['H16']).toBe('ROUNDDOWN(SUM(H11:H11),-4)');
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/unit/sheetName.test.ts tests/unit/formulas.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 구현**

`sheetName.ts` 는 `[ ] : * ? / \` 를 `_` 로 치환하고 31자로 자르며, 중복 시 `~2`, `~3` 접미사를 붙이되 길이를 넘기지 않도록 앞부분을 줄인다. 끝 공백은 보존한다(원본 호환). 공백만 있는 입력은 `'시스템'` 을 반환한다.

`formulas.ts` 는 위 테스트가 명시한 배치 규칙을 그대로 구현한다. `layoutFor(0)` 은 `itemCount:0` 이며 `systemFormulas` 는 품목 수식과 역전 SUM 을 생성하지 않는다(직접비계는 `0` 상수로 쓴다).

`template.ts` 는 fflate 로 템플릿을 풀고 `<sheetData>` 엘리먼트 **전체를 새로 생성해 교체**한 뒤 다시 zip 한다.

**Global Constraints("정규식으로 XML을 수정하지 않는다")와의 관계를 명시한다.** 금지 대상은 *기존 수식·XML을 정규식으로 패치하는 것*이다. 여기서는 기존 내용을 패치하지 않고, 경계가 명확한 단일 엘리먼트 하나를 **통째로 생성해 치환**한다. 안전장치로 다음 두 가지를 반드시 건다.

1. 템플릿의 `<sheetData>` 는 Task 4가 생성하므로 **항상 `<sheetData/>` 자기닫힘 형태** 하나만 존재하도록 고정한다. 치환 대상이 1개가 아니면 즉시 throw 한다.
2. 치환 후 결과 XML을 **반드시 재파싱해 well-formed 임을 확인**한다. 셀 텍스트는 `& < > "` 를 XML escape 한다.

```ts
// template.ts 안전장치
function replaceSheetData(xml: string, generated: string): string {
  const matches = xml.match(/<sheetData\s*\/>|<sheetData>[\s\S]*?<\/sheetData>/g) ?? [];
  if (matches.length !== 1) {
    throw new Error(`sheetData 엘리먼트가 정확히 1개여야 합니다 (발견: ${matches.length})`);
  }
  const out = xml.replace(matches[0]!, generated);
  assertWellFormed(out);   // 재파싱 실패 시 throw
  return out;
}
```

`assertWellFormed` 는 Node 환경에서는 `fast-xml-parser` 또는 `node:util` 기반 최소 파서를, 브라우저에서는 `DOMParser` 의 `parsererror` 검사를 쓴다. 단계 1에서는 Node 테스트만 필요하므로 `DOMParser` 의존을 만들지 않는다.

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/unit/`
Expected: PASS

- [ ] **Step 6: 합성 통합 테스트 — 1행 / 다행 / 시스템 추가**

```ts
// tests/integration/synthetic.test.ts
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { buildWorkbook } from '../../src/export/ooxml/template.js';
import { assertClean } from '../../src/export/ooxml/packageAudit.js';

const tpl = () => readFileSync('templates/sanitized/quote-template.xlsx');
const item = (n: number) => ({ name: `합성품목${n}`, qty: '2', matUnit: '1000', labUnit: '500' });

describe('합성 출력', () => {
  it.each([
    ['1행', 1, 1], ['다행', 40, 1], ['시스템 3개', 10, 3], ['100행', 100, 1], ['품목 0행', 0, 1],
  ])('%s 생성 후 감사 통과', (_label, items, systems) => {
    const out = buildWorkbook(tpl(), Array.from({ length: systems }, (_, s) => ({
      name: `시스템${s + 1}`, items: Array.from({ length: items }, (_, i) => item(i)),
    })));
    expect(() => assertClean(out, { sentinels: ['COSTSENTINEL8675309'] })).not.toThrow();
    mkdirSync('.local/out', { recursive: true });
    writeFileSync(`.local/out/synthetic-${items}x${systems}.xlsx`, out);
  });

  it('생성된 모든 XML 파트가 well-formed 이다 (셀 텍스트 escape 포함)', () => {
    const out = buildWorkbook(tpl(), [{ name: '검증', items: [{ ...item(1), name: 'A & B < C > D "E"' }] }]);
    for (const [part, bytes] of Object.entries(unzipSync(out))) {
      if (!part.endsWith('.xml') && !part.endsWith('.rels')) continue;
      expect(XMLValidator.validate(strFromU8(bytes)), `well-formed 아님: ${part}`).toBe(true);
    }
  });

  it('긴 품명과 한글·특수문자 시스템명을 처리한다', () => {
    const out = buildWorkbook(tpl(), [{
      name: 'A/V:제어[실]?*시스템 — 매우 긴 이름을 넣어 31자 제한을 넘긴다',
      items: [{ ...item(1), name: '가'.repeat(200) }],
    }]);
    expect(() => assertClean(out)).not.toThrow();
    writeFileSync('.local/out/synthetic-edge.xlsx', out);
  });
});
```

Run: `npx vitest run tests/integration/synthetic.test.ts`
Expected: PASS (7 tests), `.local/out/` 에 `.xlsx` 6개 생성 (`.local/` 은 gitignore 대상)

- [ ] **Step 7: 스테이징**

```bash
git add src/export/ooxml/ tests/unit/sheetName.test.ts tests/unit/formulas.test.ts tests/integration/synthetic.test.ts
git status --short
```

---

### Task 7: 실제 Excel 재계산·인쇄 검증 하네스

브라우저 테스트로 대체할 수 없는 검증(spec §11 "예정 검증 명령", A09/A10).

**Files:**
- Create: `tools/verify/excel_recalc.ps1`
- Create: `docs/template/verification.md`

**Interfaces:**
- Consumes: `.local/out/*.xlsx` (Task 6), `templates/sanitized/quote-template.xlsx`
- Produces: JSON 한 줄 — `{ "path", "repairLoad", "externalLinkCount", "formulaErrorCount", "sheetCount", "pageCounts": {}, "numberStringOk" }`

- [ ] **Step 1: PowerShell 검증 스크립트 작성**

```powershell
# tools/verify/excel_recalc.ps1
param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
$abs = (Resolve-Path $Path).Path
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
$xl.AskToUpdateLinks = $false      # 외부 링크 갱신 프롬프트 차단
try {
  $wb = $xl.Workbooks.Open($abs, 0, $true)   # UpdateLinks=0, ReadOnly=$true
  $xl.CalculateFullRebuild()                  # 전체 재계산 — 캐시가 아닌 실제 계산
  $links = $wb.LinkSources(1)                 # xlExcelLinks
  $linkCount = if ($null -eq $links) { 0 } else { @($links).Count }
  $errCount = 0; $pages = @{}
  foreach ($ws in $wb.Worksheets) {
    $used = $ws.UsedRange
    try {
      # xlCellTypeFormulas(-4123) + xlErrors(16)
      $errs = $used.SpecialCells(-4123, 16)
      if ($null -ne $errs) { $errCount += $errs.Count }
    } catch {}   # 오류 셀이 하나도 없으면 SpecialCells 가 예외를 던진다 = 정상
    $pages[$ws.Name] = $ws.PageSetup.Pages.Count
  }
  # NUMBERSTRING 동작 확인 (ko-KR 전용 함수)
  $probe = $wb.Worksheets.Item(1).Evaluate('NUMBERSTRING(1234,1)')
  $numberStringOk = ($probe -is [string]) -and ($probe.Length -gt 0)
  [pscustomobject]@{
    path = $abs; repairLoad = $false; externalLinkCount = $linkCount
    formulaErrorCount = $errCount; sheetCount = $wb.Worksheets.Count
    pageCounts = $pages; numberStringOk = $numberStringOk
  } | ConvertTo-Json -Compress -Depth 4
  $wb.Close($false)
} finally {
  $xl.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}
```

- [ ] **Step 2: 템플릿과 합성 산출물 전부에 대해 실행**

```powershell
tools/verify/excel_recalc.ps1 -Path templates/sanitized/quote-template.xlsx
Get-ChildItem .local/out/*.xlsx | ForEach-Object { tools/verify/excel_recalc.ps1 -Path $_.FullName }
```

Expected: 모든 파일에서 `externalLinkCount=0`, `formulaErrorCount=0`, `numberStringOk=true`, 복구 경고 대화상자 없음

- [ ] **Step 3: 수량 변경 후 재계산이 전파되는지 확인 (A09)**

`.local/out/synthetic-40x1.xlsx` 를 Excel 로 열어 임의 품목의 E열 수량을 바꾸고, ① 해당 행 G/I/J, ② 직접비계, ③ 간접비, ④ 시트 합계, ⑤ 갑지 H16/H18, ⑥ 갑지 C8 한글 금액이 모두 갱신되는지 확인한다. 한글 금액이 갱신되지 않으면 **Task 6의 C8을 상수로 대체하지 말고** `docs/template/verification.md` 에 실패로 기록한다.

- [ ] **Step 4: 인쇄 검증 (A10)**

각 시트 `PageSetup.Pages.Count` 를 기록하고, 100행 산출물에서 2페이지 이상일 때 **1~3행 머리글이 반복되는지**(Print_Titles) 확인한다. 열 잘림 여부는 `fitToWidth`/`scale` 로 판단하지 말고 실제 인쇄 미리보기에서 확인한다.

- [ ] **Step 5: `docs/template/verification.md` 작성**

다음을 반드시 포함한다: 검증 환경(Excel 16.0 ko-KR x64), 파일별 결과 표, **실패한 방식과 이유**(spec 단계 1 체크리스트 항목), shared formula 미사용 결정, `NUMBERSTRING` 동작 여부, 미해결 항목.

- [ ] **Step 6: 스테이징**

```bash
git add tools/verify/excel_recalc.ps1 docs/template/verification.md
git status --short
```

---

### Task 8: 디자인 기준 기록 (`docs/design/reference-map.md`)

**Files:**
- Create: `docs/design/reference-map.md`

**Interfaces:**
- Consumes: `../rtcom-configurator/src/styles.css`, `../svt-led-calculator/src/styles.css`
- Produces: `src/styles/tokens.css` 의 사양 (단계 3에서 구현)

- [ ] **Step 1: 두 소스에서 토큰 실측 추출**

```bash
sed -n '/:root/,/^}/p' "../svt-led-calculator/src/styles.css" > .local/analysis/led-tokens.css
grep -o '\-\-rt-[a-z-]*:[^;]*' "../rtcom-configurator/src/styles.css" | sort -u > .local/analysis/rtcom-tokens.txt
```

- [ ] **Step 2: 문서 작성 — 기준 URL·확인일·소스 경로·컴포넌트 대응**

반드시 포함할 표:

| 역할 | RTCOM 값 | LED 값 | 견적 앱 채택 | 사유 |
|---|---|---|---|---|
| accent | `#3978ee` | `#007AFF` | ? | 두 앱이 다름 — **사용자 확인 필요** |
| CTA | `linear-gradient(135deg,#3978ee,#7767f4)` | `--accent-2:#0057D8` | ? | |
| 본문 글꼴 | Pretendard Variable | Pretendard Variable | Pretendard Variable | 일치 |
| 숫자 글꼴 | (전용 토큰 없음) | `--mono` | LED | 견적 표 숫자 정렬에 필요 |
| 카드 모서리 | `24px` | `--r-card:24px` | `24px` | 일치 |
| 입력 모서리 | — | `--r-field:13px` | LED | RTCOM에 대응 토큰 없음 |
| pill | `999px` | `--r-pill:980px` | `999px` | 사실상 동일 |
| 카드 그림자 | `0 18px 50px #53698a14` | `--shadow-card` | ? | |
| 상태색(경고/오류/적합) | 없음 | `--warn/--danger/--ok` + 판정 5단계 | LED | 견적의 `review-required`/`incompatible` 표시에 필요 |
| 헤더 셸 | `.rt-top` + `.rt-portal-link` | — | RTCOM | 포털 복귀 링크 패턴이 이미 존재 |

- [ ] **Step 3: "계승하지 않을 것" 절 작성 (spec §8.8)**

LED 구성기의 ① 가격표 JS 실행 경로 ② `localStorage` 가격 보관 ③ 구성 공유/사례 저장 경로를 **복제하지 않는다**고 명시하고, 실제 해당 코드 위치를 확인해 파일·함수명을 적는다.

- [ ] **Step 4: 스테이징**

```bash
git add docs/design/reference-map.md
git status --short
```

---

### Task 9: 단계 1 통과 판정과 인계 기록

**Files:**
- Create: `README.md`
- Create: `docs/security/data-flow.md`
- Modify: `docs/template/verification.md`

- [ ] **Step 1: 전체 검증 명령 실행**

```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run audit:exports
git diff --check
git status --short
```

- [ ] **Step 2: 원본·실제 가격이 스테이징에 없는지 확인**

```bash
git diff --cached --name-only
git diff --cached | grep -nE '미래가|김진영|예술의전당|SVTDSP|평택 사무1동|매입' || echo "민감 문자열 없음"
```

- [ ] **Step 3: `docs/security/data-flow.md` 작성** — spec §8.1 표를 이 저장소의 실제 모듈 경로로 구체화하고, Task 2 감사기가 어느 경계를 강제하는지 적는다.

- [ ] **Step 4: `README.md` 작성** — 실행 방법, 지원 Excel 환경(16.0 ko-KR), 원본 준비 방법(사용자 PC 경로, 저장소에 넣지 않음), 남은 제한.

- [ ] **Step 5: 단계 1 통과 조건 판정**

spec 단계 1 통과 조건: *"최종 양식 재현 가능성이 실제 파일로 입증되어야 한다."*
→ Task 5(감사 0건) + Task 7(실제 Excel 재계산·인쇄) 모두 통과해야 **통과**로 기록한다. 하나라도 실패하면 `verification.md` 에 **미완료**로 적고 통과를 주장하지 않는다.

- [ ] **Step 6: 스테이징하고 사용자에게 보고**

```bash
git add README.md docs/
git status --short
```

---

## 단계 1 완료 후 사용자 결정이 필요한 항목

구현 중 확정할 수 없고, 단계 2 이후를 좌우하는 항목:

1. **accent 색** — RTCOM `#3978ee` vs LED `#007AFF` (Task 8)
2. **간접비 28~30행(연금·건강·노인장기요양)** — 원본이 상수인 이유. 수식화 가능한지, 아니면 수동 입력 유지인지
3. **기본 간접비 프로파일** — `간접비_DS` / `간접비_SDC, SDI` 중 기본값
4. **품셈 기준 단위 ↔ 판매 단위 환산 계수** (spec §5.3)
5. **공개 판매단가 범위와 인증 필요 여부** (spec §1, 미확정 운영 결정)
