import { test, expect } from '@playwright/test';
import { mockResources } from './fixtures';

test('실제 입구와 기본 고객 출력', async ({ page }) => {
  await mockResources(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: '구성도 JSON 열기' })).toBeVisible();
  await expect(page.getByRole('button', { name: '품목 직접 선택' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '2 고객용' })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Excel 다운로드' })).toBeDisabled();
});

test('초기 자료 로딩 성공 — 두 입구가 실제로 동작한다', async ({ page }) => {
  await mockResources(page);
  await page.goto('/');
  await expect(page.getByRole('status')).not.toBeVisible();

  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await expect(page.getByText('승인된 카탈로그 1개 품목에서 고릅니다.')).toBeVisible();

  await page.getByRole('button', { name: '구성도 JSON 열기' }).click();
  await expect(page.getByRole('button', { name: '파일 선택' })).toBeVisible();
});

test('필수 파일 실패 — 품셈 항목이 없으면 사유를 보여주고 입구를 막지 않는다', async ({ page }) => {
  await mockResources(page, { '/data/approved/labor-items.json': 'missing' });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('labor-items.json');
  // 실패해도 셸 자체는 그대로 보인다 — 화면이 통째로 죽지 않는다.
  await expect(page.getByRole('button', { name: '구성도 JSON 열기' })).toBeVisible();
});

test('판매가 없음 — 실패가 아니라 미등록 안내로 처리한다', async ({ page }) => {
  await mockResources(page, { '/data/approved/prices.json': 'missing' });
  await page.goto('/');
  await expect(page.getByRole('alert')).not.toBeVisible();
  await expect(page.getByRole('status')).toContainText('판매단가 파일이 없습니다');
  await expect(page.getByRole('button', { name: '구성도 JSON 열기' })).toBeVisible();
});

test('손상 가이드 실패 — 가이드 하나가 깨지면 사유를 보여준다', async ({ page }) => {
  await mockResources(page, {
    '/templates/sanitized/guide-won.xlsx': Buffer.from('이건 xlsx가 아니다'),
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText("가이드 'won'");
});
