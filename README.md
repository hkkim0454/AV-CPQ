# AV 견적 프로그램

교육장·회의실·강당 등의 AV 시스템 견적을 웹에서 작성하고, **수식이 살아 있는 Excel**을
내려받는다. 다운로드 후 Excel에서 계산·행 정리·서식 복구를 하지 않아도 되는 것이 목표다.

요구사항 기준 문서는 [`docs/design-spec.md`](docs/design-spec.md)다.
그보다 뒤에 내린 결정은 [`docs/decisions/`](docs/decisions/)가 우선한다.

---

## 빠르게 보기

```bash
npm install
npm run verify        # 타입 검사 + 테스트 + 원가 격리 감사
npm run dev           # 개발 서버
```

생성된 견적 Excel을 직접 보려면:

```bash
npx vitest run tests/integration     # tests/fixtures/out/*.xlsx 를 만든다
```

| 파일 | 내용 |
|---|---|
| `tests/fixtures/out/synthetic-quote.xlsx` | 2시스템, 파생 행, 간접비 9항목 |
| `tests/fixtures/out/long-quote.xlsx` | 100행 다페이지 (합성 품명) |
| `tests/fixtures/out/catalog-quote.xlsx` | 100행 다페이지 (**실제 카탈로그 품명**) |
| `tests/fixtures/out/internal-quote.xlsx` | 원가 포함 내부용 |

전부 합성 금액이다. 실제 매입 원가가 들어 있지 않다.

---

## 지원 Excel 환경

검증한 환경 — **이 환경에서 실제로 열어 재계산하고 인쇄 설정을 확인했다.**

| | |
|---|---|
| Excel | Microsoft 365 / Excel 16.0 (build 16.0.20430.20092) |
| 언어 | **ko-KR** |
| 아키텍처 | x64 |
| OS | Windows 11 |

### ko-KR가 중요한 이유

갑지의 금액 문구가 `NUMBERSTRING` 함수를 쓴다. **문서화되지 않은 한국어 전용 함수**다.

```
=“일금”&NUMBERSTRING(H18,1)&“원정(\”&TEXT(H18,"###,##0")&“) V.A.T별도”
```

다른 언어판 Excel에서는 이 함수가 `#NAME?`가 될 수 있다. 추측하지 않고 실제 Excel에서
22개 값을 측정해 `tests/unit/koreanAmount.test.ts`에 고정했다.

통화 기호도 같은 이유로 둘이다. 원본은 `\`(U+005C)를 쓰고 **한국어 Windows에서만**
글꼴 매핑으로 `₩`로 보인다. 웹 화면은 `₩`(U+20A9)를 쓴다
(`koreanAmountSentenceForWeb`). 숫자 변환 코드는 양쪽이 공유한다.

### Excel이 없으면

Excel 출력의 **최종 검증은 할 수 없다.** 설계서 §11 단계 7이 못박은 사항이다 —
브라우저 테스트로 대체하지 않는다. 도메인·계산·추출은 Excel 없이도 전부 돌아간다.

---

## 데이터 준비

### 배포 데이터 (`data/approved/`)

커밋되어 있다. 다시 만들 필요는 보통 없다.

| 파일 | 내용 | 개수 |
|---|---|---|
| `products.json` | 제품 — **가격 없음** | 1,468 |
| `prices.json` | 판매단가만 | 1,444 |
| `labor-items.json` | 품셈 항목 | 1,331 |
| `wage-table.json` | 노임 (26년 상반기) | 21직종 |
| `labor-mappings.json` | SKU ↔ 품셈 연결 | 1,331 |

**제품과 가격을 일부러 나눠 두었다** (결정 D3). 나중에 "판매가는 공개하지 말자"로
바뀌면 `prices.json`을 배포에서 **빼기만 하면 된다.** 코드를 고치지 않는다.
앱은 해당 단가를 `미등록`으로 표시하고, 사용자가 품셈 파일을 올리면 채운다.

빼고 빌드해도 성공한다. 경고만 남는다:

```
배포 데이터 4개 복사: labor-items.json, labor-mappings.json, products.json, wage-table.json
  빠진 선택 파일: prices.json — 앱은 해당 단가를 '미등록'으로 표시한다 (결정 D3)
```

### 다시 만들어야 할 때

품셈 파일이 개정되면 두 단계를 거친다. **원본 xlsx는 저장소에 넣지 않는다.**

```bash
# 1) 원본 → 원시 덤프 (.local/, git 제외)
python tools/extract_catalog.py --source "<품셈 파일.xlsx>" .local/raw/catalog-raw.json

# 2) 원시 덤프 → 배포 데이터 (감사 게이트 통과해야 쓴다)
npm run build:approved
```

추출기는 **M열(제조사/구매처)·N열(영업비고)을 읽지 않는다.** 금지 목록을 두고 거르는
방식이 아니라, 읽을 열만 적는 allowlist다. 그 인덱스가 코드 어디에도 없다.

`npm run build:approved`는 쓰기 전에 감사한다. 매입처·로컬 경로·URL·이메일이
하나라도 나오면 **아무것도 쓰지 않고 멈춘다.**

> ⚠ **SKU는 시트 + 원본 행 번호다** (`CBL-0006`). 원본 행이 밀리면 SKU가 바뀐다.
> 품셈 파일을 개정하면 기존 견적 문서의 SKU 대조표가 필요하다.
> 품명 기반 SKU를 쓰지 않는 이유는 원본에 품명·규격이 완전히 같은 행이 연달아 있기 때문이다.

### Excel 템플릿 (`templates/sanitized/`)

커밋되어 있다. 원본 견적서에서 데이터·외부링크·고객정보를 제거한 빈 양식이다.
`xl/styles.xml`·`theme`·`drawings`(회사 직인)·`media`는 **바이트 그대로** 옮겼다.

다시 만들려면:

```bash
python tools/build_template.py templates/sanitized/quote-template.xlsx
python tools/audit_xlsx.py templates/sanitized/quote-template.xlsx
```

---

## 검증

```bash
npm run verify        # 타입 검사 + 테스트 + 원가 격리 감사
```

### 테스트만으로는 부족하다

이 프로젝트에서 **세 번** 겪었다.

| 무엇 | 테스트 | 실제 |
|---|---|---|
| 품 열 수식 585건 | 통과 | 제품 1/3의 노무비가 0이 될 뻔 |
| 내부용 판매단가 열 | 통과 (12개) | 열이 통째로 비어 있었다 |
| 규격 칸 줄바꿈 112건 | 통과 | 둘째 줄이 인쇄물에서 사라질 뻔 |

셋 다 **터지지 않고 조용히 틀리는** 종류였고, 셋 다 **원본 데이터의 형태를 안 봐서**
생겼다. 둘째는 `tsc`가, 나머지는 실제 데이터로 돌려봐서 잡았다.

> 틀린 값은 테스트가 잡지만, **없는 값은 테스트가 애초에 쳐다보지 않는다.**

### 실제 Excel 검증

```powershell
powershell -File tools\verify_in_excel.ps1 <파일.xlsx> [기대값.json]
```

한 번에 9가지를 본다 — 복구 경고, 숨김 시트, 외부 링크, 수식 오류, 웹↔Excel 금액 대조,
다페이지 머리글 반복·가로 분할·병합 셀 분단, 인쇄 영역 범위, 행 잘림, 편집 후 재계산.

### 원가 격리 감사

```bash
npm run audit:exports
```

정적으로 막는 것:

- 고객용·도메인 경로가 `services/private-cost`를 import하는가
- 원가를 만질 수 있는 모듈이 `localStorage` 등에 닿는가
- **화면이 견적 문서를 브라우저에 영속 저장하거나 외부 origin으로 보내는가**
- `eval` / `new Function` / dynamic import
- `calculateQuote`·`buildCustomerProjection`이 `PrivateCostSession`을 받는가

---

## 원가를 다루는 방식

매입 원가는 **사용자 PC의 파일에서 읽어 브라우저 메모리에만** 둔다.

- 네트워크로 보내지 않는다. 외부 AI에 올리지 않는다.
- `localStorage`·`IndexedDB`·작업 파일에 저장하지 않는다.
- 세션 객체는 `#private` 필드를 쓰고 `toJSON`을 재정의해, 실수로 직렬화돼도
  원가가 아니라 표식만 나간다.
- 원가표 **파일명도 담지 않는다**.
- 새로고침하면 사라진다. 다시 쓰려면 파일을 다시 고른다.

고객용 Excel과 내부용 Excel은 **별도 exporter**다. 방향이 한쪽뿐이다 —
고객용에 원가 시트를 *덧붙여* 내부용을 만든다. 내부용에서 뭔가를 지워 고객용을
만드는 경로는 코드에 없다. 지우는 방식은 하나만 빠뜨려도 원가가 고객에게 간다.

자세한 것은 설계서 §8과 [`docs/template/verification.md`](docs/template/verification.md) §6.

---

## 남은 제한

설계서 §13-9: "구현 계획에 나열된 기능을 완료 사실로 보고하지 않는다."

### 아직 못 한 검증

- **원본과 인쇄 서식 1:1 시각 대조.** 인쇄 영역·방향·배율·반복 머리글·페이지 수·
  행 잘림은 기계로 확인했다. 머리글·병합·폰트·테두리·열너비를 원본 출력물과
  나란히 놓고 보는 것은 **사람 눈이 필요하다.** 기계로 할 수 없는 유일한 항목이다.
- **Playwright E2E · CSP · 번들 의존성 검토.** 화면이 있어야 돈다.

### 알려진 차이

- **규격 칸이 두 줄인 제품 112건은 한 줄로 합쳐져 보인다.** 글자가 빠진 것이 아니라
  줄이 합쳐진 것이다. 그대로 두면 고정 행 높이(21pt) 때문에 둘째 줄이 **아예 안 보인다.**
  바꾸려면 `wrapText` + 가변 행 높이가 필요하고, 원본 서식 보존 전제를 재검토해야 한다.
  ([`verification.md`](docs/template/verification.md) §7.1)

### 범위 밖

- **부자재 자동 추천** (설계서 §7, 인수기준 A05). 포트 데이터가 어느 원본에도 없다.
  코드는 `src/domain/accessories/`에 있지만 **비활성**이다. 결정 D4.
- 실시간 협업 · 서버 견적 저장 · CRM · ERP · 전자결재 · 외부 AI 추천.

### 사용자 결정 대기

| | 내용 |
|---|---|
| 연동 항목 표 | "UTP 전송기 → UTP 케이블 필수" 같은 표. 내용은 사용자가 작성한다 (결정 D5) |
| 카탈로그 보충 18건 | 평택 견적서에 있는데 카탈로그에 없는 제품 ([`catalog-coverage.md`](docs/catalog-coverage.md)) |
| 브랜드 | 원본에 브랜드 열이 없다. 1,468건 전부 미상 |
| 간접비 발주처 프로파일 | `간접비_DS` / `간접비_SDC, SDI` 두 시트 |
| 샘플 견적 내용 | 사용자가 실제 견적서를 제공하기로 했다 |
| 배포 방식 | 결정 D6 — 미정 |

---

## 문서

| 문서 | 내용 |
|---|---|
| [`docs/design-spec.md`](docs/design-spec.md) | 설계서. 요구사항 기준 |
| [`docs/decisions/`](docs/decisions/) | 설계서 이후의 결정. **설계서보다 우선** |
| [`docs/stage-status.md`](docs/stage-status.md) | 단계별 상태, 열린 항목 |
| [`docs/template/verification.md`](docs/template/verification.md) | **Excel 검증 기록 — 인수 보고의 단일 창구** |
| [`docs/template/mapping.md`](docs/template/mapping.md) | 원본 Excel ↔ 생성기 매핑 |
| [`docs/design/reference-map.md`](docs/design/reference-map.md) | RTCOM·LED 디자인 토큰 |
| [`docs/catalog-coverage.md`](docs/catalog-coverage.md) | 실제 견적서 대조 커버리지 |

---

## 구조

```
src/
  domain/        견적 문서 · 계산 · 품셈 · (부자재: 비활성)
  export/
    customer/    고객용 allowlist projection
    internal/    내부용 (원가 포함)
    ooxml/       템플릿 패치 · 수식 · 레이아웃
  services/
    private-cost/  원가 메모리 세션
  data/catalog/  카탈로그 빌드 · 스키마 · 감사
  features/      화면 (단계 3)
tools/           추출 · 템플릿 생성 · 감사 · Excel 검증
templates/sanitized/   정리된 빈 Excel 양식
data/approved/   배포 데이터
```
