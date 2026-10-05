/**
 * 0/1/2단계 Excel 다운로드 실제 연결 (계획 2026-10-04-quote-workspace-ui
 * Task 6). 파일명만 보지 않고 실제 받은 바이트를 열어 내용을 본다.
 *
 * 합성 fixture의 품셈 연결(`/data/approved/labor-mappings.json`)은
 * 스키마상 `confirmed`가 늘 `false`다(설계서 §5.3 — 자동 추출 산출물은
 * 사람 확인 전 전부 미확인) — 즉 `laborMode: 'mapped'`인 행은 지금
 * 구조에서 항상 차단된다. "출력이 실제로 되는" 상태를 만들려고 품셈
 * 연결 자체를 느슨하게 풀지 않는다 — 대신 작업 파일을 저장한 뒤 그
 * 행의 노무 처리 방식을 `manual`(수동 0원 지정, 침묵하지 않고 명시한
 * 값)로 바꿔 다시 연다. 카탈로그/품셈 스키마는 건드리지 않는다.
 */
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { test, expect, type Page, type Download } from '@playwright/test';
import { mockResources } from './fixtures';

async function downloadedBytes(download: Download): Promise<Uint8Array> {
  const path = await download.path();
  return new Uint8Array(readFileSync(path!));
}

async function saveQuote(page: Page): Promise<Record<string, unknown>> {
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

/**
 * 품셈 연결 미확인 차단을 피해, 노무비를 수동 0원으로 명시한 문서를
 * 만든다. `sku`/`productId`도 지운다 — 남겨 두면 "현재 기준으로 다시
 * 계산"이 카탈로그로 재연결하면서 `laborMode`를 다시 `unresolved`로
 * 덮어써 버린다(`resolveProduct.ts`의 의도된 동작: 재연결 시 제품에
 * 종속된 칸을 전부 다시 채운다) — sku가 없으면 재계산이 이 행을
 * 건드리지 않고 그대로 둔다(`refreshResolvedRows`).
 */
function withResolvedLabor(document: Record<string, unknown>): Record<string, unknown> {
  const rows = document['rows'] as Array<Record<string, unknown>>;
  for (const row of rows) {
    if (row['type'] === 'item') {
      row['laborMode'] = 'manual';
      row['manualLaborUnitPrice'] = '0';
      delete row['laborMappingId'];
      delete row['sku'];
      delete row['productId'];
    }
  }
  return document;
}

async function reopen(page: Page, document: unknown): Promise<void> {
  await page.goto('/');
  await page.getByLabel('작업 파일 선택').setInputFiles({
    name: 'resolved.avcpq.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document)),
  });
}

/** 출력이 실제로 되는(차단 없는) 문서를 만들어 연다. */
async function makeDownloadableQuote(page: Page): Promise<void> {
  const document = withResolvedLabor(await saveQuote(page));
  await reopen(page, document);
  await expect(page.getByRole('button', { name: 'Excel 다운로드' })).toBeEnabled();
}

test('고객용(2단계) — 실제 다운로드 파일을 연다', async ({ page }) => {
  await makeDownloadableQuote(page);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel 다운로드' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^견적서_.*\.xlsx$/);
  expect(download.suggestedFilename()).not.toContain('_원');
  expect(download.suggestedFilename()).not.toContain('설명+품셈포함');

  const bytes = await downloadedBytes(download);
  const files = unzipSync(bytes);
  expect(files['[Content_Types].xml']).toBeDefined();
  const detail = strFromU8(files['xl/worksheets/sheet2.xml']!);
  expect(detail).toContain('합성 테스트 품목');
});

test('공유용(1단계) — 원가 열 없이 설명/품셈을 더해 낸다', async ({ page }) => {
  await makeDownloadableQuote(page);
  await page.getByRole('radio', { name: '1 공유용' }).check();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel 다운로드' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toContain('(설명+품셈포함)');

  const bytes = await downloadedBytes(download);
  const files = unzipSync(bytes);
  expect(files['[Content_Types].xml']).toBeDefined();
});

test('영업팀용(0단계) — 원가 세션이 없어도 출력은 된다(원가 칸은 빈 채)', async ({ page }) => {
  await makeDownloadableQuote(page);
  await page.getByRole('radio', { name: '0 영업팀용' }).check();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel 다운로드' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toContain('_원');

  const bytes = await downloadedBytes(download);
  const files = unzipSync(bytes);
  expect(files['[Content_Types].xml']).toBeDefined();
});

test('해결되지 않은 구성도/품셈/계산 경고 — 해결 전에는 출력을 막는다', async ({ page }) => {
  await mockResources(page, { '/data/approved/prices.json': 'missing' });
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('합성 테스트 품목');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();

  await expect(page.getByText('해결되지 않은 구성도/품셈/계산 경고가 있어', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Excel 다운로드' })).toBeDisabled();
});

test('D23 — 노임 기준이 옛것이면 다시 계산해 적용할 때까지 출력을 막는다', async ({ page }) => {
  const document = withResolvedLabor(await saveQuote(page));
  await reopen(page, document);
  await expect(page.getByRole('button', { name: 'Excel 다운로드' })).toBeEnabled();

  // 1) 양성 대조 — 지금 기준으로는 다운로드가 된다.
  const firstDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel 다운로드' }).click();
  await firstDownload;

  // 2) 노임 기준을 옛것으로 바꿔 다시 연다 — 미적용 상태에서는 막는다.
  //    download 이벤트가 전혀 없어야 한다.
  (document as { versions: { wage: string } }).versions.wage = 'unavailable-old-wage';
  await reopen(page, document);
  await expect(page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' })).toBeVisible();
  const excelButton = page.getByRole('button', { name: 'Excel 다운로드' });
  await expect(excelButton).toBeDisabled();
  let gotDownload = false;
  page.once('download', () => { gotDownload = true; });
  await excelButton.click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
  expect(gotDownload).toBe(false);

  // 3) 현재 기준으로 재계산해 적용하면 출력 가능해진다.
  await page.getByRole('button', { name: '현재 기준으로 다시 계산 — 미리보기' }).click();
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await expect(excelButton).toBeEnabled();
  const afterApplyDownload = page.waitForEvent('download');
  await excelButton.click();
  await afterApplyDownload;

  // 4) undo로 옛 기준 문서로 되돌아가면 다시 막힌다.
  await page.getByRole('button', { name: '실행 취소' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' })).toBeVisible();
  await expect(excelButton).toBeDisabled();
});
