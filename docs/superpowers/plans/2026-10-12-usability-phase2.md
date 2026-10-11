# 견적 작업 화면 2차 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 사용자 지정 구현자 `d2a784d1-a0cd-4319-9b69-33604cd80545` 한 세션에서 순차 구현합니다.

**Goal:** 견적표를 먼저 보고, 출력 전에 해결할 항목에서 정확한 입력 위치로 이동할 수 있도록 화면을 정리합니다.

**Architecture:** 계산·문서 상태는 기존 workspace와 PreparedQuote를 사용합니다. 읽기 전용 문제 목록과 화면 탐색 상태를 분리하고, 탐색만으로 문서나 원가 세션을 바꾸지 않습니다. 기존 입력 컴포넌트와 해소 경로를 재사용합니다.

**Tech Stack:** React, TypeScript, 기존 CSS, Vitest, Playwright. 새 UI 라이브러리는 추가하지 않습니다.

**Spec:** 이 문서의 §1이 승인된 2차 방향을 구체화한 명세입니다. 이전 단계는 `2026-10-09-usability-phase1.md`입니다.

**상태:** 구현 인계본. 지정 검토자가 2판의 실행 가능성을 확인했고, 남은 낮음 2건은 문구 보강 후 인계해도 된다고 판단했습니다. 아래에 두 건을 반영했습니다. 계획 검토 통과이며 구현·검증 완료를 뜻하지 않습니다.

## Global Constraints

- 단독 구현자 원칙과 `docs/team-split.md`의 2026-10-12 역할을 따릅니다.
- 기존 노무 확인, D23, 전역 `confirmed:false`, Decimal 계산, 원가 격리, 시스템별 간접비 정책을 유지합니다.
- 금액은 CalculationSnapshot에서 읽습니다. 화면에서 별도 계산식을 만들지 않습니다.
- LED, HDBaseT 자동 연결, 품셈 교체, O22 기준 관리 기능은 이번 범위가 아닙니다.
- 공개 push·배포, 원본 자료 반입, 실제 원가의 시험·로그 저장을 하지 않습니다.
- 현재 공유 작업 폴더의 브랜치 `codex/usability-phase1`, 기준 `a7cf3ac`을 보존합니다. 임의 checkout/reset을 하지 않습니다.
- 화면 접기·탐색으로 입력 중 초안이나 PrivateCostPanel 세션을 잃지 않습니다. 문서 교체에 따른 세션 폐기는 기존 규칙을 따릅니다.

## Review Focus

1. 같은 품명·매핑을 쓰는 두 행을 구분하고 해당 rowId로 이동해야 합니다(Task A·B).
2. 같은 edge의 서로 다른 케이블 품목, 본체와 옵션 경고를 합치지 않아야 합니다(Task A·B).
3. 접힌 영역의 잘못된 입력과 원가 연결이 탐색 뒤에도 남아 있어야 합니다(Task C).
4. 해소 수단이 없는 경고도 목록에서 사라지거나 출력 가능으로 안내되지 않아야 합니다(Task A).
5. 좁은 화면과 키보드 탐색에서 목적지 표시·포커스가 모두 확인되어야 합니다(Task B·D).

## 1. 화면 명세

### 기본 배치

- 상단에는 현재 고객/현장 식별, 저장 상태, 저장·출력 동작을 둡니다. 기존 출력 등급 선택을 유지합니다.
- 큰 화면에서는 왼쪽에 시스템 목록과 설정 영역으로 이동하는 탐색 메뉴, 중앙에 견적표를 둡니다. 확인 목록은 견적표 위의 요약과 펼칠 수 있는 목록으로 둡니다. 세 번째 고정 열로 표 너비를 줄이지 않습니다.
- 처음 열린 견적에서는 견적표를 먼저 보여줍니다. 갑지 정보·케이블 거리·배관·간접비·원가 확인은 표 아래의 명확한 제목과 접기 영역으로 정리합니다.
- 접기 영역은 children을 조건부 제거하지 않고 마운트를 유지합니다. 이동할 때 해당 영역을 열고 목적지로 스크롤·포커스합니다.
- 시스템 탐색은 해당 표 위치로 이동합니다. 행을 필터링해서 합계를 바꾸거나 문서를 수정하지 않습니다.
- 표의 설명·비고·거래처·영업비고 열은 '상세 열 표시'로 한 번에 펼칩니다. 기본은 핵심 품명·규격·단위·수량·재료비·노무비·합계·행 동작입니다. 열과 입력 컴포넌트를 조건부 렌더로 제거하지 않고, 해당 th/td에 CSS class의 `display:none`을 적용해 숨깁니다. 숨긴 입력의 draft도 보존합니다. 출력 등급에 따른 정보 제외는 기존 projection에서 계속 수행합니다.
- PDF 링크는 메인페이지에 계속 두고 제목·보기·다운로드 중심으로 간결화합니다. 긴 출처 설명은 펼치기로 보존합니다. 사전 PDF 요청은 만들지 않습니다.
- 390px에서는 탐색이 가로 줄바꿈되고 표만 내부 스크롤합니다. 페이지 전체 가로 넘침과 글자 단위 줄바꿈을 막습니다.

### 확인 목록과 출력 상태

- 실제 `PreparedQuote.importWarnings`, `priced.laborWarnings`, `priced.calculation.warnings`에서 목록을 만듭니다. 목록의 개수는 '확인 항목 N건'으로 표현하며 품목 수와 혼동하지 않습니다.
- 분류는 노무 확인, 수량 확인, 품목 연결, 시공 입력, 기타 계산 확인입니다. 출처별 경고 원문과 시스템·행 이름을 함께 보존합니다.
- 문구가 같다는 이유로 경고를 합치지 않습니다. 초기 구현은 출처별 항목을 모두 보존하며, 목록의 경고 수가 사용자 행 수보다 클 수 있음을 제목으로 구분합니다.
- `pendingCableEdit`는 '거리 변경 적용/취소 필요' 항목으로 따로 표시합니다. 값 입력 중 초안은 저장 상태에서 계속 안내합니다.
- 행의 노무 문제는 해당 LaborBasisPanel을 열고, 수량 문제는 해당 입력에, 품목 연결 문제는 기존 WarningList의 정확한 후보/검색 영역에 이동합니다. 배관·케이블의 전용 검증을 일반 카탈로그 검색으로 우회하지 않습니다.
- 자동 해소 UI가 없는 문제는 원문과 '세부 내용 보기' 동작을 제공합니다. 없는 수정 기능을 약속하지 않습니다.
- 기준 충돌 화면은 기존 명시적 재계산 경로를 유지하고 '현재 기준으로 재계산 필요'라고 안내합니다. 이 상태에서는 과거 prepared를 재사용하지 않습니다.
- 출력 가능 여부는 기존 exportGate가 결정합니다. 요약 목록이 비었다는 이유만으로 출력을 허용하지 않습니다. blocking이면 '확인 전 합계'로 표시합니다.

## 2. 파일 책임과 인터페이스

신규 `src/features/worksheet/reviewItems.ts`는 화면용 목록만 파생합니다.

```ts
type ReviewTarget =
  | { kind: 'labor'; rowId: string }
  | { kind: 'quantity'; rowId: string }
  | { kind: 'import'; warningId: string }
  | { kind: 'cables' }
  | { kind: 'detail'; source: 'labor' | 'calculation'; warningId: string };
interface ReviewItem {
  id: string;
  source: 'import' | 'labor' | 'calculation' | 'pending-cable';
  code: string;
  category: 'labor' | 'quantity' | 'product' | 'installation' | 'calculation';
  message: string;
  blocking: boolean;
  target: ReviewTarget;
  rowId?: string;
  systemId?: string;
}
function buildReviewItems(prepared: PreparedQuote, pendingCableEdit: boolean): ReviewItem[];
interface ReviewNavigation {
  target: ReviewTarget;
  sourcePrepared: PreparedQuote;
  nonce: number;
}
```

- 배열 인덱스를 목적지 식별자로 사용하지 않습니다. `reviewItems.ts`에서 공유 함수 `identifyImportWarnings(warnings: readonly ImportWarning[]): { id: string; warning: ImportWarning }[]`를 내보내고, 요약 목록과 WarningList 모두 이 함수로 식별합니다.
- import identity는 고정 순서 tuple을 `JSON.stringify`한 문자열입니다. `['import', code, nodeId ?? null, edgeId ?? null, rowId ?? null, optionId ?? null, sourceCableKey ?? null, installationSystemId ?? null, owner ?? null]`를 사용합니다. 단순 하이픈 연결이나 `nodeId ?? edgeId`로 필드를 버리지 않습니다. 기존 WarningList의 li key도 공유 id로 교체합니다. `requiredCableMeters` 같은 값은 identity에 넣지 않습니다. 거리가 바뀔 때 기존 항목이 remount되어 검색어·펼치기 상태를 잃지 않게 하며, 오래된 이동 요청의 거부는 sourcePrepared 비교가 담당합니다.
- 같은 tuple의 경고가 여러 번 나오면 전부 보존하고 tuple별 발생 순번을 suffix로 붙입니다. 서로 다른 케이블 품목은 sourceCableKey로 구분합니다. 순번은 완전히 같은 identity의 중복 렌더 key를 구분하는 용도이며, 오래된 탐색을 허용하는 근거가 아닙니다. UI 정렬은 식별이 끝난 객체에만 적용합니다.
- 노무·계산 상세의 ID도 출처, code, rowId, laborMappingId 또는 systemId/itemId의 고정 tuple과 중복 발생 순번으로 만듭니다. 서로 다른 출처 사이에서는 ID가 겹치지 않습니다.
- 탐색 요청은 클릭 당시 `sourcePrepared` 참조와 nonce를 보관합니다. 소비 및 펼치기 후 포커스 시점마다 `sourcePrepared === 현재 prepared`를 확인합니다. 다르면 요청을 폐기하고 '견적 내용이 바뀌었습니다. 확인 목록에서 다시 선택해 주세요'라고 안내합니다. 같아도 현재 ID/rowId가 없으면 대상 없음으로 안내하고 다른 항목을 대신 선택하지 않습니다. 기준 충돌·문서 교체 때도 이전 요청을 소비하지 않습니다. 이 참조는 일시적인 화면 state이며 직렬화하지 않습니다.
- 행을 가진 노무 경고, 계산 경고의 `labor-unresolved`, `manual-labor-incomplete`, `not-applicable-reason-missing`, `labor-mapping-missing`은 labor 목적지입니다. `quantity-unresolved`는 quantity 목적지입니다.
- import 경고는 해당 WarningList 항목으로 연결합니다. 필요한 거리 수정은 그 상세 항목에서 시공 입력으로 이동하는 링크를 제공합니다. 한 edge의 여러 경고를 nodeId만으로 묶지 않습니다.
- rowId 없는 노무 경고와 나머지 계산 경고는 `detail` 목적지로 목록 내 원문 상세를 보여줍니다. 행·시스템 ID가 있으면 같이 보여주며, ID 없는 blocking 경고도 목록에 남깁니다. 수정 UI가 없다는 이유로 버리지 않습니다.

신규 `ReviewSummary.tsx`는 목록 렌더와 `onNavigate(target)` 호출만 담당합니다. 신규 `WorkspaceSection.tsx`는 접기 상태와 마운트 보존을 담당합니다. App.tsx는 이 컴포넌트들을 조립하며 계산 엔진을 변경하지 않습니다.

QuoteSheet에는 아래 요청을 추가합니다. nonce는 같은 목적지를 다시 눌렀을 때도 이동하도록 합니다.

```ts
type RowNavigation = {
  rowId: string;
  kind: 'labor' | 'quantity';
  sourcePrepared: PreparedQuote;
  nonce: number;
};
// optional prop: navigation?: RowNavigation
// 현재 prepared 참조도 prop으로 받는다. 동일 참조·현재 rowId 검사
// → 노무 영역 열기 → 렌더 뒤 다시 동일 참조 검사 → ref로 focus/scroll.
```

ID 문자열을 CSS selector에 그대로 조합하지 않습니다. DOM ref 또는 안전하게 만든 id와 getElementById를 사용합니다. 접기 전환에 따른 화면 state를 QuoteDocument나 작업 파일에 추가하지 않습니다.

## Task A: 현재 상태에서 확인 목록 파생

**Files:** 신규 `reviewItems.ts`, `tests/unit/reviewItems.test.ts`.

- [ ] 서로 다른 두 rowId의 mapping-unconfirmed, 한 행의 추가 wage-missing, rowId 없는 blocking 노무 경고, 같은 edge의 다른 sourceCableKey를 가진 import 경고 2건, quantity-unresolved, 전용 해소 UI가 없는 calculation 경고(예: derived-source-missing), pending 케이블을 합성 prepared로 구성합니다. 아래 unsupported 변수는 이 calculation 경고를 가리킵니다.
- [ ] 다음 단언이 실패하는지 실제 실행합니다. 테스트 fixture는 기존 prepare 통합시험의 타입을 사용합니다.

```ts
expect(items.filter(x => x.source === 'labor' && x.code === 'mapping-unconfirmed').map(x => x.rowId)).toEqual(['row-a', 'row-b']);
expect(items.filter(x => x.target.kind === 'import')).toHaveLength(2);
expect(new Set(items.filter(x => x.target.kind === 'import').map(x => x.id)).size).toBe(2);
expect(items.find(x => x.source === 'labor' && x.rowId === undefined)?.target.kind).toBe('detail');
expect(items.some(x => x.target.kind === 'cables')).toBe(true);
expect(items.find(x => x.message === unsupported.message)?.blocking).toBe(true);
```

- [ ] 원본 배열을 읽는 순수 함수를 구현합니다. 메시지를 읽어 경고 종류를 추측하지 않고 code와 구조화된 ID를 사용합니다.
- [ ] 한 행 확인 후 재생성하면 그 행 경고만 사라지고, 같은 메시지의 다른 행은 남는지 검증합니다. 입력 prepared가 변하지 않는지도 단언합니다.
- [ ] 같은 케이블 경고의 requiredCableMeters 값만 바꾸면 identity는 같고 표시값은 갱신되는지 단언합니다.
- [ ] `npx vitest run tests/unit/reviewItems.test.ts` 통과 후 관련 파일만 커밋합니다.

## Task B: 확인 항목에서 정확한 입력으로 이동

**Files:** 신규 `ReviewSummary.tsx`, 수정 `QuoteSheet.tsx`, `WarningList.tsx`, `App.tsx`, 신규 `tests/e2e/workspace-navigation.spec.ts`.

- [ ] 기존 `labor-confirmation.spec.ts`의 양수 품셈 fixture를 재사용해 이름이 같은 두 행을 만들고, 목록에서 두 번째 항목을 눌렀을 때 두 번째 행만 펼쳐지는 E2E를 먼저 실패시킵니다.
- [ ] ReviewSummary와 RowNavigation을 연결합니다. 노무 영역을 연 다음 해당 영역 제목 또는 첫 조작 요소에 포커스를 줍니다. 수량은 해당 입력에 포커스를 줍니다.
- [ ] 공유 identifyImportWarnings의 id로 WarningList의 기존 li key 충돌을 먼저 고치고 ref/id를 부여합니다. 같은 edge의 서로 다른 sourceCableKey 두 경고를 표시하고 각 목적지로 이동하는 시험, 중복 React key 경고가 없다는 시험을 추가합니다. 후보 선택 범위는 해당 항목으로 유지합니다. 이동이 실패하면 목록에 오류 안내를 표시하고 다른 행을 대신 선택하지 않습니다.
- [ ] 다음 사용자 흐름을 검증합니다.

```ts
await secondIssue.click();
await expect(secondLaborPanel).toBeVisible();
await expect(firstLaborPanel).toHaveCount(0);
await secondLaborPanel.getByRole('button', { name: '확인함', exact: true }).click();
await expect(firstIssue).toBeVisible();
await expect(page.getByRole('button', { name: 'Excel 다운로드' })).toBeDisabled();
await page.getByRole('button', { name: '실행 취소', exact: true }).click();
await expect(secondIssue).toBeVisible();
```

- [ ] 후보가 다른 두 경고, 수량 포커스, 삭제된 행으로의 오래된 요청 무시, basis-conflict 안내도 시험합니다. 요청 후 앞선 경고가 삭제되어 배열 순서가 바뀐 경우, 같은 ID를 가진 새 문서를 연 경우, 한 identity가 완전히 중복된 경우도 검증합니다. 이전 prepared 요청은 포커스하지 않아야 하고 현재 목록에서 다시 누르면 해당 항목으로 이동해야 합니다. sourcePrepared 비교 분기를 끄면 오래된 요청 거부 시험이 실패하는지 실제 확인합니다.
- [ ] 관련 E2E와 Task A 단위시험 통과 후 커밋합니다.

## Task C: 견적표 중심 배치와 입력 보존

**Files:** 신규 `WorkspaceSection.tsx`, 수정 `App.tsx`, `QuoteSheet.tsx`, `ReferenceDocs.tsx`, `src/styles/base.css`, `workspace.css`, `tests/e2e/workspace-navigation.spec.ts` 및 의도한 UI 변경에 영향받는 기존 E2E.

- [ ] 최초 견적에서 표가 갑지 입력보다 먼저 보이고, 상세 열·설정은 펼쳐서 쓸 수 있는 시험을 작성합니다.
- [ ] 시스템 메뉴, 견적표, 확인 요약, 설정 접기, 간결한 PDF 영역 순서로 재배치합니다. 노무 상세·표 열의 colSpan도 현재 표시 열과 맞춥니다.
- [ ] 탐색 시 섹션 open을 먼저 반영하고 다음 렌더에서 focus/scroll합니다. 같은 위치를 두 번 눌러도 동작해야 합니다.
- [ ] 수량에 잘못된 초안 입력 → 상세/설정 접기 → 다시 열기에서 입력값과 미저장 보호가 유지되는지 시험합니다.
- [ ] 거래처·영업비고를 입력한 뒤 상세 열을 숨겼다가 다시 보이면 값이 유지되고 저장하지 않은 변경 안내가 남는지 시험합니다. 일반 클릭의 blur로 값이 이미 커밋되었을 수 있으므로, 컴포넌트 시험에서는 blur 없이 visibility prop만 바꾸는 경우도 따로 단언해 실제 지역 draft 보존을 검증합니다. 저장된 견적에서 시작하고 화면 조작 전후 값을 비교합니다.
- [ ] 합성 원가 파일 선택·연결 → 다른 영역 이동 → 원가 영역 복귀에서 연결 유지, 다른 견적 열기에서는 폐기되는지 기존 원가 E2E에 추가합니다.
- [ ] 시스템 메뉴 이동 전후 문서·합계가 같고, undo 내역이 늘지 않는지 확인합니다. 화면 상태만 바뀌는 조작으로 '저장하지 않은 변경'이 새로 생기면 실패입니다.
- [ ] PDF 요청 0건, 링크 두 종류, 상세 입력 저장·재열기, 1차 보호 시험을 다시 실행합니다. 의도한 펼치기 조작을 기존 시험에 추가할 수 있으나 금액·차단·보존 단언을 삭제하지 않습니다.
- [ ] 관련 시험 통과 후 커밋합니다.

## Task D: 실제 화면과 전체 회귀 확인

**Files:** 시험 필요분과 이 문서의 검증 기록만 갱신합니다.

- [ ] 1440×1000과390×844에서 합성 20품목·2시스템 견적을 열어 스크린샷을 저장하고 육안 확인합니다.
- [ ] `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`을 단언합니다. 1px은 소수 픽셀 반올림만 허용합니다. 견적표의 내부 스크롤은 허용합니다.
- [ ] Tab/Enter로 확인 목록 → 입력 이동, focus 표시, 접기 버튼의 aria-expanded, 움직임 줄이기 설정을 확인합니다.
- [ ] `npx tsc -b --force`, `npx vitest run`, `npx playwright test`, `npm run audit:exports`, `npm run build`를 실행합니다. Windows에서는 cmd 확장 실행파일을 사용할 수 있습니다.
- [ ] 커밋·실행 명령·통과 수·시각 확인 범위·남은 제약을 보고합니다. Codex 독립 결과 검토 전에는 '검토 완료'로 표기하지 않습니다. push·배포는 하지 않습니다.

## 자체 검토 및 확인 범위

### 사용자 제공 AV Builder 화면 참고 (2026-10-12 추가)

Codex가 `.local/av-builder-screenshot-1.png` 원본 이미지를 직접 확인했습니다. 구현 세션이 기존 첨부를 추출한 파일이며 저장소에 포함하지 않습니다. 사용자 원문은 `https://seoul-visual-tech.github.io/av-system-builder/ 이거 참고해줘`입니다. 해당 사이트의 현재 동작을 실행 검증했다는 뜻은 아닙니다.

- 확인한 화면은 케이블 편집 창입니다. 카탈로그 선택 목록에 품명·규격이 한 줄로 표시되고, 아래에 제품명 입력·제작/기성 선택·수량·취소/저장 버튼이 있습니다.
- 이번 계획에서 참고할 부분은 작업 중인 케이블의 선택 영역을 필요한 때 열고, 품명·규격을 함께 보여주는 동선입니다. 기존 후보가 여러 개면 단위·판매단가·설명도 확인할 수 있어야 합니다.
- 스크린샷의 자유 입력이나 제작/기성 전환을 승인 목록 밖 품목 생성 또는 계산 방식 변경 승인으로 해석하지 않습니다. 네이티브 드롭다운으로 기존 상세 후보 정보를 대체하는 변경도 이번 초안에 확정하지 않습니다.
- 계획 검토자는 현재 CandidateList의 묶음별 펼치기와 이번 확인 항목 탐색만으로 사용자 요청을 충족하는지 검토하고, 별도의 후보 선택 개선이 필요하면 그 범위를 구체적으로 제안합니다.

- App의 실제 배치, QuoteSheet의 expandedRowIds, WarningList의 node/option/edge/sourceCableKey 분기, CalculationWarning·ImportWarning 구조, ReferenceDocs 링크 구조를 읽었습니다.
- 1차 미저장 보호·원가 세션 보존을 이번 탐색 계약에 명시했습니다. 구현 코드 전체의 안전성을 검증했다는 뜻은 아닙니다.
- 검토자는 경고 목록 완전성, 실제 수정 수단과 목적지 일치, 컴포넌트 마운트 보존, 기존 E2E의 영향 범위를 우선 검토합니다.

### 1차 검토 반영 기록

Codex가 WarningList의 li key에 sourceCableKey/installationSystemId가 빠진 점, LaborWarning의 rowId가 선택 필드인 점, QuoteDrafts cleanup이 unmount 시 pending을 해제하는 점을 직접 읽어 확인했습니다. 2판은 구조적 경고 식별, 오래된 탐색 요청 거부, rowId 없는 경고 상세, CSS 열 숨김과 draft 시험을 보강합니다. 이는 계획 보강이며 실제 버그 수정이나 시험 통과 보고가 아닙니다.

후보의 품명·규격·설명·단위·판매단가 표시는 기존 CandidateDetail을 유지합니다. 이번 2차는 필요한 후보 영역을 찾아 펼치는 동선을 바꿉니다. AV Builder처럼 표시를 단일 드롭다운으로 바꾸는 별도 승인을 추가로 묻지 않습니다.

### 2차 검토 반영 및 인계

지정 검토자 `c1a826e5-9bf7-48df-a37b-e91230083c31`는 2판의 구조와 sourcePrepared 참조 비교가 기존 useMemo 경로에 맞는다고 보고했습니다. 남은 낮음 2건인 requiredCableMeters의 identity 제외와 unsupported fixture의 calculation 출처 명시를 반영했습니다. 이 두 문구 보강 후 추가 계획 검토를 반복하지 않고 지정 구현자에게 Task A~D를 순차 인계합니다. 완료 뒤 Codex가 구현 결과를 검토합니다.
