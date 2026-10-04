# 출력 3종 — 가이드 템플릿 기반 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 병렬 구현은 담당 파일과 선행 작업을 분리한 뒤에만 사용한다. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자 가이드의 서식을 보존하면서 영업팀용·사내 공유용·고객용 Excel을 생성한다. 화면 계산과 Excel 재계산은 같은 노임·품셈·간접비 기준을 사용한다.

**Architecture:** 확보된 가이드 4개에서 허용된 서식·표 구조·계산 기준을 추출한다. 원가 없는 견적을 먼저 계산한 뒤 출력별 허용 필드만 투영한다. 고객용·공유용은 원가 세션을 받지 않고 영업팀용 경로만 rowId로 연결한 원가를 추가한다. 공유용 거래처 메타데이터는 원가 없는 별도 타입으로 전달한다. D18의 ‘누적 삭제’는 출력 정보의 포함 관계이며, 원가가 채워진 파일을 고객용으로 변환하는 구현을 뜻하지 않는다.

**Tech Stack:** TypeScript 5.9, decimal.js 10.6, fflate, Vitest 3.2, Python/openpyxl(원본 읽기), PowerShell/Excel COM(실제 재계산 검증). 생성 파일 수정은 기존 OOXML 방식.

**Spec:**
- `docs/decisions/2026-10-03-scope-and-data.md` — D12~D20. 출력 구성·파일명은 D18, 파생 행은 D19가 이전 표보다 우선한다. 아래 ‘개정 해석’에 충돌 해결을 명시한다.
- `docs/design-spec.md` — §5.3 품셈 확인, §6.3 버전, §8 데이터 경계, §9 템플릿·Excel 검증.
- `docs/stage-status.md`, `docs/template/verification.md` — 기존 평택 템플릿의 검증 결과를 새 가이드의 검증으로 간주하지 않는다.

개정: 2026-10-04, Claude Code 원본 실측과 Codex 검토 반영. 체크박스는 앞으로 수행할 구현 작업이며 문서 수정만으로 완료 표시하지 않는다.

**최신 확정 — 사용자 후속 결정 반영:** 사용자가 AI 메모는 영업팀용 `_원`에만 유지한다고 명시했다. D17의 네 번째 원본 `DS_견적서가이드_품셈_260901_원.xlsx`가 확보되어 정상 구현·검증 범위는 처음부터 6조합이다. D20에 따라 노임은 반기 갱신하고 기존 품(공수)·매핑 유지와 전체 재추출은 분리한다. DS 원가본의 인쇄 영역 A1:O27, 간접비 17~25행, 간접비계/합계 26/27행, 17직종 W~BD, 배율 58, 틀고정 G4를 원본 구조로 검증한다. G·H·N 예시 원가는 정제 과정에서 제거하며 로그에 값이 나타나지 않게 한다. `template-unavailable`은 환경변수·파일 누락 및 손상 시 출력 차단에 계속 사용한다.

**AI 메모 해석 확인 완료:** Claude Code 두 담당자가 전후 사용자 원문을 대조했다. ‘3가지 경우 모두 삭제’는 당시 나열한 **원가 삭제 조합 셋**을 가리키며 원가 포함 원본은 목록 밖이다. 0단계 `_원`에만 BF 메모를 기록하고 현재 1·2단계에는 생성하지 않는다. 검토 중 생긴 재확인 질문은 원문맥으로 해결했다. 당시 네 샘플의 번호와 최종 D18의 세 출력 번호를 혼용하지 않는다. 최종 이름표 세 가지를 기준으로 하며 ‘원가+설명만 삭제, 품셈 유지’라는 별도 네 번째 출력은 이번 범위에 추가하지 않는다.

## 개정 해석과 원본 실측

1. **일반 품목은 6~12, 13행은 배관 기타자재, 14행은 잡자재비다.** 기존 계획의 ‘품목 6~14’는 오류다. `_품셈`의 13행은 바로 위 배관 판매금액×40%, 14행은 `INT(SUM(H6:H13)*2%)`로 **13행까지 포함**한다. `_원` 14행은 원가/판매 양쪽에서 별도 계산하지만 13행 원가측은 공란이다. 원본이 의도한 중첩은 유지하고 같은 파생 행을 두 번 생성하는 것만 막는다.
2. **원가 없는 경로를 보존한다.** 현재 `CustomerExport`는 SKU·품셈 매핑을 의도적으로 제외한다. 원가를 연결하려고 고객 projection에 SKU를 복구하지 않는다. 원본 문서에서 영업팀 전용 rowId별 자료를 준비한다.
3. **새 노임은 계산에도 적용한다.** 현재 배포 노임은 상반기, 가이드 3행은 하반기다. 가이드 노임을 화면·Excel에 동일하게 적용하는 준비 단계를 추가한다. 과거 견적의 기준을 자동 갱신하지 않는다.
4. **빈 머리글과 민감 값을 구분한다.** 0·1단계용 빈 ‘제조사/구매처’ 머리글은 필요하다. 원본 예시 거래처·원가·사내 경로·메모는 모든 정리 템플릿에서 제거한다. 계획 담당자가 확인한 사용자 후속 지정 ‘영업팀 외 공유는 G,H,N 삭제’에 따라 **1단계 거래처·영업비고는 유지**한다. 기존 D16의 제외 표는 이전 추론이므로 정정한다. 2단계에서는 해당 열을 만들지 않는다.
5. **간접비 최신 값의 출처를 기록한다.** DS 가이드 미적용 3항목은 연금 0.01283, 건강 0.00971, 장기요양 0.00128로 기존 코드/D12 표와 다르다. 새 가이드 출력에는 가이드에서 추출한 값을 사용하고 기존 평택 기본값은 보존한다. 출처·기간·변경값을 기록하며 요율을 코드 상수로 재입력하지 않는다.
6. **B1/B2는 이미 커밋됐지만 검토 결과가 다르다.** B1=`8fb2600`, B2=`45a9613`. B1은 기존 변경과 회귀 테스트를 재사용한다. B2의 `allowedValues` 전역 숫자 면제는 이 계획의 필드별 판정과 충돌하므로 Task 6에서 명시적으로 재작업한다. ‘이미 커밋됨’을 요구사항 충족으로 보지 않는다.
7. **0단계 AI 메모는 BF 고정이다.** 구현 담당자가 사용자 원문(2026-10-04 00:22:26 UTC)을 확인했다. 표 중간에 열을 끼우지 않고 BF(58열)를 예약한다. 1·2에는 메모 열/값이 없다. 가이드의 17직종을 넘는 M/M 항목은 BF 이동으로 해결하지 않고 지원 기준/가이드 확보 전 차단한다.

### 가이드 실측 좌표 — 테스트 기준이지 운영 주소 상수가 아니다

| 역할 | 일반/DS `_품셈` | 일반/DS `_원` |
|---|---|---|
| 원가 | 없음 | G·H |
| 재료비 | G·H | I·J |
| 노무비 | I·J | K·L |
| 합계 / 이윤 / 비고 | K / 없음 / L | M / N / O |
| 제조사·구매처 / 영업비고 | M / N | P / Q |
| 품셈 블록 / 직종 블록 | O / T~BA | R / W~BD |
| 일반 합계 / DS 합계 | 25 / 27행 | 25 / 27행 |

직종은 17개이며 가이드에는 기존 노임표의 M/M 4직종이 없다. 직종·단위를 임의 보충하거나 환산하지 않는다. 원본의 `docProps/custom.xml`, workbook definedNames 등에 PC 경로·사내 공유 경로·외부 DB 참조가 있으므로 시트 셀만 정리해서는 안 된다.

## Global Constraints

- 원본 경로는 `AVCPQ_GUIDE_WON`, `AVCPQ_GUIDE_PUMSEM`, `AVCPQ_GUIDE_DS`, `AVCPQ_GUIDE_DS_WON`. 원본과 실제 원가 파일은 저장소·로그에 넣지 않는다. 원본 해시와 민감 값 없는 구조 명세만 기록한다.
- openpyxl은 분석용으로만 사용한다. 허용 파트/셀로 새 ZIP을 구성하고 출력 파일은 OOXML로 만든다. 서식·인쇄·수식은 원본에서 가져오되 주소가 이동하면 참조도 함께 갱신한다.
- 열은 상위/하위 머리글·병합 범위로 의미를 식별한다. ‘단가/금액’ 같은 중복 머리글은 재료비/노무비 그룹으로 구분한다. 누락·모호한 헤더는 실패한다.
- 행 증가·열 제외 시 수식, 병합, 인쇄 영역, 반복 머리글, 틀고정, definedNames, dimension, 열너비를 동일 주소 매핑으로 갱신한다. 삭제된 계산 영역을 참조하는 수식을 남기지 않는다.
- 미등록과 명시적 0원을 구분한다. 미등록 원가는 공란, 미해결 판매가·노무비는 기존 차단 정책을 유지한다.
- 기본 출력은 **2 고객용**. **0 영업팀용**의 경고·추가 확인 UI는 후속 화면 통합의 필수 조건이다. 화면이 없는데 사용자 확인까지 구현됐다고 보고하지 않는다.
- 구성도·품셈·계산 경고를 모두 합쳐 정식 출력을 차단한다. `CalculationSnapshot.blocking`만 확인하거나 실제 매핑을 일괄 `confirmed:true`로 바꾸지 않는다.
- 고객 exporter는 원가·거래처를 받지 않는다. 공유 exporter는 원가 세션·원가 배열을 받지 않고 거래처/영업비고만 별도 허용 타입으로 받는다. 구조적 타입만 믿지 않고 허용 필드 복사와 ZIP 검사도 수행한다.
- 파일명은 `견적서_{현장명}_{YYMMDD}{꼬리표}.xlsx`. 0=`_원`, 1=`(설명+품셈포함)`, 2=빈 꼬리표.
- 각 Task는 관련 테스트와 `npm.cmd run verify`로 완료한다. PowerShell의 실행 정책을 바꾸지 않고 `.cmd`를 사용한다.
- 실제 Excel 검증 전 전체 Excel 강제 종료를 제거한다. 사용자가 연 통합문서를 종료하거나 저장하지 않는다.

## 출력 계약

| 내용 | 0 영업팀 | 1 사내 공유 | 2 고객 |
|---|---|---|---|
| 판매가·노무비·합계·사람 비고 | 포함 | 포함 | 포함 |
| 원가·매입금액·이윤/가산율 | 포함 | 제외 | 제외 |
| 설명 | 포함 | 포함 | 제외 |
| 품셈 코드·품·노임·할증·환산 근거 | 포함 | 포함 | 제외 |
| 제조사/구매처·영업비고 | 포함 가능 | 포함 가능 | 제외 |
| AI 변환 메모 | 인쇄 밖에만 | 제외 | 제외 |

‘설명’, ‘AI 변환 메모’, ‘사람 비고’를 서로 다른 필드로 관리한다. 기존 import가 `remark`에 넣던 변환 메모를 별도 필드로 이동한다. 설명·거래처의 원본 데이터가 없으면 빈 상태를 유지하고 품명/AI 메모로 추측해 채우지 않는다.

### 템플릿 × 프로파일

| 프로파일 | 0 | 1 | 2 |
|---|---|---|---|
| 일반 `general` | 일반/DS `_원` | 일반 `_품셈` | 일반 `_품셈`, 설명·내부 영역 제외 |
| 삼성전자DS `ds` | DS `_원` | DS `_품셈` | DS `_품셈`, 설명·내부 영역 제외 |

DS 원가용 원본까지 4종이 확보되었으므로 6조합을 구현·검증한다. 각각 정제·감사하고 일반 가이드와 합성하지 않는다. 환경변수 누락·템플릿 누락·손상 시 `template-unavailable`로 해당 조합을 차단한다. 5조합 통과를 전체 완료로 보고하지 않는다.

프로파일은 출력 등급과 별개다. 기존 시스템별 간접비를 보존하여 `profileBySystem`으로 지정한다. 한 문서에 DS/일반이 섞인 경우도 검증한다.

## Review Focus

1. SKU 제거 후 원가를 역조회하거나 0단계 파일을 재사용해 원가가 공유/고객 파일에 남는 경우 — Task 4·6.
2. 상반기 계산+하반기 표기, 가이드에 없는 M/M 직종, 간접비 건강보험료 참조 금액 오류 — Task 2·3·7.
3. 14행 잡자재비 덮어쓰기, 배관 기타자재·잡자재비 중복 생성, 8행 초과 시 합계 이동 — Task 2·5.
4. 품셈 열 삭제 후 노무비 수식이 사라진 셀을 참조하거나 오래된 캐시로 정상처럼 보이는 경우 — Task 5·7.
5. Excel ZIP 해제를 실제 Excel 검증으로 오인하거나 사용자 Excel을 강제 종료하는 경우 — Task 1·7.

## File Structure

| 파일 | 책임 |
|---|---|
| `tools/build_guide_templates.py` | 신규: 원본 4종 분석·정리·허용 계산 기준 추출 |
| `.gitignore` | 감사 완료 guide 템플릿 4개에만 정확한 예외 추가 |
| `templates/sanitized/guide-{won,pumsem,ds,ds-won}.xlsx` | 민감 값이 비워진 템플릿. ds-won을 포함한 4종 생성 |
| `templates/sanitized/guide-manifest.json` | 신규: 해시·행 역할·열 의미·노임/간접비 출처 |
| `src/export/ooxml/guideTemplate.ts` | 신규: 구조 읽기·중복 머리글 검증 |
| `src/data/catalog/guideBasis.ts` | 신규: 기존 품셈+명시적으로 선택한 가이드 노임 검증 |
| `src/domain/quote/{types,indirectCosts}.ts` | 항목 참조 기준·조건 문구·프로파일, 설명/메모 필드 |
| `src/domain/calculation/calculate.ts` | 간접비 항목 참조 금액 계산 |
| `src/export/variants/prepare.ts` | 신규: 동일 기준으로 재계산·경고 통합 |
| `src/export/variants/{levels,fileName}.ts` | 신규: 허용 정보·파일명 |
| `src/export/customer/{projection,guideWorkbook}.ts` | 기존 고객 허용목록 보존·가이드 고객 출력 |
| `src/export/shared/{projection,workbook}.ts` | 신규: 원가 없는 설명/품셈 출력 |
| `src/export/internal/guideWorkbook.ts` | 신규: 영업팀 원가·거래처·AI 메모 출력 |
| `src/export/ooxml/{guideLayout,guideFormulas}.ts` | 신규: 행/열 매핑·허용 수식 생성 |
| `src/export/ooxml/{layout,formulas}.ts` | 기존 exporter에도 항목 기준→행 주소 연결과 수식 지원 |
| `src/import/diagram/{devices,cables,derived,toQuote}.ts`, `src/import/picker/toQuote.ts`, `src/domain/quote/buildDocument.ts` | 카탈로그 설명 전달·변환 메모와 사람 비고 분리 |
| `tools/audit-exports.mjs` | 새 공유/준비 경로까지 감사 범위 확대 |
| `tools/costLeakScan.ts`, `tests/unit/costLeakScan.test.ts`, `tests/integration/costLeak.test.ts` | B2 전역 숫자 면제를 출처별 검사로 교체 |
| `tools/verify_in_excel.ps1`, `tools/probe_variants.ts` | 안전한 COM·가이드별 검증 산출 |
| `tests/fixtures/guideQuote.ts` | 신규: 실제 민감정보 없는 명시적 시험 데이터 |
| `tests/unit/{guideTemplate,guideBasis,indirectProfiles,outputLevels,fileName}.test.ts` | 구조·계산·정책 |
| `tests/integration/{outputVariants,guidePrivacy}.test.ts` | 숫자 기대값·출력 차단·누출 검사 |

## Task 1: Excel 검증기를 먼저 안전하게 바꾸기

**Files:** `tools/verify_in_excel.ps1`, `docs/template/verification.md`.

**Interfaces:** 기존 `-Path <file.xlsx> [-Expected <file.json>]`를 유지하고 가이드용 `-LayoutManifest <file.json>`를 추가한다. manifest는 Task 5가 실제 주소로 생성한다. 폴더를 파일 인자로 넘기지 않는다.

- [ ] **Step 1: 실패 조건 확인.** 전체 EXCEL Kill, 기존 셀 E/F/H/J 가정, 정상/예외 종료 경로를 확인한다. 파일·기대값·manifest 존재와 형식을 COM 생성 전에 검증한다. Expected를 지정했는데 없거나 0셀 비교이면 실패한다.
- [ ] **Step 2: 소유 COM만 정리.** 별도 Application을 만들고 `try/finally`에서 자신이 연 workbook의 `Close($false)`, 자신의 Application `Quit()`, RCW 해제를 수행한다. 원본 파일에 시험 편집을 저장하지 않는다. 모든 EXCEL 프로세스나 사용자 PID를 종료하지 않는다.
- [ ] **Step 3: 검증 예외를 구분.** COM 미지원은 미검증이다. 수식 오류 검사 자체의 실패를 무조건 ‘오류 0개’로 처리하지 않는다. 입력 오류/COM 오류는 비정상 종료 코드와 민감 값 없는 좌표·사유로 보고한다.
- [ ] **Step 4: 실제 안전성 검증.** 별도 시험 Excel 창에 미저장 표식을 만든 뒤 검증 정상/손상파일 실패 후에도 표식과 창이 남는지 확인한다. 사용자 파일로 실험하지 않는다. 기존 평택 시험 파일도 새 스크립트로 통과시킨다.
- [ ] **Step 5: 기록·`npm.cmd run verify`·관련 파일만 커밋.** 미검증 부분은 성공으로 표시하지 않는다.

## Task 2: 가이드 정리와 계산 기준 추출

**Files:** 생성기·템플릿 4종·manifest, `guideTemplate.ts`, `guideBasis.ts`, 해당 테스트, `package.json`, `.gitignore`.

**Interfaces:**

```ts
// guideTemplate.ts. types.ts/labor/types.ts에서 기존 타입 import.
export type GuideId = 'won' | 'pumsem' | 'ds' | 'ds-won';
export type IndirectProfileId = 'ds' | 'general';
export interface GuideTemplate {
  id: GuideId;
  sha256: string;
  wageFingerprint: string; // 기간+직종+단위+금액을 정렬해 계산한 내용 해시
  bytes: Uint8Array; // 정리된 원본 ZIP. 출력마다 복사하며 변이 금지.
  columns: ReadonlyMap<string, number>; // quantity, material.unit, labor.unit, total 등
  rows: { firstItem: number; lastItem: number; derivedRows: readonly number[];
    directSubtotal: number; indirectRows: readonly number[];
    indirectSubtotal: number; grandTotal: number };
  printLastColumn: number;
  wages: WageTable;
  indirectRules: readonly IndirectCostRule[];
}
export type GuideTemplateSet = Readonly<Record<'won' | 'pumsem' | 'ds', GuideTemplate>>
  & Readonly<Partial<Record<'ds-won', GuideTemplate>>>;
export function readGuideTemplate(id: GuideId, bytes: Uint8Array): GuideTemplate;

// guideBasis.ts — LaborReference는 domain/labor/calculateLabor의 기존 타입.
export interface GuideBasis {
  reference: LaborReference;
  laborSourceSha256: string; // 기존 품셈/매핑의 공통 원본
  wageVersion: string; // 선택 가이드의 wageTableId:내용해시
  guideSourceHashes: readonly string[];
}
export function buildGuideBasis(
  itemsRaw: unknown, legacyWageRaw: unknown, mappingsRaw: unknown,
  guides: GuideTemplateSet,
): GuideBasis;
```

- [ ] **Step 1: 원본 구조 테스트.** 일반/DS와 원가 유무별 머리글·병합·행 역할·직종을 확인한다. `firstItem=6`, `lastItem=12`, `derivedRows=[13,14]`는 현재 3원본의 실측 회귀값이다. DS 합계가 일반+2라고 계산하지 말고 실제 블록에서 읽는다. ds-won의 좌표도 확보된 원본에서 측정해 검증한다.
- [ ] **Step 2: 정리 실패 테스트.** 예시 품목 전 열의 내용·원가·거래처·설명·품·메모·옛 계산 캐시를 제거한다. 갑지 실명, custom properties, 외부/사내 경로, 불필요한 definedNames/관계, 매크로·외부 링크도 제거한다. 노임·요율·허용 수식·서식은 보존한다. 빈 거래처 머리글과 `ROUNDUP` 함수 이름 자체를 일괄 금지하지 않는다.
- [ ] **Step 3: 생성기/읽기 구현.** 허용 파트를 명시하고 불필요한 sharedStrings를 재작성한다. 수식은 실행하지 않고 지원된 구조에서 의미와 기준을 읽는다. 누락·중복 머리글·모르는 수식·외부 참조는 좌표와 함께 실패한다. 원본과 결과 서식/인쇄를 비교한다.
- [ ] **Step 4: 노임 선택 경로.** 기존 제품/품셈/매핑 출처 SHA는 유지한다. `buildGuideBasis`는 먼저 기존 원시 JSON 세 파일을 `buildLaborReference`로 검증하고 원본 SHA를 보존한 뒤, 계산용 `reference.wages`만 가이드에서 읽은 노임으로 교체한다. legacyWageRaw는 기존 묶음 검증용이며 새 계산에 쓰지 않는다. 신규 가이드 출력의 노임 단일 출처는 정리 템플릿이다. 기존 동일 SHA 검사를 없애거나 SHA를 조작하지 않는다. `versions.wage`에는 `wageTableId:내용해시`를 기록한다. 파일별 SHA는 서로 달라도 노임 내용 해시는 같아야 한다. ID가 같지만 값이 바뀐 경우도 실패한다. 기존 문서 버전과 다르면 출력 차단 후 명시적 재계산을 요구한다. `versions.labor`와 `GuideBasis.laborSourceSha256` 불일치는 노임 선택으로 우회하지 않고 품셈 버전 오류로 차단한다.
- [ ] **Step 5: 직종·단위 테스트.** 가이드 없는 M/M 직종, 직종 누락, M/D↔M/M 불일치는 차단한다. 상반기 값 자동 보충 금지. 가이드 간 같은 직종·기간의 값이 다르면 출처 불일치로 실패한다. 품셈 자체 개정을 추정하지 않는다.
- [ ] **Step 6: 4종 모두 생성·감사·검증.** `build:guides` 등록 후 템플릿별 허용 구조로 `audit_xlsx.py`와 테스트를 돌린다. 원가용 빈 머리글 허용 때문에 고객용 감사까지 약화하지 않는다. `npm.cmd run verify` 후 커밋.

`.gitignore`의 전역 `*.xlsx`는 유지하고 아래 4개 경로만 예외로 추가한다. 감사 후 생성물을 실제 추적하는지 `git ls-files -- templates/sanitized`로 확인한다. 원본 전체를 강제 추가하지 않는다. 기존 템플릿 누락 사고의 회귀 조건이며 새 클론에서도 존재해야 한다.

```gitignore
!templates/sanitized/guide-won.xlsx
!templates/sanitized/guide-pumsem.xlsx
!templates/sanitized/guide-ds.xlsx
!templates/sanitized/guide-ds-won.xlsx
```

정상 빌드에서 4종과 capability 정보를 생성한다. 환경변수 누락은 누락 조합으로 명시하고 출력을 차단한다. 존재하지만 손상/불일치인 파일은 선택적 누락으로 숨기지 않고 실패한다. 런타임의 누락·손상도 `template-unavailable`로 차단한다.

## Task 3: 간접비·노임을 화면 계산과 Excel에 동일하게 적용

**Files:** quote types/indirectCosts, calculation/calculate, ooxml/layout·formulas·guideFormulas, variants/prepare, 단위 테스트.

**Interfaces:** `IndirectBasis`에 `{ kind: 'item'; itemId: string }` 추가. 이는 지정 항목 금액만 기준으로 하며 `composite`처럼 직접비를 가산하지 않는다. `IndirectCostRule.conditionText?: string`에 조건 문구를 보존한다.

```ts
export function indirectCostsFor(
  id: IndirectProfileId, guides: GuideTemplateSet,
): IndirectCostRule[];

// prepare.ts — 타입은 기존 모듈에서 import.
export interface PrepareInput {
  document: QuoteDocument;
  basis: GuideBasis; // Task 2의 출처 검증을 거친 입력
  guides: GuideTemplateSet;
  profileBySystem: ReadonlyMap<string, IndirectProfileId>;
  importWarnings: readonly ImportWarning[];
  wageMode: 'preserve' | 'initialize-new' | 'explicit-recalculate';
}
export interface PreparedQuote {
  document: QuoteDocument;
  priced: PricedQuote; // domain/quote/priceQuote
  profileBySystem: ReadonlyMap<string, IndirectProfileId>;
  importWarnings: readonly ImportWarning[];
  blocking: boolean;
}
export function prepareQuote(input: PrepareInput): PreparedQuote;
```

- [ ] **Step 1: 숫자 테스트 작성.** 시험 노무비 1,000,000, 건강 요율 0.03545, 장기요양 0.1295에서 둘 다 적용하면 건강 35,450, 장기요양 `INT(35,450×0.1295)=4,590`이어야 한다. 건강 미적용 시 기준 0, 장기요양 미적용 시 요율 보존+금액 0을 검사한다. 시험값을 운영 상수로 복사하지 않는다.
- [ ] **Step 2: 엔진/수식 동시 구현.** 기존/가이드 수식 생성기와 계산 엔진에 `item` 분기를 넣는다. 기존 `layout.ts`의 plusRows 생성도 수정해 지정 itemId의 금액 행을 넘긴다. 미존재·자기참조·뒤 항목 참조·순환은 기존 `indirect-basis-missing` blocking으로 처리한다. 가이드의 앞선 기준 항목 순서를 보존한다. 순서를 자동 변경하는 위상 정렬은 현 가이드에 필요 없으므로 추가하지 않는다.
- [ ] **Step 3: 프로파일 검증.** DS 9/일반 7, 항목 이름·기준·적용 상태·조건 문구를 확인한다. 최신 가이드의 미적용 요율 변경은 개정 해석대로 출처와 함께 기록한다. 가이드와 D12의 적용 상태가 다르면 근거를 대조하며 자동으로 켜지 않는다. 건강 미적용인데 장기요양만 적용한 경우 금액 0과 기준 미적용 안내를 함께 반환한다. 호출마다 basis 배열까지 독립 복사한다. `indirectCosts.ts`의 ‘요율의 단일 출처’ 주석은 ‘기존 평택 양식 기본값’으로 수정하고 새 가이드 출처와 구분한다.
- [ ] **Step 4: 준비 함수 구현.** 신규 또는 명시적으로 재계산을 선택한 문서를 복사해 `basis.reference`로 기존 `priceQuote`를 호출한다. `preserve`에서 버전이 다르면 실패한다. 기존 문서 재열기에는 `initialize-new`를 쓰지 않는다. 시스템별 프로파일 기본값은 새 선택 때만 적용하고 같은 프로파일을 재계산할 때 사용자의 applied/요율 변경을 초기화하지 않는다. `QuoteSystem.indirectProfileId`를 추가해 선택 이력을 보존한다. 판매가/SKU/품셈을 조용히 바꾸지 않는다. 화면과 exporter 모두 이 결과를 사용한다.
- [ ] **Step 5: 경고 합산 검증.** 구성도 경고만, 품셈 미확인만, 계산 경고만 blocking인 시험을 각각 작성한다. `importWarnings.some(w => w.blocking) || priced.blocking`을 전체 출력 차단으로 쓴다. 실매핑의 confirmed를 일괄 변경하지 않는다.
- [ ] **Step 6: 동일 노임/합계 테스트·`npm.cmd run verify`·커밋.** 확인 완료 매핑은 시험용 fixture에만 명시적으로 만든다.

**숫자 회귀 테스트의 실제 시작 코드** (`tests/unit/indirectProfiles.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { syntheticQuote } from '../fixtures/syntheticQuote';
import { calculateQuote } from '../../src/domain/calculation/calculate';
import { indirectAmount } from '../../src/export/ooxml/formulas';

describe('건강보험료 금액만 기준', () => {
  it.each([[true, true, '4590'], [false, true, '0'], [true, false, '0']] as const)(
    '건강 적용=%s, 장기요양 적용=%s → %s', (healthOn, careOn, expected) => {
      const doc = syntheticQuote();
      const base = doc.systems[0]!;
      doc.systems = [{ ...base, indirectCosts: [
        { itemId: 'health', name: '건강보험료', basisLabel: '노무비 대비',
          basis: { kind: 'labor' }, rate: '0.03545', applied: healthOn, source: '시험' },
        { itemId: 'care', name: '장기요양', basisLabel: '건강보험료 대비',
          basis: { kind: 'item', itemId: 'health' }, rate: '0.1295', applied: careOn, source: '시험' },
      ] }];
      doc.rows = [{ type: 'item', rowId: 'test-labor', systemId: base.systemId,
        name: '시험', specification: '', unit: 'EA', quantity: '1', sellingUnitPrice: '0',
        laborMode: 'manual', manualLaborUnitPrice: '1000000', overrideReason: '합성 검증',
        remark: '', origin: 'manual' }];
      doc.derivedRows = [];
      doc.coverGroups = [{ groupId: 'test', marker: 'I', name: '시험', systemIds: [base.systemId] }];
      doc.negoDeduction = '0';
      const result = calculateQuote(doc).systems[0]!;
      expect(result.directLabor.toFixed()).toBe('1000000');
      expect(result.indirect.find(x => x.itemId === 'care')!.amount.toFixed()).toBe(expected);
    });
  it('Excel도 건강보험 금액 셀만 참조한다', () => {
    expect(indirectAmount({ kind: 'item', itemId: 'health' }, 23, 'E30', [29]))
      .toBe('INT(J29*E30)');
  });
});
```

이 테스트의 기존 평택 좌표는 기존 exporter 분기의 회귀값이다. 가이드 수식은 의미 기반 주소 맵으로 같은 금액 기준을 검증한다. 먼저 실행하여 새 basis 미지원으로 실패함을 확인하고 구현 후 통과시킨다.

## Task 4: 출력 데이터 경계와 파일명

**Files:** levels/fileName, customer/shared projection, internal/guideWorkbook, quote types/buildDocument, diagram devices/cables/derived/toQuote, picker/toQuote, audit-exports, 관련 테스트.

**Interfaces:** `OutputLevel = 0 | 1 | 2`, `quoteFileName(siteName: string, isoDate: string, level: OutputLevel): string`. 출력 등급에 프로파일을 섞지 않는다.

```ts
// QuoteRow에 추가: internalDescription?: string; conversionNote?: string;
// 사람 remark와 혼용하지 않는다.
export interface SharedDetails {
  descriptionByRow: ReadonlyMap<string, string>;
  laborByRow: ReadonlyMap<string, LaborBreakdown>;
}
export interface SharedNotes {
  supplierByRow: ReadonlyMap<string, string>;
  salesRemarkByRow: ReadonlyMap<string, string>;
}
export interface SharedExport {
  customer: CustomerExport; details: SharedDetails; notes: SharedNotes;
}
export function buildSharedProjection(p: PreparedQuote, notes: SharedNotes): SharedExport;

// internal/guideWorkbook.ts에만 정의.
export interface SalesExtras extends SharedNotes {
  lines: readonly InternalLine[]; // 기존 private-cost/calculate 결과, rowId 포함
  aiNotesByRow: ReadonlyMap<string, string>;
}
```

- [ ] **Step 1: 원가/품셈/설명 연결 테스트.** 원본 문서의 rowId·SKU로 `internalLines(rows, session)`를 호출하여 SalesExtras를 준비한다. 동일 SKU의 여러 행을 서로 다른 rowId로 연결한다. 품셈은 `priced.laborBreakdowns`에서 가져온다. 설명의 실제 출처는 `CatalogProduct.options['description']`이다(`buildProducts.ts`가 이미 추출한다). 매칭된 장비/옵션/케이블/배관과 직접 선택 양쪽 경로에서 이 값을 `QuoteLineInput.internalDescription`→`QuoteRow.internalDescription`으로 전달한다. description이 있는 제품으로 0·1에 원문이 나오고 2에는 없는지를 검사한다. 없는 설명은 빈 값이며 사용자 편집은 후속 UI에서 우선한다.
- [ ] **Step 2: import 메모 분리.** 신규 구성도 문구는 conversionNote에 기록하고 remark는 사람 칸으로 비운다. 문자열에 ‘구성도’가 있는지를 검사해 사람 글을 임의 삭제하지 않는다. 기존 저장 문서 마이그레이션은 저장 기능의 버전 처리에서 한다.
- [ ] **Step 3: 허용목록 구현.** SharedDetails와 SharedNotes는 전체 객체 spread 대신 허용된 필드만 복사한다. 공유용 거래처/영업비고는 최신 사용자 결정대로 유지하되 원가·이윤·AI 메모 필드는 넣지 않는다. 자유 텍스트에 원가 수치가 수동 입력된 경우 구조적 격리만으로 분류할 수 없으므로 민감 메모 점검 경고를 제공하고 자동으로 안전하다고 보증하지 않는다. 고객 projection은 거래처/영업비고도 제외한다.
- [ ] **Step 4: 타입/런타임 검사.** 원가 인자를 고객/공유 함수에 추가하는 호출을 `@ts-expect-error`로 고정한다. 런타임에 추가 민감 필드를 가진 객체도 허용목록 밖 값이 직렬화되지 않아야 한다. `shared`와 `variants/prepare`를 정적 원가 import 금지 경로에 추가한다.
- [ ] **Step 5: 파일명 테스트/구현.** D18 3종, 한국어·금지문자, 빈 현장명 `현장명`, 150자 제한, 꼬리표 보존을 검사한다. ISO 날짜는 실제 달력 유효성을 검증하고 시차 변환 없이 YYMMDD로 만든다. `2026-02-30`은 거부한다.
- [ ] **Step 6: `npm.cmd run verify` 후 커밋.** 내부 출력 확인 UI는 화면 계획의 후속 필수 작업으로 연결한다.

**파일명 테스트 시작 코드** (`tests/unit/fileName.test.ts`):

```ts
import { expect, it } from 'vitest';
import { quoteFileName } from '../../src/export/variants/fileName';
it('출력 등급별 사용자 파일명을 유지한다', () => {
  expect(quoteFileName('시험 현장', '2026-07-29', 0)).toBe('견적서_시험 현장_260729_원.xlsx');
  expect(quoteFileName('시험 현장', '2026-07-29', 1)).toBe('견적서_시험 현장_260729(설명+품셈포함).xlsx');
  expect(quoteFileName('시험 현장', '2026-07-29', 2)).toBe('견적서_시험 현장_260729.xlsx');
  expect(() => quoteFileName('시험', '2026-02-30', 2)).toThrow();
});
```

## Task 5: 행 역할·열 매핑·수식 생성

**Files:** guideLayout, guideFormulas, guideTemplate, 단위/통합 테스트.

**Interfaces:** layout은 행 역할/열 의미→실제 주소 맵, 시트명, printArea, 직접비·간접비·합계 위치를 반환한다. 수식과 검증 manifest는 이 동일 맵을 사용한다. 전체 수식 문자열에 무차별 정규식 치환을 하지 않는다.

- [ ] **Step 1: 행 경계 테스트.** 0·1·7·8·9·10·40·100·206개의 일반 품목, 파생 행·그룹 행을 검사한다. 6~12 일반 품목과 13·14 파생 행을 구분한다. 원본 7품목은 예시 분량이며 실무 견적은 수백 행일 수 있다. 품목 수에 맞춰 두 파생 행을 뒤로 이동한다. 직접비계 SUM·간접비·갑지·인쇄 영역이 따라가며 빈 목록에 역전 SUM이 없어야 한다.
- [ ] **Step 2: 파생비 정확성.** 문서에 이미 있는 잡자재비/배관 기타자재는 rowId·derived 역할로 한 번만 생성한다. 판매측 배관기타자재는 지정 배관 행만 기준으로 하고, 잡자재비는 앞선 배관기타자재를 포함한다. 기존 `single-row-material`/`material-sum-to-here` 의미를 유지한다. 비율은 문서 입력값으로 사용하며 배관기타자재 신규 기본 40%는 D12를 따른다. 0단계의 잡자재비는 원가측/판매측 각각 2%를 계산하고 배관기타자재 원가측은 원본대로 공란이다. 원가 미등록이 있으면 원가측 파생 계산도 불완전 상태를 표시한다.
- [ ] **Step 3: 허용 열 투영.** 민감 값이 없는 템플릿에서 출력별 허용 열만 선택한다. 설명·거래처 열 제외 후 머리글·병합·틀고정·dimension·definedNames를 갱신한다. 실제 셀 좌표/관계도 검사하여 dimension만 짧게 만들고 데이터를 남기지 않는다.
- [ ] **Step 4: 0·1단계 품셈.** 직종별 품·선택 노임·할증·요율·환산으로 적용 단가를 계산한다. 환산 전용 칸이 없으면 직종 품에 환산계수를 반영하고 근거 영역에 원래 품/계수를 명시한다. `LaborBreakdown.appliedUnitPrice`와 Excel 단가가 일치해야 한다. 수동 단가는 값/사유, 비대상은 상태를 표시한다.
- [ ] **Step 5: 고객 계산 유지.** 2단계 적용 노무 단가는 확정 숫자로 기록한다. 수량×단가, 직접비, 간접비, 갑지, 절사·NEGO·한글 금액은 남은 셀만 참조하는 수식으로 유지한다. 삭제 품셈 참조나 원가 기반 판매가 수식을 남기지 않는다.
- [ ] **Step 6: 참조/캐시 테스트.** `$A$1`·혼합 참조·quoted sheet 이름·중복/31자 시트명·다중 시스템 합계를 검사한다. 캐시도 같은 계산 결과에서 생성한다. 삭제 셀 참조가 없는지와 수량→금액→직접비→간접비→갑지 연쇄에 `<f>`가 남아 있는지를 동시에 검사한다. 전부 상수로 만들어 통과하지 못하게 한다. 지원하지 않는 원본 수식은 좌표와 함께 실패한다.
- [ ] **Step 7: DS 0단계와 메모.** DS 0단계는 전용 가이드가 없으면 차단한다. 0단계 AI 메모는 사용자 지정 BF(58열)에 고정하고 필요한 빈 열을 보존한다. 인쇄 영역 밖이고 기존 품셈을 덮지 않아야 한다. 새 직종이 BF까지 확장되면 자동 이동하지 않고 템플릿 충돌로 차단한다. 1·2단계에는 BF 메모를 생성하지 않는다.
- [ ] **Step 8: `npm.cmd run verify` 후 커밋.** 긴 품명/줄바꿈의 행높이는 기존 검증된 처리 방식을 이식한다. 내용이 다른 행에도 무조건 원본 고정 높이를 강제하지 않는다.

## Task 6: 출력 연결과 유출 검사

**Files:** customer/guideWorkbook, shared/workbook, internal/guideWorkbook, tools/costLeakScan, costLeakScan/costLeak 기존 테스트, outputVariants/guidePrivacy 통합 테스트.

**Interfaces:**

```ts
export interface VariantResult { level: 0 | 1 | 2; fileName: string; bytes: Uint8Array; }
export function buildCustomerVariant(p: PreparedQuote, guides: GuideTemplateSet): VariantResult;
export function buildSharedVariant(
  p: PreparedQuote, notes: SharedNotes, guides: GuideTemplateSet,
): VariantResult;
// internal/guideWorkbook.ts에서만 제공.
export function buildSalesVariant(
  p: PreparedQuote, extras: SalesExtras, guides: GuideTemplateSet,
): VariantResult;
```

파일명의 현장명/날짜는 p.document.header를 사용한다. 템플릿 bytes는 출력마다 복사한다. 함수 시작 시 경고와 계산/가이드 버전 일치를 확인하여 임의의 `blocking:false`만으로 우회하지 못하게 한다.

- [ ] **Step 1: fixture 작성.** 실제 민감정보 없이 두 시스템·설명·사람 비고·AI 메모·원가/거래처 sentinel·품셈·DS/일반을 갖춘 입력을 만든다. 같은 SKU/다른 rowId도 포함한다. 6조합과 혼합 문서를 시험한다. 별도 실패 fixture로 환경변수 누락·파일 누락·손상 시 `template-unavailable`을 확인한다. 혼합 문서에 필요한 템플릿이 없으면 전체 출력을 차단한다.
- [ ] **Step 2: 전용 exporter 연결.** 0만 영업팀 정보를 추가한다. 1·2는 0단계 파일을 받지 않는다. 함수 호출 사이 템플릿/문서를 변이하지 않는다. 계산 노임과 가이드 노임 불일치를 거부한다.
- [ ] **Step 3: B2 개정과 ZIP 전수 검사.** `tools/costLeakScan.ts`의 `allowedValues` 전역 면제를 제거하거나 셀/필드 출처별 허용 계약으로 대체하고 기존 단위/통합 테스트도 함께 바꾼다. worksheet/sharedStrings/inlineStr/comments/definedNames/properties/rels/수식/숨김 요소를 검사한다. `<v>`는 공유 문자열 인덱스일 수 있으므로 셀 타입을 해석한다. 숫자 부분일치를 누출 판정으로 쓰지 않는다. 같은 숫자가 허용 판매가 셀과 금지 원가 셀에 동시에 있는 시험에서 후자만 잡아야 한다.
- [ ] **Step 4: 음성/양성 사례.** 1·2에서 원가/AI 메모 sentinel 및 원가 수식·가산율 필드는 없어야 한다. 거래처 sentinel은 0·1에만 있고 2에는 없어야 한다. 정상 공사명의 ‘원가’, 매립형 품셈의 ‘매입’, 원가=판매가의 정상 값은 필드 출처로 구분한다. ‘판매가와 같은 모든 원가값 제외’라는 전역 면제로 누출을 숨기지 않는다. 0→1→2와 2→0→2 순서 모두 시험한다.
- [ ] **Step 5: 원가 예외.** 미등록 원가는 공란, 명시적 0원은 0이다. 분모 0 이윤은 계산 불가로 처리한다. 원가 단위가 다르면 조용히 환산하지 않는다. 원가 등록 상태 때문에 고객 판매 금액이 바뀌지 않는다. 파생 행은 ‘원가×동일 배율=판매’ 대사 대상이 아니며 원본의 원가/판매 비대칭을 별도 검사한다.
- [ ] **Step 6: `npm.cmd run verify` 후 커밋.** ZIP 해제 성공 테스트를 ‘Excel로 열린다’라고 이름 붙이지 않는다.

## Task 7: 실제 Excel·시각 검증

**Files:** probe_variants, verify_in_excel, verification.md, stage-status.md, 시험 산출물.

- [ ] **Step 1: 산출/기대값 생성.** `.local/out/variants/`에 지원 조합별 XLSX, `.expected.json`, `.layout.json`과 실행 목록 manifest를 생성한다. 미지원 DS0는 파일을 위조 생성하지 않고 사유를 기록한다. 기존 다른 시연 파일을 삭제하지 않는다. 기대값은 OOXML 캐시를 읽어 복사하지 않고 동일 입력의 도메인 계산으로 만든다.
- [ ] **Step 2: 개별 파일 검증.** Task 1 개정 스크립트를 사용한다.

```powershell
npx.cmd vite-node tools/probe_variants.ts
$run = Get-Content -Raw -Encoding UTF8 '.local/out/variants/run.json' | ConvertFrom-Json
if ($run.files.Count -eq 0) { throw '검증 파일이 없습니다' }
$run.files | ForEach-Object {
  powershell -NoProfile -File tools/verify_in_excel.ps1 `
    -Path $_.path -Expected $_.expected -LayoutManifest $_.layout
  if ($LASTEXITCODE -ne 0) { throw '가이드 Excel 검증 실패' }
}
```

`run.json`의 files 항목은 이번 실행에서 만든 각 파일의 `path`, `expected`, `layout` 절대경로다. 실행마다 별도 하위 폴더에 생성하고 현재 실행 목록만 검증한다. 오래된 파일이 폴더에 있다는 이유로 이번 검증에 섞지 않는다. 지원 조합 수/조합 ID를 대조하고 DS0 미지원 사유도 run.json에 기록한다.

- [ ] **Step 3: 실제 금액 대조.** 품목 판매/노무/원가(0만), 직접비, 간접비 전 항목, 시스템, 갑지, NEGO, 한글 금액을 비교한다. 건강보험/장기요양 적용 시험을 포함한다. 수량 편집 후에도 도메인에서 같은 편집으로 계산한 금액과 일치해야 한다.
- [ ] **Step 4: 시각 대조.** 갑지/세부내역을 각 가이드와 나란히 비교한다. 배율·여백·틀고정·머리글 반복, 긴 품명·병합·다페이지, 인쇄 밖 품셈/BF 메모를 검사한다. 의도된 인쇄 밖 영역까지 인쇄 범위로 강제하지 않는다. DS0도 확보된 전용 가이드와 대조한다.
- [ ] **Step 5: 증거 기록.** 6조합/혼합 문서, 원본 해시·노임 버전·비교 셀 수·이미지/PDF 경로를 기록한다. 기존 평택 출력도 회귀 검증한다. Excel/시각 검증을 못 했으면 미검증 사유를 기록한다.
- [ ] **Step 6: `npm.cmd run verify`·문서 갱신·커밋.** 새 출력 검증 전 기존 exporter를 제거하지 않는다.

## 완료 범위와 후속 연결

- **사용자 확정 — 기존 원가 포함 Excel을 PC에서 읽기:** 사이트의 ‘내 PC의 원가 파일 불러오기’에서 파일을 선택하고 브라우저 안에서 계산한 뒤 결과를 PC에 저장한다. 원가 파일·내용을 서버나 AI로 전송하지 않는다. 사용자 파일은 B열 품명, C열 머리글 ‘규격’(실제 의미는 모델명), G열 매입단가를 사용한다. C열 모델을 기준으로 후보를 찾고 B열 품명과 단위를 검증해 견적의 rowId/SKU로 연결하는 입력 어댑터를 계획한다. H열 기존 매입금액은 재사용하지 않고 새 견적 수량으로 계산한다. SKU 없는 파일도 처리할 수 있어야 하지만 중복·미일치·유사 모델을 임의 연결하지 않는다. 수식 가격·단위 누락 등 기존 입력 검증 정책을 우회하지 않는다. 기존 SKU 입력 경로를 유지하며 사용자 파일의 열 구조를 별도 지원한다. 파일 제공이나 실제 원가의 AI 첨부를 구현 전제조건으로 삼지 않는다.
- **실제 사례 자료 수신(2026-10-04):** 사용자 제공 `회의실 타입별 분류(공유).xlsx`의 구조를 읽기 전용으로 확인했다. 총 38시트(집계표 1, 상세 36, 숨김 Sheet1 1)이며 집계표에는 6·8·10·12·16·24·26·40인 및 VIP 타입이 있다. 4인 타입은 집계표에서 확인되지 않았다. 8인/6인은 일부 상세 시트를 공유하므로 시트 수를 독립 사례 수로 간주하지 않는다. SamplePicker의 실제 자료 대기는 이 파일 범위에서 해소되었으나, 품목 매핑·가져오기 및 가격 기준 검증은 별도 수행해야 한다. 원본은 업로드 위치에 보존하며 저장소·사이트 배포에 포함하지 않는다. 자료 제공은 공개 배포 허가로 간주하지 않는다.
- **사용자 추가 요구 — 기존 사례에서 시작:** 구성도 작성·불러오기를 기본 경로로 유지하면서, 4인 회의실 등 기존 공간·공정별 타입을 선택해 불러오는 별도 선택지를 제공한다. 불러온 사례를 그대로 적용하거나 품목·수량을 수정할 수 있게 한다. `SamplePicker`의 기능 범위 보류는 이번 요청으로 해제하며, 실제 등록 데이터는 제공된 기존 사례로 구성한다. 예시 품목이나 수량을 임의로 만들어 실제 사례로 표시하지 않는다. 원본 사례를 보존하고 새 견적으로 복사하며, 단가·공수·적용률·노임 기준을 어떤 버전으로 적용할지는 화면 설계에서 명시한다. 자료 미확보와 기능 제외를 혼동하지 않는다. 이번 출력 구현과 연결되는 필수 후속 화면 요구이며 사례 선택 화면의 구현 완료를 뜻하지 않는다.
- **사용자 추가 요구 — 공수 적용률 수동 조정:** 표준품셈 공수에 적용할 비율(%)을 사용자가 직접 수정할 수 있는 항목을 제공한다. 기본 적용률은 제공 자료의 값을 사용하며 임의로 100%로 통일하지 않는다. 기준 공수·자료의 기본 적용률·사용자가 지정한 적용률을 구분하고, 원자료를 덮어쓰지 않는다. 선택한 적용률은 화면 계산과 Excel 출력에 동일하게 반영한다. 기존 자료의 적용률/할증과 의미를 대조하여 같은 비율을 이중 적용하지 않는다. 후속 화면 설계에서 조정 단위와 견적별 저장 범위를 명시하고, 기존 견적의 기준 자동 변경 금지 원칙을 유지한다.
- **사용자 추가 요구(2026-10-04) — 계산 기준 관리 화면:** 한곳에서 공정별 투입 공수(품)와 상반기·하반기 직종별 노임단가를 모두 수정할 수 있어야 한다. 사용자가 “공수(품)와 노임단가 모두”라고 명시 확정했다. 화면 후속 계획의 필수 범위로 기록한다. 현재 출력 구현은 가이드 추출값을 최초 기준으로 사용하되, 향후 검증된 사용자 수정 버전을 선택해 화면 계산과 Excel에 동일하게 적용할 수 있도록 기준 선택 경계를 유지한다. 기존 견적의 기준은 자동 변경하지 않고 명시적 재계산으로만 바꾼다. 관리 화면은 이번 출력 구현만으로 완료됐다고 보고하지 않는다.
- B1은 기존 수정·회귀 테스트를 확인하고 재사용한다. B2는 Task 6의 명시적 재작업 대상이다. 매크로·외부 링크·암호화·용량 제한은 유지한다. 읽는 SKU 등 식별 열의 수식/캐시 정책도 명시하여 오래된 키로 다른 제품 원가를 연결하지 않는다.
- 원가 업로드 화면, 0단계 경고/추가 확인, 설명 편집, 다운로드 연결은 화면 후속 계획의 필수 작업이다. 이번 완료를 전체 앱 완성이라고 부르지 않는다.
- 품셈 전체 재추출·SKU 마이그레이션은 별도 과제다. 새 노임의 출처/단위 검증은 여기서 끝낸다. 기존 견적 기준을 자동 변경하지 않는다.
- 미확인 품셈·옵션 카드·배관 기타자재 대응표의 기존 차단/보류 결정은 유지한다. 미해결 실자료를 경고만 지워 정식 성공 사례로 만들지 않는다.

**완료 기준:** 계산 기준 일치, 출력 3종×프로파일 2종, 고객/공유 원가 격리, 행 증가·열 제외·실제 Excel 재계산·인쇄 검증의 근거가 모두 남는다. 파일 존재나 테스트 수만으로 완료를 선언하지 않으며 사용자 Excel 작업을 닫지 않고 검증할 수 있어야 한다.
