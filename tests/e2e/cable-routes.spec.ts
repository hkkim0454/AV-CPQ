import { test, expect } from '@playwright/test';
import { mockResources } from './fixtures';

async function openDiagram(page: Parameters<typeof mockResources>[0]) {
  const common = { schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: 'a'.repeat(64) };
  await mockResources(page, {
    '/data/approved/products.json': { ...common, products: [3, 5].map(m => ({
      productId: `C${m}`, sku: `C${m}`, brand: '', model: `CABLE-${m}M`, quoteName: '합성 HDMI',
      quoteSpec: `${m}M`, unit: 'EA', options: { group: 'HDMI' }, currency: 'KRW', evidence: 'verified',
    })) },
    '/data/approved/prices.json': { ...common, currency: 'KRW', prices: {
      C3: { sellingUnitPrice: '100', currency: 'KRW' }, C5: { sellingUnitPrice: '200', currency: 'KRW' },
    } },
  });
  await page.goto('/');
  await page.getByRole('button', { name: '구성도 JSON 열기' }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'routes.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: '1', nodes: [
      { id: 'n1', data: { name: '시작', model: '' } }, { id: 'n2', data: { name: '끝', model: '' } },
    ], edges: ['e1', 'e2'].map(id => ({ id, source: 'n1', target: 'n2', data: { lineTypeId: 'hdmi',
      bomRows: [{ cableType: 'ready-made', productName: 'CABLE-3M', length: '3', quantity: '1' }],
    } })), lineTypes: [{ id: 'hdmi', name: 'HDMI' }] })) });
}

async function previewFive(page: Parameters<typeof mockResources>[0], id: string) {
  await page.getByLabel(`${id} 거리 기준`, { exact: true }).selectOption('confirmed-total');
  await page.getByLabel(`${id} 확인된 총길이(m)`, { exact: true }).fill('5');
  await page.getByRole('button', { name: '케이블 재산출 미리보기', exact: true }).click();
}

test('구간 거리로 케이블이 분할·병합되고 실행취소로 입력과 행이 함께 복원된다', async ({ page }) => {
  await openDiagram(page);
  const rows = page.locator('.q-quote-table tbody tr', { hasText: '합성 HDMI' });
  await expect(rows).toHaveCount(1);
  await previewFive(page, 'e1');
  // 무관한 견적 편집에서 거리 초안은 유지하고 미리보기만 다시 만든다.
  await page.getByLabel('고객', { exact: true }).fill('초안 보존 확인');
  await page.getByLabel('고객', { exact: true }).blur();
  await expect(page.getByLabel('e1 확인된 총길이(m)', { exact: true })).toHaveValue('5');
  await page.getByRole('button', { name: '케이블 재산출 미리보기', exact: true }).click();
  await page.getByRole('button', { name: '재산출 적용', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: '5M' }).getByLabel('합성 HDMI 수량')).toHaveValue('1');
  await previewFive(page, 'e2');
  await page.getByRole('button', { name: '재산출 적용', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.getByLabel('합성 HDMI 수량')).toHaveValue('2');
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByLabel('e2 확인된 총길이(m)', { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: '케이블 구간 거리' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.local/out/ui-cable-route-390.png' });
});

test('수동 수량을 고친 행의 분할은 확인 전 적용되지 않는다', async ({ page }) => {
  await openDiagram(page);
  await page.getByLabel('합성 HDMI 수량', { exact: true }).fill('7');
  await page.getByLabel('합성 HDMI 수량', { exact: true }).blur();
  await previewFive(page, 'e1');
  await expect(page.getByRole('button', { name: '재산출 적용', exact: true })).toBeDisabled();
  await expect(page.getByLabel('합성 HDMI 수량', { exact: true })).toHaveValue('7');
  await page.getByRole('button', { name: '재산출 취소', exact: true }).click();
  await expect(page.getByLabel('합성 HDMI 수량', { exact: true })).toHaveValue('7');
  await previewFive(page, 'e1');
  await page.getByRole('checkbox', { name: '이 항목의 수동 수정을 버리고 표시된 자동 산출값을 사용합니다' }).check();
  await page.getByRole('button', { name: '재산출 적용', exact: true }).click();
  await expect(page.locator('.q-quote-table tbody tr', { hasText: '합성 HDMI' })).toHaveCount(2);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(page.getByLabel('합성 HDMI 수량', { exact: true })).toHaveValue('7');
});

test('미완성 경로와 거리 초과 경고는 재산출·실행취소를 따르고 짧은 케이블로 해소할 수 없다', async ({ page }) => {
  await openDiagram(page);
  await page.getByLabel('e1 수평거리(m)', { exact: true }).fill('20');
  await page.getByRole('button', { name: '케이블 재산출 미리보기', exact: true }).click();
  await page.getByRole('button', { name: '재산출 적용', exact: true }).click();
  const warnings = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' });
  await expect(warnings).toContainText('경로 입력이 아직 완성되지 않았다');
  await page.getByLabel('e1 입상 높이(m)', { exact: true }).fill('2');
  await page.getByLabel('e1 입하 높이(m)', { exact: true }).fill('2');
  await expect(page.getByText('(20m + 2m + 2m) × 1.3 = 31.2m', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '케이블 재산출 미리보기', exact: true }).click();
  await page.getByRole('button', { name: '재산출 적용', exact: true }).click();
  await expect(warnings).toContainText('완제품 최대 길이');
  await expect(warnings).not.toContainText('경로 입력이 아직 완성되지 않았다');
  await expect(warnings.getByRole('button', { name: '선택', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(warnings).toContainText('경로 입력이 아직 완성되지 않았다');
  await expect(warnings).not.toContainText('완제품 최대 길이');
});
