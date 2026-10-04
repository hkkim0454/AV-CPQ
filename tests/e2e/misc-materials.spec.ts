import { test, expect } from '@playwright/test';
import { mockResources } from './fixtures';

test('LED 캐비넷은 제외하고 S-BOX는 잡자재비에 포함한다', async ({ page }) => {
  const common = { schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: 'a'.repeat(64) };
  await mockResources(page, {
    '/data/approved/products.json': { ...common, products: [
      { productId: 'CAB', sku: 'CAB', brand: '', model: 'CAB', quoteName: '합성 캐비넷', quoteSpec: 'CAB', unit: 'EA', options: { group: 'MMF' }, currency: 'KRW', evidence: 'verified' },
      { productId: 'BOX', sku: 'BOX', brand: '', model: 'BOX', quoteName: '합성 S-BOX', quoteSpec: 'BOX', unit: 'EA', options: { group: 'S-BOX 및 부속품' }, currency: 'KRW', evidence: 'verified' },
    ] },
    '/data/approved/prices.json': { ...common, currency: 'KRW', prices: {
      CAB: { sellingUnitPrice: '1000000', currency: 'KRW' }, BOX: { sellingUnitPrice: '10000', currency: 'KRW' },
    } },
  });
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  for (const query of ['합성 캐비넷', '합성 S-BOX']) {
    await page.getByLabel('품목 검색').fill(query);
    await page.getByRole('button', { name: '추가', exact: true }).click();
  }
  await page.getByRole('button', { name: '견적 만들기' }).click();
  const miscAmount = page.locator('tr[data-derived="true"]', { hasText: '잡자재비' }).locator('td').nth(6);
  await expect(miscAmount).toHaveText('200');
  await page.getByLabel('합성 캐비넷 수량', { exact: true }).fill('5');
  await page.getByLabel('합성 캐비넷 수량', { exact: true }).blur();
  await expect(miscAmount).toHaveText('200');
  await page.getByLabel('합성 S-BOX 수량', { exact: true }).fill('2');
  await page.getByLabel('합성 S-BOX 수량', { exact: true }).blur();
  await expect(miscAmount).toHaveText('400');
});

test('잡자재비가 화면에 나타나고 수량 변경과 실행취소를 따른다', async ({ page }) => {
  await mockResources(page);
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('합성 테스트 품목');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();
  const misc = page.locator('.q-quote-table tbody tr', { hasText: '잡자재비' });
  await expect(misc).toHaveCount(1);
  await expect(misc.locator('td').nth(6)).toHaveText('200');
  await page.getByLabel('합성 테스트 품목 수량', { exact: true }).fill('2');
  await page.getByLabel('합성 테스트 품목 수량', { exact: true }).blur();
  await expect(misc.locator('td').nth(6)).toHaveText('400');
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(misc.locator('td').nth(6)).toHaveText('200');
  await expect(misc).toHaveCount(1);
});
