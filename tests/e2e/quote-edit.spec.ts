import { test, expect } from '@playwright/test';
import { mockResources } from './fixtures';

const SKU_PRICED = 'E2E-001';
const SKU_NO_PRICE = 'E2E-002';
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
    prices: { [SKU_PRICED]: { sellingUnitPrice: '50000', currency: 'KRW' } },
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

  const pickerTotal = await page.locator('.q-quote-table tfoot tr', { hasText: '합계' }).last().textContent();

  // --- 구성도 열기: 같은 모델 노드 2개 ---
  await page.getByRole('button', { name: '구성도 JSON 열기' }).click();
  // 파일 입력은 hidden 속성이라 보이는 버튼이 아니라 input 자체를 잡는다.
  await page.locator('input[type="file"]').setInputFiles({
    name: 'diagram.json',
    mimeType: 'application/json',
    buffer: Buffer.from(diagramWithTwoDevices()),
  });

  const diagramTotal = await page.locator('.q-quote-table tfoot tr', { hasText: '합계' }).last().textContent();

  expect(pickerTotal).not.toBeNull();
  expect(diagramTotal).toBe(pickerTotal);
});

test('미등록과 0을 구분한다', async ({ page }) => {
  await setupCustomCatalog(page);
  await page.goto('/');

  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('E2E 미등록 품목');
  await page.getByRole('button', { name: '추가' }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();

  const row = page.locator('.q-quote-table tbody tr', { hasText: 'E2E 미등록 품목' });
  await expect(row).toContainText('미등록');
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
