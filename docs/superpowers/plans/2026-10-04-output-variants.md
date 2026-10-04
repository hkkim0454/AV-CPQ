# 출력 3종 — 가이드 템플릿 기반 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 견적서를 **가이드 파일을 템플릿으로** 생성한다. 원가·설명·품셈 근거를 단계별로 빼는 3종 출력과 파일명 규칙을 구현하고, 사용자가 실물로 확인한 서식을 코드로 재현하지 않는다.

**Architecture:** 서식을 **그리지 않고 복사한다.** 가이드 `.xlsx` 두 개를 정리해 템플릿으로 만들고, exporter 는 품목 행만 채운다. 열 삭제는 단계별로 수행하고 모든 주소를 계산한다. 기존 OOXML 패치 방식(`src/export/ooxml/`)을 그대로 쓴다 — openpyxl 왕복 저장은 Excel 이 열지 못한다(`verification.md` §1).

**Tech Stack:** TypeScript 5.9, fflate, Vitest 3.2, Python 3.13 + openpyxl(템플릿 생성 전용, 읽기만)

**Spec:**
- `docs/decisions/2026-10-03-scope-and-data.md` — **D17 가이드 템플릿**, **D18 출력 3종**, D13 레이아웃, D12 간접비 프로파일, D14 열 선택, D16 열 배치
- `docs/design-spec.md` — §8.1 데이터 경계, §8.7 고객용/내부용 분리, §9.1 템플릿 우선, §9.6 전수 검사
- `docs/stage-status.md` — 끝난 것과 전제. **착수 전 읽는다**

---

## Global Constraints

- **서식을 코드로 만들지 않는다.** 글꼴·테두리·열너비·행높이·배율·여백·틀고정·병합은 전부 템플릿에서 온다. 코드에 `Font(...)`·`Border(...)`·`width=` 가 나오면 잘못된 것이다.
  > 근거(D17): 손으로 옮기다 노임 3건·틀고정·배율·갑지 테두리·여백을 전부 틀렸다. 사용자가 네 번 되돌려 보냈다.
- **노임·요율을 코드에 적지 않는다.** 템플릿 3행(노임)과 간접비 블록에서 읽는다.
- **openpyxl 왕복 저장 금지.** 템플릿 **생성**에만 쓰고(원본 읽기 → 새 파일 쓰기), 생성물 수정에는 쓰지 않는다. 생성물은 기존 OOXML 패치 경로로 만든다.
- **열 주소를 하드코딩하지 않는다.** 단계마다 열이 밀린다. 2행 머리글 이름으로 찾아 계산한다.
- **누적 삭제만 한다.** 0 → 1 → 2 로 갈수록 빼기만 한다. 되돌리는 경로를 만들지 않는다.
- **기본 선택은 2단계(고객 전달용).** 아무것도 고르지 않으면 가장 안전한 것이 나간다.
- Task 완료 조건은 **`npm run verify`** (typecheck → test → audit:exports).
- 커밋 메시지는 한국어 한 줄.

### 입력 — 가이드 파일 3종 (사용자 제공, 2026-10-04)

```
SDC,SDI_견적서가이드_260901_원.xlsx     일반 프로파일 · 원가 포함
SDC,SDI_견적서가이드_260901_품셈.xlsx   일반 프로파일 · 원가 없음
DS_견적서가이드_260901_품셈.xlsx        삼성전자DS 프로파일 (간접비 9항목)
```

원본은 저장소에 넣지 않는다(설계서 §4.5). 경로는 환경변수로 받는다.

### 가이드 실측 사양 (D17)

| | `_원` | `_품셈` |
|---|---|---|
| 세부내역 인쇄 | `A1:O25` | `A1:L25` |
| 배율 | 58 | 70 |
| 반복 머리글 | `$1:$3` | `$1:$3` |
| 틀 고정 | `G4` | `G4` |
| 1행 | `="▣ 공사명 : "&갑지!C5` | 같음 |
| 품목 행 | 6~14 | 6~14 |
| 직접비계 / 간접비 / 간접비계 / 합계 | 15 / 16~23 / 24 / 25 | 같음 |
| 갑지 참조 | `=세부내역!M25` | `=세부내역!K25` |
| 갑지 | `A1:J21` 배율 98 | 같음 |
| 여백 | L0.12 R0.12 T0.75 B0.31 · 가로 가운데 | 같음 |
| 숨김 열 | 없음 | 없음 |

### 출력 3종 (D18)

| | 꼬리표 | 원가 G·H | 이윤 N | 설명 D | 품셈 P~BE | AI 메모 |
|---|---|---|---|---|---|---|
| 0 영업팀 | `_원` | O | O | O | O | **O** |
| 1 영업팀 외 | `(설명+품셈포함)` | X | X | O | O | X |
| 2 고객 | (없음) | X | X | X | X | X |

파일명 `견적서_{현장명}_{YYMMDD}{꼬리표}.xlsx`

---

## Review Focus

1. **2단계에 매입처가 남는 경우** — `제조사/구매처`·`영업비고`는 품셈 블록 안에 있다. 2단계에서 P~BE 를 지울 때 **한 열이라도 남으면 매입처가 고객에게 간다.** 평택 원본 감사에서 인쇄 영역 밖 58셀의 내부 메모가 실제로 나왔다. Task 4 가 "2단계 산출물의 사용 열이 비고에서 끝난다"를 고정한다.
2. **열을 지운 뒤 수식이 깨짐** — 갑지가 `=세부내역!M25` 를 참조한다. 세부내역에서 열을 지우면 합계가 다른 열로 옮겨간다. 참조를 같이 고치지 않으면 **갑지 금액이 0 이거나 `#REF!`** 가 된다. 사용자는 인쇄물만 보고 알아채기 어렵다. Task 3 이 각 단계의 갑지 참조가 실제 합계 셀을 가리키는지 고정한다.
3. **품목이 9행을 넘을 때** — 가이드 품목 행은 6~14 뿐이다. 10행째부터는 행을 늘리고 직접비계 SUM·간접비 기준·갑지 참조·인쇄 영역을 전부 다시 계산해야 한다. 기존 exporter 가 이미 하는 일이지만 **가이드 템플릿에서도 같은지** 확인되지 않았다. Task 2 가 1행·9행·40행으로 고정한다.
4. **0단계 AI 메모가 인쇄 영역 안으로 들어감** — 메모 열은 인쇄되면 안 된다. 인쇄 영역이 `A1:O##` 인데 메모를 O 안쪽에 쓰면 고객이 본다(0단계는 사내용이지만 그대로 인쇄해 돌릴 수 있다). Task 5 가 메모 열이 인쇄 영역 **밖**임을 고정한다.
5. **간접비 프로파일을 바꿨는데 행 수가 다름** — 삼성전자DS 9항목 / 일반 7항목. 템플릿이 다르므로 **합계 행 번호가 2 차이난다**. 프로파일을 바꿀 때 갑지 참조와 인쇄 영역이 따라가지 않으면 금액이 틀린다. Task 6 이 두 프로파일 모두 끝까지 통과함을 고정한다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `tools/build_guide_templates.py` | **신규** 가이드 3종 → 정리된 템플릿. 민감정보 제거, 품목 행 비움 |
| `templates/sanitized/guide-won.xlsx` | **생성물** 일반 · 원가 포함 |
| `templates/sanitized/guide-pumsem.xlsx` | **생성물** 일반 · 원가 없음 |
| `templates/sanitized/guide-ds.xlsx` | **생성물** 삼성전자DS |
| `src/export/ooxml/guideTemplate.ts` | **신규** 템플릿 읽기 — 머리글 이름으로 열 찾기, 행 구조 파악 |
| `src/export/variants/levels.ts` | **신규** 출력 3종 정의와 삭제 규칙 |
| `src/export/variants/fileName.ts` | **신규** 파일명 규칙 |
| `src/export/variants/build.ts` | **신규** 단계별 생성 |
| `tests/unit/guideTemplate.test.ts` | 머리글 탐색·행 구조 |
| `tests/unit/outputLevels.test.ts` | 삭제 규칙·열 계산 |
| `tests/unit/fileName.test.ts` | 파일명 |
| `tests/integration/outputVariants.test.ts` | 3종 끝까지 + 유출 검사 |

---

### Task 1: 가이드 → 정리된 템플릿

**Files:**
- Create: `tools/build_guide_templates.py`
- Create: `templates/sanitized/guide-{won,pumsem,ds}.xlsx`
- Test: `tests/integration/outputVariants.test.ts` (첫 블록)

**Interfaces:**
- Consumes: 환경변수 `AVCPQ_GUIDE_WON` / `AVCPQ_GUIDE_PUMSEM` / `AVCPQ_GUIDE_DS`
- Produces: 품목 행이 빈 템플릿 3개

가이드에서 **지울 것**: 예시 품목 내용(6~14행의 B~F·단가), 견적처·담당자·견적번호 실명,
`docProps` 작성자, 프린터 설정, `calcChain`.
**남길 것**: 모든 서식·수식·인쇄설정·노임 3행·간접비 블록·갑지 구조.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/integration/outputVariants.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

const T = (n: string) => `templates/sanitized/guide-${n}.xlsx`;

describe('가이드 템플릿', () => {
  it.each(['won', 'pumsem', 'ds'])('%s 템플릿이 있다', (n) => {
    expect(existsSync(T(n)), `${T(n)} 없음. npm run build:guides 를 먼저 돌린다`).toBe(true);
  });

  it.each(['won', 'pumsem', 'ds'])('%s 에 민감정보가 없다', (n) => {
    const z = unzipSync(new Uint8Array(readFileSync(T(n))));
    let text = '';
    for (const [p, b] of Object.entries(z)) if (p.endsWith('.xml')) text += strFromU8(b);
    for (const pat of [/매입처/, /구매처/, /영업비고/, /[A-Z]:\\\\/, /ROUNDUP/]) {
      expect(text, `${n} 에 ${pat}`).not.toMatch(pat);
    }
  });

  it('won 은 원가 열이 있고 pumsem 은 없다', () => {
    const head = (n: string) => {
      const z = unzipSync(new Uint8Array(readFileSync(T(n))));
      return strFromU8(z['xl/sharedStrings.xml'] ?? new Uint8Array());
    };
    expect(head('won')).toMatch(/원\s*가/);
    expect(head('pumsem')).not.toMatch(/재료비 이윤/);
  });

  it('외부 링크·매크로가 없다', () => {
    for (const n of ['won', 'pumsem', 'ds']) {
      const z = unzipSync(new Uint8Array(readFileSync(T(n))));
      expect(Object.keys(z).filter((p) => /externalLink|vbaProject/.test(p)), n).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/integration/outputVariants.test.ts`
Expected: FAIL — 템플릿 없음

- [ ] **Step 3: 생성기 구현**

`tools/build_guide_templates.py` — 기존 `tools/build_template.py` 의 **허용목록 방식**을 그대로 쓴다.
openpyxl 로 원본을 **읽기만** 하고, 포함할 파트를 명시적으로 열거해 새 zip 을 만든다.

`package.json` 에 추가:
```json
"build:guides": "python tools/build_guide_templates.py"
```

- [ ] **Step 4: 실행 후 `tools/audit_xlsx.py` 로 감사**

```bash
export AVCPQ_GUIDE_WON="<경로>" AVCPQ_GUIDE_PUMSEM="<경로>" AVCPQ_GUIDE_DS="<경로>"
npm run build:guides
python tools/audit_xlsx.py templates/sanitized/guide-won.xlsx
npx vitest run tests/integration/outputVariants.test.ts
```
Expected: FINDINGS none · 테스트 PASS

- [ ] **Step 5: 커밋**

```bash
git add tools/build_guide_templates.py templates/sanitized/guide-*.xlsx tests/integration/outputVariants.test.ts package.json
git commit -m "템플릿: 견적서 가이드 3종을 정리해 템플릿으로"
```

---

### Task 2: 템플릿 구조 읽기

**Files:**
- Create: `src/export/ooxml/guideTemplate.ts`
- Test: `tests/unit/guideTemplate.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface GuideColumns {
    /** 2행 머리글 이름 → 1-based 열 번호. 병합된 쌍은 시작 열. */
    byHeader: ReadonlyMap<string, number>;
    /** 단가/금액 쌍인 머리글. */
    paired: ReadonlySet<string>;
    /** 직종 블록 시작 열과 개수. */
    tradeStart: number;
    tradeCount: number;
    lastPrintColumn: number;
  }
  export interface GuideRows {
    firstItem: number;        // 6
    lastItem: number;         // 14
    directSubtotal: number;   // 15
    indirectFirst: number;    // 17
    indirectCount: number;    // 7 또는 9
    indirectSubtotal: number; // 24
    grandTotal: number;       // 25
  }
  export interface GuideTemplate {
    columns: GuideColumns;
    rows: GuideRows;
    /** 3행 노임. 직종 이름 → DecimalText. 코드에 적지 않고 여기서 읽는다. */
    wages: ReadonlyMap<string, DecimalText>;
    coverTotalRef: string;    // '세부내역!M25'
  }
  export function readGuideTemplate(bytes: Uint8Array): GuideTemplate;
  ```

**열을 번호로 찾지 않는다.** 2행 머리글 문자열로 찾는다 — 단계마다 열이 밀리기 때문이다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/guideTemplate.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readGuideTemplate } from '../../src/export/ooxml/guideTemplate.js';

const load = (n: string) => readGuideTemplate(new Uint8Array(readFileSync(`templates/sanitized/guide-${n}.xlsx`)));

describe('_원 템플릿', () => {
  const t = () => load('won');

  it('머리글을 이름으로 찾는다', () => {
    const c = t().columns.byHeader;
    expect(c.get('번호')).toBe(1);
    expect(c.get('품   명')).toBe(2);
    expect(c.get('설   명')).toBe(4);
    expect(c.get('원   가')).toBe(7);
    expect(c.get('재료비')).toBe(9);
    expect(c.get('노무비')).toBe(11);
    expect(c.get('합 계')).toBe(13);
    expect(c.get('재료비 이윤')).toBe(14);
    expect(c.get('비 고')).toBe(15);
  });

  it('단가/금액 쌍을 안다', () => {
    expect([...t().columns.paired].sort()).toEqual(['노무비', '원   가', '재료비'].sort());
  });

  it('행 구조를 읽는다', () => {
    expect(t().rows).toMatchObject({
      firstItem: 6, lastItem: 14, directSubtotal: 15,
      indirectSubtotal: 24, grandTotal: 25,
    });
  });

  it('노임 17직종을 3행에서 읽는다 — 코드에 적지 않는다', () => {
    const w = t().wages;
    expect(w.size).toBe(17);
    expect(w.get('통신관련기사')).toBe('324979');
    expect(w.get('통신관련산업기사')).toBe('304662');
    expect(w.get('보통인부')).toBe('172698');
  });

  it('갑지 참조를 읽는다', () => {
    expect(t().coverTotalRef).toBe('세부내역!M25');
  });

  it('인쇄 영역 끝이 비고 열이다', () => {
    const t0 = t();
    expect(t0.columns.lastPrintColumn).toBe(t0.columns.byHeader.get('비 고'));
  });
});

describe('_품셈 템플릿', () => {
  const t = () => load('pumsem');

  it('원가·이윤 열이 없다', () => {
    const c = t().columns.byHeader;
    expect(c.has('원   가')).toBe(false);
    expect(c.has('재료비 이윤')).toBe(false);
    expect(c.get('재료비')).toBe(7);
    expect(c.get('합 계')).toBe(11);
    expect(c.get('비 고')).toBe(12);
  });

  it('갑지가 K25 를 가리킨다', () => {
    expect(t().coverTotalRef).toBe('세부내역!K25');
  });

  it('노임은 _원 과 같다', () => {
    expect(t().wages.get('통신관련기사')).toBe(load('won').wages.get('통신관련기사'));
  });
});

describe('삼성전자DS 템플릿', () => {
  it('간접비가 9항목이다 — 일반은 7항목', () => {
    expect(load('ds').rows.indirectCount).toBe(9);
    expect(load('pumsem').rows.indirectCount).toBe(7);
  });

  it('항목 수가 다르면 합계 행도 다르다', () => {
    expect(load('ds').rows.grandTotal).not.toBe(load('pumsem').rows.grandTotal);
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인**

Run: `npm run verify && npx vitest run tests/unit/guideTemplate.test.ts`
Expected: FAIL → PASS

- [ ] **Step 3: 커밋**

```bash
git add src/export/ooxml/guideTemplate.ts tests/unit/guideTemplate.test.ts
git commit -m "템플릿: 머리글 이름으로 열을 찾는다 — 주소를 박지 않는다"
```

---

### Task 3: 출력 3종 정의와 열 계산

**Files:**
- Create: `src/export/variants/levels.ts`
- Test: `tests/unit/outputLevels.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type OutputLevel = 0 | 1 | 2;
  export interface LevelSpec {
    level: OutputLevel;
    label: string;              // '영업팀용' …
    suffix: string;             // '_원' | '(설명+품셈포함)' | ''
    keepCost: boolean;          // G·H + N
    keepDescription: boolean;   // D
    keepPumsem: boolean;        // P~BE
    keepAiNote: boolean;        // 0단계만
    template: 'won' | 'pumsem';
  }
  export const LEVELS: readonly [LevelSpec, LevelSpec, LevelSpec];
  /** 이 단계에서 지울 열 목록(1-based, 내림차순). */
  export function columnsToDrop(t: GuideTemplate, spec: LevelSpec): number[];
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/outputLevels.test.ts
import { describe, expect, it } from 'vitest';
import { columnsToDrop, LEVELS } from '../../src/export/variants/levels.js';

describe('출력 3종 — D18', () => {
  it('누적 삭제다 — 뒤 단계가 앞 단계를 포함한다', () => {
    const [a, b, c] = LEVELS;
    expect([a.keepCost, b.keepCost, c.keepCost]).toEqual([true, false, false]);
    expect([a.keepDescription, b.keepDescription, c.keepDescription]).toEqual([true, true, false]);
    expect([a.keepPumsem, b.keepPumsem, c.keepPumsem]).toEqual([true, true, false]);
  });

  it('AI 메모는 0단계에만 있다', () => {
    expect(LEVELS.map((l) => l.keepAiNote)).toEqual([true, false, false]);
  });

  it('꼬리표가 D18 그대로다', () => {
    expect(LEVELS.map((l) => l.suffix)).toEqual(['_원', '(설명+품셈포함)', '']);
  });

  it('고객 전달용만 꼬리표가 없다', () => {
    expect(LEVELS.filter((l) => l.suffix === '')).toHaveLength(1);
    expect(LEVELS[2].label).toContain('고객');
  });

  it('0단계만 _원 템플릿을 쓴다', () => {
    expect(LEVELS.map((l) => l.template)).toEqual(['won', 'pumsem', 'pumsem']);
  });
});

describe('열 삭제 계산', () => {
  it('0단계는 아무것도 안 지운다', () => {
    expect(columnsToDrop(wonTemplate(), LEVELS[0])).toEqual([]);
  });

  it('1단계는 _품셈 템플릿이라 지울 게 없다 — 원가가 애초에 없다', () => {
    expect(columnsToDrop(pumsemTemplate(), LEVELS[1])).toEqual([]);
  });

  it('2단계는 설명과 품셈 블록을 지운다', () => {
    const t = pumsemTemplate();
    const drop = columnsToDrop(t, LEVELS[2]);
    expect(drop).toContain(t.columns.byHeader.get('설   명'));
    expect(drop).toContain(t.columns.byHeader.get('제조사/구매처'));
    expect(drop).toContain(t.columns.tradeStart);
  });

  it('내림차순이다 — 앞에서 지우면 뒤 주소가 밀린다', () => {
    const d = columnsToDrop(pumsemTemplate(), LEVELS[2]);
    expect(d).toEqual([...d].sort((a, b) => b - a));
  });

  it('비고 열은 어느 단계에서도 지우지 않는다', () => {
    for (const spec of LEVELS) {
      const t = spec.template === 'won' ? wonTemplate() : pumsemTemplate();
      expect(columnsToDrop(t, spec)).not.toContain(t.columns.byHeader.get('비 고'));
    }
  });

  it('2단계에서 매입처가 반드시 지워진다 — Review Focus #1', () => {
    const t = pumsemTemplate();
    for (const h of ['제조사/구매처', '영업비고']) {
      expect(columnsToDrop(t, LEVELS[2])).toContain(t.columns.byHeader.get(h));
    }
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인**

Run: `npm run verify && npx vitest run tests/unit/outputLevels.test.ts`

- [ ] **Step 3: 커밋**

```bash
git add src/export/variants/levels.ts tests/unit/outputLevels.test.ts
git commit -m "출력: 3종 정의와 누적 삭제 규칙 (D18)"
```

---

### Task 4: 파일명

**Files:**
- Create: `src/export/variants/fileName.ts`
- Test: `tests/unit/fileName.test.ts`

**Interfaces:**
  ```ts
  /** `견적서_{현장명}_{YYMMDD}{꼬리표}.xlsx` */
  export function quoteFileName(siteName: string, isoDate: string, spec: LevelSpec): string;
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/fileName.test.ts
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../src/export/variants/levels.js';
import { quoteFileName } from '../../src/export/variants/fileName.js';

const SITE = 'DSR B타워 1F 강당 및 컨퍼런스 A홀 AV시스템 구축';

describe('quoteFileName — D18', () => {
  it('사용자가 준 예시 그대로 만든다', () => {
    expect(quoteFileName(SITE, '2026-07-29', LEVELS[0]))
      .toBe(`견적서_${SITE}_260729_원.xlsx`);
    expect(quoteFileName(SITE, '2026-07-29', LEVELS[2]))
      .toBe(`견적서_${SITE}_260729.xlsx`);
  });

  it('1단계에 (설명+품셈포함) 이 붙는다', () => {
    expect(quoteFileName(SITE, '2026-07-29', LEVELS[1]))
      .toBe(`견적서_${SITE}_260729(설명+품셈포함).xlsx`);
  });

  it('세 이름이 전부 다르다 — 폴더에서 섞이면 안 된다', () => {
    const names = LEVELS.map((l) => quoteFileName(SITE, '2026-07-29', l));
    expect(new Set(names).size).toBe(3);
  });

  it('파일명 금지 문자를 바꾼다', () => {
    expect(quoteFileName('A/B:C*D?E"F<G>H|I', '2026-07-29', LEVELS[2]))
      .toBe('견적서_A_B_C_D_E_F_G_H_I_260729.xlsx');
  });

  it('현장명이 비면 기본값을 쓴다', () => {
    expect(quoteFileName('   ', '2026-07-29', LEVELS[2])).toBe('견적서_현장명_260729.xlsx');
  });

  it('날짜를 YYMMDD 로 줄인다', () => {
    expect(quoteFileName('X', '2026-12-05', LEVELS[2])).toBe('견적서_X_261205.xlsx');
  });

  it('너무 긴 현장명을 자른다 — 경로 길이 제한', () => {
    const name = quoteFileName('가'.repeat(300), '2026-07-29', LEVELS[0]);
    expect(name.length).toBeLessThanOrEqual(150);
    expect(name.endsWith('_원.xlsx')).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인 → 커밋**

```bash
git add src/export/variants/fileName.ts tests/unit/fileName.test.ts
git commit -m "출력: 파일명 규칙 — 꼬리표 없는 것만 고객용"
```

---

### Task 5: 단계별 생성

**Files:**
- Create: `src/export/variants/build.ts`
- Modify: `tests/integration/outputVariants.test.ts`

**Interfaces:**
  ```ts
  export interface VariantInput {
    projection: CustomerExport;
    siteName: string;
    isoDate: string;
    /** 0단계에만 쓴다. 비면 메모 열을 만들지 않는다. */
    aiNotes?: ReadonlyMap<string, string>;   // rowId → 메모
    /** 0단계에만. SKU → 매입단가. */
    costs?: ReadonlyMap<string, DecimalText>;
  }
  export interface VariantResult {
    level: OutputLevel;
    fileName: string;
    bytes: Uint8Array;
  }
  export function buildVariant(
    input: VariantInput, spec: LevelSpec, templates: Record<string, Uint8Array>,
  ): VariantResult;
  ```

AI 메모 열은 **인쇄 영역 밖**에 만든다. 자리는 직종 블록 끝 다음 빈 열 — **코드에 `BF` 를 박지 않고**
`tradeStart + tradeCount*2` 에서 시작해 계산한다(D16 의 BF 는 17직종 기준 결과값이다).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
describe('단계별 생성', () => {
  it.each([0, 1, 2] as const)('%d단계가 Excel 로 열린다', async (lv) => {
    const r = buildVariant(input(), LEVELS[lv], templates());
    expect(r.bytes.byteLength).toBeGreaterThan(5000);
    expect(() => unzipSync(r.bytes)).not.toThrow();
  });

  it('2단계 산출물의 사용 열이 비고에서 끝난다 — Review Focus #1', () => {
    const r = buildVariant(input(), LEVELS[2], templates());
    const dim = sheetDimension(r.bytes, '세부내역');
    expect(columnOf(dim.end)).toBeLessThanOrEqual(columnOf('L'));
  });

  it('2단계에 매입처 문자열이 없다', () => {
    const text = allXml(buildVariant(input(), LEVELS[2], templates()).bytes);
    for (const pat of [/제조사\s*\/\s*구매처/, /영업비고/, /매입/]) {
      expect(text).not.toMatch(pat);
    }
  });

  it('1단계에는 매입처가 남는다 — 사내용이다', () => {
    const text = allXml(buildVariant(input(), LEVELS[1], templates()).bytes);
    expect(text).toMatch(/제조사/);
  });

  it('0단계에만 AI 메모가 있다', () => {
    const notes = new Map([['r1', '구성도 — 노드 3개 합산']]);
    const has = (lv: 0 | 1 | 2) =>
      allXml(buildVariant({ ...input(), aiNotes: notes }, LEVELS[lv], templates()).bytes)
        .includes('노드 3개 합산');
    expect([has(0), has(1), has(2)]).toEqual([true, false, false]);
  });

  it('AI 메모 열이 인쇄 영역 밖이다 — Review Focus #4', () => {
    const r = buildVariant({ ...input(), aiNotes: new Map([['r1', 'x']]) }, LEVELS[0], templates());
    const { printArea, noteColumn } = inspect(r.bytes);
    expect(noteColumn).toBeGreaterThan(printArea.lastColumn);
  });

  it('갑지 참조가 실제 합계 셀을 가리킨다 — Review Focus #2', () => {
    for (const lv of [0, 1, 2] as const) {
      const r = buildVariant(input(), LEVELS[lv], templates());
      const { coverRef, grandTotalCell } = inspect(r.bytes);
      expect(coverRef, `${lv}단계`).toBe(`세부내역!${grandTotalCell}`);
    }
  });

  it('품목 1행·9행·40행 전부 동작한다 — Review Focus #3', () => {
    for (const n of [1, 9, 40]) {
      const r = buildVariant(inputWith(n), LEVELS[2], templates());
      expect(() => unzipSync(r.bytes), `${n}행`).not.toThrow();
    }
  });

  it('0단계 파일명에 _원 이 붙는다', () => {
    expect(buildVariant(input(), LEVELS[0], templates()).fileName).toMatch(/_원\.xlsx$/);
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인**

- [ ] **Step 3: 실제 Excel 검증**

```bash
npx vite-node tools/probe_variants.ts      # 3종을 .local/out/ 에 저장
pwsh tools/verify_in_excel.ps1 .local/out
```
Expected: 복구 경고 0 · 외부 링크 0 · 수식 오류 0 · 행 잘림 0

**그리고 품목 수량을 바꿔 갑지 금액까지 연쇄 재계산되는지** 확인한다(A09).

- [ ] **Step 4: 커밋**

```bash
git add src/export/variants/build.ts tools/probe_variants.ts tests/integration/outputVariants.test.ts
git commit -m "출력: 3종 생성 — 가이드 템플릿에 품목만 채운다"
```

---

### Task 6: 간접비 프로파일 전환

**Files:**
- Modify: `src/export/variants/build.ts`, `src/domain/quote/indirectCosts.ts`
- Test: `tests/unit/indirectProfiles.test.ts`

**Interfaces:**
  ```ts
  export type IndirectProfileId = 'ds' | 'general';
  export const PROFILE_LABEL: Record<IndirectProfileId, string>;  // '삼성전자DS' | '일반'
  export function indirectCostsFor(id: IndirectProfileId): IndirectCostRule[];
  ```

D12 의 두 프로파일. **요율을 코드에 적지 않고 템플릿 간접비 블록에서 읽는다.**
`일반` 의 `노인장기요양보험료` 는 **`건강보험료 대비`** 다 — 기존 `IndirectBasis` 에 없는 축이라
"다른 간접비 항목을 기준으로 삼는" 경우를 받아야 한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
describe('간접비 프로파일 — D12', () => {
  it('삼성전자DS 는 9항목', () => {
    expect(indirectCostsFor('ds')).toHaveLength(9);
  });

  it('일반은 7항목이고 공과잡비가 없다', () => {
    const g = indirectCostsFor('general');
    expect(g).toHaveLength(7);
    expect(g.map((x) => x.name)).not.toContain('공과잡비');
  });

  it('일반에만 일반관리비가 있다', () => {
    expect(indirectCostsFor('general').map((x) => x.name)).toContain('일반관리비');
    expect(indirectCostsFor('ds').map((x) => x.name)).not.toContain('일반관리비');
  });

  it('일반의 노인장기요양은 건강보험료를 기준으로 한다 — 새로운 basis', () => {
    const x = indirectCostsFor('general').find((r) => r.name === '노인장기요양보험료')!;
    expect(x.basisLabel).toBe('건강보험료 대비');
  });

  it('미적용 항목은 요율을 보존한 채 applied:false 다', () => {
    for (const id of ['ds', 'general'] as const) {
      for (const r of indirectCostsFor(id).filter((x) => !x.applied)) {
        expect(Number(r.rate)).toBeGreaterThan(0);
      }
    }
  });

  it('화면 표기는 삼성전자DS / 일반이다', () => {
    expect(PROFILE_LABEL).toEqual({ ds: '삼성전자DS', general: '일반' });
  });

  it('호출마다 새 배열을 준다 — 한 견적의 변경이 번지지 않는다', () => {
    const a = indirectCostsFor('ds'); const b = indirectCostsFor('ds');
    a[0]!.applied = false;
    expect(b[0]!.applied).toBe(true);
  });
});

describe('프로파일별 생성', () => {
  it('두 프로파일 모두 끝까지 통과한다 — Review Focus #5', () => {
    for (const id of ['ds', 'general'] as const) {
      const r = buildVariant({ ...input(), profile: id }, LEVELS[2], templates());
      const { coverRef, grandTotalCell } = inspect(r.bytes);
      expect(coverRef, id).toBe(`세부내역!${grandTotalCell}`);
    }
  });

  it('항목 수가 다르면 합계 행이 다르다', () => {
    const row = (id: 'ds' | 'general') =>
      inspect(buildVariant({ ...input(), profile: id }, LEVELS[2], templates()).bytes).grandTotalCell;
    expect(row('ds')).not.toBe(row('general'));
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인 → 커밋**

```bash
git add src/domain/quote/indirectCosts.ts src/export/variants/build.ts tests/unit/indirectProfiles.test.ts
git commit -m "간접비: 삼성전자DS·일반 두 프로파일 (D12)"
```

---

## 이 계획이 끝나면

```
구성도 JSON ─┐
              ├→ QuoteDocument → 계산 → 가이드 템플릿 → 3종 Excel
원가 업로드 ─┘                                    ├ _원
                                                 ├ (설명+품셈포함)
                                                 └ (고객)
```

사용자가 **실물로 확인한 서식 그대로** 나온다. 코드가 서식을 만들지 않는다.

## 이 계획이 하지 않는 것

| 항목 | 어디로 |
|---|---|
| 화면 | 단계 3-A 계획 |
| 원가 업로드 수식 거부 버그 | 아래 "먼저 고칠 것" |
| 원가 유출 검사 오경보 | 아래 |
| 하반기 품셈으로 카탈로그 재추출 | 별도 계획 (O12 와 함께) |
| 연동 항목 표 | **사용자 대기** (D5) |

## 먼저 고칠 것 — 이 계획보다 앞선다

### B1. 원가 파일 업로드가 수식 때문에 거부된다

```
TableReadError: 셀 V5에 수식이 있다. 값으로 붙여넣은 파일만 읽는다.
```

품셈 파일은 수식투성이다. V5 는 품셈 계산식이고 원가와 무관하다.
**파일 전체가 아니라 읽는 가격 열에만** 수식 검사를 건다.
설계서 §8.3 의 취지는 *"수식이 만든 가격을 그대로 믿지 말자"* 다.

### B2. 원가 유출 검사가 오경보를 낸다

고객용 파일에서 "원가 35종 발견" 이 떴으나 **전부 오경보**였다.

```
30종   theme1.xml 색상값·styles.xml 서식 번호에 우연히 같은 숫자
 3종   원가와 판매가가 같은 제품 (마진 0) — 판매가로 들어간 것
 2종   계산된 금액(수량×판매단가)이 다른 제품 원가와 우연히 일치
```

고치기:
- XML 전체 문자열이 아니라 **셀 값(`<v>`)만** 비교한다
- 판매가와 같은 값은 제외한다
- `원가` 라는 **단어 검사를 뺀다** — 공사명에 들어갈 수 있다(실제로 그랬다)
- 금지 단어에 `이익률`·`이익율`·`마진`·`가산율` 을 **추가**한다

> 숫자 일치만으로는 유출을 판정할 수 없다. 진짜 보증은 **고객용 projection 이 원가를 전달받지 못한다**는 타입 수준 차단이다. 숫자 대조는 보조다.
