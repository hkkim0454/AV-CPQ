import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { mockResources } from './fixtures';

/**
 * 메인페이지 자료 안내 — 노임 공표·표준품셈 PDF 보기·다운로드(계획 §8,
 * 2026-10-05).
 */

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const DOC1 = '2026년_하반기_적용_정보통신부문_시중노임단가_공표_안내_1부.pdf';
const DOC2 = '2026년도-적용-정보통신공사-표준품셈.pdf';

test('초기 화면에서 자료 PDF를 요청하지 않는다 — 링크만 렌더링한다', async ({ page }) => {
  await mockResources(page);
  const pdfRequests: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/reference-docs/')) pdfRequests.push(req.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '자료 안내' })).toBeVisible();
  await expect(page.getByRole('link', { name: /노임 공표 보기/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /표준품셈 보기/ })).toBeVisible();
  expect(pdfRequests).toEqual([]);
});

test('보기는 같은 사이트의 PDF를 새 탭 링크로 가리키고, 실제로 받아보면 원본과 바이트가 같다', async ({ page }) => {
  // 헤드리스 Chromium은 새 탭에서 PDF 내장 뷰어 탐색을 끝까지 완료하지
  // 않을 때가 있어(about:blank에 머무름), 여기서는 링크 자체의 계약
  // (같은 사이트 경로·새 탭·보안 rel)과 그 경로가 실제로 내주는 바이트를
  // 검증한다 — 브라우저 내장 뷰어 렌더링 자체는 검증 대상이 아니다.
  await mockResources(page);
  await page.goto('/');
  const link = page.getByRole('link', { name: /2026년 하반기 정보통신 노임 공표 보기/ });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  const href = await link.getAttribute('href');
  expect(href).toBeTruthy();
  const url = new URL(href!, page.url());
  expect(url.pathname).toContain('/reference-docs/');
  expect(url.pathname).toContain(encodeURIComponent(DOC1));

  const response = await page.request.get(url.toString());
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/pdf');
  const original = readFileSync(resolve(ROOT, 'reference-docs', DOC1));
  expect(Buffer.from(await response.body()).equals(original)).toBe(true);
});

test('다운로드는 원본과 바이트가 동일한 노임 공표 PDF를 내려받는다', async ({ page }) => {
  await mockResources(page);
  await page.goto('/');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: /2026년 하반기 정보통신 노임 공표 다운로드/ }).click(),
  ]);
  const downloaded = readFileSync((await download.path())!);
  const original = readFileSync(resolve(ROOT, 'reference-docs', DOC1));
  expect(downloaded.equals(original)).toBe(true);
});

test('다운로드는 원본과 바이트가 동일한 표준품셈 PDF를 내려받는다', async ({ page }) => {
  await mockResources(page);
  await page.goto('/');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: /표준품셈 다운로드/ }).click(),
  ]);
  const downloaded = readFileSync((await download.path())!);
  const original = readFileSync(resolve(ROOT, 'reference-docs', DOC2));
  expect(downloaded.equals(original)).toBe(true);
});

test('표준품셈 PDF는 내용 추출이 아니라 원문 보기·다운로드로만 제공한다고 명시한다', async ({ page }) => {
  await mockResources(page);
  await page.goto('/');
  await expect(page.getByText('내용을 추출해 화면에 다시 표시하거나', { exact: false })).toBeVisible();
});

test('노임 공표 PDF는 17개 직종 전체의 근거가 아니라고 명시한다', async ({ page }) => {
  await mockResources(page);
  await page.goto('/');
  await expect(page.getByText('템플릿 17개 직종 전체의 근거는 아닙니다', { exact: false })).toBeVisible();
});
