# 견적 작업 화면 Implementation Plan — 실행 개정본

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 출력 수정은 합의한 검증 범위에서 종결됐고 Task6의 실제 API 및 D22 반영분 교차 검토를 마쳤다. Task1부터 실행한다. O25은 2026-10-05 사용자 결정으로 닫혔다. 트레이 기타자재 기본30%와 사용자 결정 출처를 반영한다.

**Goal:** 사용자가 구성도 또는 품목 선택으로 견적을 만들고, 수량·설명·시공 입력·간접비를 확인/수정한 뒤 로컬 작업 파일과 출력 3종을 직접 저장한다.

**Architecture:** 원가 없는 문서 상태, 계산 기준, 작업 중인 원가 세션을 분리한다. 화면은 도메인 계산 결과만 표시하고 모든 Excel 경로는 검증된 출력 준비 함수를 거친다. 실제 회사 자료는 샘플/빌드에 묶지 않으며 사용자 파일 선택은 브라우저 로컬 처리다.

**Tech Stack:** 기존 React 19.2 / TypeScript 5.9 / Vite 7.1 / decimal.js / Zod / Vitest / Playwright. 새 런타임 라이브러리를 추가하지 않는다.

**Spec:** `docs/design-spec.md` §2·3·5·6·8·9, `docs/decisions/2026-10-03-scope-and-data.md` D7·D8·D11·D12·D15·D18·D20·D21, `docs/design/reference-map.md`, `docs/interface/av-builder.md`, 출력 계획의 사용자 후속 요구.

## 1. 범위와 선행 조건

- 순서: 출력 수정/독립 검증 → 이 화면 → O8 사례 변환기 및 D11 검사. 화면 설계는 현재 진행하되 출력 코드와 동시에 변경하지 않는다.
- 기존 `2026-10-03-stage3a-quote-sheet-render.md` Task0·3의 완료 코드를 재사용한다. 미착수 Task1·2·4·5·6은 이 계획의 Task1·2·7로 대체한다. 읽기 전용 목표와 고정 평택 열/절사 기준을 새 화면에 그대로 적용하지 않는다.
- 원가 입력/확인, 모델 연결, 0단계 추가 확인, 설명 편집, 실제 다운로드까지 이 화면 범위다. 버튼만 그리고 동작을 남겨두는 방식으로 완료하지 않는다.
- O8 사례 선택은 요구사항으로 유지하되 변환기 완성 전 사용 가능한 것처럼 표시하지 않는다. 실제 39선택안/36상세시트 대응은 D21 기준이다. 가짜 사례를 기본 자료로 넣지 않는다.
- 전사 공수·노임 기준 편집, 공수 적용률의 견적별 덮어쓰기/내용 버전은 별도 계산 기준 관리 계획이다. 본 화면에서 원자료를 직접 변이하지 않는다. 관리 기능이 완료됐다는 표시는 하지 않는다.
- 큰 편집기(여러 셀 붙여넣기, 전체 키보드 탐색, 복잡한 행 이동)의 설계서 요구는 후속 편집 단계에 남긴다. 본 계획은 품목 추가/삭제, 수량/설명/비고 수정, 실행취소/다시실행을 제공한다. 원가 세션은 실행취소 이력에 포함하지 않는다.
- 출력 API는 Task6에 0f8df51 기준으로 확정했다. 착수 시 변경 여부만 대조한다. 단일 시스템 builder를 반복 호출해 여러 파일로 내보내는 임의 대체는 하지 않는다.
- D22의 분류·기본 비율·자재 범위를 Task3에서 구현한다. O25은 트레이 기타자재30%로 확정됐다. 출처는 품셈이 아니라 사용자 결정이다. 트레이에 후렉시블20%를 적용하지 않는다. 트레이30%를 같은 요율 관리 경계에서 제공하고 출처를 화면에 표시한다. 업무 결정과 구현 완료는 구분한다. O26은 확정됐다: 견적 단위10M 품목은 필요한 길이를10M 단위로 올림하고 구매 묶음30M/50M에 맞춰 강제 올림하지 않는다. 해당 품목을 사용하지 않는 견적과 다른 화면 작업은 진행할 수 있다. 기존 질문을 반복하지 않는다.

## 2. Global Constraints

- 원가·매입처·원가 파일명·원가 연결 표식은 서버/AI/로그/URL/브라우저 영속 저장소/일반 작업 파일에 넣지 않는다. 영업팀 Excel 저장은 사용자 명시 동작으로만 한다.
- 제품/판매단가 배포의 기존 인증 정책을 확대하지 않는다. 전체 판매단가표까지 로컬 전용으로 옮길지는 아직 별도 결정이다. 원가 로컬 처리 승인을 가격표 공개 승인으로 해석하지 않는다.
- 외부 CDN·분석 SDK·오류 전송·원격 AI는 없다. 글꼴 포함 정적 자산은 자체 제공한다. 초기 승인 데이터/정제 템플릿 로딩을 끝낸 뒤 네트워크를 차단해도 견적·원가·파일 출력이 동작해야 한다.
- 정적 자료 fetch와 `connect-src 'none'`은 동시에 성립하지 않는다. 배포 CSP는 자산 로딩 방식과 함께 후속 배포에서 검증한다. 본 작업의 same-origin GET 허용을 문서/원가 전송 허용으로 넓히지 않는다.
- `undefined` 가격은 ‘미등록’, 명시적 0은 ‘0’이다. 구성도·품셈·계산의 blocking 사유를 모두 표시하고 정식 출력은 막는다.
- 출력 기본값은 2 고객용. 0 영업팀용에는 원가 포함 사실과 저장할 파일 종류를 확인하는 단계가 있어야 한다. 등급을 바꿔도 이전 원가 파일을 변환해서 쓰지 않는다.
- 색상·폰트·버튼·패널·간격은 reference-map의 실제 RTCOM/LED 값으로 계승한다. 인쇄 표 중간에 임의 설명/AI 열을 추가하지 않는다.
- 금액 계산/절사/간접비 식을 React에 복제하지 않는다. 매 변경마다 동일 도메인 경로로 재계산하고 결과를 표시한다.
- 원본 unknown 필드를 그대로 작업 파일에 직렬화하지 않는다. 구성도의 equipmentDB 전체, 이미지 URL 등 불필요한 필드는 버리고 필요한 출처/입력만 allowlist로 저장한다.

## 3. 사용자 흐름

1. 초기 자료 로딩 상태/실패 사유를 표시한다. 구성도 JSON 열기를 주 입구, 품목 직접 선택을 보조 입구로 둔다.
2. 현장·고객·작성일·견적번호를 입력하고 시스템별 내역/갑지/품셈 근거를 확인한다.
3. 미매칭 모델·케이블 품목·길이·옵션 등 확인 항목을 해당 행/구간으로 연결한다. 실제 값을 해결해야 경고가 해소되며 경고 일괄 지우기는 없다.
4. 공간별 천장고·장비실에서 가장 먼 장비까지의 거리·배관 줄 수(기본 3), 구간별 확인된 거리/입상·입하를 입력한다. 배관은 `10m × 3줄 = 30m`처럼 산출 근거와 적용된 수량을 보여준다.
5. 일반/DS 프로파일과 항목별 적용·요율을 선택한다. 조건 문구와 기준 금액을 함께 보여준다.
6. 필요할 때 ‘내 PC의 원가 파일 불러오기’를 사용한다. B품명/C규격=모델/G매입단가로 후보를 확인하고 연결한다. H총액은 사용하지 않는다.
7. 출력 등급을 선택해 검증된 Excel을 내려받거나, 원가 없는 작업 파일을 저장한다.
8. 작업 파일을 다시 열면 저장 기준과 현재 기준을 대조한다. 기준 차이를 표시하고 이전 상태 보기/맞는 기준 불러오기/명시적 새 기준 재계산 중 가능한 동작을 제공한다. 선택 전 출력은 차단한다.

## 4. 파일 책임과 계약

| 파일 | 책임 |
|---|---|
| `src/main.tsx`, `src/app/App.tsx` | React 진입점과 원가 없는 작업 셸 |
| `src/app/workspace.ts` | 문서 수정·취소/복구·준비 결과·오래된 비동기 결과 무시 |
| `src/app/resources.ts` | 승인 데이터와 정제 가이드 초기 로딩, 원가 입력 없음 |
| `src/styles/{tokens,base,workspace}.css` | 공통 토큰, 배경, 견적 표 스크롤/반응형 |
| `src/features/worksheet/{QuoteSheet,CoverSheet,WarningList,IndirectPanel}.tsx` | 금액 표시·입력·차단 사유·조건 표시 |
| `src/features/entry/{DiagramInput,ProductPicker}.tsx` | 로컬 JSON 입력과 카탈로그 품목 선택 |
| `src/features/installation/InstallationPanel.tsx` | 공간/구간별 시공 입력과 계산 근거 |
| `src/domain/quote/installation.ts` | 거리/배관 계산과 단위 검증; React 외부 |
| `src/features/private-cost/{PrivateCostPanel,CostMatchDialog}.tsx` | 원가를 볼 수 있는 전용 경계 |
| `src/services/private-cost/workspace.ts` | 세션 수명/rowId 연결/교체·삭제; 영속 저장 금지 |
| `src/services/files/{workFile,download}.ts` | 원가 없는 allowlist 작업 파일·Blob 다운로드 |
| `src/features/export/{ExportPanel,SalesExportAction}.tsx` | 1·2 경로와 0단계 추가 확인/전용 연결 분리 |
| `src/features/basis/BasisConflictDialog.tsx` | 다시 열기/기준 변경/명시적 재계산 |
| `tools/vite-guide-assets.ts`, `vite.config.ts` | 정제 템플릿4+manifest만 dev/build에 제공 |
| `tools/audit-exports.mjs` | 원가 UI 경계 검사와 고객/공유/저장 금지 경계 유지 |

신규 계약은 원가 없는 값만 담는다:

```ts
import type { QuoteDocument } from '../../../src/domain/quote/types';
import type { PreparedQuote } from '../../../src/export/variants/prepare';
import type { ImportWarning } from '../../../src/import/diagram/devices';

export interface SpaceInput {
  systemId: string;
  ceilingHeightM?: string;
  farthestDeviceMeters?: string;
  conduitRuns: string; // 새 공간의 기본값 '3'
  conduitType: 'flexible' | 'cd'; // 기본 flexible; 품목은 승인 카탈로그에서 별도 연결
  conduitMaterialRate: string;
}
export interface RouteInput {
  edgeId: string;
  systemId: string;
  source: 'measured-route' | 'confirmed-total';
  horizontalMeters?: string;
  riseMeters?: string;
  dropMeters?: string;
  confirmedTotalMeters?: string;
}
export interface WorkFileV1 {
  schemaVersion: 1;
  document: QuoteDocument;
  spaces: SpaceInput[];
  routes: RouteInput[];
  importWarnings: ImportWarning[];
}
export type WorkspaceStatus =
  | { kind: 'empty' }
  | { kind: 'editing'; work: WorkFileV1; prepared: PreparedQuote }
  | { kind: 'basis-conflict'; work: WorkFileV1; reasons: string[] };
// 신규 함수: Task4에서 구현. 알 수 없는 필드는 제외하고 기존 버전을 보존한다.
export declare function encodeWorkFile(work: WorkFileV1): string;
export declare function decodeWorkFile(text: string): WorkFileV1;
```

위 선언은 신규 설계 계약이며 기존 구현이 있다는 뜻이 아니다. 타입은 `src/services/files/workFile.ts`에 두고 상대 import 경로를 맞춘다. 실행 시 스키마로 행별 허용 항목을 검증하며 타입 단언만으로 통과시키지 않는다.

## 5. Review Focus

1. 작업 파일을 열자마자 최신 가격으로 바뀌거나 이전 원가가 복원되는 경우 → Task4·5.
2. 거리 미입력이 0m가 되거나 재산출이 수동 수정을 덮어쓰고 행을 중복 추가하는 경우 → Task3.
3. 미등록과 0원, 건강보험 미적용과 계산 오류가 같은 상태로 보이는 경우 → Task2.
4. 고객용에 원가/AI 메모가 섞이거나 원가 읽기 후 내용이 전송되는 경우 → Task5·6.
5. 390px에서 표 밖까지 가로로 넘치거나 긴 한글 품명/확인 이유가 가려지는 경우 → Task1·7.

## Task 1 — 실제 화면과 초기 자료 로딩

**Files:** main/App/resources, styles, vite-guide-assets, `tests/e2e/workspace.spec.ts`, `playwright.config.ts`.
**Interfaces:** resources는 기존 buildCatalog/buildGuideBasis/readGuideTemplate을 이용해 승인 입력을 준비한다. App은 WorkspaceStatus를 렌더한다. 원가 자료를 resources에 넘기지 않는다.

- [ ] 합성 승인 데이터 fixture로 로딩 성공/필수 파일 실패/판매가 없음/손상 가이드 실패를 Playwright에서 작성하고 실패를 확인한다.
- [ ] RTCOM 셸과 LED 입력창/탭을 계승한다. 빈 화면의 두 실제 입구를 만든다. 초기 파일 로딩은 파일별 실패 사유를 표시하며 판매가 미등록만 허용한다.
- [ ] 가이드4+manifest를 배포 자산에 명시적으로 복사한다. 업로드 폴더·`.local`·원본 xlsx는 제외한다. Node fs 사용 모듈을 브라우저 번들에서 사용하지 않는다.
- [ ] `npm.cmd run build`, `npm.cmd run verify`, `npx.cmd playwright test tests/e2e/workspace.spec.ts`를 실행하고 원본 미포함을 검사한 뒤 관련 파일만 커밋한다.

```ts
// tests/e2e/workspace.spec.ts — fixture 서버가 합성 승인 데이터를 제공한다.
import { test, expect } from '@playwright/test';
test('실제 입구와 기본 고객 출력', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '구성도 JSON 열기' })).toBeVisible();
  await expect(page.getByRole('button', { name: '품목 직접 선택' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '2 고객용' })).toBeChecked();
  // 출력 등급의 기본 선택과 빈 문서의 다운로드 차단은 별도로 검증한다.
  await expect(page.getByRole('button', { name: 'Excel 다운로드' })).toBeDisabled();
});
```

## Task 2 — 두 입구·견적표·설명·간접비

**Files:** workspace, entry, worksheet, `tests/e2e/quote-edit.spec.ts`.
**Interfaces:** 기존 parseDiagram/diagramToQuote/pickedItemsToQuote를 확인해 호출하고 결과 document/warnings를 함께 보존한다. prepareQuote의 mode와 profileBySystem을 호출부에서 명시한다.

- [ ] 같은 합성 품목/수량을 두 입구로 입력해 직접비/간접비/갑지 동일, 미등록과0 구분, 수량/설명 수정·취소 테스트를 먼저 작성/실패 확인한다.
- [ ] 행 rowId를 유지하는 reducer와 입력 검증을 만든다. 빈 수량·음수·잘못된 소수는 원래 문서를 덮어쓰지 않고 해당 입력에 이유를 표시한다. 설명은 CatalogProduct.options['description']에서 실제 입력 경로로 전달되는지 검증하고 사용자 편집을 보존한다.
- [ ] AI 변환 설명과 사람 비고를 분리한다. 미해결 모델/옵션의 후보 선택은 실제 mapping/입력을 수정하며, 전체 confirmed=true 우회는 없다.
- [ ] 시스템별 프로파일과 적용/요율을 편집한다. 각 항목의 conditionText·basisLabel·기준금액을 표시한다. 조건은 가이드에서 온 문구이며 현재 법령에 대한 판단으로 표현하지 않는다. 자동 적용하지 않는다.
- [ ] D12 사용자 확정: 새 견적의 기본 프로파일은 `ds`다. 기존 문서의 프로파일·사용자 수정 요율을 기본값으로 덮어쓰지 않는다. 화면 요율은 `0.000%` 형식으로 표시하고 입력도 % 단위임을 명시한다. 저장·계산은 기존 소수 DecimalText를 유지하며 decimal.js로 ×100/÷100 변환한다. 표시용 반올림은 저장값을 변경하지 않는다. 편집하지 않은 blur에서는 원래 정밀도를 보존한다. 화면의 기본 요율 출처는 `indirectCostsFor(profile, guides)`이며 기존 평택 exporter 상수와 섞지 않는다. 두 입구의 DS 초기 선택, 0.0486↔4.860%·0.00424↔0.424%·0.00128↔0.128%, 프로파일 변경 및 undo/redo 후 입력칸·계산값 일치, 기존 수정값 보존을 검증한다.
- [ ] 건강보험이 꺼진 상태에서 장기요양을 켜면 ‘기준인 건강보험료가 0원이라 이 항목도 0원’이라고 표시한다. 노동비1,000,000·건강0.03545·장기요양0.1295 fixture에서35,450/4,590 대조한다.
- [ ] 단위 테스트+실제 클릭 E2E+verify 통과 후 커밋한다. React에 금액 식을 복제하지 않았는지 검토한다.

## Task 3 — 천장고·경로·배관 입력과 재산출

**Files:** installation domain/panel, diagram cables/derived/toQuote, workFile 입력 타입, `tests/unit/installation.test.ts`, `tests/e2e/installation.spec.ts`.
**Interfaces:** SpaceInput/RouteInput을 받는 순수 도메인 함수로 결과 길이와 근거를 생성한다. 기존 cable/derived 생성 함수에는 검증된 입력을 넘긴다. 현재 DiagramFile은 실거리/천장고를 보장하지 않으므로 UI좌표를 m로 읽지 않는다.

- [ ] 아래의 단위 테스트와 재산출 중복 방지 테스트를 작성하고 실패를 확인한다. 입력 source가 다르면 적용 식도 달라야 한다.
- [ ] 현재 cables.ts에는 ×1.3 보정이 없다. Task3에서 누락된 보정을 추가한다. measured-route는 `(horizontal + rise + drop) × 1.3`, confirmed-total은 사용자가 확인한 최종 산출거리 그대로 적용한다. 천장고만으로 rise/drop을 확정하지 않고 장비 설치높이/확인된 입상·입하를 입력받는다.
- [ ] cableType별 소비 경로를 분리한다. ready-made의 BOM.length는 제품 규격이므로 원본 값을 바꾸거나 ×1.3 하지 않는다. RouteInput의 산출거리를 snapToStep에 전달해 필요한 제품 길이를 선택하고, 그 길이에 맞는 SKU·규격·가격을 함께 확인한다. 일치하는 제품을 찾지 못하면 확인 필요 상태로 두며 기존 SKU에 새 길이만 붙이지 않는다. manufactured는 보정 전 구간 거리 대신 RouteInput의 산출거리를 합산에 사용하고 합산 후 10M 단위로 올림한다. 원본 BOM은 보존한다. 경로 입력이 없으면 제품 길이로 경로를 추정하지 않는다.
- [ ] ready-made 3m 제품의 BOM.length가 재산출 후에도 3인 테스트와, 별도 경로가 3m여서 보정 후 3.9m가 필요하면 5m 제품 후보를 선택하는 테스트를 분리한다. manufactured의 구간별 보정·합산·올림도 검증한다.
- [ ] D8 최신 결정에 따라 배관은 공간별 `farthestDeviceMeters × conduitRuns`로 계산한다. 거리와 줄 수를 저장하고 결과 conduitMeters는 계산해서 표시한다. 새 공간의 줄 수 기본값은 '3'이며 사용자가 변경할 수 있다. 왕복이라는 표현으로 ×2를 추가하지 않고 케이블 여유분 ×1.3도 배관에 적용하지 않는다. 공간당 50m 기본값은 폐기한다.
- [ ] 거리가 없으면 '입력 필요'로 유지하고 0m나 50m로 대체하지 않는다. 배관 산정에 필요한 값이 없으면 해당 산정과 그에 의존한 정식 출력을 차단한다. 명시적 0과 빈칸을 구분하고 음수·잘못된 숫자·소수 줄 수를 거부한다. 최종 길이 직접 입력 모드는 이번 범위에 추가하지 않는다.
- [ ] D22를 적용한다. 배관 여부는 승인 카탈로그의 options.group 원문 묶음(배관자재·케이블 트레이)으로 판정하고 품명 문자열을 검색하지 않는다. 케이블 트레이도 배관 분류에 포함하되 후렉시블/CD관과 같은 제품으로 취급하지 않는다. 묶음 출처가 없거나 불명확하면 확인 필요로 남긴다.
- [ ] 배관 종류는 후렉시블(기본)/CD관/케이블 트레이 선택으로 제공한다. 기타자재 비율의 기본값은 후렉시블20%, CD관40%, 트레이30%이며 사용자 수정값을 별도로 보존한다. 종류 변경 시 적용될 비율을 표시하고 기존 사용자 수정값을 조용히 덮어쓰지 않는다. 트레이를 후렉시블로 간주해20%를 자동 적용하지 않는다. 기본 요율과 출처는 같은 관리 경계에 둔다. 후렉시블/CD관은 품셈 근거, 트레이는 사용자 결정(2026-10-05)으로 표시한다. 향후 승인 품셈에 트레이 비율이 반영되면 새 기준 후보로 취급하고 기존 견적·수동 수정값을 조용히 바꾸지 않는다.
- [ ] 승인된 원가삭제 표준품셈 목록의 자재만 선택할 수 있다. 카탈로그에 미등록된105건을 자동 보충하지 않는다. 현재 CD관을 고르면 '품셈에 CD관 품목이 없습니다'를 표시하고 해당 품목 생성·출력을 차단한다. 0원이나 후렉시블로 대체하지 않는다. 이후 승인된 카탈로그에 유효한 CD관 행이 반영되면 동일 경로로 선택 가능하게 한다. 원본 Excel 수정만으로 기존 견적이 자동 갱신되지는 않는다.
- [ ] O21/O24/O11의 업무 결정은 D22로 확정됐으며 구현 완료와 구분한다. 해당 분류·선택을 바탕으로 파생 행을 생성하고 기존 D19 일반/DS 원가측 차이를 유지한다. O26 확정에 따라 견적 단위10M 품목의 수량은 `ceil(산출거리 / 10)`이다. 필요한 길이와 견적 반영 길이를 함께 표시한다. 구매 묶음50M/30M 표시는 구매 담당 참고 정보이며 견적 수량에 영향을 주지 않는다. 구매 묶음 미기재만으로 산정을 차단하지 않는다. EA·3M 기준 트레이에는10M 규칙을 적용하지 않는다.
- [ ] 트레이의 배관 분류·전용30%·EA3M 단위·출처 표시·저장/재열기, 후렉시블 기본20%, 사용자 비율 수정 보존, CD관 미등록 차단을 검증한다. 10M 단위 품목의20m→수량2,21m→수량3을 검증하고 구매 묶음이30M/50M/미기재인 경우에도 결과가 같음을 확인한다.
- [ ] 배관 10m×3줄=30m, 줄 수 변경 10m×2줄=20m, 거리 미입력, 명시적0, 음수·소수 줄 수 거부를 검증한다. 저장·재열기 후 거리와 줄 수가 각각 유지되고 30m가 재현되는지 확인한다. 기존 50m 결과만 있는 파일에서 거리·줄 수를 역산하지 않으며 이전 상태를 보존하고 명시적 기준 변경과 입력을 요구한다.
- [ ] 재산출은 해당 sourceEdgeId/시스템에서 생성된 행을 교체하며 행을 누적 추가하지 않는다. 수동 수정 행은 표시하고 덮어쓰기 대상을 미리 보여준다. 실행취소와 저장/재열기에 입력/근거가 함께 보존돼야 한다.
- [ ] D19 최신 사용자 확정(O27 닫힘): 잡자재비는 LED 캐비넷을 제외한 재료비 합계의 2%를 INT 처리하여 자동 생성한다. 캐비넷 분류는 승인된 묶음 출처로 판정한다(IEA·IEA-F·IEA-E·IEA-EF·IFR-M·IFR-MF·MPF·MMF·MMF-S). 품명 검색이나 행 위치로 추정하지 않는다. S-BOX·자석지그·설치프레임 등 부속품과 앞선 배관 기타자재는 합산에 포함하며 잡자재비 자신의 금액·노무비·간접비는 포함하지 않는다. 분류 출처가 없는 LED 품목은 확인 필요로 표시한다. 신규 원본 카탈로그 반입이나 단종 제품의 임의 교체는 하지 않는다.
- [ ] LED 제외는 화면 계산뿐 아니라 0/1/2단계 Excel 수식에 같은 행 근거로 적용한다. 기존 `material-sum-to-here` 전체 연속합만으로 제외를 표현하지 못하므로 파생 기준과 projection/layout 계약을 필요한 범위에서 확장한다. 고객용 파일에 내부 분류 데이터가 유출되지 않도록 최종 허용 셀 수식으로 변환한다. 0단계 원가/판매 양쪽의 제외와 기존 D19 일반/DS 배관 원가 차이를 함께 검증한다. LED 없음/캐비넷+부속품 혼합/캐비넷만/중간 캐비넷/배관 기타자재 포함/재산출 중복 없음/편집·undo·Excel 재계산을 대조한다. 간접비 시트에 정의돼 있다는 사실만으로 일반↔DS 변경 시 잡자재비 비율이 달라진다고 추정하지 않는다.
- [ ] 도메인/E2E/verify 후 커밋한다. 구성도 원본 계약을 바꾸지 않은 것을 확인한다.

```ts
// 신규 순수 함수 calcRouteMeters(input: RouteInput): string (Decimal 기반)
expect(calcRouteMeters({ edgeId:'e1', systemId:'s1', source:'measured-route',
  horizontalMeters:'10', riseMeters:'2', dropMeters:'2' })).toBe('18.2');
expect(calcRouteMeters({ edgeId:'e1', systemId:'s1', source:'confirmed-total',
  confirmedTotalMeters:'18.2' })).toBe('18.2');
// 같은 입력을 두 번 재산출해도 행 수·rowId 연결·총수량이 변하지 않는다.
```

## Task 4 — 원가 없는 작업 파일 저장·열기와 기준 충돌

**Files:** workFile/download, BasisConflictDialog, workspace, `tests/unit/workFile.test.ts`, `tests/e2e/work-file.spec.ts`.
**Interfaces:** encodeWorkFile/decodeWorkFile과 WorkFileV1. 문서 저장 기준 및 승인된 판매단가 스냅샷은 보존하고 PrivateCostSession은 인자로 받지 않는다.

- [ ] 원가/supplier/costEntryId/원가파일명 sentinel을 runtime 객체와 unknown 필드에 넣고 저장 결과에서 제외되는 테스트, 손상JSON·미지원 schemaVersion 거부 테스트를 먼저 작성한다.
- [ ] row type별 allowlist schema를 작성한다. 문서의 unknown JSON을 spread해서 저장하지 않는다. 형식 오류는 현재 열려 있는 작업을 잃지 않게 처리한다.
- [ ] 열기에는 preserve를 사용한다. DocumentVersions의 catalog/labor/wage/template/rule 다섯 축을 저장 당시와 현재 선택한 기준 사이에서 비교한다. 하나라도 다르거나 누락되면 차이와 영향을 보여주고 다운로드를 막는다. 기존 basis 검사가 다루지 않는 축은 파일 coordinator에서 검증한다.
- [ ] 가이드의 절사 규칙 변경은 template 버전으로 감지한다. 문서의 coverTotalDigits/roundingDigits는 사용자 설정으로 그대로 저장·복원하며 현재 기본값으로 덮어쓰지 않는다. rule은 케이블 계단·커넥터·배관 산정식과 기본 줄 수 등 계산 규칙의 버전이다. 배관의 거리·줄 수·기타자재 비율은 문서 입력으로 보존하며, 기본값 변경과 사용자 입력 변경을 구분한다. rule만 변경된 재열기 차단 테스트를 포함한다.
- [ ] ‘새 기준으로 재계산’을 선택하기 전 판매가/합계를 바꾸지 않는다. 재계산 후보를 복사본으로 만들고 전후 차이를 보여준 뒤 적용한다. 원래 기준 데이터가 없으면 이전 자료 열람과 기준 파일 불러오기를 제공하며 과거 계산을 재현했다고 주장하지 않는다.
- [ ] 원가 지우기/페이지종료/새문서/다른작업 열기는 private session과 연결을 폐기한다. 작업파일 재열기에서 원가 연결을 복원하지 않는다.
- [ ] unit/E2E/verify 후 커밋한다.

## Task 5 — 내 PC의 원가 파일과 모델 확인

**Files:** private-cost workspace/panel/dialog, audit-exports, `tests/e2e/private-cost.spec.ts`.
**Interfaces:** 기존 readTable→parsePrivatePrices→createSession→candidatesByModel/byEntryId→internalLines. 화면 일반 reducer에는 원가/후보 배열을 넣지 않고 전용 controller 수명으로 관리한다.

- [ ] 합성 엑셀의 B품명/C규격/G단가/H금액을 입력하고 G만 읽는 테스트를 작성한다. 동일 모델2건, SRG-A40/SRG-A40T, 단위 불일치, 수식 가격, 파일 교체, 늦게 끝난 이전 파싱 결과를 포함한다.
- [ ] 열 미리보기에서 C ‘규격’의 모델 의미를 표시한다. 통화·단위가 파일에 없으면 KRW/단위를 사용자가 명시 확인하는 입력을 제공하고 parser에 검증된 값으로 전달한다. 자동 추측하지 않는다. 빈값을0으로 채우지 않는다.
- [ ] 확인 입력은 mapping을 통해 currency-empty/unit-empty 등 누락만 해소한다. 파일에 이미 있는 통화·단위를 덮어쓰지 않는다. currency-mixed는 확인값으로 해소하지 않으며 오류 코드와 해당 행을 UI에 표시하고 입력을 거부한다. 혼합 통화 파일에 KRW 확인을 주어도 실패하는 테스트를 포함한다.
- [ ] SKU 또는 정확한 모델 후보와 B품명/단위를 대조한다. 중복 후보는 선택/미연결로 남긴다. 수동 확인 연결은 rowId와 해당 세션 표식에 묶고 새 파일 선택 즉시 무효화한다.
- [ ] 원가를 다루는 UI는 customer/shared/files 경로와 분리한다. 감사기 허용을 features 전체로 풀지 않고 전용 경계만 지정한다. controller의 network/storage/log 사용은 금지한다.
- [ ] 초기 자산 로딩 후 offline 상태에서 원가선택·계산·다운로드가 되는지 확인한다. 온라인 상태에서도 선택 이후 요청에 파일·이름·모델·원가 sentinel이 나가지 않는지 요청 감시한다. 저장소/console/일반 작업파일에도 없는지 확인한다.
- [ ] E2E/verify 및 감사 위반을 고의 삽입한 역방향 테스트 통과 후 커밋한다.

## Task 6 — 출력 3종과 미해결 상태

**Files:** export panels, workspace export adapter, download, `tests/e2e/download.spec.ts`.
**Interfaces:** 아래에 확인한 prepared→각 등급 builder 계약을 사용한다. adapter는 1·2 입력에 원가 controller를 전달하지 않는다. SalesExportAction만 원가 세션에 접근한다.

### 확인된 출력 API (0f8df51 기준)

- 준비: `prepareQuote(PrepareInput): PreparedQuote`. blocking이면 builder 호출 전 차단한다. `wageMode`, `profileBySystem`, `importWarnings`를 명시한다.
- 고객용: `buildCustomerProjection(prepared.document, prepared.priced.calculation)` → `buildMultiSystemCustomerGuideWorkbook({ exported, guideBySystemId })` (`src/export/customer/guideMultiSystem.ts`).
- 공유용: `buildSharedProjection(prepared, notes)` → `buildMultiSystemSharedGuideWorkbook({ shared, guideBySystemId })` (`src/export/shared/workbookMulti.ts`).
- 영업팀용: `buildMultiSystemSalesGuideWorkbook({ shared, extras, guideBySystemId, baseGuideBySystemId })` (`src/export/internal/guideWorkbookMulti.ts`). extras는 전용 원가 경계에서만 구성한다. guideBySystemId는 원가본, baseGuideBySystemId는 같은 프로파일의 품셈본이다.
- 모든 결과는 `MultiSystemGuideWorkbookResult`의 bytes로 다운로드하고 systems의 시트별 layout을 검증에 사용한다. 단일 시스템도 지원되는 입력으로 다루며 기반 함수 `buildMultiSystemGuideBase`를 공유용 완성 파일로 사용하지 않는다.
- 시스템 여러 개와 그룹 여러 개를 구분한다. 현재 여러 그룹 또는 그룹에 일부 시스템만 들어간 입력은 지원하지 않으므로 이유를 표시하고 차단한다. 첫 그룹만 출력하지 않는다.

출력 API 선행 조건과 D22 교차 검토를 충족했다. O25의 사용자 결정30%를 반영해 실행한다. 미결정 사항이 다른 화면 작업의 착수를 막지는 않는다.

- [ ] 새 문서 기본2,0선택 추가확인,취소시 미저장,구성도/품셈/계산 blocking 출력차단,빈문서 차단,템플릿 누락 사유,DS/일반 혼합 출력을 E2E로 먼저 작성한다.
- [ ] 다운로드 클릭 시 현재 문서 revision의 prepared 결과를 사용한다. 계산/파일읽기 중 수정된 옛 결과로 다운로드하지 않는다. Blob URL은 사용 후 해제한다.
- [ ] 원가가 없는 품목은0원으로 표시하지 않고 원가미등록을 보여준다. 허용되는 내부 부분원가 출력은 완전한 원가합계로 보이지 않도록 엔진 상태를 따른다.
- [ ] Playwright download 이벤트로 실제 받은 파일을 검사한다. 파일명만 검사하지 말고 최종 고객 열/AI메모/원가분리,1설명,0BF,혼합시스템을 검증한다. private→customer→private→customer 순서도 포함한다.
- [ ] 다운로드한 파일을 기존 Excel 검증기와 독립 domain 기대값으로 대조한다. UI 화면값/다운로드값이 같은 입력·기준에서 일치하는지 확인한 뒤 커밋한다.

## Task 7 — 전체 사용 흐름·시각 검수·인수 기록

**Files:** Playwright scenarios, `docs/template/verification.md`, `docs/stage-status.md`.
**Interfaces:** 화면 최초 진입에서 파일저장/재열기/다운로드까지 브라우저 입력만 사용한다. 내부 state 주입만으로 정상 경로를 통과시키지 않는다.

- [ ] 구성도와 직접선택 각각으로 새 견적→경고 해결→시공 입력→프로파일/요율→설명 수정→작업 저장→재열기→0/1/2 다운로드 흐름을 실행한다.
- [ ] 1440/1024/390px에서 실제 RTCOM/LED 화면과 나란히 비교한다. 긴 한글/100행/복수 시스템, 탭/툴바/표 내부 스크롤, focus/키보드 파일입력을 확인한다. 기존 실제 샘플을 공개 스크린샷 fixture로 쓰지 않는다.
- [ ] 모든 UI 실제 경로가 감사 대상에 포함되는지 확인한다. 테스트 수를 목표로 삼지 않고 각 요구의 검증 파일/산출물/미검증 이유를 기록한다.
- [ ] verify/build/E2E/Excel 검증 후 Codex 독립 검토를 받는다. 사용자 서비스 배포·인증/DNS 변경은 별도이며 로컬 사용가능과 운영배포 완료를 구분한다.

## 6. O8/D11 후속 설계 경계

공통 리더는 셀 주소·원래 수식·캐시·형식·시트 관계를 보존하는 evidence model을 만든다. O8 변환은 이를 QuoteDocument로 매핑하고 D11 검사는 evidence와 독립 계산을 대조한다. 정규화된 문서만으로 원래 수식이 맞았다고 판정하지 않는다. 비교본 없이 수동 수정 이력을 확정할 수 없으므로 수식 대신 상수가 들어간 사실과 수정 주체/시점 추정을 구분한다.

외부참조·지원하지 않는 함수·오래된 캐시·연결 정보 없는 케이블은 ‘미검증/정보 필요’다. ‘문제 없음’과 구분한다.39선택안/36시트는 별도 식별자를 유지하고 과거 금액은 기준을 맞춘 뒤에만 대조한다.

## 7. 구현 중 재확인할 경계

- Task3의 거리 입력과 기존 BOM.length 의미를 계약서와 대조할 것. 의미 확인 없이 기존 입력에1.3을 중복 적용하지 않는다.
- Task4의 기준 스냅샷/카탈로그 변경과 preserve 경계가 기존 타입으로 표현 가능한지 확인할 것.
- Task5에서 기존 원가 parser를 완화하지 않고 단위/통화 사용자 확인을 연결하는지 확인할 것.
- 공수·노임·적용률 관리와39사례선택이 후속 필수로 남아 있는지 확인할 것.
- Task6의 확정 API를 사용하고 각 Task의 검증을 실행한다. 문서의 실행 가능 상태는 화면 구현 완료를 뜻하지 않는다. O25 업무 결정만으로 구현을 완료로 표시하지 않으며 후속 필수 기능도 검증 전 완료로 표시하지 않는다.

## 8. 2026-10-05 추가 요청 — 메인페이지 노임 공표 PDF

사용자 요청: “26년 하반기 노임이야. 메인페이지 보기와 다운로드 아이콘 만들어 볼 수 있게 해 줘”.

- [ ] 메인페이지의 자료 안내 영역에 “2026년 하반기 정보통신 노임 공표” 제목과 보기·다운로드 아이콘을 둔다. 아이콘에는 보이는 설명 또는 접근 가능한 이름을 붙이고 기존 디자인을 계승한다.
- [ ] 전달받은 PDF 원본 경로·문서 제목·공표기관·적용기간을 확인한다. 계획 담당 보고상 적용기간은 2026-09-01~2026-12-31이다. 템플릿 17직종 전체를 이 PDF가 증명한다고 표기하지 않는다. PDF 미포함 직종은 별도 출처 확인 대상이다.
- [ ] 보기는 같은 사이트의 PDF를 새 탭으로 열고 다운로드는 동일 파일을 저장한다. BASE_URL을 적용해 하위 경로 배포에서도 동작하도록 한다. 외부 뷰어·추가 PDF 라이브러리는 도입하지 않는다.
- [ ] 승인된 노임 공표 PDF와 표준품셈 PDF 두 파일을 각각 자산 허용목록과 .gitignore 예외에 명시한다. 업로드 폴더 전체나 모든 PDF를 복사/추적하지 않는다. 보류 중인 공개 푸시·배포는 별도 승인 전 실행하지 않는다.
- [ ] PDF 파일과 다운로드 결과의 일치, 실제 보기 경로, 접근 가능한 버튼 이름, 빌드 산출물 포함 여부를 확인한다. CSP 호환성은 브라우저에서 확인하며 정책을 임의로 넓히지 않는다.
- [ ] 공표기간 종료와 계산 기준 버전 불일치는 별개다. 사용자 업무 결정에 따라 다음 공표 반영 전까지 계속 사용한다. 기간 종료일이 지나도 날짜만으로 경고·자동 변경·출력 차단을 하지 않는다. 적용기간은 원문 정보로만 표시한다. 새 계산 기준을 명시적으로 반영할 때 버전 차이를 확인하고 기존 견적 재계산은 사용자 선택을 따른다. 이번 요청은 자료 보기·다운로드이며 노임 자동 갱신 기능이 아니다.
- [ ] 자료 PDF는 링크만 렌더링하고 초기 화면에서 fetch·prefetch·preload·iframe·object로 가져오지 않는다. 사용자가 보기/다운로드를 선택할 때만 요청한다. 표준품셈 PDF도 동일한 방식으로 제공할 수 있으며, 실제 원본 경로·제목·제공 범위를 확인한 파일만 개별 허용목록에 추가한다. 초기 페이지 네트워크에서 PDF 요청0건을 검증한다.

### 표준품셈 PDF 요청 범위 확정

- 사용자 원문: “이건 노무비 산출근거 자료야. 이것도 동일하게 처리해 주고 배관자재, 공정별 노무산출은 이 자료 바탕으로 정립된 거야.”
- 원본: `C:/Users/khk00/.paseo/uploads/upload_5204d5d3-2e4a-46f4-8be9-4dbd2f93c005/2026년도-적용-정보통신공사-표준품셈.pdf`.
- 메인페이지 제목은 “2026년도 적용 정보통신공사 표준품셈”, 용도는 “노무비 산출근거 자료”로 표시한다. 노임 공표와 별개 자료로 보기·다운로드를 제공한다.
- 요청 범위는 원본 보기·다운로드다. 내용 추출·웹 본문 재가공·계산식 또는 품셈 매핑 변경은 포함하지 않는다. 사용자 설명을 근거로 현재 매핑 전체가 원문과 검증됐다고 표시하지 않는다.
- 계획 담당은 587쪽·4,069,128 bytes 및 일부 앞쪽 본문을 확인했으며 전체 내용·재배포 조건·현재 매핑 대조는 미검증이다. 구현 시 원본 파일 확인과 명시 이용조건 확인 범위를 기록한다. 공개 푸시·배포 보류는 유지한다.
- Task4의 기준 불일치 감지는 구현된 기능이고 사용자가 새 품셈·가이드를 업로드해 교체하는 관리 화면은 O22 후속 과제다. 자료 PDF 다운로드 기능과 기준 갱신 기능을 혼동하지 않도록 안내한다.
## 9. D5 후속 — HDBaseT 연동 자료

D5 현재 요약(e55be45)의 사용자 확정 규칙은 **전송 장비 실제 1대당 2m HDMI 1개**다. 한 구간이 TX 1대와 RX 1대로 구성되면 2m HDMI 2개와 UTP 케이블 1개가 필요하다. 이전의 “송수신기라는 품명이면 HDMI 2개” 해석은 폐기한다. O9의 HDBaseT 업무 결정은 닫혔다. 자동 연동 구현과 아래 중복 처리·SKU 선택 계약은 아직 완료되지 않았다.

- 확인된 SKU에 실제 장비 수와 역할을 연결한다. CT-/CR- 같은 모델 접두사나 품명으로 역할·대수를 추정하지 않는다. XDM-CTR100은 TX/RX 모드 선택형으로 1대가 한쪽 끝에 해당하며 HDMI 1개를 적용한다. 확정된 대수는 VE801(VID-0269)이 2대, VE801-T(VID-0270)가 1대이며 PV185S는 사용하지 않는다(2026-10-05). VE801과 VE801-T는 같은 SET 단위지만 대수가 다르므로 단위 문자열로 대수를 환산하지 않는다. PV185S는 승인 카탈로그에 없어 별도 삭제 작업을 하지 않는다. 확정되지 않은 SKU는 임의로 환산하지 않고 사용자 지정을 받는다. 이미 질문한 사항은 반복하지 않는다.
- 구성도 BOM이나 직접 추가 품목에 이미 들어 있는 HDMI를 무조건 다시 추가하지 않는다. 연결 구간/장비별 출처로 기존 케이블과 대응 가능한지 확인하고, 출처 없는 수량을 임의 차감하지 않는다.
- TX와 RX 개별 행, 세트 행의 중복 표현을 구분한다. 재산출의 중복 방지, 장비 수량 변경·삭제, 수동 케이블 추가·삭제, 실행취소, 저장/재열기에서 연결 근거가 보존되도록 별도 설계한다.
- 2m HDMI의 승인 카탈로그 SKU가 여러 개면 사용자가 선택하고, 없으면 미등록으로 알린다. 임의 대체·자동 SKU 선정은 하지 않는다. UTP 길이는 기존 경로 입력 규칙을 따르며 HDMI 개수로 길이를 추정하지 않는다.
- 현재 Task5 원가 UI 작업과 별도 항목으로 유지한다. 분류 및 중복 처리 계약을 확인한 뒤 구현하며, 이 절 추가만으로 자동 연동 구현 완료로 표시하지 않는다.
