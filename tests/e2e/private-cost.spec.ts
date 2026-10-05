import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { mockResources } from './fixtures';

/**
 * Task5 "내 PC의 원가 파일과 모델 확인" — 집중 항목만 검증한다(독립
 * 검토 지적 2026-10-05): 원가 파일 교체/문서 교체 시 세션 폐기, 지연
 * 응답 무효화, 고객/작업 파일 격리, 통화/단위 확인 입력(2026-10-05
 * 추가). 모델 후보 연결 UI는 아직 없다 — 고정 열 이름(품명/규격/
 * 매입단가/통화/단위)만 쓴다.
 *
 * 숫자는 전부 합성이다. 실제 원가 파일은 사용자 PC에만 있다.
 */

const COST_CSV_HEADER = '품명,규격,매입단가,통화,단위';
const COST_PRICE_A = '1234567';
const COST_PRICE_B = '7654321';

function costCsv(price: string): Buffer {
  return Buffer.from(`${COST_CSV_HEADER}\nPTZ 카메라,FIX,${price},KRW,EA\n`, 'utf8');
}

function costCsvNoCurrencyUnit(price: string): Buffer {
  return Buffer.from(`품명,규격,매입단가\nPTZ 카메라,FIX,${price}\n`, 'utf8');
}

async function createDocument(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('합성 테스트 품목');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();
  await expect(page.locator('.q-quote-table tbody tr', { hasText: '합성 테스트 품목' })).toBeVisible();
}

async function selectCostFile(page: import('@playwright/test').Page, name: string, bytes: Buffer): Promise<void> {
  await page.getByLabel('원가 파일 선택').setInputFiles({ name, mimeType: 'text/csv', buffer: bytes });
}

test('원가 파일을 고르면 인식된 줄 수가 보인다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);
  await selectCostFile(page, 'cost-a.csv', costCsv(COST_PRICE_A));
  await expect(page.getByRole('status').filter({ hasText: '1줄 인식됨' })).toBeVisible();
});

test('원가 파일 교체 — 두 번째 파일을 고르면 첫 파일의 인식 결과가 아니라 두 번째 것만 남는다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);
  await selectCostFile(page, 'cost-a.csv', costCsv(COST_PRICE_A));
  await expect(page.getByRole('status').filter({ hasText: 'cost-a.csv' })).toBeVisible();

  await selectCostFile(page, 'cost-b.csv', costCsv(COST_PRICE_B));
  await expect(page.getByRole('status').filter({ hasText: 'cost-b.csv' })).toBeVisible();
  await expect(page.getByText('cost-a.csv')).toHaveCount(0);
});

test('문서 교체 — 작업 파일을 다시 열면(같은 내용이라도 새 문서 객체) 원가 연결이 폐기된다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);
  await selectCostFile(page, 'cost-a.csv', costCsv(COST_PRICE_A));
  await expect(page.getByRole('status').filter({ hasText: '1줄 인식됨' })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '작업 파일로 저장' }).click(),
  ]);
  const savedText = readFileSync((await download.path())!, 'utf8');

  // 같은 내용을 다시 열어도 decodeWorkFile은 매번 새 객체를 만든다 —
  // 참조 동일성으로 유효성을 가르는 로직이 내용이 아니라 "다시 열었다는
  // 사실" 자체에 반응하는지 확인한다.
  await page.getByLabel('작업 파일 선택').setInputFiles({
    name: 'reopened.avcpq.json',
    mimeType: 'application/json',
    buffer: Buffer.from(savedText),
  });
  await expect(page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' })).toHaveCount(0);
  await expect(page.locator('.q-quote-table tbody tr', { hasText: '합성 테스트 품목' })).toBeVisible();

  await expect(page.getByRole('status').filter({ hasText: '인식됨' })).toHaveCount(0);
  await expect(page.getByText('cost-a.csv')).toHaveCount(0);
});

test('격리 — 원가 파일을 연결한 채로 작업 파일을 저장해도 원가 값이나 파일명이 들어가지 않는다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);
  await selectCostFile(page, 'cost-secret.csv', costCsv(COST_PRICE_A));
  await expect(page.getByRole('status').filter({ hasText: '1줄 인식됨' })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '작업 파일로 저장' }).click(),
  ]);
  const savedText = readFileSync((await download.path())!, 'utf8');

  expect(savedText).not.toContain(COST_PRICE_A);
  expect(savedText).not.toContain('cost-secret.csv');
  expect(savedText).not.toContain('privateCostSession');
});

test('통화/단위 열이 없는 원가 파일 — 추측하지 않고 확인 입력을 받은 뒤에만 인식된다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);
  await selectCostFile(page, 'no-currency-unit.csv', costCsvNoCurrencyUnit(COST_PRICE_A));

  const confirm = page.getByRole('alert').filter({ hasText: '통화·단위 열이 없다' });
  await expect(confirm).toBeVisible();
  // 확인 전에는 아직 인식되지 않는다 — 추측해서 채우지 않는다.
  await expect(page.getByRole('status').filter({ hasText: '인식됨' })).toHaveCount(0);

  const confirmButton = confirm.getByRole('button', { name: '확인' });
  await expect(confirmButton).toBeDisabled();

  await confirm.getByLabel('원가 파일 통화 확인').fill('KRW');
  await confirm.getByLabel('원가 파일 단위 확인').fill('EA');
  await confirmButton.click();

  await expect(page.getByRole('status').filter({ hasText: '1줄 인식됨' })).toBeVisible();
});

test('모델 후보 연결 — SKU가 없는 행은 모델명 후보 중 사람이 직접 골라 연결한다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);
  // 고정 카탈로그 품목의 SKU(FIX-0001)를 원가 파일에 넣지 않는다 —
  // 모델명(규격 FIX-SPEC)으로만 찾아야 하는 상황을 만든다.
  const csv = Buffer.from('품명,규격,매입단가,통화,단위\nPTZ 카메라,FIX-SPEC,1234567,KRW,EA\n', 'utf8');
  await selectCostFile(page, 'cost-model-only.csv', csv);
  await expect(page.getByRole('status').filter({ hasText: '1줄 인식됨' })).toBeVisible();

  const row = page.locator('.q-private-cost tbody tr', { hasText: '합성 테스트 품목' });
  await expect(row).toBeVisible();
  await expect(row.getByText('미등록')).toHaveCount(0);
  await row.getByRole('button', { name: '연결' }).click();

  await expect(row.getByText(/원가 1234567/)).toBeVisible();
});

test('감사 — 오프라인에서도 원가 선택·연결·저장이 되고, 요청·콘솔·저장소·작업 파일 어디에도 원가가 새지 않는다', async ({
  page,
  context,
}) => {
  await mockResources(page);
  await createDocument(page);

  const requests: string[] = [];
  page.on('request', (req) => requests.push(req.url()));
  const consoleMessages: string[] = [];
  page.on('console', (msg) => consoleMessages.push(msg.text()));

  // 초기 자산 로딩이 끝난 뒤 오프라인으로 전환한다 — 이 지점부터는
  // 네트워크가 전혀 없어도 원가 선택·연결·저장이 전부 돼야 한다.
  await context.setOffline(true);

  const secretPrice = '919191917';
  const secretFileName = 'cost-offline-secret.csv';
  const csv = Buffer.from(`품명,규격,매입단가,통화,단위\nPTZ 카메라,FIX-SPEC,${secretPrice},KRW,EA\n`, 'utf8');
  await selectCostFile(page, secretFileName, csv);
  await expect(page.getByRole('status').filter({ hasText: '1줄 인식됨' })).toBeVisible();

  const row = page.locator('.q-private-cost tbody tr', { hasText: '합성 테스트 품목' });
  await row.getByRole('button', { name: '연결' }).click();
  await expect(row.getByText(new RegExp(`원가 ${secretPrice}`))).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '작업 파일로 저장' }).click(),
  ]);
  const savedText = readFileSync((await download.path())!, 'utf8');

  await context.setOffline(false);

  // 네트워크 — 이 흐름 전체에서 어떤 요청도 비밀 가격·원가 파일명을 담지 않는다.
  expect(requests.some((url) => url.includes(secretPrice))).toBe(false);
  expect(requests.some((url) => url.includes(secretFileName))).toBe(false);

  // 콘솔 — 어디에도 비밀 가격을 찍지 않는다.
  expect(consoleMessages.some((text) => text.includes(secretPrice))).toBe(false);

  // 저장소 — localStorage/sessionStorage 어디에도 없다.
  const storages = await page.evaluate(() => {
    const dump = (storage: Storage): string =>
      Array.from({ length: storage.length }, (_, i) => storage.key(i))
        .map((key) => `${key}=${storage.getItem(key ?? '')}`)
        .join(';');
    return { local: dump(window.localStorage), session: dump(window.sessionStorage) };
  });
  expect(storages.local).not.toContain(secretPrice);
  expect(storages.session).not.toContain(secretPrice);

  // 작업 파일 — 저장된 JSON에도 없다.
  expect(savedText).not.toContain(secretPrice);
  expect(savedText).not.toContain(secretFileName);
});

test('격리 — 원가 파일 선택은 네트워크 요청을 전혀 내지 않는다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);

  const requests: string[] = [];
  page.on('request', (req) => requests.push(req.url()));

  await selectCostFile(page, 'cost-a.csv', costCsv(COST_PRICE_A));
  await expect(page.getByRole('status').filter({ hasText: '1줄 인식됨' })).toBeVisible();

  expect(requests.filter((url) => url.includes('cost-a.csv'))).toEqual([]);
  expect(requests.some((url) => url.includes(COST_PRICE_A))).toBe(false);
});
