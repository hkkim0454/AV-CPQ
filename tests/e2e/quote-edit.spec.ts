import { test, expect } from '@playwright/test';
import { mockResources } from './fixtures';

const SKU_PRICED = 'E2E-001';
const SKU_NO_PRICE = 'E2E-002';
const SKU_ZERO_PRICE = 'E2E-003';
const SKU_AMBIGUOUS_A = 'E2E-010';
const SKU_AMBIGUOUS_B = 'E2E-011';
const DESCRIPTION = '합성 설명 문구 — E2E 전용';
const SHA = 'c'.repeat(64);

function customProducts(): unknown {
  return {
    schemaVersion: 1,
    generatedOn: '2026-01-01',
    sourceSha256: SHA,
    products: [
      {
        productId: SKU_PRICED,
        sku: SKU_PRICED,
        brand: '',
        model: 'E2E-MODEL-1',
        quoteName: 'E2E 테스트 품목',
        quoteSpec: 'E2E-MODEL-1',
        unit: 'EA',
        options: { description: DESCRIPTION },
        currency: 'KRW',
        evidence: 'verified',
      },
      {
        productId: SKU_NO_PRICE,
        sku: SKU_NO_PRICE,
        brand: '',
        model: 'E2E-MODEL-2',
        quoteName: 'E2E 미등록 품목',
        quoteSpec: 'E2E-MODEL-2',
        unit: 'EA',
        options: {},
        currency: 'KRW',
        evidence: 'verified',
      },
      {
        productId: SKU_ZERO_PRICE,
        sku: SKU_ZERO_PRICE,
        brand: '',
        model: 'E2E-MODEL-3',
        quoteName: 'E2E 무상 품목',
        quoteSpec: 'E2E-MODEL-3',
        unit: 'EA',
        options: {},
        currency: 'KRW',
        evidence: 'verified',
      },
      // 같은 모델 문자열(quoteSpec)에 두 제품이 걸린다 — 모호한 매칭
      // 경고(device-ambiguous-match)의 후보 선택 검증용이다.
      {
        productId: SKU_AMBIGUOUS_A,
        sku: SKU_AMBIGUOUS_A,
        brand: '',
        model: 'AMB-MODEL',
        quoteName: 'E2E 후보 A',
        quoteSpec: 'AMB-MODEL',
        unit: 'EA',
        options: {},
        currency: 'KRW',
        evidence: 'verified',
      },
      {
        productId: SKU_AMBIGUOUS_B,
        sku: SKU_AMBIGUOUS_B,
        brand: '',
        model: 'AMB-MODEL',
        quoteName: 'E2E 후보 B',
        quoteSpec: 'AMB-MODEL',
        unit: 'EA',
        options: {},
        currency: 'KRW',
        evidence: 'verified',
      },
    ],
  };
}

function customPrices(): unknown {
  return {
    schemaVersion: 1,
    generatedOn: '2026-01-01',
    sourceSha256: SHA,
    currency: 'KRW',
    // SKU_NO_PRICE는 의도적으로 뺐다 — 미등록 검증용.
    // SKU_ZERO_PRICE는 **명시적** 0원이다 — 미등록과 다른 상태다.
    prices: {
      [SKU_PRICED]: { sellingUnitPrice: '50000', currency: 'KRW' },
      [SKU_ZERO_PRICE]: { sellingUnitPrice: '0', currency: 'KRW' },
      [SKU_AMBIGUOUS_A]: { sellingUnitPrice: '70000', currency: 'KRW' },
      [SKU_AMBIGUOUS_B]: { sellingUnitPrice: '80000', currency: 'KRW' },
    },
  };
}

function diagramWithTwoDevices(): string {
  const node = (id: string) => ({ id, data: { model: 'E2E-MODEL-1', systemName: '시스템1' } });
  return JSON.stringify({
    version: '1',
    nodes: [node('n1'), node('n2')],
    edges: [],
    lineTypes: [],
  });
}

/**
 * 모호한 모델(두 후보에 걸림) 하나, 카탈로그에 아예 없는 모델 하나 —
 * 두 경고가 서로 독립적으로 해소되는지 보는 데 쓴다.
 */
function diagramWithUnresolvedDevices(): string {
  return JSON.stringify({
    version: '1',
    nodes: [
      { id: 'amb-1', data: { model: 'AMB-MODEL', systemName: '시스템1' } },
      { id: 'unknown-1', data: { model: 'NOPE-MODEL-XYZ', name: '알 수 없는 장비', systemName: '시스템1' } },
    ],
    edges: [],
    lineTypes: [],
  });
}

/**
 * 본체 하나 + 옵션 카드 2종, 전부 카탈로그에 없는 모델이다. 옵션은
 * `diagram.options`로 실제로 정의한다("옵션 미정"이 아니라 모델이
 * 카탈로그에 없는 경우) — 본체를 해결해도 옵션 둘은 그대로 남고,
 * 옵션 하나를 해결해도 나머지 하나와 본체는 그대로인지 보는 데 쓴다.
 */
function diagramWithDeviceAndTwoOptions(): string {
  return JSON.stringify({
    version: '1',
    nodes: [
      {
        id: 'body-1',
        data: {
          model: 'BODY-UNRESOLVED',
          systemName: '시스템1',
          selectedOptionQuantities: { 'opt-a': 1, 'opt-b': 1 },
        },
      },
    ],
    edges: [],
    lineTypes: [],
    options: [
      { id: 'opt-a', model: 'OPT-A-UNRESOLVED' },
      { id: 'opt-b', model: 'OPT-B-UNRESOLVED' },
    ],
  });
}

async function setupCustomCatalog(page: Parameters<typeof mockResources>[0]): Promise<void> {
  await mockResources(page, {
    '/data/approved/products.json': customProducts(),
    '/data/approved/prices.json': customPrices(),
  });
}

test('두 입구(구성도/품목 선택) — 같은 품목·수량이면 직접비·합계가 같다', async ({ page }) => {
  await setupCustomCatalog(page);
  await page.goto('/');

  // --- 품목 직접 선택: SKU_PRICED 수량 2 ---
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('E2E 테스트 품목');
  await page.getByRole('button', { name: '추가' }).click();
  await page.getByLabel(`E2E 테스트 품목 담은 수량`).fill('2');
  await page.getByRole('button', { name: '견적 만들기' }).click();

  const row = page.locator('.q-quote-table tbody tr', { hasText: 'E2E 테스트 품목' });
  const remarkInput = row.locator('td').nth(5).locator('input');
  const totalRow = page.locator('.q-quote-table tfoot tr', { hasText: '합계' }).last();

  // 품목 직접 선택 경로가 실제로 반영됐다는 출처 표식을 먼저 기다린다
  // (`remarkFor`가 적는 '직접 선택'). 합계를 곧바로 읽으면 우연히
  // 이전 상태를 읽고도 통과할 수 있다.
  await expect(remarkInput).toHaveValue('직접 선택');
  const pickerTotal = await totalRow.textContent();

  // --- 구성도 열기: 같은 모델 노드 2개 ---
  await page.getByRole('button', { name: '구성도 JSON 열기' }).click();
  // 파일 입력은 hidden 속성이라 보이는 버튼이 아니라 input 자체를 잡는다.
  await page.locator('input[type="file"]').setInputFiles({
    name: 'diagram.json',
    mimeType: 'application/json',
    buffer: Buffer.from(diagramWithTwoDevices()),
  });

  // 구성도 경로로 **새 문서**가 실제로 반영됐는지 출처 표식이 '구성도'로
  // 바뀌는 것부터 확인한다(비동기 파일 읽기·변환이 끝나길 기다리는
  // 신호이자, 행이 실제로 구성도 출처인지 확인하는 신호다). 이 확인
  // 없이 곧바로 합계를 읽으면 전환 전 값을 우연히 비교해 통과할 위험이
  // 있다.
  await expect(remarkInput).toHaveValue('구성도');
  const diagramTotal = await totalRow.textContent();

  expect(pickerTotal).not.toBeNull();
  expect(diagramTotal).toBe(pickerTotal);
});

test('미등록과 명시적 0을 구분한다', async ({ page }) => {
  await setupCustomCatalog(page);
  await page.goto('/');

  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('E2E 미등록 품목');
  await page.getByRole('button', { name: '추가' }).click();
  await page.getByLabel('품목 검색').fill('E2E 무상 품목');
  await page.getByRole('button', { name: '추가' }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();

  const unregisteredRow = page.locator('.q-quote-table tbody tr', { hasText: 'E2E 미등록 품목' });
  await expect(unregisteredRow).toContainText('미등록');

  // 판매단가 0은 '미등록'이 아니라 숫자 0으로 보여야 한다. 노무비 칸은
  // 이 품목에 품셈 연결이 없어 별개로 '미등록'이 맞다 — 여기서 보는
  // 것은 재료비 칸 하나다.
  const zeroRow = page.locator('.q-quote-table tbody tr', { hasText: 'E2E 무상 품목' });
  await expect(zeroRow.locator('td').nth(6)).toHaveText('0'); // 재료비 칸

  // 무상 품목 쪽은 가격 미등록 경고가 없어야 한다 — 미등록 품목 경고만 있다.
  const warnings = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' });
  await expect(warnings).toContainText('E2E 미등록 품목');
  await expect(warnings).not.toContainText('E2E 무상 품목');
});

test('카탈로그 설명이 실제로 표시되고 사용자 편집을 보존한다', async ({ page }) => {
  await setupCustomCatalog(page);
  await page.goto('/');

  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('E2E 테스트 품목');
  await page.getByRole('button', { name: '추가' }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();

  const descriptionInput = page.getByLabel('E2E 테스트 품목 설명');
  await expect(descriptionInput).toHaveValue(DESCRIPTION);

  await descriptionInput.fill('사람이 고친 설명');
  await descriptionInput.blur();
  await expect(descriptionInput).toHaveValue('사람이 고친 설명');
});

test('수량 편집 후 실행취소로 되돌아간다', async ({ page }) => {
  await setupCustomCatalog(page);
  await page.goto('/');

  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('E2E 테스트 품목');
  await page.getByRole('button', { name: '추가' }).click();
  await page.getByLabel(`E2E 테스트 품목 담은 수량`).fill('1');
  await page.getByRole('button', { name: '견적 만들기' }).click();

  const quantityInput = page.getByLabel('E2E 테스트 품목 수량');
  const totalRow = page.locator('.q-quote-table tfoot tr', { hasText: '합계' }).last();

  await expect(quantityInput).toHaveValue('1');
  const beforeTotal = await totalRow.textContent();

  await quantityInput.fill('5');
  await quantityInput.blur();
  await expect(quantityInput).toHaveValue('5');
  const afterTotal = await totalRow.textContent();
  expect(afterTotal).not.toBe(beforeTotal);

  await page.getByRole('button', { name: '실행 취소' }).click();
  await expect(quantityInput).toHaveValue('1');
  await expect(totalRow).toHaveText(beforeTotal ?? '');
});

test('잘못된 수량은 문서를 바꾸지 않고 이유를 보여준다', async ({ page }) => {
  await setupCustomCatalog(page);
  await page.goto('/');

  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('E2E 테스트 품목');
  await page.getByRole('button', { name: '추가' }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();

  const quantityInput = page.getByLabel('E2E 테스트 품목 수량');
  await quantityInput.fill('-3');
  await quantityInput.blur();

  await expect(page.getByRole('alert').getByText('음수를 허용하지 않습니다')).toBeVisible();
  // 입력창 자체는 사용자가 입력한 값을 보여주지만, 문서는 그대로다 —
  // 실행 취소 버튼이 활성화되지 않는다(아직 아무 것도 커밋되지 않았다).
  await expect(page.getByRole('button', { name: '실행 취소' })).toBeDisabled();
});

test('간접비율 수정 → 프로파일 변경 → undo/redo가 선택값·요율·합계를 정확히 복원한다', async ({
  page,
}) => {
  // 실제로 찾은 결함: profileBySystem을 문서와 별도 state로 두면,
  // 프로파일을 바꾼 뒤 실행취소를 눌렀을 때 문서만 이전 상태로 돌아가고
  // profileBySystem은 그대로 남아 — 되돌아간 문서(일반)를 바뀐
  // 프로파일(DS)로 다시 계산했다. 이 시나리오를 그대로 재현한다.
  await setupCustomCatalog(page);
  await page.goto('/');

  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('E2E 테스트 품목');
  await page.getByRole('button', { name: '추가' }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();

  const rateInput = page.getByLabel('g1 요율');
  const profileSelect = page.getByLabel('시스템1 간접비 프로파일');
  const totalRow = page.locator('.q-quote-table tfoot tr', { hasText: '합계' }).last();

  // --- 1) 일반 프로파일에서 요율을 사람이 고친다 ---
  await expect(profileSelect).toHaveValue('general');
  await expect(rateInput).toHaveValue('0.06');
  await rateInput.fill('0.08');
  await rateInput.blur();
  await expect(rateInput).toHaveValue('0.08');
  const afterRateEditTotal = await totalRow.textContent();

  // --- 2) DS로 전환 — 전혀 다른 규칙·요율이 심긴다 ---
  await profileSelect.selectOption('ds');
  await expect(profileSelect).toHaveValue('ds');
  const dsTotal = await totalRow.textContent();
  expect(dsTotal).not.toBe(afterRateEditTotal);

  // --- 3) 실행취소 — 일반으로 돌아가되, 사람이 고친 요율(0.08)은 그대로다 ---
  await page.getByRole('button', { name: '실행 취소' }).click();
  await expect(profileSelect).toHaveValue('general');
  await expect(rateInput).toHaveValue('0.08');
  await expect(totalRow).toHaveText(afterRateEditTotal ?? '');

  // --- 4) 다시실행 — DS로 다시 전환된 선택값·합계가 그대로 복원된다 ---
  await page.getByRole('button', { name: '다시 실행' }).click();
  await expect(profileSelect).toHaveValue('ds');
  await expect(totalRow).toHaveText(dsTotal ?? '');
});

test('견적 정보(머리글) 편집과 취소', async ({ page }) => {
  await setupCustomCatalog(page);
  await page.goto('/');

  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('E2E 테스트 품목');
  await page.getByRole('button', { name: '추가' }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();

  const customerInput = page.getByLabel('고객', { exact: true });
  const projectInput = page.getByLabel('현장/공사명');

  await expect(customerInput).toHaveValue('');
  await customerInput.fill('합성 고객사');
  await customerInput.blur();
  await expect(customerInput).toHaveValue('합성 고객사');

  await projectInput.fill('본사 2층 회의실');
  await projectInput.blur();
  await expect(projectInput).toHaveValue('본사 2층 회의실');

  // 조건 추가
  await page.getByLabel('조건 추가').fill('설치 후 1년 무상 AS');
  await page.getByRole('button', { name: '추가' }).click();
  await expect(page.getByText('설치 후 1년 무상 AS')).toBeVisible();

  // 실행취소 — 조건 추가 → 공사명 → 고객 순으로 역순 복원
  await page.getByRole('button', { name: '실행 취소' }).click();
  await expect(page.getByText('설치 후 1년 무상 AS')).toHaveCount(0);
  await page.getByRole('button', { name: '실행 취소' }).click();
  await expect(projectInput).toHaveValue('');
  await page.getByRole('button', { name: '실행 취소' }).click();
  await expect(customerInput).toHaveValue('');
});

test('건강보험 미적용 상태에서 장기요양을 켜면 0원 사유를 보여준다', async ({ page }) => {
  await setupCustomCatalog(page);
  await page.goto('/');

  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('E2E 테스트 품목');
  await page.getByRole('button', { name: '추가' }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();

  const healthApplied = page.getByLabel('국민건강보험료 적용');
  const longTermApplied = page.getByLabel('노인장기요양보험료 적용');
  const longTermRow = page.locator('.q-indirect-table tbody tr', { hasText: '노인장기요양보험료' });

  // 원본 그대로 둘 다 기본 미적용이다.
  await expect(healthApplied).not.toBeChecked();
  await expect(longTermApplied).not.toBeChecked();

  // 건강보험은 그대로 끈 채로 장기요양만 켠다.
  await longTermApplied.check();
  await expect(longTermApplied).toBeChecked();
  await expect(longTermRow).toContainText('기준인 국민건강보험료이(가) 0원이라 이 항목도 0원입니다');
  await expect(longTermRow.locator('td').last()).toContainText('0');
});

test('기존 견적에 품목 추가/삭제 — 실행취소가 기존 수동 수정을 보존한다', async ({ page }) => {
  await setupCustomCatalog(page);
  await page.goto('/');

  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('E2E 테스트 품목');
  await page.getByRole('button', { name: '추가' }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();

  // 기존 행을 사람이 먼저 고친다 — 품목 추가/삭제 뒤에도 이 수정이
  // 그대로인지가 이 시험의 핵심이다(rowId 안정성).
  const quantityInput = page.getByLabel('E2E 테스트 품목 수량');
  await quantityInput.fill('3');
  await quantityInput.blur();
  await expect(quantityInput).toHaveValue('3');

  const rows = page.locator('.q-quote-table tbody tr');
  const rowCountBefore = await rows.count();

  // --- 품목 추가: 기존 견적에 바로 더해진다(새 문서를 만들지 않는다) ---
  // 이미 견적 정보(CoverSheet)의 '조건 추가' 버튼도 같은 이름으로 떠
  // 있으므로, 검색 결과 목록 안으로 좁혀서 누른다.
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('E2E 무상 품목');
  await page.locator('.q-picker-matches').getByRole('button', { name: '추가' }).click();

  await expect(rows).toHaveCount(rowCountBefore + 1);
  await expect(page.locator('.q-quote-table tbody tr', { hasText: 'E2E 무상 품목' })).toBeVisible();
  // 기존 품목의 수동 수정은 그대로다 — 품목 추가가 다른 행을 건드리지 않는다.
  await expect(quantityInput).toHaveValue('3');

  // --- 실행취소 — 추가한 행만 사라지고 기존 수정은 남는다 ---
  await page.getByRole('button', { name: '실행 취소' }).click();
  await expect(rows).toHaveCount(rowCountBefore);
  await expect(quantityInput).toHaveValue('3');

  // --- 다시실행 — 추가가 복원된다 ---
  await page.getByRole('button', { name: '다시 실행' }).click();
  await expect(rows).toHaveCount(rowCountBefore + 1);

  // --- 삭제: 추가했던 행을 지운다 ---
  await page.getByLabel('E2E 무상 품목 삭제').click();
  await expect(rows).toHaveCount(rowCountBefore);
  await expect(quantityInput).toHaveValue('3');

  // --- 삭제도 실행취소로 복원된다 ---
  await page.getByRole('button', { name: '실행 취소' }).click();
  await expect(rows).toHaveCount(rowCountBefore + 1);
  await expect(page.locator('.q-quote-table tbody tr', { hasText: 'E2E 무상 품목' })).toBeVisible();
});

test('미해결 모델/옵션 — 후보 선택·검색 연결로 실제 원인을 해소하고, 관련 없는 경고는 남는다', async ({
  page,
}) => {
  await setupCustomCatalog(page);
  await page.goto('/');

  await page.getByRole('button', { name: '구성도 JSON 열기' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'diagram.json',
    mimeType: 'application/json',
    buffer: Buffer.from(diagramWithUnresolvedDevices()),
  });

  const warningPanel = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' });
  await expect(warningPanel).toContainText('AMB-MODEL');
  await expect(warningPanel).toContainText('NOPE-MODEL-XYZ');

  // 해결 전 행 — rowId 안정성 확인용으로 미리 적어 둔다.
  const ambiguousRowBefore = page.locator('.q-quote-table tbody tr', { hasText: 'AMB-MODEL' });
  const ambiguousRowId = await ambiguousRowBefore.getAttribute('data-row-id');
  expect(ambiguousRowId).not.toBeNull();

  // --- 1) 모호한 모델 — 후보 목록에서 하나를 직접 고른다 ---
  await warningPanel.getByRole('button', { name: '선택' }).first().click();

  // 그 경고만 사라지고, 검색이 필요한 나머지 경고는 그대로 남는다 —
  // 관련 없는 경고가 조용히 같이 지워지지 않는다.
  await expect(warningPanel).not.toContainText('AMB-MODEL');
  await expect(warningPanel).toContainText('NOPE-MODEL-XYZ');

  // rowId는 그대로고, 품명만 고른 후보로 바뀌었다.
  const resolvedAmbiguousRow = page.locator(
    '.q-quote-table tbody tr',
    { hasText: /E2E 후보 [AB]/ },
  );
  await expect(resolvedAmbiguousRow).toHaveAttribute('data-row-id', ambiguousRowId ?? '');

  // --- 2) 카탈로그에 전혀 없는 모델 — 검색으로 직접 연결한다 ---
  await page.getByLabel('unknown-1 연결할 품목 검색').fill('E2E 테스트 품목');
  await page.getByRole('button', { name: '연결' }).click();

  // 둘 다 해소됐고, 이 구성도에는 다른 미해결 경고가 없다 — 배관은
  // 더는 가져오기 시점에 자동으로 생기지 않는다(결정 D8 보강. 구성도에는
  // 거리가 없어 설치 패널에서 거리를 입력해야 생긴다).
  const warningPanelAfterResolve = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' });
  await expect(warningPanelAfterResolve).toHaveCount(0);

  // --- 실행취소 — 검색 연결만 되돌아가고, 후보 선택은 그대로 유지된다 ---
  await page.getByRole('button', { name: '실행 취소' }).click();
  const warningPanelAfterUndo = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' });
  await expect(warningPanelAfterUndo).toContainText('NOPE-MODEL-XYZ');
  await expect(warningPanelAfterUndo).not.toContainText('AMB-MODEL');
  await expect(resolvedAmbiguousRow).toHaveAttribute('data-row-id', ambiguousRowId ?? '');
});

test('본체+옵션 2종 — 본체를 해결해도 옵션 행은 그대로고, 옵션끼리도 서로 무관하다', async ({ page }) => {
  await setupCustomCatalog(page);
  await page.goto('/');

  await page.getByRole('button', { name: '구성도 JSON 열기' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'diagram.json',
    mimeType: 'application/json',
    buffer: Buffer.from(diagramWithDeviceAndTwoOptions()),
  });

  const bodyRow = page.locator('.q-quote-table tbody tr', { hasText: 'BODY-UNRESOLVED' });
  const optionARow = page.locator('.q-quote-table tbody tr', { hasText: 'OPT-A-UNRESOLVED' });
  const optionBRow = page.locator('.q-quote-table tbody tr', { hasText: 'OPT-B-UNRESOLVED' });
  await expect(bodyRow).toBeVisible();
  await expect(optionARow).toBeVisible();
  await expect(optionBRow).toBeVisible();

  const warningPanel = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' });
  await expect(warningPanel).toContainText('BODY-UNRESOLVED');
  await expect(warningPanel).toContainText('OPT-A-UNRESOLVED');
  await expect(warningPanel).toContainText('OPT-B-UNRESOLVED');

  // --- 1) 본체만 해결한다 — 옵션 두 행은 전혀 안 바뀐다 ---
  await page.getByLabel('body-1 연결할 품목 검색').fill('E2E 테스트 품목');
  await page.locator('.q-resolve-search').filter({ has: page.getByLabel('body-1 연결할 품목 검색') }).getByRole('button', { name: '연결' }).click();

  await expect(page.locator('.q-quote-table tbody tr', { hasText: 'E2E 테스트 품목' })).toBeVisible();
  // 옵션 두 행은 이름이 그대로다 — 본체 선택이 옵션까지 바꾸지 않는다.
  await expect(optionARow).toBeVisible();
  await expect(optionBRow).toBeVisible();
  await expect(warningPanel).not.toContainText('BODY-UNRESOLVED');
  await expect(warningPanel).toContainText('OPT-A-UNRESOLVED');
  await expect(warningPanel).toContainText('OPT-B-UNRESOLVED');

  // --- 2) 옵션 A만 해결한다 — 옵션 B와 본체(이미 해결됨)는 안 바뀐다 ---
  await page.getByLabel('opt-a 연결할 품목 검색').fill('E2E 무상 품목');
  await page.locator('.q-resolve-search').filter({ has: page.getByLabel('opt-a 연결할 품목 검색') }).getByRole('button', { name: '연결' }).click();

  await expect(page.locator('.q-quote-table tbody tr', { hasText: 'E2E 무상 품목' })).toBeVisible();
  await expect(optionBRow).toBeVisible(); // 옵션 B는 그대로 미해결.
  await expect(page.locator('.q-quote-table tbody tr', { hasText: 'E2E 테스트 품목' })).toBeVisible(); // 본체는 그대로 해결된 채.
  await expect(warningPanel).not.toContainText('OPT-A-UNRESOLVED');
  await expect(warningPanel).toContainText('OPT-B-UNRESOLVED');
  await expect(warningPanel).not.toContainText('BODY-UNRESOLVED');

  // --- 실행취소 — 옵션 A 해결만 되돌아가고, 본체 해결은 유지된다 ---
  await page.getByRole('button', { name: '실행 취소' }).click();
  await expect(optionARow).toBeVisible();
  await expect(warningPanel).toContainText('OPT-A-UNRESOLVED');
  await expect(warningPanel).toContainText('OPT-B-UNRESOLVED');
  await expect(warningPanel).not.toContainText('BODY-UNRESOLVED');
  await expect(page.locator('.q-quote-table tbody tr', { hasText: 'E2E 테스트 품목' })).toBeVisible();
});
