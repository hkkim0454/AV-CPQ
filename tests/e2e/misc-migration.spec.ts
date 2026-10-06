/**
 * Task 3·4 잔여 2번 — 옛 기준의 잡자재 행이 있는 저장 문서를 열었을 때,
 * **무엇이 어떻게 달라지는지 보여주고 사용자가 명시적으로 옮기게** 한다.
 * 자동으로 옮기지 않고, 거절하면 막힌 상태를 그대로 둔다.
 */
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { mockResources } from './fixtures';

const common = { schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: 'a'.repeat(64) };

/** LED 캐비넷(MMF 묶음) 한 개와 일반 자재 한 개. 합성 자료다. */
const RESOURCES = {
  '/data/approved/products.json': {
    ...common,
    products: [
      { productId: 'CAB', sku: 'CAB', brand: '', model: 'CAB', quoteName: '합성 캐비넷', quoteSpec: 'CAB', unit: 'EA', options: { group: 'MMF' }, currency: 'KRW', evidence: 'verified' },
      { productId: 'BOX', sku: 'BOX', brand: '', model: 'BOX', quoteName: '합성 S-BOX', quoteSpec: 'BOX', unit: 'EA', options: { group: 'S-BOX 및 부속품' }, currency: 'KRW', evidence: 'verified' },
    ],
  },
  '/data/approved/prices.json': {
    ...common,
    currency: 'KRW',
    prices: { CAB: { sellingUnitPrice: '1000000', currency: 'KRW' }, BOX: { sellingUnitPrice: '10000', currency: 'KRW' } },
  },
};

async function saveQuote(page: Page) {
  await mockResources(page, RESOURCES);
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  for (const query of ['합성 캐비넷', '합성 S-BOX']) {
    await page.getByLabel('품목 검색').fill(query);
    await page.getByRole('button', { name: '추가', exact: true }).click();
  }
  await page.getByRole('button', { name: '견적 만들기' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '작업 파일로 저장' }).click();
  return JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
}

/** 저장 문서를 LED 제외 규칙 이전의 모습으로 되돌린다. */
function toLegacyBasis(document: {
  versions: Record<string, string>;
  derivedRows: { ruleInstanceId?: string; derived: { kind: string; excludedRowIds?: string[] } }[];
}) {
  for (const row of document.derivedRows) {
    if (row.derived.kind !== 'material-sum-to-here') continue;
    row.ruleInstanceId = 'misc-material-v0';
    row.derived.excludedRowIds = [];
  }
  document.versions['rule'] = 'obsolete-conduit-50m-misc-all-materials';
  return document;
}

async function reopen(page: Page, document: unknown) {
  await page.goto('/');
  await page.getByLabel('작업 파일 선택').setInputFiles({
    name: 'legacy-misc.avcpq.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)),
  });
}

const miscAmount = (page: Page) =>
  page.locator('.q-quote-table tbody tr', { hasText: '잡자재비' }).locator('td').nth(8);

test('옛 잡자재 기준은 자동으로 바뀌지 않고, 미리보기에서 옛 금액·새 금액과 제외될 캐비넷을 보여준다', async ({ page }) => {
  const legacy = toLegacyBasis(await saveQuote(page));
  await reopen(page, legacy);

  // 연 것만으로는 아무것도 바뀌지 않는다 — 기준 충돌로 막혀 있다.
  await expect(page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' })).toBeVisible();

  await page.getByRole('button', { name: '현재 기준으로 다시 계산 — 미리보기' }).click();

  // 왜 금액이 바뀌는지가 보여야 한다: 옛 금액 → 새 금액, 그리고 빠지는 행.
  const preview = page.getByRole('region', { name: '잡자재비 기준 이전' });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('20200');
  await expect(preview).toContainText('200');
  await expect(preview).toContainText('합성 캐비넷');
});

test('거절하면 옮기지 않고 막힌 상태를 유지한다', async ({ page }) => {
  const legacy = toLegacyBasis(await saveQuote(page));
  await reopen(page, legacy);
  await page.getByRole('button', { name: '현재 기준으로 다시 계산 — 미리보기' }).click();
  await page.getByRole('button', { name: '취소', exact: true }).click();

  await expect(page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Excel 다운로드' })).toBeDisabled();
  // 미리보기는 사라지고 다시 처음 상태로 돌아간다 — 옮기지 않았다.
  await expect(page.getByRole('region', { name: '잡자재비 기준 이전' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '현재 기준으로 다시 계산 — 미리보기' })).toBeVisible();
});

test('옮기기로 하면 LED 캐비넷을 뺀 금액으로 바뀐다', async ({ page }) => {
  const legacy = toLegacyBasis(await saveQuote(page));
  await reopen(page, legacy);
  await page.getByRole('button', { name: '현재 기준으로 다시 계산 — 미리보기' }).click();
  await page.getByRole('button', { name: '적용', exact: true }).click();

  await expect(miscAmount(page)).toHaveText('200');
  await expect(page.getByText('기존 잡자재비 계산 기준이 있습니다', { exact: false })).toHaveCount(0);
});
