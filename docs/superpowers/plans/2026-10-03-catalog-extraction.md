# 카탈로그·품셈 승인 데이터 추출 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자의 표준품셈 통합문서에서 제품 카탈로그·판매가·품셈·노임을 추출해, 매입처 정보가 0인 `data/approved/*.json` 다섯 파일을 재현 가능하게 생성한다.

**Architecture:** 3단 파이프라인. (1) Python/openpyxl 이 원본 xlsx 를 **기계적으로** 덤프한다 — 판단 없음, 금지 열은 읽지도 않음, 산출물은 git-ignored `.local/raw/`. (2) TypeScript 순수 함수가 분류·정규화·품셈 조립을 한다 — 여기가 전부 vitest 로 덮인다. (3) Node 빌드 스크립트가 `data/approved/` 에 쓰고, 감사 게이트가 통과해야 커밋된다. 원본은 저장소에 들어오지 않는다.

**Tech Stack:** Python 3.13 + openpyxl (읽기 전용), TypeScript 5.9, Zod 4.1, Vitest 3.2, Node 24 (`--experimental-strip-types`)

**Spec:**
- `docs/design-spec.md` (설계서 v1.0) — §4.3 품셈 구조, §4.4 표준품셈 DB, §4.5 자료 취급, §5.2 노무비, §5.3 일위대가, §6.1 ProductVariant, §8.1 데이터 경계
- `docs/decisions/2026-10-03-scope-and-data.md` — D1 카탈로그 출처, D2 가격 두 종류, D3 판매가 공개·파일 분리

설계서와 결정 기록이 충돌하면 **결정 기록이 우선**한다(날짜가 뒤다).

---

## Global Constraints

- **M열(제조사/구매처)·N열(영업비고)을 읽지 않는다.** 매입처 정보다(설계서 §8.1, 결정 D1). 추출기에서 해당 열 인덱스를 아예 접근하지 않고, 감사 테스트가 산출물에 그 문자열이 없음을 증명한다.
- **숨김 시트 2개를 제외한다**: `LED전광판 계산`, `단종, 미사용 제품`. 간접비 시트 2개(`간접비_DS`, `간접비_SDC, SDI`)도 이 계획 범위 밖이다(별도 계획).
- **`products.json` 과 `prices.json` 을 반드시 분리한다**(결정 D3). 제품 파일에 `sellingUnitPrice` 필드를 넣지 않는다. 섞으면 결정 D3 가 비가역이 된다.
- **원본 xlsx 를 저장소에 복사하지 않는다**(설계서 §4.5). 경로는 환경변수 `AVCPQ_PUMSEM_XLSX` 로 받는다. 기본값을 하드코딩하지 않는다.
- **금액·수량은 전부 `DecimalText`(string)** 다. `number` 로 저장하지 않는다 — `src/domain/quote/types.ts:12` 의 기존 정의를 따른다.
- **노임 단위가 두 가지다.** 17개 직종은 `M/D`(인·일), CMS 전용 4개 직종(`응용 SW개발자`, `임베디드 SW개발자`, `데이터베이스 운용자`, `NW엔지니어`)은 `M/M`(인·월). 섞으면 안 된다.
- **노임 기준**: `26년 상반기`. `WageTable.periodLabel` 에 그대로 쓴다.
- 새 npm 의존성을 추가하지 않는다. 현재 `package.json` 의 decimal.js / fflate / zod / vitest 로 충분하다.
- **추출기는 원본 xlsx 를 읽기만 한다. `wb.save()` 를 부르지 않는다.** 구현 세션이 실측으로 확인한 사실: openpyxl 왕복 저장은 Excel 이 열지 못하는 파일을 만든다. 또한 ElementTree 로 OOXML 을 재직렬화하면 등록되지 않은 네임스페이스 접두사가 `ns0`/`ns1` 로 바뀌어, 속성 **값 안에서** 접두사를 문자열로 참조하는 `mc:Ignorable="x14ac xr xr2 xr3"` 의 참조가 끊어진다. 이 계획은 XML 을 쓰지 않으므로 해당 없지만, 쓰기를 섞지 않는다.
- **산출물 감사는 텍스트 패턴 검사다.** 기존 `tools/audit_xlsx.py` 는 XLSX ZIP 전수 감사용이라 JSON 산출물에 그대로 쓸 수 없다. Task 5 의 감사 게이트가 그 역할을 한다. 다만 그 스크립트가 원본에서 실제로 잡아낸 누출 3종(externalLinks 경로의 고객사명, `docProps/custom.xml` 의 이전 작성자 PC 경로, definedNames 에 박힌 과거 고객사 참조와 하드코딩 노임 상수)은 **같은 종류가 JSON 에도 샐 수 있으므로** Task 5 의 패턴 목록에 경로·확장자·`매입`·`구매처` 검사가 들어 있다.
- 커밋 메시지는 한국어 한 줄. 기존 `b751f5e` 형식을 따른다.

### 원본 열 구조 (전 제품 시트 공통, 2~3행이 머리글)

| 열 | 내용 | 이 계획에서 |
|---|---|---|
| A | 번호 | 읽음 (원본 추적용) |
| B | 품명 | 읽음 — **계층 있음**, Task 2 참조 |
| C | 규격 | 읽음 |
| D | 설명 | 읽음 |
| E | 단위 | 읽음 — **제품행 판별 기준** |
| F | 수량 | ⛔ 읽지 않음 (카탈로그에 무의미한 샘플 수량) |
| G | 재료비 단가 | 읽음 → `prices.json` |
| H~K | 금액·합계 | ⛔ 읽지 않음 (수식) |
| L | 비고 | 읽음 |
| **M** | **제조사/구매처** | ⛔ **금지** |
| **N** | **영업비고** | ⛔ **금지** |
| O | 노무비 | ⛔ 읽지 않음 |
| P | 품셈 코드 | 읽음 → `labor-items.json` |
| Q | 품목별 요율% | 읽음 → `LaborMapping.itemRate` |
| R | 할증 | 읽음 → `LaborMapping.surcharge` |
| S | 표준 노무단가 | ⛔ 읽지 않음 (수식, 우리가 다시 계산한다) |
| T,V,X,… | 직종별 품 | 읽음 → `LaborItem.trades` |
| U,W,Y,… | 직종별 금액 | ⛔ 읽지 않음 (수식) |
| **3행** | **직종별 노임** | 읽음 → `wage-table.json` |

### 직종 21종과 열 위치

전 시트 공통 17종:

```
T 통신관련기사  V 통신관련산업기사  X 통신설비공  Z 보통인부  AB 통신내선공
AD 무선안테나공  AF 저압케이블공  AH 통신케이블공  AJ 내선전공  AL 플랜트기계설치공
AN 내장공  AP 광케이블설치사  AR H/W시험사  AT S/W시험사  AV 특별인부
AX 통신관련 기능사  AZ 건축목공
```

`CMS` 시트에만 추가 4종 (**단위 M/M**):

```
BL 응용 SW개발자  BN 임베디드 SW개발자  BP 데이터베이스 운용자  BR NW엔지니어
```

품 값은 `col`, 노임은 `col+1` 의 3행. 직종 이름은 `col` 의 2행.

### 26년 상반기 노임 (3행 실측값)

| 직종 | 단위 | 노임 | 직종 | 단위 | 노임 |
|---|---|---|---|---|---|
| 통신관련기사 | M/D | 320449 | 플랜트기계설치공 | M/D | 230376 |
| 통신관련산업기사 | M/D | 304509 | 내장공 | M/D | 256883 |
| 통신설비공 | M/D | 315528 | 광케이블설치사 | M/D | 471349 |
| 보통인부 | M/D | 172068 | H/W시험사 | M/D | 393090 |
| 통신내선공 | M/D | 284880 | S/W시험사 | M/D | 446358 |
| 무선안테나공 | M/D | 356809 | 특별인부 | M/D | 226122 |
| 저압케이블공 | M/D | 304156 | 통신관련 기능사 | M/D | 249822 |
| 통신케이블공 | M/D | 436224 | 건축목공 | M/D | 277642 |
| 내선전공 | M/D | 273676 | | | |
| 응용 SW개발자 | **M/M** | 6395094 | 데이터베이스 운용자 | **M/M** | 5733364 |
| 임베디드 SW개발자 | **M/M** | 5668383 | NW엔지니어 | **M/M** | 6846793 |

### 기대 규모 (사전 조사 실측)

| 시트 | 제품행 | 단가 보유 | 품셈 보유 |
|---|---|---|---|
| 영상 | 311 | 311 | 307 |
| 오디오 | 263 | 262 | 224 |
| 케이블 및 커넥터 | 230 | 221 | 230 |
| TV | 162 | 162 | 149 |
| 화상회의 | 139 | 138 | 119 |
| 프로젝터,스크린 | 103 | 103 | 88 |
| 전원, 랙, 판넬, 몰드 및 보양 | 84 | 84 | 66 |
| 제어 | 81 | 79 | 75 |
| Head-End, CATV | 47 | 47 | 46 |
| CMS | 32 | 19 | 27 |
| CCTV | 12 | 12 | 12 |
| 기타 유통제품 | 4 | 4 | 4 |
| **합계** | **1468** | **1442** | **1347** |

이 수치는 "제품행 = B열과 E열이 모두 비어있지 않음" 기준이다. Task 2 가 분류 규칙을 정교화하면 숫자가 **줄어들 수 있다**(브랜드행 일부가 섞여 있을 수 있음). 줄어드는 것은 정상이고, 늘어나면 버그다.

---

## Review Focus

1. **CMS 4개 직종의 `M/M` 단위** — `M/D` 와 같은 표로 합치면 노무비가 약 20배 틀린다. `WageTable` 이 직종별 단위를 들고 있지 않으면 이 오류를 구조적으로 막을 수 없다. Task 4 가 `unit` 필드와 혼용 거부 테스트로 고정한다.
2. **브랜드행이 제품으로 섞여 들어감** — `SONY/AVICS` 처럼 대괄호도 없고 단위도 없는 행이 있다. 단위가 비었는데 단가만 있는 행, 단가가 비었는데 단위만 있는 행이 실제로 존재한다(CMS 32행 중 단가 19개). "둘 다 있어야 제품"이 아니라 "단위가 있으면 제품"으로 가면 머리글이 섞인다. Task 2 가 실제 원본 행으로 고정한다.
3. **같은 품명이 여러 시트에 중복** — `HDMI 케이블` 류는 `케이블 및 커넥터` 와 `영상` 양쪽에 있을 수 있다. SKU 를 품명 기반으로 만들면 충돌해 한쪽이 덮인다. Task 3 이 시트+행 기반 SKU 와 중복 검출 테스트로 고정한다.
4. **단가 셀이 숫자가 아닌 경우** — 수식·문자열·빈칸이 섞여 있다(1468 중 26개가 단가 없음). `Number(cell)` 이 `NaN` 이나 `0` 을 만들면 설계서 §5.6 의 "미등록을 0원으로 처리하지 말 것"을 정면으로 위반한다. Task 3 이 `미등록`(필드 부재)과 `명시적 0`을 구분해 고정한다.
5. **품셈코드 없는 121개 제품** — 매핑이 없으므로 `LaborMapping` 을 만들면 안 된다. 만들어 버리면 노무비 0원이 조용히 들어간다. Task 4 가 매핑 부재를 보고하고, 0원 매핑을 만들지 않음을 고정한다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `tools/extract_catalog.py` | **신규** 원본 xlsx → `.local/raw/catalog-raw.json`. 기계적 덤프. 금지 열 미접근. 판단 없음 |
| `src/data/catalog/rawTypes.ts` | **신규** 원시 덤프의 타입 정의 (Python 과 TS 사이의 계약) |
| `src/data/catalog/classifyRow.ts` | **신규** 행 분류 — 분류머리글 / 브랜드머리글 / 제품 / 무시 |
| `src/data/catalog/buildProducts.ts` | **신규** 제품행 → `ProductVariant[]` + 가격 맵. SKU 생성·단위 정규화 |
| `src/data/catalog/buildLabor.ts` | **신규** 제품행 → `LaborItem[]` / `WageTable` / `LaborMapping[]` |
| `src/data/catalog/schema.ts` | **신규** 산출 JSON 다섯 개의 Zod 스키마 |
| `tools/build-approved.ts` | **신규** 파이프라인 실행기. `.local/raw` → `data/approved/*.json` |
| `data/approved/products.json` | **생성물** 제품 1468 (가격 없음) |
| `data/approved/prices.json` | **생성물** 판매단가 1442 (제품과 분리 — 결정 D3) |
| `data/approved/labor-items.json` | **생성물** 품셈 항목 |
| `data/approved/wage-table.json` | **생성물** 26년 상반기 노임 21직종 |
| `data/approved/labor-mappings.json` | **생성물** SKU ↔ 품셈 연결 |
| `tests/unit/classifyRow.test.ts` | 행 분류 |
| `tests/unit/buildProducts.test.ts` | 제품 정규화·SKU·미등록 가격 |
| `tests/unit/buildLabor.test.ts` | 품셈·노임·M/M 단위 |
| `tests/integration/approvedData.test.ts` | 산출물 스키마·불변식·**민감정보 감사 게이트** |

---

### Task 1: 원시 덤프 추출기

**Files:**
- Create: `tools/extract_catalog.py`
- Create: `src/data/catalog/rawTypes.ts`
- Create: `tests/integration/approvedData.test.ts`
- Modify: `package.json` (scripts 추가)

**Interfaces:**
- Consumes: 환경변수 `AVCPQ_PUMSEM_XLSX` 가 가리키는 원본 xlsx
- Produces:
  ```ts
  // src/data/catalog/rawTypes.ts
  export interface RawRow {
    readonly sheet: string;
    readonly row: number;               // 원본 행 번호 (1-based)
    readonly no: string | null;         // A
    readonly name: string | null;       // B
    readonly spec: string | null;       // C
    readonly note: string | null;       // D 설명
    readonly unit: string | null;       // E
    readonly price: string | null;      // G — 숫자 셀일 때만 문자열, 아니면 null
    readonly remark: string | null;     // L
    readonly pumsemCode: string | null; // P
    readonly itemRate: string | null;   // Q
    readonly surcharge: string | null;  // R
    /** 직종명 → 품(문자열). 0·빈칸은 키 자체를 넣지 않는다. */
    readonly trades: Readonly<Record<string, string>>;
  }
  export interface RawWage {
    readonly trade: string;
    readonly unit: 'M/D' | 'M/M';
    readonly wage: string;
  }
  export interface RawDump {
    readonly sourceSha256: string;
    readonly extractedAt: string;   // ISO
    readonly periodLabel: string;   // '26년 상반기'
    readonly wages: readonly RawWage[];
    readonly rows: readonly RawRow[];
  }
  ```

- [ ] **Step 1: 실패하는 테스트 작성 — 덤프에 금지 정보가 없음을 증명한다**

파이썬 추출기의 1차 계약은 "금지 열을 읽지 않는다"이다. 이것을 먼저 테스트로 건다.

```ts
// tests/integration/approvedData.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const RAW = '.local/raw/catalog-raw.json';

describe('원시 덤프', () => {
  it('덤프 파일이 존재한다 — 없으면 `npm run extract:catalog` 를 먼저 돌린다', () => {
    expect(existsSync(RAW), `${RAW} 없음. AVCPQ_PUMSEM_XLSX 를 설정하고 npm run extract:catalog`).toBe(true);
  });

  it('원본 해시가 기록되어 있다', () => {
    const d = JSON.parse(readFileSync(RAW, 'utf8'));
    expect(d.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(d.periodLabel).toBe('26년 상반기');
  });

  it('금지 열(M 제조사/구매처, N 영업비고)의 키가 아예 없다', () => {
    const d = JSON.parse(readFileSync(RAW, 'utf8'));
    const keys = new Set(d.rows.flatMap((r: object) => Object.keys(r)));
    for (const forbidden of ['maker', 'vendor', 'supplier', 'salesNote', 'm', 'n']) {
      expect(keys.has(forbidden), `금지 키 ${forbidden}`).toBe(false);
    }
  });

  it('숨김 시트 2개가 덤프에 없다', () => {
    const d = JSON.parse(readFileSync(RAW, 'utf8'));
    const sheets = new Set(d.rows.map((r: { sheet: string }) => r.sheet));
    expect(sheets.has('LED전광판 계산')).toBe(false);
    expect(sheets.has('단종, 미사용 제품')).toBe(false);
  });

  it('간접비 시트 2개가 덤프에 없다 — 별도 계획 범위', () => {
    const d = JSON.parse(readFileSync(RAW, 'utf8'));
    const sheets = new Set(d.rows.map((r: { sheet: string }) => r.sheet));
    expect(sheets.has('간접비_DS')).toBe(false);
    expect(sheets.has('간접비_SDC, SDI')).toBe(false);
  });

  it('노임 21직종이 있고 CMS 전용 4종만 M/M 이다', () => {
    const d = JSON.parse(readFileSync(RAW, 'utf8'));
    expect(d.wages).toHaveLength(21);
    const mm = d.wages.filter((w: { unit: string }) => w.unit === 'M/M').map((w: { trade: string }) => w.trade);
    expect(mm.sort()).toEqual(['NW엔지니어', '데이터베이스 운용자', '응용 SW개발자', '임베디드 SW개발자'].sort());
    const engineer = d.wages.find((w: { trade: string }) => w.trade === '통신관련기사');
    expect(engineer).toEqual({ trade: '통신관련기사', unit: 'M/D', wage: '320449' });
  });

  it('덤프 전체 텍스트에 사내 경로 패턴이 없다', () => {
    const text = readFileSync(RAW, 'utf8');
    for (const pat of [/[A-Z]:\\\\/, /Y:\\\\/, /\.xlsx?["'\s]/i, /\.mdb/i]) {
      expect(text, `패턴 ${pat} 발견`).not.toMatch(pat);
    }
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/integration/approvedData.test.ts`
Expected: FAIL — `.local/raw/catalog-raw.json 없음`

- [ ] **Step 3: 추출기 구현**

```python
# tools/extract_catalog.py
"""표준품셈 통합문서 → 원시 JSON 덤프.

설계서 §4.5: 원본은 읽기 전용으로 보존하고 저장소에 넣지 않는다.
설계서 §8.1 / 결정 D1: M열(제조사/구매처)·N열(영업비고)은 **읽지 않는다**.
              아래 COL 상수에 그 인덱스가 없는 것이 그 보증이다.

판단은 하지 않는다. 행 분류·정규화는 TypeScript 쪽(src/data/catalog/)이 한다.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import openpyxl

OUT = Path('.local/raw/catalog-raw.json')

SKIP_SHEETS = {
    'LED전광판 계산',        # 숨김
    '단종, 미사용 제품',      # 숨김
    '간접비_DS',             # 별도 계획
    '간접비_SDC, SDI',       # 별도 계획
}

HEADER_ROW_TRADE = 2   # 직종 이름
HEADER_ROW_WAGE = 3    # 노임 / 품 단위 표기
FIRST_DATA_ROW = 4

# 1-based 열 인덱스. M(13)·N(14)·O(15)는 의도적으로 없다.
COL = {
    'no': 1, 'name': 2, 'spec': 3, 'note': 4, 'unit': 5,
    'price': 7, 'remark': 12,
    'pumsemCode': 16, 'itemRate': 17, 'surcharge': 18,
}
FORBIDDEN_COLS = {13, 14}  # M 제조사/구매처, N 영업비고 — 접근 금지
assert not (set(COL.values()) & FORBIDDEN_COLS)

TRADE_FIRST_COL = 20  # T


def cell_text(ws, row: int, col: int) -> str | None:
    """셀을 문자열로. 수식·빈칸은 None."""
    assert col not in FORBIDDEN_COLS, f'금지 열 접근: {col}'
    v = ws.cell(row, col).value
    if v is None:
        return None
    if isinstance(v, str):
        s = v.strip()
        if not s or s.startswith('='):
            return None
        return s
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return str(int(v)) if float(v).is_integer() else repr(float(v))
    return None


def numeric_text(ws, row: int, col: int) -> str | None:
    """숫자 셀일 때만 문자열로. 수식·문자열은 None(=미등록)."""
    assert col not in FORBIDDEN_COLS, f'금지 열 접근: {col}'
    v = ws.cell(row, col).value
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return str(int(v)) if float(v).is_integer() else repr(float(v))


def trade_columns(ws) -> list[tuple[int, str, str]]:
    """(품 열, 직종명, 단위) 목록. 단위는 3행의 M/D 또는 M/M."""
    out = []
    for c in range(TRADE_FIRST_COL, ws.max_column + 1):
        name = ws.cell(HEADER_ROW_TRADE, c).value
        if not name or not str(name).strip():
            continue
        unit = str(ws.cell(HEADER_ROW_WAGE, c).value or '').strip()
        if unit not in ('M/D', 'M/M'):
            continue
        out.append((c, str(name).strip(), unit))
    return out


def main() -> int:
    src = os.environ.get('AVCPQ_PUMSEM_XLSX')
    if not src:
        print('AVCPQ_PUMSEM_XLSX 환경변수에 표준품셈 xlsx 경로를 지정하세요.', file=sys.stderr)
        return 2
    path = Path(src)
    if not path.is_file():
        print(f'파일 없음: {path}', file=sys.stderr)
        return 2

    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    wb = openpyxl.load_workbook(path, data_only=False, read_only=False)

    wages: dict[str, dict[str, str]] = {}
    rows: list[dict] = []

    for ws in wb.worksheets:
        if ws.title in SKIP_SHEETS:
            continue
        tcols = trade_columns(ws)
        for c, trade, unit in tcols:
            w = ws.cell(HEADER_ROW_WAGE, c + 1).value
            if isinstance(w, (int, float)) and not isinstance(w, bool):
                wages.setdefault(trade, {'trade': trade, 'unit': unit, 'wage': str(int(w))})

        for r in range(FIRST_DATA_ROW, ws.max_row + 1):
            name = cell_text(ws, r, COL['name'])
            if name is None:
                continue
            trades: dict[str, str] = {}
            for c, trade, _unit in tcols:
                q = numeric_text(ws, r, c)
                if q is not None and q not in ('0', '0.0'):
                    trades[trade] = q
            rows.append({
                'sheet': ws.title,
                'row': r,
                'no': cell_text(ws, r, COL['no']),
                'name': name,
                'spec': cell_text(ws, r, COL['spec']),
                'note': cell_text(ws, r, COL['note']),
                'unit': cell_text(ws, r, COL['unit']),
                'price': numeric_text(ws, r, COL['price']),
                'remark': cell_text(ws, r, COL['remark']),
                'pumsemCode': cell_text(ws, r, COL['pumsemCode']),
                'itemRate': numeric_text(ws, r, COL['itemRate']),
                'surcharge': numeric_text(ws, r, COL['surcharge']),
                'trades': trades,
            })

    wb.close()

    dump = {
        'sourceSha256': sha,
        'extractedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'periodLabel': '26년 상반기',
        'wages': sorted(wages.values(), key=lambda w: w['trade']),
        'rows': rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(dump, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'{OUT}: 시트 {len({r["sheet"] for r in rows})}개, 행 {len(rows)}개, 직종 {len(wages)}종')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
```

`package.json` 의 `scripts` 에 추가한다:

```json
"extract:catalog": "python tools/extract_catalog.py",
"build:catalog": "node --experimental-strip-types tools/build-approved.ts"
```

- [ ] **Step 4: 실행하고 테스트 통과 확인**

```bash
export AVCPQ_PUMSEM_XLSX="<사용자 PC의 원본 경로>"
npm run extract:catalog
npx vitest run tests/integration/approvedData.test.ts
```

Expected: 추출기가 `시트 12개, 행 …개, 직종 21종` 출력. 테스트 7개 PASS.

행 수는 제품행이 아니라 **B열이 있는 모든 행**이므로 1468 보다 크다(분류·브랜드 머리글 포함). 정상이다.

- [ ] **Step 5: 커밋**

```bash
git add tools/extract_catalog.py src/data/catalog/rawTypes.ts tests/integration/approvedData.test.ts package.json
git commit -m "카탈로그: 표준품셈 원시 덤프 추출기 — 금지 열 미접근 보증"
```

---

### Task 2: 행 분류기

**Files:**
- Create: `src/data/catalog/classifyRow.ts`
- Test: `tests/unit/classifyRow.test.ts`

**Interfaces:**
- Consumes: `RawRow` (Task 1)
- Produces:
  ```ts
  export type RowClass = 'category' | 'brand' | 'product' | 'ignore';
  export function classifyRow(row: RawRow): RowClass;
  export interface ClassifiedRow {
    readonly raw: RawRow;
    readonly category: string | null;
    readonly brand: string | null;
  }
  /** 분류/브랜드 머리글을 아래 제품행에 전파한다. 입력 순서를 유지한다. */
  export function classifyAll(rows: readonly RawRow[]): readonly ClassifiedRow[];
  ```

분류 규칙:

| 조건 | 결과 |
|---|---|
| `name` 이 `[` 로 시작 | `category` — 예 `[ PTZ CAMERA & Ctrl ]` |
| `unit` 이 있음 | `product` |
| `unit` 없고 `price`·`pumsemCode`·`trades` 전부 없음 | `brand` — 예 `SONY/AVICS` |
| 그 외 (`unit` 없는데 가격이나 품셈이 있음) | `ignore` — 불완전 행. 조용히 버리지 않고 Task 5 가 수를 보고한다 |

`category` 이름은 바깥 대괄호와 공백을 벗긴다. 분류 머리글이 나오면 `brand` 는 초기화된다(새 분류의 첫 제품이 이전 분류 브랜드를 물려받으면 안 된다).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/classifyRow.test.ts
import { describe, expect, it } from 'vitest';
import { classifyAll, classifyRow } from '../../src/data/catalog/classifyRow.js';
import type { RawRow } from '../../src/data/catalog/rawTypes.js';

const base: RawRow = {
  sheet: '영상', row: 1, no: null, name: null, spec: null, note: null, unit: null,
  price: null, remark: null, pumsemCode: null, itemRate: null, surcharge: null, trades: {},
};
const r = (p: Partial<RawRow>): RawRow => ({ ...base, ...p });

describe('classifyRow', () => {
  it('대괄호로 시작하면 분류 머리글이다', () => {
    expect(classifyRow(r({ name: '[ PTZ CAMERA & Ctrl ]' }))).toBe('category');
  });

  it('단위가 있으면 제품이다', () => {
    expect(classifyRow(r({ name: '1" Exmor R PTZ Camera', unit: 'EA', price: '11475000' }))).toBe('product');
  });

  it('단가가 없어도 단위가 있으면 제품이다 — 미등록 가격 (설계서 §5.6)', () => {
    expect(classifyRow(r({ name: '단가미정 제품', unit: 'EA' }))).toBe('product');
  });

  it('단위·단가·품셈이 모두 없으면 브랜드 머리글이다', () => {
    expect(classifyRow(r({ name: 'SONY/AVICS' }))).toBe('brand');
  });

  it('단위가 없는데 품셈만 있는 행은 무시한다 — 불완전', () => {
    expect(classifyRow(r({ name: 'DP to HDMI 케이블&젠더', trades: { 보통인부: '0.1' } }))).toBe('ignore');
  });

  it('단위가 없는데 단가만 있는 행은 무시한다', () => {
    expect(classifyRow(r({ name: '뭔가', price: '1000' }))).toBe('ignore');
  });

  it('대괄호가 앞에 있으면 단위가 있어도 분류다', () => {
    expect(classifyRow(r({ name: '[ 소계 ]', unit: 'EA' }))).toBe('category');
  });
});

describe('classifyAll', () => {
  const rows = [
    r({ row: 4, name: '[ PTZ CAMERA & Ctrl ]' }),
    r({ row: 5, name: 'SONY/AVICS' }),
    r({ row: 6, name: '1" Exmor R PTZ Camera', unit: 'EA', price: '11475000' }),
    r({ row: 7, name: '1/2" PTZ Camera', unit: 'EA', price: '3000000' }),
    r({ row: 8, name: '[ DISPLAY ]' }),
    r({ row: 9, name: '75" 상업용 디스플레이', unit: 'EA', price: '2000000' }),
  ];

  it('분류와 브랜드를 아래 제품행에 전파한다', () => {
    const out = classifyAll(rows).filter((c) => classifyRow(c.raw) === 'product');
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ category: 'PTZ CAMERA & Ctrl', brand: 'SONY/AVICS' });
    expect(out[1]).toMatchObject({ category: 'PTZ CAMERA & Ctrl', brand: 'SONY/AVICS' });
  });

  it('새 분류가 나오면 브랜드를 초기화한다 — 이전 분류 브랜드가 새지 않는다', () => {
    const out = classifyAll(rows).filter((c) => classifyRow(c.raw) === 'product');
    expect(out[2]).toMatchObject({ category: 'DISPLAY', brand: null });
  });

  it('브랜드 없이 바로 나오는 제품은 brand 가 null 이다', () => {
    const out = classifyAll([r({ row: 4, name: '[ 기타 ]' }), r({ row: 5, name: '잡자재', unit: 'EA' })]);
    expect(out[1]).toMatchObject({ category: '기타', brand: null });
  });

  it('시트가 바뀌면 분류·브랜드를 초기화한다', () => {
    const out = classifyAll([
      r({ sheet: '영상', row: 4, name: '[ A ]' }),
      r({ sheet: '영상', row: 5, name: '브랜드X' }),
      r({ sheet: 'TV', row: 4, name: 'TV제품', unit: 'EA' }),
    ]);
    expect(out[2]).toMatchObject({ category: null, brand: null });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/unit/classifyRow.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// src/data/catalog/classifyRow.ts
/**
 * 품셈 통합문서 B열의 계층을 복원한다.
 *
 * 원본은 한 시트 안에서 `[ 분류 ]` → `브랜드` → 제품 행 순으로 내려간다.
 * 단위(E열)가 제품행의 판별 기준이다 — 단가는 미등록일 수 있으므로(설계서 §5.6)
 * 단가 유무로 판단하면 안 된다.
 */
import type { RawRow } from './rawTypes.js';

export type RowClass = 'category' | 'brand' | 'product' | 'ignore';

export function classifyRow(row: RawRow): RowClass {
  const name = row.name?.trim();
  if (!name) return 'ignore';
  if (name.startsWith('[')) return 'category';
  if (row.unit) return 'product';
  const hasData =
    row.price !== null || row.pumsemCode !== null || Object.keys(row.trades).length > 0;
  return hasData ? 'ignore' : 'brand';
}

/** `[ PTZ CAMERA & Ctrl ]` → `PTZ CAMERA & Ctrl` */
function categoryName(raw: string): string {
  return raw.replace(/^\[+/, '').replace(/\]+$/, '').trim();
}

export interface ClassifiedRow {
  readonly raw: RawRow;
  readonly category: string | null;
  readonly brand: string | null;
}

export function classifyAll(rows: readonly RawRow[]): readonly ClassifiedRow[] {
  const out: ClassifiedRow[] = [];
  let sheet: string | null = null;
  let category: string | null = null;
  let brand: string | null = null;

  for (const raw of rows) {
    if (raw.sheet !== sheet) {
      sheet = raw.sheet;
      category = null;
      brand = null;
    }
    switch (classifyRow(raw)) {
      case 'category':
        category = categoryName(raw.name ?? '');
        brand = null; // 새 분류는 브랜드를 물려받지 않는다
        break;
      case 'brand':
        brand = raw.name?.trim() ?? null;
        break;
      default:
        break;
    }
    out.push({ raw, category, brand });
  }
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/unit/classifyRow.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/data/catalog/classifyRow.ts tests/unit/classifyRow.test.ts
git commit -m "카탈로그: 품명 열의 분류·브랜드 계층 복원"
```

---

### Task 3: 제품과 가격 분리 생성

**Files:**
- Create: `src/data/catalog/buildProducts.ts`
- Test: `tests/unit/buildProducts.test.ts`

**Interfaces:**
- Consumes: `ClassifiedRow[]` (Task 2), `ProductVariant` (`src/domain/quote/types.ts:26`)
- Produces:
  ```ts
  /** 가격을 뺀 ProductVariant. 결정 D3: products.json 에 가격을 넣지 않는다. */
  export type CatalogProduct = Omit<ProductVariant, 'sellingUnitPrice' | 'ports' | 'includedAccessories'>;
  export interface PriceEntry { readonly sku: string; readonly sellingUnitPrice: DecimalText; }
  export interface BuildProductsResult {
    readonly products: readonly CatalogProduct[];
    readonly prices: readonly PriceEntry[];
    readonly skipped: number;                  // classify 가 'ignore' 로 판정한 행 수
    readonly duplicateSkus: readonly string[];
  }
  export function buildProducts(rows: readonly ClassifiedRow[]): BuildProductsResult;
  ```

SKU 생성: 시트명을 짧은 코드로 바꾼 뒤 원본 행 번호를 붙인다. 원본에서 행이 밀리면 같은 제품이 같은 SKU 를 유지하지 못하지만, **반기마다 전체를 다시 뽑는 구조**이므로 안정성보다 충돌 없음이 우선이다. 작업 파일은 설계서 §6.3 대로 `versions.catalog` 스냅샷을 들고 있어 조용한 변경을 막는다.

| 시트 | 코드 | 시트 | 코드 |
|---|---|---|---|
| 케이블 및 커넥터 | `CBL` | 화상회의 | `VCS` |
| 오디오 | `AUD` | 프로젝터,스크린 | `PRJ` |
| 영상 | `VID` | CMS | `CMS` |
| TV | `TV` | CCTV | `CCT` |
| Head-End, CATV | `HE` | 기타 유통제품 | `ETC` |
| 제어 | `CTL` | | |
| 전원, 랙, 판넬, 몰드 및 보양 | `PWR` | | |

`productId` 는 SKU 와 같다. 같은 모델의 여러 설치 행은 `QuoteRow.rowId` 로 구분되므로(설계서 §6.1) 카탈로그 쪽은 1:1 이면 된다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/buildProducts.test.ts
import { describe, expect, it } from 'vitest';
import { buildProducts } from '../../src/data/catalog/buildProducts.js';
import { classifyAll } from '../../src/data/catalog/classifyRow.js';
import type { RawRow } from '../../src/data/catalog/rawTypes.js';

const base: RawRow = {
  sheet: '영상', row: 1, no: null, name: null, spec: null, note: null, unit: null,
  price: null, remark: null, pumsemCode: null, itemRate: null, surcharge: null, trades: {},
};
const r = (p: Partial<RawRow>): RawRow => ({ ...base, ...p });
const build = (rows: RawRow[]) => buildProducts(classifyAll(rows));

describe('buildProducts', () => {
  it('제품행만 제품이 된다 — 분류·브랜드 머리글은 제외', () => {
    const out = build([
      r({ row: 4, name: '[ PTZ ]' }),
      r({ row: 5, name: 'SONY/AVICS' }),
      r({ row: 6, name: 'BRC-H800', spec: '12배줌', unit: 'EA', price: '11475000' }),
    ]);
    expect(out.products).toHaveLength(1);
    expect(out.products[0]).toMatchObject({
      sku: 'VID-6', productId: 'VID-6', quoteName: 'BRC-H800', quoteSpec: '12배줌',
      unit: 'EA', brand: 'SONY/AVICS', currency: 'KRW',
    });
  });

  it('가격을 제품에서 분리한다 — 결정 D3', () => {
    const out = build([r({ row: 6, name: 'A', unit: 'EA', price: '11475000' })]);
    expect(out.products[0]).not.toHaveProperty('sellingUnitPrice');
    expect(out.prices).toEqual([{ sku: 'VID-6', sellingUnitPrice: '11475000' }]);
  });

  it('단가 미등록은 가격 항목을 만들지 않는다 — 0원으로 만들지 않는다 (설계서 §5.6)', () => {
    const out = build([r({ row: 6, name: '단가미정', unit: 'EA', price: null })]);
    expect(out.products).toHaveLength(1);
    expect(out.prices).toHaveLength(0);
  });

  it('명시적 0원은 미등록과 구분해 보존한다 (설계서 §8.3)', () => {
    const out = build([r({ row: 6, name: '무상제공', unit: 'EA', price: '0' })]);
    expect(out.prices).toEqual([{ sku: 'VID-6', sellingUnitPrice: '0' }]);
  });

  it('시트가 달라도 SKU 가 충돌하지 않는다', () => {
    const out = build([
      r({ sheet: '영상', row: 6, name: 'HDMI 케이블', unit: 'EA', price: '10000' }),
      r({ sheet: '케이블 및 커넥터', row: 6, name: 'HDMI 케이블', unit: 'EA', price: '9000' }),
    ]);
    expect(out.products.map((p) => p.sku)).toEqual(['VID-6', 'CBL-6']);
    expect(out.duplicateSkus).toHaveLength(0);
  });

  it('같은 품명이 여러 번 나와도 각각 별도 제품이다', () => {
    const out = build([
      r({ row: 6, name: 'HDMI 케이블', spec: '2m', unit: 'EA', price: '10000' }),
      r({ row: 7, name: 'HDMI 케이블', spec: '5m', unit: 'EA', price: '12000' }),
    ]);
    expect(out.products).toHaveLength(2);
    expect(out.products.map((p) => p.quoteSpec)).toEqual(['2m', '5m']);
  });

  it('품셈 코드가 있으면 laborMappingId 를, 없으면 undefined 를 둔다', () => {
    const out = build([
      r({ row: 6, name: 'A', unit: 'EA', pumsemCode: '7-11-1-방송용카메라' }),
      r({ row: 7, name: 'B', unit: 'EA' }),
    ]);
    expect(out.products[0].laborMappingId).toBe('LM-VID-6');
    expect(out.products[1].laborMappingId).toBeUndefined();
  });

  it('전부 review-required 다 — 자동 확정하지 않는다 (설계서 §5.3)', () => {
    const out = build([
      r({ row: 6, name: 'A', unit: 'EA', pumsemCode: '7-11-1' }),
      r({ row: 7, name: 'B', unit: 'EA' }),
    ]);
    expect(out.products.every((p) => p.evidence === 'review-required')).toBe(true);
  });

  it('model 은 규격에서, 없으면 품명에서 가져온다', () => {
    const out = build([
      r({ row: 6, name: '1" PTZ Camera', spec: '12배줌, BRC-H800', unit: 'EA' }),
      r({ row: 7, name: '잡자재', unit: 'EA' }),
    ]);
    expect(out.products[0].model).toBe('12배줌, BRC-H800');
    expect(out.products[1].model).toBe('잡자재');
  });

  it('분류를 options.category 에 보존한다 — ProductPicker 필터용', () => {
    const out = build([r({ row: 4, name: '[ PTZ ]' }), r({ row: 6, name: 'A', unit: 'EA' })]);
    expect(out.products[0].options).toEqual({ category: 'PTZ', sheet: '영상', sourceRow: '6' });
  });

  it('무시된 불완전 행 수를 보고한다 — 조용히 버리지 않는다', () => {
    const out = build([r({ row: 6, name: '불완전', price: '1000' })]);
    expect(out.products).toHaveLength(0);
    expect(out.skipped).toBe(1);
  });

  it('알 수 없는 시트명은 던진다 — 조용히 통과시키지 않는다', () => {
    expect(() => build([r({ sheet: '새로생긴시트', row: 6, name: 'A', unit: 'EA' })]))
      .toThrow(/새로생긴시트/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/unit/buildProducts.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// src/data/catalog/buildProducts.ts
/**
 * 분류된 행 → 제품 카탈로그와 판매가.
 *
 * 결정 D3: 제품과 가격을 **두 파일로 분리**한다. 여기서 섞으면 그 결정이 비가역이 된다.
 * 설계서 §5.6: 단가 미등록을 0원으로 만들지 않는다 — 가격 항목 자체를 만들지 않는다.
 */
import type { DecimalText, ProductVariant } from '../../domain/quote/types.js';
import { classifyRow, type ClassifiedRow } from './classifyRow.js';
import { SHEET_CODE } from './sheetCode.js';

export type CatalogProduct = Omit<
  ProductVariant,
  'sellingUnitPrice' | 'ports' | 'includedAccessories'
>;

export interface PriceEntry {
  readonly sku: string;
  readonly sellingUnitPrice: DecimalText;
}

export interface BuildProductsResult {
  readonly products: readonly CatalogProduct[];
  readonly prices: readonly PriceEntry[];
  readonly skipped: number;
  readonly duplicateSkus: readonly string[];
}

export function skuFor(sheet: string, row: number): string {
  const code = SHEET_CODE[sheet];
  if (!code) {
    throw new Error(`알 수 없는 시트: ${sheet}. SHEET_CODE 에 코드를 추가하세요.`);
  }
  return `${code}-${row}`;
}

export function buildProducts(rows: readonly ClassifiedRow[]): BuildProductsResult {
  const products: CatalogProduct[] = [];
  const prices: PriceEntry[] = [];
  const seen = new Set<string>();
  const duplicateSkus: string[] = [];
  let skipped = 0;

  for (const { raw, category, brand } of rows) {
    const cls = classifyRow(raw);
    if (cls === 'ignore') {
      skipped += 1;
      continue;
    }
    if (cls !== 'product') continue;

    const sku = skuFor(raw.sheet, raw.row);
    if (seen.has(sku)) duplicateSkus.push(sku);
    seen.add(sku);

    const name = raw.name ?? '';
    products.push({
      productId: sku,
      sku,
      brand: brand ?? '',
      model: raw.spec ?? name,
      quoteName: name,
      quoteSpec: raw.spec ?? '',
      unit: raw.unit ?? '',
      options: {
        category: category ?? '',
        sheet: raw.sheet,
        sourceRow: String(raw.row),
      },
      currency: 'KRW',
      laborMappingId: raw.pumsemCode ? `LM-${sku}` : undefined,
      // 설계서 §5.3: 사람이 확인하기 전에는 verified 로 올리지 않는다.
      evidence: 'review-required',
    });

    if (raw.price !== null) {
      prices.push({ sku, sellingUnitPrice: raw.price });
    }
  }

  return { products, prices, skipped, duplicateSkus };
}
```

그리고 Task 4 와 공유하는 시트 코드표를 별도 파일로 둔다 (두 곳에 복제하면 어긋난다):

```ts
// src/data/catalog/sheetCode.ts
/** 시트명 → SKU 접두 코드. buildProducts 와 buildLabor 가 함께 쓴다. */
export const SHEET_CODE: Readonly<Record<string, string>> = {
  '케이블 및 커넥터': 'CBL',
  '오디오': 'AUD',
  '영상': 'VID',
  'TV': 'TV',
  'Head-End, CATV': 'HE',
  '제어': 'CTL',
  '전원, 랙, 판넬, 몰드 및 보양': 'PWR',
  '화상회의': 'VCS',
  '프로젝터,스크린': 'PRJ',
  'CMS': 'CMS',
  'CCTV': 'CCT',
  '기타 유통제품': 'ETC',
};
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/unit/buildProducts.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/data/catalog/buildProducts.ts src/data/catalog/sheetCode.ts tests/unit/buildProducts.test.ts
git commit -m "카탈로그: 제품과 판매가를 분리해 생성 (결정 D3)"
```

---

### Task 4: 품셈·노임·매핑 생성

**Files:**
- Create: `src/data/catalog/buildLabor.ts`
- Test: `tests/unit/buildLabor.test.ts`

**Interfaces:**
- Consumes: `ClassifiedRow[]` (Task 2), `RawWage` (Task 1), `skuFor`/`SHEET_CODE` (Task 3), `LaborItem`/`WageTable`/`LaborMapping` (`src/domain/labor/types.ts`)
- Produces:
  ```ts
  /** 노임 단위. 설계서에 없던 축. M/D 와 M/M 을 섞으면 노무비가 20배 틀린다. */
  export type WageUnit = 'M/D' | 'M/M';
  export interface TradeWage { readonly unit: WageUnit; readonly wage: DecimalText; }
  /** 기존 WageTable.wages 는 Record<Trade, DecimalText> 라 단위를 담지 못한다. 단위를 함께 싣는다. */
  export interface UnitAwareWageTable extends Omit<WageTable, 'wages'> {
    readonly wages: Readonly<Record<string, TradeWage>>;
  }
  export interface BuildLaborResult {
    readonly wageTable: UnitAwareWageTable;
    readonly laborItems: readonly LaborItem[];
    readonly mappings: readonly LaborMapping[];
    readonly unmappedSkus: readonly string[];
  }
  export function buildLabor(
    rows: readonly ClassifiedRow[],
    wages: readonly RawWage[],
    periodLabel: string,
  ): BuildLaborResult;
  ```

`LaborItem.laborItemId` 는 `LI-${sku}`, `LaborMapping.laborMappingId` 는 `LM-${sku}` — Task 3 이 제품에 넣은 값과 **반드시 일치**해야 한다.

`conversionFactor` 는 `"1"` 로 고정한다. 원본에 판매단위↔품셈단위 환산 정보가 없다. 설계서 §5.3 이 요구하는 환산 계수는 사용자 확인 후 채운다 — 그래서 `confirmed: false` 다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/buildLabor.test.ts
import { describe, expect, it } from 'vitest';
import { buildLabor } from '../../src/data/catalog/buildLabor.js';
import { classifyAll } from '../../src/data/catalog/classifyRow.js';
import type { RawRow, RawWage } from '../../src/data/catalog/rawTypes.js';

const base: RawRow = {
  sheet: '영상', row: 1, no: null, name: null, spec: null, note: null, unit: null,
  price: null, remark: null, pumsemCode: null, itemRate: null, surcharge: null, trades: {},
};
const r = (p: Partial<RawRow>): RawRow => ({ ...base, ...p });

const wages: RawWage[] = [
  { trade: '통신관련기사', unit: 'M/D', wage: '320449' },
  { trade: '통신설비공', unit: 'M/D', wage: '315528' },
  { trade: '보통인부', unit: 'M/D', wage: '172068' },
  { trade: '응용 SW개발자', unit: 'M/M', wage: '6395094' },
];
const build = (rows: RawRow[]) => buildLabor(classifyAll(rows), wages, '26년 상반기');

describe('노임표', () => {
  it('직종별 단위를 함께 싣는다', () => {
    const { wageTable } = build([]);
    expect(wageTable.periodLabel).toBe('26년 상반기');
    expect(wageTable.wages['통신관련기사']).toEqual({ unit: 'M/D', wage: '320449' });
    expect(wageTable.wages['응용 SW개발자']).toEqual({ unit: 'M/M', wage: '6395094' });
  });

  it('M/D 와 M/M 을 같은 숫자처럼 섞지 않는다', () => {
    const { wageTable } = build([]);
    const units = new Set(Object.values(wageTable.wages).map((w) => w.unit));
    expect(units).toEqual(new Set(['M/D', 'M/M']));
  });
});

describe('품셈 항목', () => {
  it('품셈 코드가 있는 제품만 항목을 만든다', () => {
    const out = build([
      r({ row: 6, name: 'A', unit: 'EA', pumsemCode: '7-11-1-방송용카메라',
          trades: { 통신관련기사: '0.15', 보통인부: '0.31' } }),
      r({ row: 7, name: 'B', unit: 'EA' }),
    ]);
    expect(out.laborItems).toHaveLength(1);
    expect(out.laborItems[0]).toMatchObject({
      laborItemId: 'LI-VID-6', code: '7-11-1-방송용카메라', baseUnit: 'EA',
      revision: '26년 상반기',
    });
    expect(out.laborItems[0].trades).toEqual([
      { trade: '통신관련기사', quantity: '0.15' },
      { trade: '보통인부', quantity: '0.31' },
    ]);
  });

  it('품셈 코드가 없으면 매핑을 만들지 않고 미연결로 보고한다 (설계서 §5.3)', () => {
    const out = build([r({ row: 7, name: 'B', unit: 'EA', trades: { 보통인부: '0.1' } })]);
    expect(out.laborItems).toHaveLength(0);
    expect(out.mappings).toHaveLength(0);
    expect(out.unmappedSkus).toEqual(['VID-7']);
  });

  it('품셈 코드는 있는데 품이 하나도 없으면 매핑을 만들지 않는다 — 노무비 0원 방지', () => {
    const out = build([r({ row: 6, name: 'A', unit: 'EA', pumsemCode: '1-1-1' })]);
    expect(out.mappings).toHaveLength(0);
    expect(out.unmappedSkus).toEqual(['VID-6']);
  });

  it('노임표에 없는 직종이 품에 나오면 던진다', () => {
    expect(() => build([
      r({ row: 6, name: 'A', unit: 'EA', pumsemCode: '1-1-1', trades: { 없는직종: '0.1' } }),
    ])).toThrow(/없는직종/);
  });
});

describe('매핑', () => {
  it('요율·할증을 그대로 옮기고 미확인 상태로 둔다', () => {
    const out = build([
      r({ row: 6, name: 'A', unit: 'EA', pumsemCode: '7-11-1', itemRate: '0.63',
          surcharge: '0', trades: { 통신관련기사: '0.15' } }),
    ]);
    expect(out.mappings[0]).toMatchObject({
      laborMappingId: 'LM-VID-6', sku: 'VID-6', laborItemId: 'LI-VID-6',
      conversionFactor: '1', surcharge: '0', itemRate: '0.63', confirmed: false,
    });
    expect(out.mappings[0].note).toMatch(/사용자 확인/);
  });

  it('요율이 비면 1 로 둔다 — 0 으로 두면 노무비가 0원이 된다', () => {
    const out = build([
      r({ row: 6, name: 'A', unit: 'EA', pumsemCode: '1-1-1', trades: { 보통인부: '0.1' } }),
    ]);
    expect(out.mappings[0]).toMatchObject({ itemRate: '1', surcharge: '0' });
  });

  it('mappingId 가 buildProducts 의 laborMappingId 와 같은 규칙이다', () => {
    const out = build([
      r({ row: 6, name: 'A', unit: 'EA', pumsemCode: '1-1-1', trades: { 보통인부: '0.1' } }),
    ]);
    expect(out.mappings[0].laborMappingId).toBe('LM-VID-6');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/unit/buildLabor.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// src/data/catalog/buildLabor.ts
/**
 * 분류된 행 → 품셈 항목·노임표·매핑.
 *
 * 설계서 §4.3 의 원본 수식  I = INT(SUM((R*S),S)*Q),  S = Σ(직종별 품 × 노임)
 * 을 데이터로 분해한 것이다. 계산 자체는 domain/labor 가 한다.
 *
 * ⚠ 노임 단위가 두 가지다. 17개 직종은 M/D(인·일), CMS 전용 4개는 M/M(인·월).
 *   기존 WageTable.wages 는 Record<Trade, DecimalText> 라 단위를 담지 못하므로
 *   여기서는 단위를 함께 싣는 타입을 쓴다.
 */
import type { DecimalText } from '../../domain/quote/types.js';
import type { LaborItem, LaborMapping, WageTable } from '../../domain/labor/types.js';
import { classifyRow, type ClassifiedRow } from './classifyRow.js';
import { skuFor } from './buildProducts.js';
import type { RawWage } from './rawTypes.js';

export type WageUnit = 'M/D' | 'M/M';

export interface TradeWage {
  readonly unit: WageUnit;
  readonly wage: DecimalText;
}

export interface UnitAwareWageTable extends Omit<WageTable, 'wages'> {
  readonly wages: Readonly<Record<string, TradeWage>>;
}

export interface BuildLaborResult {
  readonly wageTable: UnitAwareWageTable;
  readonly laborItems: readonly LaborItem[];
  readonly mappings: readonly LaborMapping[];
  readonly unmappedSkus: readonly string[];
}

const MAPPING_NOTE =
  '원본 표준품셈 Q·R열에서 추출. 환산 계수와 적용 범위는 사용자 확인 필요 (설계서 §5.3).';

export function buildLabor(
  rows: readonly ClassifiedRow[],
  wages: readonly RawWage[],
  periodLabel: string,
): BuildLaborResult {
  const wageMap: Record<string, TradeWage> = {};
  for (const w of wages) {
    wageMap[w.trade] = { unit: w.unit, wage: w.wage };
  }

  const laborItems: LaborItem[] = [];
  const mappings: LaborMapping[] = [];
  const unmappedSkus: string[] = [];

  for (const { raw } of rows) {
    if (classifyRow(raw) !== 'product') continue;
    const sku = skuFor(raw.sheet, raw.row);

    const trades = Object.entries(raw.trades).map(([trade, quantity]) => {
      if (!(trade in wageMap)) {
        throw new Error(`노임표에 없는 직종: ${trade} (${raw.sheet} ${raw.row}행)`);
      }
      return { trade, quantity };
    });

    // 품셈 코드가 없거나 품이 하나도 없으면 매핑을 만들지 않는다.
    // 만들면 노무비 0원이 조용히 들어간다 (설계서 §5.3).
    if (!raw.pumsemCode || trades.length === 0) {
      unmappedSkus.push(sku);
      continue;
    }

    laborItems.push({
      laborItemId: `LI-${sku}`,
      code: raw.pumsemCode,
      description: raw.note ?? raw.name ?? '',
      baseUnit: raw.unit ?? '',
      source: '표준품셈 통합문서',
      revision: periodLabel,
      trades,
    });

    mappings.push({
      laborMappingId: `LM-${sku}`,
      sku,
      laborItemId: `LI-${sku}`,
      conversionFactor: '1',
      surcharge: raw.surcharge ?? '0',
      // 요율이 비면 1. 0 으로 두면 노무 단가가 통째로 0원이 된다.
      itemRate: raw.itemRate ?? '1',
      confirmed: false,
      note: MAPPING_NOTE,
    });
  }

  return {
    wageTable: {
      wageTableId: `WAGE-${periodLabel}`,
      periodLabel,
      source: '표준품셈 통합문서 3행',
      wages: wageMap,
    },
    laborItems,
    mappings,
    unmappedSkus,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/unit/buildLabor.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: 기존 계산 엔진과 맞물리는지 확인한다**

`src/domain/labor/calculateLabor.ts:51` 의 `calculateLaborUnitPrice` 시그니처를 읽고, 아래 테스트를 `tests/unit/buildLabor.test.ts` 끝에 추가한다. **인자 순서와 반환 필드명은 실제 시그니처에 맞추고, 기대값 `63887` 은 바꾸지 않는다** — 원본 수식에서 유도한 값이다.

```ts
describe('기존 계산 엔진과의 연결', () => {
  it('생성한 품셈·노임으로 원본 I열 수식과 같은 값이 나온다', () => {
    // 원본: I = INT(SUM((R*S),S)*Q),  S = Σ(품 × 노임)
    // 0.15 × 320449 + 0.31 × 172068 = 48067.35 + 53341.08 = 101408.43
    // 할증 0, 요율 0.63 → INT(101408.43 × 0.63) = INT(63887.3109) = 63887
    const out = build([
      r({ row: 6, name: 'A', unit: 'EA', pumsemCode: '7-11-1', itemRate: '0.63',
          surcharge: '0', trades: { 통신관련기사: '0.15', 보통인부: '0.31' } }),
    ]);
    const plain = Object.fromEntries(
      Object.entries(out.wageTable.wages).map(([t, w]) => [t, w.wage]),
    );
    const got = calculateLaborUnitPrice(
      out.laborItems[0],
      { wageTableId: 'W1', periodLabel: '26년 상반기', source: '표준품셈', wages: plain },
      out.mappings[0],
    );
    expect(got.unitPrice).toBe('63887');
  });
});
```

Run: `npx vitest run tests/unit/buildLabor.test.ts`
Expected: PASS (10 tests)

통과하지 않으면 **계산 엔진이 아니라 이 테스트의 호출 형태를 먼저 의심**한다. 그래도 값이 다르면 설계서 §4.3 의 수식 해석이 어긋난 것이므로 `Ruling:` 으로 기록하고 사용자에게 보고한다.

- [ ] **Step 6: 커밋**

```bash
git add src/data/catalog/buildLabor.ts tests/unit/buildLabor.test.ts
git commit -m "카탈로그: 품셈·노임·매핑 생성 — M/D와 M/M 단위 구분"
```

---

### Task 5: 빌드 스크립트와 Zod 스키마

**Files:**
- Create: `src/data/catalog/schema.ts`
- Create: `tools/build-approved.ts`
- Modify: `tests/integration/approvedData.test.ts` (Task 1 블록 아래에 추가)
- Modify: `.gitignore` (필요하면 `data/approved/*.json` 예외)

**Interfaces:**
- Consumes: `buildProducts`(Task 3), `buildLabor`(Task 4), `.local/raw/catalog-raw.json`(Task 1)
- Produces: `data/approved/` 다섯 JSON 과 그 Zod 스키마 `productsSchema`, `pricesSchema`, `laborItemsSchema`, `wageTableSchema`, `mappingsSchema`

`version` 은 원본 SHA-256 앞 12자 + `-` + 추출일(`YYYYMMDD`). 설계서 §6.3 의 `DocumentVersions.catalog`/`labor`/`wage` 에 그대로 들어간다.

- [ ] **Step 1: 실패하는 테스트 작성 — 산출물 불변식과 감사 게이트**

```ts
// tests/integration/approvedData.test.ts 에 추가
import {
  laborItemsSchema, mappingsSchema, pricesSchema, productsSchema, wageTableSchema,
} from '../../src/data/catalog/schema.js';

const read = (f: string) => JSON.parse(readFileSync(`data/approved/${f}`, 'utf8'));

describe('승인 데이터 산출물', () => {
  it('다섯 파일이 스키마를 만족한다', () => {
    expect(() => productsSchema.parse(read('products.json'))).not.toThrow();
    expect(() => pricesSchema.parse(read('prices.json'))).not.toThrow();
    expect(() => laborItemsSchema.parse(read('labor-items.json'))).not.toThrow();
    expect(() => wageTableSchema.parse(read('wage-table.json'))).not.toThrow();
    expect(() => mappingsSchema.parse(read('labor-mappings.json'))).not.toThrow();
  });

  it('제품 파일에 가격 필드가 없다 — 결정 D3', () => {
    const text = readFileSync('data/approved/products.json', 'utf8');
    expect(text).not.toMatch(/sellingUnitPrice/);
    expect(text).not.toMatch(/"price"/);
  });

  it('제품 수가 기대 범위다', () => {
    const { products } = read('products.json');
    expect(products.length).toBeGreaterThan(1300);
    expect(products.length).toBeLessThanOrEqual(1468);
  });

  it('SKU 가 전부 고유하다', () => {
    const { products } = read('products.json');
    const skus = products.map((p: { sku: string }) => p.sku);
    expect(new Set(skus).size).toBe(skus.length);
  });

  it('가격의 SKU 가 전부 제품에 존재한다', () => {
    const { products } = read('products.json');
    const { prices } = read('prices.json');
    const known = new Set(products.map((p: { sku: string }) => p.sku));
    expect(prices.filter((p: { sku: string }) => !known.has(p.sku))).toEqual([]);
  });

  it('매핑의 SKU 와 품셈 항목이 서로 맞는다', () => {
    const { products } = read('products.json');
    const { mappings } = read('labor-mappings.json');
    const { items } = read('labor-items.json');
    const knownSku = new Set(products.map((p: { sku: string }) => p.sku));
    const knownItem = new Set(items.map((i: { laborItemId: string }) => i.laborItemId));
    for (const m of mappings) {
      expect(knownSku.has(m.sku), `미지의 SKU ${m.sku}`).toBe(true);
      expect(knownItem.has(m.laborItemId), `미지의 품셈 ${m.laborItemId}`).toBe(true);
    }
  });

  it('제품의 laborMappingId 가 가리키는 매핑이 실제로 있다', () => {
    const { products } = read('products.json');
    const { mappings } = read('labor-mappings.json');
    const known = new Set(mappings.map((m: { laborMappingId: string }) => m.laborMappingId));
    for (const p of products) {
      if (p.laborMappingId !== undefined) {
        expect(known.has(p.laborMappingId), `${p.sku} → 없는 매핑 ${p.laborMappingId}`).toBe(true);
      }
    }
  });

  it('확인된 매핑이 하나도 없다 — 자동 확정 금지 (설계서 §5.3)', () => {
    const { mappings } = read('labor-mappings.json');
    expect(mappings.every((m: { confirmed: boolean }) => m.confirmed === false)).toBe(true);
  });

  it('노임이 21직종이고 M/M 은 CMS 전용 4종뿐이다', () => {
    const w = read('wage-table.json');
    expect(Object.keys(w.wages)).toHaveLength(21);
    const mm = Object.values(w.wages).filter((v) => (v as { unit: string }).unit === 'M/M');
    expect(mm).toHaveLength(4);
  });

  it('요율 0 인 매핑이 없다 — 노무비가 통째로 0원이 된다', () => {
    const { mappings } = read('labor-mappings.json');
    expect(mappings.filter((m: { itemRate: string }) => Number(m.itemRate) === 0)).toEqual([]);
  });
});

describe('민감정보 감사 게이트 (설계서 §8.1, 결정 D1)', () => {
  const files = [
    'products.json', 'prices.json', 'labor-items.json',
    'wage-table.json', 'labor-mappings.json',
  ];

  it.each(files)('%s 에 매입처·영업비고 흔적이 없다', (f) => {
    const text = readFileSync(`data/approved/${f}`, 'utf8');
    for (const pat of [/제조사\s*\/\s*구매처/, /영업비고/, /구매처/, /매입/]) {
      expect(text, `${f} 에 ${pat}`).not.toMatch(pat);
    }
  });

  it.each(files)('%s 에 파일 경로·확장자가 없다', (f) => {
    const text = readFileSync(`data/approved/${f}`, 'utf8');
    for (const pat of [/[A-Z]:\\\\/, /\.xlsx/i, /\.mdb/i]) {
      expect(text, `${f} 에 ${pat}`).not.toMatch(pat);
    }
  });

  it('제품 파일에 대괄호 분류 머리글이 제품으로 섞여 있지 않다', () => {
    const { products } = read('products.json');
    expect(products.filter((p: { quoteName: string }) => p.quoteName.startsWith('['))).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/integration/approvedData.test.ts`
Expected: FAIL — `data/approved/products.json` 없음

- [ ] **Step 3: 스키마 구현**

```ts
// src/data/catalog/schema.ts
/** 승인 데이터 다섯 파일의 런타임 검증. 설계서 §10.1: 런타임 입력 검증은 Zod. */
import { z } from 'zod';

const decimalText = z.string().regex(/^-?\d+(\.\d+)?$/, 'DecimalText 형식이 아님');
const version = z.string().regex(/^[0-9a-f]{12}-\d{8}$/, 'version 은 <sha12>-<YYYYMMDD>');

export const catalogProductSchema = z.object({
  productId: z.string().min(1),
  sku: z.string().min(1),
  brand: z.string(),
  model: z.string(),
  quoteName: z.string().min(1),
  quoteSpec: z.string(),
  unit: z.string().min(1),
  lengthM: decimalText.optional(),
  options: z.record(z.string(), z.string()),
  currency: z.literal('KRW'),
  laborMappingId: z.string().optional(),
  evidence: z.enum(['verified', 'review-required', 'conflicted']),
}).strict();

export const productsSchema = z.object({
  version,
  products: z.array(catalogProductSchema),
}).strict();

export const pricesSchema = z.object({
  version,
  prices: z.array(
    z.object({ sku: z.string().min(1), sellingUnitPrice: decimalText }).strict(),
  ),
}).strict();

export const laborItemsSchema = z.object({
  version,
  items: z.array(z.object({
    laborItemId: z.string().min(1),
    code: z.string().min(1),
    description: z.string(),
    baseUnit: z.string(),
    source: z.string().min(1),
    revision: z.string().min(1),
    trades: z.array(
      z.object({ trade: z.string().min(1), quantity: decimalText }).strict(),
    ).min(1),
  }).strict()),
}).strict();

export const wageTableSchema = z.object({
  wageTableId: z.string().min(1),
  periodLabel: z.string().min(1),
  source: z.string().min(1),
  wages: z.record(z.string(), z.object({
    unit: z.enum(['M/D', 'M/M']),
    wage: decimalText,
  }).strict()),
}).strict();

export const mappingsSchema = z.object({
  version,
  mappings: z.array(z.object({
    laborMappingId: z.string().min(1),
    sku: z.string().min(1),
    laborItemId: z.string().min(1),
    conversionFactor: decimalText,
    surcharge: decimalText,
    itemRate: decimalText,
    confirmed: z.literal(false),
    note: z.string(),
  }).strict()),
}).strict();
```

- [ ] **Step 4: 빌드 스크립트 구현**

```ts
// tools/build-approved.ts
/**
 * `.local/raw/catalog-raw.json` → `data/approved/*.json` 다섯 개.
 *
 * 결정 D3: products 와 prices 를 **분리해서 쓴다**.
 * 설계서 §4.5: 원본 xlsx 는 이 스크립트가 보지 않는다. Python 덤프만 읽는다.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildLabor } from '../src/data/catalog/buildLabor.ts';
import { buildProducts } from '../src/data/catalog/buildProducts.ts';
import { classifyAll } from '../src/data/catalog/classifyRow.ts';
import type { RawDump } from '../src/data/catalog/rawTypes.ts';
import {
  laborItemsSchema, mappingsSchema, pricesSchema, productsSchema, wageTableSchema,
} from '../src/data/catalog/schema.ts';

const RAW = '.local/raw/catalog-raw.json';
const OUT = 'data/approved';

const dump: RawDump = JSON.parse(readFileSync(RAW, 'utf8'));
const version = `${dump.sourceSha256.slice(0, 12)}-${dump.extractedAt.slice(0, 10).replaceAll('-', '')}`;

const classified = classifyAll(dump.rows);
const { products, prices, skipped, duplicateSkus } = buildProducts(classified);
const { wageTable, laborItems, mappings, unmappedSkus } =
  buildLabor(classified, dump.wages, dump.periodLabel);

if (duplicateSkus.length > 0) {
  throw new Error(`SKU 중복 ${duplicateSkus.length}건: ${duplicateSkus.slice(0, 5).join(', ')}`);
}

mkdirSync(OUT, { recursive: true });
const write = (file: string, schema: { parse: (v: unknown) => unknown }, value: unknown) => {
  schema.parse(value);
  writeFileSync(`${OUT}/${file}`, `${JSON.stringify(value, null, 1)}\n`, 'utf8');
};

write('products.json', productsSchema, { version, products });
write('prices.json', pricesSchema, { version, prices });
write('labor-items.json', laborItemsSchema, { version, items: laborItems });
write('wage-table.json', wageTableSchema, wageTable);
write('labor-mappings.json', mappingsSchema, { version, mappings });

console.log(`version      ${version}`);
console.log(`제품         ${products.length}`);
console.log(`판매단가     ${prices.length}  (미등록 ${products.length - prices.length})`);
console.log(`품셈 항목    ${laborItems.length}`);
console.log(`매핑         ${mappings.length}`);
console.log(`품셈 미연결  ${unmappedSkus.length}`);
console.log(`무시된 행    ${skipped}`);
```

- [ ] **Step 5: 실행하고 통과 확인**

```bash
npm run build:catalog
git check-ignore -v data/approved/products.json || echo "추적 가능"
npx vitest run tests/integration/approvedData.test.ts
```

Expected: 빌드가 제품 1300~1468, 판매단가 1400 내외를 출력. 테스트 전부 PASS.

`git check-ignore` 가 `.gitignore` 의 `*원가*` / `*cost*.json` 규칙에 걸린다고 답하면 `.gitignore` 에 `!data/approved/*.json` 예외를 추가한다.

- [ ] **Step 6: 커밋**

```bash
git add src/data/catalog/schema.ts tools/build-approved.ts tests/integration/approvedData.test.ts .gitignore
git add data/approved/products.json data/approved/prices.json data/approved/labor-items.json data/approved/wage-table.json data/approved/labor-mappings.json
git status --short
git commit -m "카탈로그: 승인 데이터 다섯 파일 생성과 감사 게이트"
```

---

### Task 6: 원본 견적서 대조 커버리지 보고

**Files:**
- Create: `tools/catalog_coverage.py`
- Create: `docs/template/catalog-coverage.md`

**Interfaces:**
- Consumes: `data/approved/products.json`, 환경변수 `AVCPQ_NEGO_XLSX` 가 가리키는 평택 견적서
- Produces: 보고 문서. 코드가 소비하는 인터페이스 없음

이 태스크가 답하는 질문: **이 카탈로그로 실제 견적서를 재현할 수 있는가.** 평택 견적서의 148개 품목 행이 카탈로그에서 몇 개나 찾아지는지 센다. 적중률이 낮으면 단계 3 의 ProductPicker 가 쓸모없다는 뜻이고, 그 사실을 UI 를 만들기 **전에** 알아야 한다.

원본이 없는 환경에서는 건너뛴다(설계서 §4.5: 원본 접근 불가 시 해당 검증은 미완료로 기록).

- [ ] **Step 1: 대조 스크립트 작성**

```python
# tools/catalog_coverage.py
"""평택 견적서 품목이 추출한 카탈로그에서 찾아지는지 센다.

설계서 §4.5: 원본은 읽기 전용. 결과 문서에 실제 금액을 쓰지 않는다 — 건수만 센다.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

import openpyxl

SKIP_WORDS = ('직접비', '간접', '합계', '소계')


def norm(s: str | None) -> str:
    return re.sub(r'\s+', '', (s or '')).lower()


def main() -> int:
    src = os.environ.get('AVCPQ_NEGO_XLSX')
    if not src or not Path(src).is_file():
        print('AVCPQ_NEGO_XLSX 미설정 — 대조를 건너뜁니다 (설계서 §4.5).', file=sys.stderr)
        return 1

    products = json.loads(
        Path('data/approved/products.json').read_text(encoding='utf-8')
    )['products']
    by_name: dict[str, list[dict]] = {}
    for p in products:
        by_name.setdefault(norm(p['quoteName']), []).append(p)

    wb = openpyxl.load_workbook(src, data_only=False, read_only=True)
    rows: list[tuple[str, str, str]] = []
    for ws in wb.worksheets:
        if ws.title == '갑지':
            continue
        for r in range(7, ws.max_row + 1):
            b = ws.cell(r, 2).value
            if not b:
                continue
            s = str(b).strip()
            if s.startswith('[') or any(w in s for w in SKIP_WORDS):
                continue
            rows.append((ws.title, s, str(ws.cell(r, 3).value or '').strip()))
    wb.close()

    exact = [x for x in rows if norm(x[1]) in by_name]
    missing = [x for x in rows if norm(x[1]) not in by_name]

    print(f'견적서 품목 {len(rows)}개')
    print(f'  품명 완전일치 {len(exact)}개 ({len(exact) * 100 // max(len(rows), 1)}%)')
    print(f'  미발견        {len(missing)}개')
    print()
    print('미발견 품명 (최대 40개):')
    for sheet, name, spec in missing[:40]:
        print(f'  [{sheet}] {name}  |  {spec}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
```

- [ ] **Step 2: 실행하고 적중률 확인**

```bash
export AVCPQ_NEGO_XLSX="<평택 견적서 경로>"
mkdir -p .local
python tools/catalog_coverage.py | tee .local/coverage.txt
```

Expected: 적중률 숫자가 나온다. 목표치는 정하지 않는다 — **측정이 목적**이다.

- [ ] **Step 3: 보고 문서 작성**

`docs/template/catalog-coverage.md` 에 다음을 적는다. **실제 금액은 쓰지 않는다.**

- 측정일, 대조한 견적서 SHA-256, 카탈로그 version
- 견적서 품목 수 / 완전일치 수 / 적중률
- 미발견 품명 목록과 각각의 분류:
  - 카탈로그에 실제로 없는 제품
  - 이름 표기가 달라서 못 찾은 것 (띄어쓰기·약어·모델명 위치)
  - 견적서에만 있는 공사 항목 (배관·배선·시공비 등 제품이 아닌 것)
- 적중률이 낮다면 **단계 3 ProductPicker 설계에 미치는 영향**을 한 문단으로 적는다. 이름 불일치가 주원인이면 검색을 완전일치가 아니라 부분일치·초성 검색으로 설계해야 한다.

- [ ] **Step 4: 커밋**

```bash
git add tools/catalog_coverage.py docs/template/catalog-coverage.md
git commit -m "카탈로그: 평택 견적서 대조 커버리지 측정"
```

---

## 이 계획이 끝나면

산출물:

```
data/approved/products.json        제품 (가격 없음)
data/approved/prices.json          판매단가 (분리 — 결정 D3)
data/approved/labor-items.json     품셈 항목
data/approved/wage-table.json      26년 상반기 노임 21직종 (M/D·M/M 구분)
data/approved/labor-mappings.json  SKU ↔ 품셈 (전부 confirmed:false)
docs/template/catalog-coverage.md  실제 견적서 대조 결과
```

열리는 것: 설계서 §11 **단계 3**(ProductPicker 가 쓸 데이터가 생김), **단계 4**(품셈·일위대가 화면의 데이터가 생김).

이 계획이 하지 않는 것:

- 간접비 시트 2개(`간접비_DS`, `간접비_SDC, SDI`) 추출 — 발주처별 프로파일 모델링이 필요하다. 별도 계획.
- **샘플 견적서 가져오기** — 사용자가 회의실(4인·22인·42인)·상황실·대강당 등 **실제 견적서 파일을 올려주기로 했다**. 견적서 xlsx → `QuoteDocument` 변환기는 별도 계획이며, 파일을 받은 뒤 착수한다. 샘플을 상상해서 만들지 않는다.
- 연동 항목 표 (결정 D5) — **사용자에게 질문 후** 착수. 임의로 만들지 않는다.
- UI. 이 계획은 데이터만 만든다.

## 남은 결정

| 항목 | 상태 |
|---|---|
| 샘플 견적서 | **사용자가 파일 올려주기로 함** — 받으면 변환기 계획 작성 |
| 연동 항목 표 내용 (결정 D5) | **사용자 — 반드시 질문할 것** |
| 간접비 발주처 프로파일 (`_DS` vs `_SDC, SDI`) 적용 규칙 | 사용자 |
| 간접비 28~30행(연금·건강·노인장기요양) 상수 처리 | 사용자 |
| 배포 방식 (결정 D6) | 단계 8 로 유보 |
