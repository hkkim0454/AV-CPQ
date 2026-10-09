import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { mockResources } from './fixtures';

async function createQuote(page: Page) {
  await mockResources(page);
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택', exact: true }).click();
  await page.getByLabel('품목 검색').fill('합성 테스트');
  await page.locator('.q-picker-matches').getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '견적 만들기', exact: true }).click();
}

async function saveQuote(page: Page) {
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '작업 파일로 저장', exact: true }).click();
  const path = await (await downloaded).path();
  return readFile(path!, 'utf8');
}

test('미저장 상태를 표시하고 저장·편집·undo/redo를 실제 내용에 맞춰 추적한다', async ({ page }) => {
  await createQuote(page);
  const state = page.getByRole('status', { name: '작업 저장 상태' });
  await expect(state).toContainText('저장하지 않은');
  const saved = await saveQuote(page);
  await expect(state).toContainText('저장한 내용과 같습니다');
  await page.getByLabel('고객', { exact: true }).fill('변경 고객');
  await page.getByLabel('고객', { exact: true }).press('Tab');
  await expect(state).toContainText('저장하지 않은');
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(state).toContainText('저장한 내용과 같습니다');
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  await expect(state).toContainText('저장하지 않은');

  const rejected = page.waitForEvent('dialog');
  await page.getByLabel('작업 파일 선택').setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
  await (await rejected).dismiss();
  await expect(page.getByLabel('고객', { exact: true })).toHaveValue('변경 고객');
  const accepted = page.waitForEvent('dialog');
  await page.getByLabel('작업 파일 선택').setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
  await (await accepted).accept();
  await expect(page.getByLabel('고객', { exact: true })).not.toHaveValue('변경 고객');
  await expect(state).toContainText('저장한 내용과 같습니다');
});

test('새로고침과 구성도 교체를 취소하면 미저장 견적이 남는다', async ({ page }) => {
  await createQuote(page);
  const quantity = page.getByRole('textbox', { name: / 수량$/ }).first();
  await quantity.fill('7');
  await quantity.press('Tab');
  const leaving = page.waitForEvent('dialog');
  const reload = page.reload({ timeout: 1500 }).catch(() => undefined);
  expect((await leaving).type()).toBe('beforeunload');
  await (await leaving).dismiss();
  await reload;
  await expect(quantity).toHaveValue('7');

  await page.getByRole('button', { name: '구성도 JSON 열기', exact: true }).click();
  const dialog = page.waitForEvent('dialog');
  await page.getByLabel('구성도 파일 선택').setInputFiles({ name: 'new.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: '1', nodes: [{ id: 'n', data: { model: 'FIX', systemName: '새 공간' } }], edges: [], lineTypes: [] })) });
  await (await dialog).dismiss();
  await expect(quantity).toHaveValue('7');
});

test('저장한 견적에서도 입력 중인 값과 잘못된 숫자를 버리지 않으며 저장 실패는 미저장을 유지한다', async ({ page }) => {
  await createQuote(page);
  await saveQuote(page);
  const customer = page.getByLabel('고객', { exact: true });
  await customer.fill('아직 입력 중');
  const leaving = page.waitForEvent('dialog');
  const reload = page.reload({ timeout: 1500 }).catch(() => undefined);
  await (await leaving).dismiss();
  await reload;
  await expect(customer).toHaveValue('아직 입력 중');
  await customer.press('Tab');
  await saveQuote(page);
  const quantity = page.getByRole('textbox', { name: / 수량$/ }).first();
  await quantity.fill('잘못된 수량');
  await quantity.press('Tab');
  await expect(page.getByRole('status', { name: '작업 저장 상태' })).toContainText('저장하지 않은');
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByRole('button', { name: '작업 파일로 저장', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '작업 파일을 저장하지 못했습니다' })).toBeVisible();
  expect(downloads).toBe(0);
  await quantity.fill('3');
  await quantity.press('Tab');
  await page.evaluate(() => { URL.createObjectURL = () => { throw new Error('합성 저장 실패'); }; });
  await page.getByRole('button', { name: '작업 파일로 저장', exact: true }).click();
  await expect(page.getByRole('status', { name: '작업 저장 상태' })).toContainText('저장하지 않은');
  await expect(page.getByRole('alert').filter({ hasText: '합성 저장 실패' })).toBeVisible();
});

test('모델명 검색과 후보 설명·단가·단위를 보고 직접 선택한다', async ({ page }) => {
  const products = ['EA', 'SET', 'EA'].map((unit, i) => ({ productId: `SEARCH-${i}`, sku: `SEARCH-${i}`, brand: '', model: 'BRC-H800', quoteName: '합성 카메라', quoteSpec: `옵션 ${i}`, unit, options: { group: '합성 장비', description: ['아이패드 제외', '아이패드 포함', '별도 문의'][i] }, currency: 'KRW', evidence: 'verified' }));
  await mockResources(page, {
    '/data/approved/products.json': { schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: 'a'.repeat(64), products },
    '/data/approved/prices.json': { schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: 'a'.repeat(64), currency: 'KRW', prices: { 'SEARCH-0': { sellingUnitPrice: '6000000', currency: 'KRW' }, 'SEARCH-1': { sellingUnitPrice: '0', currency: 'KRW' } } },
  });
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택', exact: true }).click();
  await page.getByLabel('품목 검색').fill('brc-h800');
  const results = page.locator('.q-picker-matches li');
  await expect(results).toHaveCount(3);
  await expect(results.nth(0)).toContainText('아이패드 제외');
  await expect(results.nth(0)).toContainText('6,000,000원');
  await expect(results.nth(1)).toContainText('단위 SET');
  await expect(results.nth(1)).toContainText('0원');
  await expect(results.nth(2)).toContainText('미등록');
  await results.nth(1).getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '견적 만들기', exact: true }).click();
  const doc = JSON.parse(await saveQuote(page));
  expect(doc.rows.find((row: { sku?: string }) => row.sku === 'SEARCH-1').unit).toBe('SET');
});

test('두 시스템 중 추가할 곳을 명시로 골라 추가하고 undo로 되돌린다', async ({ page }) => {
  await mockResources(page);
  await page.goto('/');
  await page.getByRole('button', { name: '구성도 JSON 열기', exact: true }).click();
  await page.getByLabel('구성도 파일 선택').setInputFiles({ name: 'rooms.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: '1', nodes: ['회의실', '강당'].map((systemName, i) => ({ id: `n${i}`, data: { model: 'FIX', systemName } })), edges: [], lineTypes: [] })) });
  await page.getByRole('button', { name: '품목 직접 선택', exact: true }).click();
  await page.getByLabel('품목 검색').fill('합성 테스트');
  const add = page.locator('.q-picker-matches').getByRole('button', { name: '추가', exact: true });
  await expect(add).toBeDisabled();
  await page.getByLabel('추가할 시스템').selectOption({ label: '강당' });
  await add.click();
  await expect(page.getByLabel('추가할 시스템')).toBeVisible();
  let doc = JSON.parse(await saveQuote(page));
  const hall = doc.systems.find((s: { name: string }) => s.name === '강당');
  expect(doc.rows.filter((r: { sku?: string; systemId: string }) => r.sku === 'FIX-0001' && r.systemId === hall.systemId)).toHaveLength(2);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  doc = JSON.parse(await saveQuote(page));
  expect(doc.rows.filter((r: { sku?: string; systemId: string }) => r.sku === 'FIX-0001' && r.systemId === hall.systemId)).toHaveLength(1);
});

test('실패한 파일은 작업을 보존하고, 늦게 읽힌 파일이 더 나중에 선택한 구성도를 덮지 않는다', async ({ page }) => {
  await createQuote(page);
  const saved = await saveQuote(page);
  await page.getByLabel('작업 파일 선택').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await expect(page.getByRole('alert').filter({ hasText: '작업 파일을 열지 못했습니다' })).toBeVisible();
  await expect(page.getByLabel('고객', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = async function () {
      const value = await original.call(this);
      if (this.name === 'slow.json') {
        await new Promise<void>((resolve) => { (window as unknown as { releaseFile(): void }).releaseFile = resolve; });
      }
      return value;
    };
  });
  await page.getByLabel('작업 파일 선택').setInputFiles({ name: 'slow.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
  await page.waitForFunction(() => typeof (window as unknown as { releaseFile?: unknown }).releaseFile === 'function');
  await page.getByRole('button', { name: '구성도 JSON 열기', exact: true }).click();
  await page.getByLabel('구성도 파일 선택').setInputFiles({ name: 'newest.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: '1', nodes: [{ id: 'new', data: { model: 'FIX', systemName: '나중 공간' } }], edges: [], lineTypes: [] })) });
  await expect(page.getByLabel('견적번호', { exact: true })).toHaveValue('newest');
  await saveQuote(page);
  await page.evaluate(async () => {
    (window as unknown as { releaseFile(): void }).releaseFile();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  await expect(page.getByLabel('견적번호', { exact: true })).toHaveValue('newest');
});
