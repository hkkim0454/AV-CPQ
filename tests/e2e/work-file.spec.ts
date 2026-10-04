import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { mockResources } from './fixtures';

/** 계획 2026-10-04-quote-workspace-ui Task 4 — 작업 파일 저장/열기. */

test('작업 파일로 저장했다가 다시 열면 그대로 돌아온다(같은 기준)', async ({ page }) => {
  await mockResources(page);
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('합성 테스트 품목');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();

  await expect(page.locator('.q-quote-table tbody tr', { hasText: '합성 테스트 품목' })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '작업 파일로 저장' }).click(),
  ]);
  const path = await download.path();
  expect(path).not.toBeNull();
  const savedText = readFileSync(path!, 'utf8');

  // 같은 세션을 비우고(새로고침) 방금 받은 파일을 다시 연다 — 같은 카탈로그라
  // 기준 충돌 없이 바로 견적 화면으로 돌아와야 한다.
  await page.goto('/');
  await page.getByLabel('작업 파일 선택').setInputFiles({
    name: 'saved.avcpq.json',
    mimeType: 'application/json',
    buffer: Buffer.from(savedText),
  });

  await expect(page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' })).toHaveCount(0);
  await expect(page.locator('.q-quote-table tbody tr', { hasText: '합성 테스트 품목' })).toBeVisible();
});

test('카탈로그가 바뀐 뒤 작업 파일을 열면 조용히 다시 계산하지 않고 알린다', async ({ page }) => {
  await mockResources(page);
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('합성 테스트 품목');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '작업 파일로 저장' }).click(),
  ]);
  const path = await download.path();
  const savedText = readFileSync(path!, 'utf8');

  const common = { schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: 'f'.repeat(64) };
  await mockResources(page, {
    '/data/approved/products.json': {
      ...common,
      products: [
        {
          productId: 'FIX-0001', sku: 'FIX-0001', brand: '', model: 'FIX', quoteName: '합성 테스트 품목',
          quoteSpec: 'FIX-SPEC', unit: 'EA', options: { group: '합성 장비' }, currency: 'KRW', evidence: 'verified',
        },
      ],
    },
    '/data/approved/prices.json': {
      ...common, currency: 'KRW', prices: { 'FIX-0001': { sellingUnitPrice: '10000', currency: 'KRW' } },
    },
  });
  await page.goto('/');
  await page.getByLabel('작업 파일 선택').setInputFiles({
    name: 'saved.avcpq.json',
    mimeType: 'application/json',
    buffer: Buffer.from(savedText),
  });

  const conflict = page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' });
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText('카탈로그');

  await conflict.getByRole('button', { name: '현재 기준으로 다시 계산' }).click();
  await expect(conflict).toHaveCount(0);
  await expect(page.locator('.q-quote-table tbody tr', { hasText: '합성 테스트 품목' })).toBeVisible();
});

test('케이블 거리 수정이 적용 대기 중이면 작업 파일 저장을 막는다', async ({ page }) => {
  await mockResources(page);
  await page.goto('/');
  const diagram = {
    version: '1',
    nodes: [
      { id: 'n1', data: { model: '', name: '소스', systemName: '시스템1' } },
      { id: 'n2', data: { model: '', name: '싱크', systemName: '시스템1' } },
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2', data: { lineTypeId: 'video', bomRows: [] } }],
    lineTypes: [{ id: 'video', name: 'HDMI', color: '#ef4444' }],
  };
  await page.getByRole('button', { name: '구성도 JSON 열기' }).click();
  await page.locator('.q-card input[type="file"]').setInputFiles({
    name: 'diagram.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(diagram)),
  });

  await expect(page.getByRole('button', { name: '작업 파일로 저장' })).toBeEnabled();

  await page.getByLabel('e1 수평거리(m)').fill('10');
  await expect(page.getByRole('button', { name: '작업 파일로 저장' })).toBeDisabled();

  await page.getByRole('button', { name: '케이블 재산출 미리보기' }).click();
  await page.getByRole('button', { name: '재산출 취소' }).click();
  await expect(page.getByRole('button', { name: '작업 파일로 저장' })).toBeEnabled();
});
