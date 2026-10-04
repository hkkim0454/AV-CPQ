import { test, expect } from '@playwright/test';
import { mockResources } from './fixtures';

const SKU_DEVICE = 'E2E-100';
const SKU_CONDUIT_A = 'E2E-101';
const SKU_CONDUIT_B = 'E2E-102';
const SHA = 'd'.repeat(64);

/**
 * 계획 2026-10-04-quote-workspace-ui Task 3, 결정 D8 보강·D22.
 *
 * 배관 후보 2건(후렉시블 묶음)만 넣고 **CD관 묶음은 두지 않는다** —
 * 실제 품셈 파일과 같다(D22: CD관 품목이 아직 없다). 그래서 CD관을
 * 고르면 후보 0건으로 차단되는지까지 같은 카탈로그로 확인할 수 있다.
 */
function customProducts(): unknown {
  return {
    schemaVersion: 1,
    generatedOn: '2026-01-01',
    sourceSha256: SHA,
    products: [
      {
        productId: SKU_DEVICE,
        sku: SKU_DEVICE,
        brand: '',
        model: 'E2E-DEVICE',
        quoteName: 'E2E 설치 시험 장비',
        quoteSpec: 'E2E-DEVICE',
        unit: 'EA',
        options: {},
        currency: 'KRW',
        evidence: 'verified',
      },
      {
        productId: SKU_CONDUIT_A,
        sku: SKU_CONDUIT_A,
        brand: '',
        model: '16㎜',
        quoteName: 'E2E 후렉시블 16mm',
        quoteSpec: '16㎜',
        unit: '10M',
        options: { group: '후렉시블' },
        currency: 'KRW',
        evidence: 'review-required',
      },
      {
        productId: SKU_CONDUIT_B,
        sku: SKU_CONDUIT_B,
        brand: '',
        model: '28㎜',
        quoteName: 'E2E 후렉시블 28mm',
        quoteSpec: '28㎜',
        unit: '10M',
        options: { group: '후렉시블' },
        currency: 'KRW',
        evidence: 'review-required',
      },
    ],
  };
}

function customPrices(): unknown {
  return {
    schemaVersion: 1,
    generatedOn: '2026-01-01',
    sourceSha256: SHA,
    currency: 'KRW',
    prices: {
      [SKU_DEVICE]: { sellingUnitPrice: '100000', currency: 'KRW' },
      [SKU_CONDUIT_A]: { sellingUnitPrice: '31000', currency: 'KRW' },
      [SKU_CONDUIT_B]: { sellingUnitPrice: '45000', currency: 'KRW' },
    },
  };
}

async function setupCatalog(page: Parameters<typeof mockResources>[0]): Promise<void> {
  await mockResources(page, {
    '/data/approved/products.json': customProducts(),
    '/data/approved/prices.json': customPrices(),
  });
}

async function startDocument(page: import('@playwright/test').Page): Promise<void> {
  await setupCatalog(page);
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('E2E 설치 시험 장비');
  await page.getByRole('button', { name: '추가' }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();
}

test('배관 — 거리 × 줄 수를 입력하면 수량과 근거 문구가 나오고, 후보에서 골라 해소한다', async ({ page }) => {
  await startDocument(page);

  const status = page.locator('.q-installation-panel p[role="status"]');
  await expect(status).toContainText('거리와 줄 수를 입력하면');

  await page.getByLabel('시스템1 장비실→가장 먼 장비 거리(m)').fill('10');
  await page.getByLabel('시스템1 장비실→가장 먼 장비 거리(m)').blur();
  // 줄 수는 기본값 3 그대로 둔다(결정 D8).

  await expect(status).toContainText('10m × 3줄 = 30m');
  await expect(status).toContainText('품목 미정');

  // 배관 경고가 떠 있고, 후보 둘 중 하나를 고르면 해소된다.
  const warnings = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' });
  await expect(warnings).toContainText('후렉시블');
  await warnings.getByRole('button', { name: '선택' }).first().click();

  await expect(status).not.toContainText('품목 미정');
  await expect(warnings).toHaveCount(0);

  const conduitRow = page.locator('.q-quote-table tbody tr', { hasText: 'E2E 후렉시블' });
  await expect(conduitRow).toContainText('3'); // 30m ÷ 10M = 3
});

test('줄 수를 바꾸면 수량만 재산출된다 — 행이 늘지 않고, 이미 고른 품목은 유지된다', async ({ page }) => {
  await startDocument(page);

  await page.getByLabel('시스템1 장비실→가장 먼 장비 거리(m)').fill('10');
  await page.getByLabel('시스템1 장비실→가장 먼 장비 거리(m)').blur();
  const warnings = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' });
  await warnings.getByRole('button', { name: '선택' }).first().click();

  await page.getByLabel('시스템1 배관 줄 수').fill('2');
  await page.getByLabel('시스템1 배관 줄 수').blur();

  const status = page.locator('.q-installation-panel p[role="status"]');
  await expect(status).toContainText('10m × 2줄 = 20m');

  const conduitRows = page.locator('.q-quote-table tbody tr', { hasText: '후렉시블' });
  await expect(conduitRows).toHaveCount(1); // 누적 추가되지 않았다
  await expect(conduitRows).toContainText('2'); // 20m ÷ 10M = 2 — 품목은 그대로 유지
});

test('CD관을 고르면 품셈에 품목이 없어 차단된다 — 0원이나 후렉시블로 대신 채우지 않는다', async ({ page }) => {
  await startDocument(page);

  await page.getByLabel('시스템1 장비실→가장 먼 장비 거리(m)').fill('10');
  await page.getByLabel('시스템1 장비실→가장 먼 장비 거리(m)').blur();
  await page.getByRole('radio', { name: 'CD관' }).check();

  const warnings = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' });
  await expect(warnings).toContainText('CD관 품목이 없습니다');

  const conduitRow = page.locator('.q-quote-table tbody tr', { hasText: 'CD관' });
  await expect(conduitRow).toContainText('미등록');
});

test('배관 입력도 실행취소로 되돌아간다', async ({ page }) => {
  await startDocument(page);

  const status = page.locator('.q-installation-panel p[role="status"]');
  await page.getByLabel('시스템1 장비실→가장 먼 장비 거리(m)').fill('10');
  await page.getByLabel('시스템1 장비실→가장 먼 장비 거리(m)').blur();
  await expect(status).toContainText('10m × 3줄 = 30m');

  await page.getByRole('button', { name: '실행 취소' }).click();
  await expect(status).toContainText('거리와 줄 수를 입력하면');
});
