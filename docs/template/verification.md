# 템플릿·Excel 출력 검증 기록 (설계서 §9.2, §9.7, §11 단계 1)

검증 환경: Microsoft 365 / Excel 16.0 (build 16.0.20430.20092) / ko-KR / x64 / Windows 11
검증일: 2026-10-03
검증 방법: PowerShell + Excel COM (`tools/verify_in_excel.ps1`). 브라우저 테스트로 대체하지 않았다.

---

## 1. exporter 방식 선정 — 실패한 방식과 이유

설계서 §9.2는 "라이브러리 이름만으로 원본 100% 보존을 가정하지 않는다"고 하고,
§11 단계 1은 "실패한 방식과 이유 기록"을 요구한다. 아래는 실측 결과다.

### 1.1 기각 — openpyxl 왕복 저장

원본을 openpyxl로 읽어 값만 비우고 저장한 파일을 Excel이 **열지 못했다**.

```
파일 형식 또는 파일 확장명이 잘못되어 'quote-template.xlsx' 파일을 열 수 없습니다.
```

openpyxl은 `xl/styles.xml`을 재생성하고 `customXml/*`·`printerSettings/*`를 버리며,
원본의 서식 조합을 그대로 보존한다고 보장하지 않는다.
설계서 §9.2의 "일반 라이브러리의 왕복 저장이 기준을 통과하지 못하면 제한된 템플릿 패치
방식을 사용한다"에 해당해 **기각**했다.

openpyxl은 지금도 `tools/inspect_xlsx.py`·`tools/inspect_styles.py`의 **읽기 전용 분석**에만 쓴다.

### 1.2 기각 — ElementTree로 원본 XML 재직렬화 (접두사 보존 실패)

ZIP 수준 수술로 바꾼 뒤에도 Excel이 파일을 거부했다. 원인을 bisect로 좁혔다.

`xml.etree.ElementTree`는 **등록하지 않은 네임스페이스 접두사를 `ns0`, `ns1` …로 바꿔 쓴다.**
원본 워크시트 루트는 이렇게 생겼다.

```xml
<worksheet xmlns="…/spreadsheetml/2006/main"
           xmlns:mc="…/markup-compatibility/2006"
           mc:Ignorable="x14ac xr xr2 xr3"
           xmlns:x14ac="…" xmlns:xr="…" xmlns:xr2="…" xmlns:xr3="…">
```

`mc:Ignorable`은 **속성 값 안에서 접두사를 문자열로 참조**한다. ET가 `x14ac`를 `ns2`로
바꾸면 `mc:Ignorable="x14ac …"`가 존재하지 않는 접두사를 가리키게 되고, 파일이 깨진다.

**해결:** 재작성하는 파트에서 개정·호환성 네임스페이스(`mc`, `x14ac`, `xr*`, `x15`, `xcalcf`)를
**통째로 제거**한다. 이것들은 Excel 공동 편집의 개정 추적용이고 서식·수식과 무관하다.
남기는 네임스페이스는 spreadsheetml 본체와 관계(`r:`)뿐이다.

### 1.3 채택 — 템플릿 OOXML 패치

- **준비(오프라인, Python stdlib):** `tools/build_template.py`가 원본을 읽기 전용으로 열어
  ZIP 수준에서 정리된 빈 템플릿을 만든다. `styles.xml`·`theme`·`drawings`·`media`는
  **바이트 그대로** 옮긴다.
- **런타임(브라우저, TypeScript):** `src/export/ooxml/`이 템플릿 ZIP을 풀고 모델 행의
  `s=` 스타일 인덱스를 복제해 `sheetData`를 새로 쓴다. `styles.xml`은 손대지 않는다.

---

## 2. 생성 중 발견해 고친 결함

| # | 증상 | 원인 | 고친 곳 |
|---|---|---|---|
| D1 | Excel이 파일 형식 오류로 거부 | 파트마다 XML 선언이 **두 번** 들어감 (`XML_DECL` + 파서가 보존한 선언) | `workbook.ts` `serializeWithDeclaration()` |
| D2 | Excel이 파일을 열지 못함 | `[Content_Types].xml`이 ZIP의 **마지막** 엔트리였다. OPC는 첫 엔트리를 요구한다 | `workbook.ts` — 첫 엔트리로 고정 |
| D3 | Excel이 파일을 열지 못함 | `pageSetup r:id`가 **버린** `printerSettings*.bin`을 가리키는 끊긴 관계 | `build_template.py` — rels와 `r:id` 동시 제거 |
| D4 | Excel이 파일을 열지 못함 | ET가 `mc`/`x14ac`/`xr*` 접두사를 바꿔 `mc:Ignorable` 참조가 끊김 | `build_template.py` `strip_foreign_namespaces()` |
| D5 | 갑지의 **회사 직인 이미지 유실** | 워크시트 rels를 버려 `<drawing>`이 끊김 | `template.ts`/`sheetBuilder.ts`/`workbook.ts` — drawing·rels·media 보존 |
| D6 | 접두사 미정의 XML | TS 빌더가 `xmlns:r`를 선언하지 않고 `<drawing r:id>`를 내보냄 | `sheetBuilder.ts` |
| D7 | 갑지 합계가 구역 머리글 행부터 합산 | `firstBodyRow`를 그룹 행에서 잡음. 원본은 `SUM(H11:H15)`로 머리글 제외 | `layout.ts` |

전부 회귀 테스트로 고정했다 (`tests/integration/exportWorkbook.test.ts`).

---

## 3. 템플릿 민감정보 감사

`tools/audit_xlsx.py`가 ZIP 전체를 검사한다. 원본이 끌고 다니던 **실제 누출 3종**을 발견해 제거했다.

| # | 위치 | 내용 |
|---|---|---|
| L1 | `xl/externalLinks/_rels/externalLink1.xml.rels` | 링크 경로에 고객사명·프로젝트명 |
| L2 | `docProps/custom.xml` | 이전 작성자 PC 경로(`C:\Users\<이름>\…`)와 과거 프로젝트 파일명 |
| L3 | `xl/workbook.xml` `definedNames` **198개** | 과거 고객사 통합문서 참조(`{"Book1","…​.xls"}`)와 하드코딩된 노임 상수 |

L3은 수십 년간 견적서를 복사해 쓰면서 누적된 것으로 보인다. 인쇄 영역 밖이라 눈에 띄지 않는다.
감사 스크립트는 이제 이 셋을 **내장 패턴**으로 항상 검사한다 (sentinel 목록과 무관하게).

감사 결과: `=== FINDINGS === none`

템플릿 최종 구성 (14 파트):

```
[Content_Types].xml          _rels/.rels                docProps/app.xml
docProps/core.xml            xl/workbook.xml            xl/_rels/workbook.xml.rels
xl/worksheets/sheet1.xml     xl/worksheets/sheet2.xml   xl/worksheets/_rels/sheet1.xml.rels
xl/styles.xml                xl/theme/theme1.xml        xl/drawings/drawing1.xml
xl/drawings/_rels/drawing1.xml.rels                     xl/media/image1.png
```

버린 파트: `sharedStrings.xml`(고객 데이터 573건), `calcChain.xml`, `externalLinks/*`,
`customXml/*`, `docProps/custom.xml`, `printerSettings/*`, 쓰지 않는 시트 4장.

---

## 4. 생성물 검증 결과

대상: `tests/fixtures/out/synthetic-quote.xlsx` — 합성 견적 2시스템, 그룹 머리글·설명 행·
파생 행(배관 기타자재·잡자재비)·간접비 9항목 포함. **실제 가격을 쓰지 않았다.**

### 4.1 열기·구조

```
시트 3장
  '갑지'        printArea=$A$1:$J$18  orient=landscape  pages=1  shapes=1(회사 직인)
  '교육장 영상'  printArea=$A$1:$K$28  titles=$1:$3      pages=1
  '교육장 음향'  printArea=$A$1:$K$21  titles=$1:$3      pages=1
외부 링크: 없음
수식 오류 셀: 0
```

복구 경고 없이 열렸다 (`CorruptLoad=xlNormalLoad`로 열어 손상이면 예외가 나도록 했다).

### 4.2 웹 계산 ↔ Excel 재계산 대조

**59개 셀 전부 일치.** 대조 대상:

- 품목 행 재료비 금액 / 노무비 금액 / 합계
- 직접비계 G·I·J
- 간접비 9행 각각의 금액
- 간접비계, 시스템 합계
- 갑지 시스템별 금액, 절사액, NEGO, 최종 합계

### 4.3 편집 후 재계산 (인수 기준 A09)

Excel에서 첫 품목 수량을 2 → 3으로 바꾸고 전체 재계산했다.

```
행 금액 G7 = 4,500,000      (= 3 × 1,500,000)
갑지 최종  = 9,210,000      (편집 전 7,330,000)
한글 금액  = 일금구백이십일만원정(\9,210,000) V.A.T별도
```

수량 → 행 금액 → 직접비계 → 간접비 → 시스템 합계 → 갑지 → 만원 미만 절사 → NEGO →
최종 합계 → **한글 금액**까지 수식 연쇄가 전부 살아 있다.
한글 금액을 정적 문자열로 바꾸지 않았다는 것이 여기서 확인된다 (설계서 §9.4).

### 4.4 NUMBERSTRING 호환성 (설계서 §9.4)

`NUMBERSTRING`은 문서화되지 않은 함수라 추측하지 않고 **실제 Excel에서 22개 값을 측정**해
`tests/unit/koreanAmount.test.ts`에 고정했다. 웹 구현이 22개 전부 일치한다.

| 입력 | Excel `NUMBERSTRING(n,1)` |
|---|---|
| 0 | 영 |
| 10 | 일십 |
| 110 | 일백일십 |
| 10001 | 일만일 |
| 266000000 | 이억육천육백만 |
| 1234567890 | 일십이억삼천사백오십육만칠천팔백구십 |
| 1000000000000 | 일조 |

---

## 5. 아직 하지 않은 검증

설계서 §13-9: "구현 계획에 나열된 기능을 완료 사실로 보고하지 않는다."

- [ ] **원본과 인쇄 서식 1:1 대조** — 머리글·병합·폰트·테두리·열너비·행높이를
      원본 출력물과 나란히 놓고 사람이 확인하는 단계. 인쇄 영역·방향·배율·반복 머리글은
      기계적으로 확인했으나 시각 대조는 미완료.
- [ ] **100행 규모 다페이지 출력** — 현재 합성 견적은 시스템당 1페이지다.
      페이지 나눔·반복 머리글·행 잘림은 다페이지에서만 드러난다.
- [ ] **내부용(원가 포함) exporter** — 아직 구현 전 (설계서 §8.7).
- [ ] **품셈 데이터 연결** — 합성 노무 단가로만 검증했다. 실제 품셈·노임 추출은 단계 4.
