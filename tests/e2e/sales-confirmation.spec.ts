import { test, expect } from '@playwright/test';
import { mockResources } from './fixtures';

test('영업팀용은 매번 원가 포함을 확인하며 취소하면 다운로드하지 않는다', async ({ page }) => {
  await mockResources(page);
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('합성 테스트 품목');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();
  await page.getByRole('button', { name: '합성 테스트 품목 노무 처리 펼치기' }).click();
  await page.getByRole('radio', { name: '해당 없음' }).check();
  await page.getByLabel('합성 테스트 품목 해당 없음 사유').fill('합성 시험: 자재 납품만');
  await page.getByLabel('합성 테스트 품목 해당 없음 사유').blur();
  await expect(page.getByRole('button', { name: 'Excel 다운로드' })).toBeEnabled();
  await page.getByRole('radio', { name: '0 영업팀용' }).check();

  let downloads = 0;
  let confirmations = 0;
  let accept = false;
  page.on('download', () => { downloads += 1; });
  page.on('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toContain('원가');
    confirmations += 1;
    if (accept) await dialog.accept();
    else await dialog.dismiss();
  });

  await page.getByRole('button', { name: 'Excel 다운로드' }).click();
  expect(confirmations).toBe(1);
  expect(downloads).toBe(0);

  accept = true;
  const accepted = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel 다운로드' }).click();
  await accepted;
  expect(confirmations).toBe(2);
  expect(downloads).toBe(1);

  // Confirmation is not a permanent permission; customer export needs none.
  accept = false;
  await page.getByRole('button', { name: 'Excel 다운로드' }).click();
  expect(confirmations).toBe(3);
  expect(downloads).toBe(1);
  await page.getByRole('radio', { name: '2 고객용' }).check();
  const customer = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel 다운로드' }).click();
  await customer;
  expect(confirmations).toBe(3);
});
