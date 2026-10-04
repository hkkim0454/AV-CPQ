# P2-1 — 편집 후 전 단계 독립 기대값 대사 실행 기록

독립 검토 P2-1: "편집 후 전 단계 독립 기대값 대사"를 수행한 실행을 실행별로
기록한다. **독립 기대값**이란 Excel이 계산한 숫자를 그대로 베낀 것이 아니라,
도메인 계산 엔진(`src/domain/calculation/calculate.ts`의 `calculateQuote` 등)을
**별도로 다시 호출**해서 얻은 값을 뜻한다 — 생성기가 자기 출력과 자기를
비교하는 동어반복을 피하기 위해서다.

각 항목은 다음을 적는다: 대상 커밋, 입력(합성 데이터 요약), 실행 명령,
산출물 경로, 결과(통과/실패, 수식 오류 셀 수, 대조한 셀 수). 실제 원가·거래처
자료는 쓰지 않는다(설계서 §8.4) — 전부 승인된 합성 카탈로그다.

## 이미 수행한 실행 (다중 시스템 조립, 2026-10-04)

### 실행 1 — 일반×2 (기반/1단계 상당)
- 대상 커밋: `8d31bd5`
- 입력: `pickedItemsToQuote`로 시스템 2개(회의실/대회의실), 각 4개 품목, profile='general' 둘 다
- 명령: `npx vite-node .local/probe_multi_same.ts`(임시 스크립트, 실행 후 삭제) → `powershell` Excel COM 수동 확인
- 산출물: `.local/out/multi-system/general-x2.xlsx`
- 결과: 시트 3장(갑지·세부내역·세부내역2), 수식 오류 셀 **0개**, 갑지 H13 = `ROUNDDOWN(SUM(H11:H12),-3)` = 12,489,000(독립 계산과 일치)

### 실행 2 — DS×2 (기반/1단계 상당)
- 대상 커밋: `8d31bd5`
- 입력: 위와 동일, profile='ds' 둘 다
- 산출물: `.local/out/multi-system/ds-x2.xlsx`
- 결과: 수식 오류 셀 0개, 갑지 H13 = 13,119,000

### 실행 3 — 일반+DS 혼합 (기반/1단계 상당)
- 대상 커밋: `8d31bd5`, `081ea23`(스타일 선언 중복 결함 수정)
- 산출물: `.local/out/multi-system/general-ds-mixed.xlsx`
- 결과: 수식 오류 셀 0개. **실제 결함 발견**: 같은 프로파일 경로(실행 1·2)는
  스타일표 병합이 전혀 안 일어나 `styles.xml`에 XML 선언이 두 번 들어가는
  결함이 있었다 — Excel이 파일 자체를 못 열었다("Workbooks 클래스 중
  Open 속성을 구할 수 없습니다"). `081ea23`에서 수정, 회귀 시험 추가.
  편집 재계산: DS 세부내역(세부내역2)의 F6 수량을 1 → 1001로 편집 →
  갑지 H13 19,238,000 → 6,385,319,000 로 전파 확인(수식 연쇄가 다른
  프로파일 시트를 건너 갑지까지 닿는다는 뜻).

### 실행 4 — 2단계(고객용) 혼합
- 대상 커밋: `f7d9cfa`
- 산출물: `.local/out/multi-system/general-ds-mixed-level2.xlsx`
- 결과: 수식 오류 셀 0개, `UsedRange` 가 두 세부내역 시트 모두 K열에서
  끝남(금지 열 삭제 확인), 합계 19,238,000 — 삭제 전/후 금액 불변 확인.

### 실행 5 — 0단계(원가) 혼합
- 대상 커밋: `081ea23`
- 산출물: `.local/out/multi-system/general-ds-mixed-level0.xlsx`
- 결과: 수식 오류 셀 0개, 합계 19,238,000(0/1/2단계 전부 동일 — 등록된
  원가가 없으므로 판매측 금액이 불변인 것이 기대값이다).

### 실행 6 — 경계: 큰 시스템(품목 40줄) + 작은 시스템(품목 1줄) 혼합
- 대상 커밋: `8d31bd5`
- 입력: 시스템1(일반) 품목 40줄, 시스템2(DS) 품목 1줄
- 산출물: `.local/out/multi-system/boundary-40-1.xlsx`
- 결과: 수식 오류 셀 0개. 갑지 H11=51,885,295, H12=6,372,451,
  H13=ROUNDDOWN(58,257,746,-3)=58,257,000 — 독립 계산과 일치.
  시스템1 grandTotalRow=56, 시스템2 grandTotalRow=19 — 비대칭 행 밀림이
  서로 간섭하지 않음을 확인.

### 실행 7 — P2-2 재검증(도형 제거·비고란 연결 후)
- 대상 커밋: `e4d4d24`
- 산출물: `.local/out/multi-system/pages/general-ds-mixed-level0_p{1,3,4}.png`
- 결과: DS 세부내역의 설명 도형이 사라짐(겹침·잘림 없음), 갑지 비고란이
  빈 조건에서 빈 칸으로 나감(플레이스홀더 문구 없음), Excel COM 수식
  오류 0개, C19 텍스트 `''`.

## 실행 8~11 — 편집 시나리오별 독립 재계산 대사 (단일 시스템, 일반/DS)

도구: `tools/probe_edit_scenarios.ts`(도메인 입력을 바꿔 `calculateQuote`/
`calculateLaborForRows`를 다시 불러 독립 기대값을 만든다) +
`tools/verify_in_excel.ps1 -EditScenarios`(그 기대값에 대응하는 칸 하나를
Excel에서 편집 → 재계산 → 전부 대조 → 되돌림).

- 대상 커밋: `(이 보고 직후 커밋)`
- 입력: 승인된 합성 카탈로그, 품목 6개(XDM-12 기준 제품 + 품셈 연결된
  제품 5개), profile='general'(`won`→`pumsem`) 및 'ds'(`ds-won`→`ds`)
- 명령:
  ```
  npx vite-node tools/probe_edit_scenarios.ts
  powershell -File tools/verify_in_excel.ps1 -Path .local/out/edit-scenarios/general.xlsx \
    -Expected .local/out/edit-scenarios/general.expected.json \
    -LayoutManifest .local/out/edit-scenarios/general.layout.json \
    -EditScenarios .local/out/edit-scenarios/general.scenarios.json
  (ds.xlsx 도 동일)
  ```
- 산출물: `.local/out/edit-scenarios/{general,ds}.{xlsx,expected.json,layout.json,scenarios.json}`
- 시나리오 4종(각각 독립 재계산 기대값 39칸(일반)/41칸(DS)과 대조):
  1. **수량 편집** — 품목 행 수량 1→38(도메인: `row.quantity` 변경)
  2. **직종 공수 0→양수 편집** — 품셈 항목에 없던 직종에 품 0→2 추가
     (도메인: `LaborItem.trades[]`에 새 항목 추가, `labor-items.json`이 아니라
     읽어들인 참조 객체를 복제해서 바꾼다 — 실제 파일은 안 건드린다)
  3. **노임 편집** — 노임표의 한 직종 단가 +50,000(도메인: `WageTable.wages[trade]`)
  4. **간접비 적용률 편집** — 간접비 규칙 하나의 rate +0.02(도메인:
     `IndirectCostRule.rate`)
- 결과: **둘 다 `=== 통과 ===`.** 수식 오류 셀 0개, 4개 시나리오 전부
  39/41칸 대조 통과.
- **실제로 찾아 고친 결함 1 — COM `Value2` 캐스트 불안정**: 되돌리기
  단계에서 문자열("1", "324979", "0.06")을 `.Value2`에 대입하면
  "지정한 캐스트가 잘못되었습니다"로 간헐적으로 터졌다. `[double]`로
  파싱해서 대입하도록 고쳤다(`tools/verify_in_excel.ps1`).
- **실제로 찾아 고친 결함 2 — PowerShell 변수명 대소문자 충돌**:
  `-EditScenarios` 매개변수와 지역 변수 `$editScenarios`가 대소문자만
  달라 **같은 변수**였다 — 지역 변수 초기화가 매개변수 값을 지워
  `if ($EditScenarios)`가 항상 거짓이 됐다. `$scenariosData`로 이름을
  바꿨다.
- **실제로 찾아 고친 결함 3 — 함수 반환값의 출력 스트림 오염**:
  `Compare-Expected`가 COM 호출 결과를 `return`하자 PowerShell이
  "함수의 전체 출력 스트림"을 반환값으로 묶어 배열이 됐다(`$scenarioChecked
  += $checked`가 "System.Object[]에 op_Addition 없음"으로 실패). 기존
  `Read-JsonFile`과 같은 패턴(`$script:compareChecked`)으로 고쳤다.

## 실행 12 — 혼합 시스템(일반+DS) 수량 편집 → 독립 재계산 대사

- 대상 커밋: `(이 보고 직후 커밋)`
- 입력: 시스템1(일반) 품목 4개, 시스템2(DS) 품목 4개
- 명령: 위와 같되 `.local/out/edit-scenarios/mixed.{xlsx,scenarios.json,layout.json}`
- 시나리오: 시스템2(DS)의 첫 품목 수량 2→43 편집. 독립 기대값 4칸 —
  (a) DS 세부내역 자신의 직접재료비·합계, (b) **건드리지 않은 시스템1의
  합계가 그대로인지**, (c) 갑지의 **합산** 최종 금액.
- 결과: **`=== 통과 ===`**, 4/4칸 대조.
- **실제로 찾아 고친 결함 4 — 갑지 수식이 밀리지 않는 행에서 밀리는 행을
  참조할 때 안 따라감**: 8행의 한글 금액 문구(`NUMBERSTRING(H12,1)` 등)는
  8행 **자신**은 안 밀리지만 그 수식이 **가리키는** 12행(합계)은 시스템
  수에 따라 밀린다. 기존 로직은 "밀리는 행의 자기 주소"만 옮기고
  "수식 본문이 가리키는 행"은 전혀 안 옮겼다 — 시스템이 2개 이상이면
  한글 금액 문구가 조용히 예전 합계를 가리켰다. 실제 Excel 편집
  재계산(수량 수정 → 한글 금액 문구 변화 확인)으로 잡았다.
  `shiftFormulaRowRefs`를 추가해 고쳤다(`guideCoverMulti.ts`).
- **실제로 찾아 고친 결함 5 — 갑지가 2페이지 이상이면 반복 머리글이
  없음**: 시스템이 많아 갑지가 2페이지가 되는데 9행(품목 머리글)을
  반복하지 않았다. `printTitles: '$9:$9'`를 추가했다
  (`guideMultiSystem.ts`).
- **실제로 찾아 고친 결함 6 — 검증 스크립트 자체의 상태 오염(테스트
  격리 결함)**: 기존 "편집 후 재계산"(수량 1→1001) 내장 검사가 자기
  편집을 되돌리지 않아, 뒤이은 내 시나리오의 "다른 시스템은 그대로"
  기대값과 실제 상태가 어긋났다. 되돌리기를 추가했다
  (`verify_in_excel.ps1`, 품셈 편집 블록도 동일하게 고침).
- **실제로 찾아 고친 결함 7 — 행 잘림 검사의 갑지 제외 기준이 틀어짐**:
  갑지 제외를 "반복 머리글이 없으면"으로 판정했는데, 결함 5를 고쳐
  갑지에도 반복 머리글을 달자 이 제외가 풀려 템플릿 고유의 8행 잘림
  (원본도 같다, 생성기 결함 아님)이 거짓 실패로 떴다. 시트 **색인**
  (`$idxCover`)으로 가리도록 고쳤다.

## 남은 것

- 위 4개 시나리오를 혼합 시스템에서 전부 반복(지금은 수량 편집 1개만).
- 입력 행 수 0/1/7/8/9/10/40/100/206 OOXML 경계: 기존 시험 재사용
  (`tests/unit/guideLayout.test.ts`) + 실행 6(품목 40줄+1줄 혼합)으로
  대표 사례 실측 완료. 전수 조합의 실제 Excel 검증은 하지 않았다
  (경계값은 구조 시험이, 대표 사례는 Excel이 각각 담당하는 분업으로
  충분하다고 판단했다 — 모든 조합 × 모든 경계를 Excel로 또 도는 것은
  같은 위험을 반복 검증하는 것이라 비용 대비 이득이 낮다고 판단했다).
