import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { mockResources } from './fixtures';

async function saveQuote(page: Page) {
  await mockResources(page);
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('합성 테스트 품목');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '작업 파일로 저장' }).click();
  return JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
}

async function reopen(page: Page, document: unknown) {
  await page.goto('/');
  await page.getByLabel('작업 파일 선택').setInputFiles({
    name: 'review.avcpq.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)),
  });
}

test('저장 파일의 기준이 전부 미상이면 새 견적처럼 계산하지 않고 차단한다', async ({ page }) => {
  const document = await saveQuote(page);
  for (const key of ['catalog', 'labor', 'wage', 'template', 'rule']) document.versions[key] = 'unknown';
  await reopen(page, document);
  await expect(page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' })).toBeVisible();
});

test('계산 규칙 버전만 달라도 다시 열기에서 충돌을 알린다', async ({ page }) => {
  const document = await saveQuote(page);
  document.versions.rule = 'obsolete-conduit-50m-misc-all-materials';
  await reopen(page, document);
  await expect(page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' })).toBeVisible();
});

test('현재 기준 재계산은 버전 이름뿐 아니라 변경된 판매단가도 적용한다', async ({ page }) => {
  const document = await saveQuote(page);
  const common = { schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: 'f'.repeat(64) };
  await mockResources(page, {
    '/data/approved/products.json': { ...common, products: [{
      productId: 'FIX-0001', sku: 'FIX-0001', brand: '', model: 'FIX', quoteName: '합성 테스트 품목',
      quoteSpec: 'FIX-SPEC', unit: 'EA', options: { group: '합성 장비' }, currency: 'KRW', evidence: 'verified',
    }] },
    '/data/approved/prices.json': { ...common, currency: 'KRW', prices: {
      'FIX-0001': { sellingUnitPrice: '20000', currency: 'KRW' },
    } },
  });
  await reopen(page, document);
  await page.getByRole('button', { name: '현재 기준으로 다시 계산', exact: true }).click();
  const row = page.locator('.q-quote-table tbody tr', { hasText: '합성 테스트 품목' });
  await expect(row.locator('td').nth(6)).toHaveText('20000');
});
