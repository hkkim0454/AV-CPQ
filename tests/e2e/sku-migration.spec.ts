/**
 * 품셈 교체 Task 4 — SKU 대응 계약.
 *
 * SKU 는 `시트코드-원본행번호`(`VID-0138`)다. 품셈 파일이 바뀌면 행이 밀려
 * **같은 번호가 다른 제품**을 가리킨다. 실측: 상·하반기 공통 SKU 1,212개 중
 * **1,024개(84%)** 가 그렇다.
 *
 * 저장된 견적서를 다시 열어 재계산하면 `refreshResolvedRows` 가 SKU 로 제품을
 * 찾아 그대로 치환한다. 번호가 살아 있기만 하면 `catalog-item-removed` 경고도
 * 나지 않는다 — **조용히 다른 제품으로 바뀐다.**
 */
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { mockResources } from './fixtures';

const SKU = 'FIX-0001';
const SHA_OLD = 'a'.repeat(64);
const SHA_NEW = 'f'.repeat(64);

/** 같은 SKU 로 **다른 제품**을 담은 카탈로그. 지문(sourceSha256)도 다르다. */
function swappedCatalog() {
  const common = { schemaVersion: 1, generatedOn: '2026-02-02', sourceSha256: SHA_NEW };
  return {
    '/data/approved/products.json': {
      ...common,
      products: [
        {
          productId: SKU,
          sku: SKU,
          brand: '',
          model: 'OTHER',
          // ⛔ 번호는 같은데 전혀 다른 제품이다.
          quoteName: '전혀 다른 합성 품목',
          quoteSpec: 'OTHER-SPEC',
          unit: 'SET',
          options: { group: '다른 합성 묶음' },
          currency: 'KRW',
          evidence: 'verified',
        },
      ],
    },
    '/data/approved/prices.json': {
      ...common,
      currency: 'KRW',
      prices: { [SKU]: { sellingUnitPrice: '999000', currency: 'KRW' } },
    },
  };
}

async function saveQuote(page: Page) {
  await mockResources(page);
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('합성 테스트 품목');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '작업 파일로 저장' }).click();
  const saved = JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
  expect(saved.versions.catalog).toBe(SHA_OLD);
  return saved;
}

async function reopenWithSwappedCatalog(page: Page, document: unknown) {
  await mockResources(page, swappedCatalog());
  await page.goto('/');
  await page.getByLabel('작업 파일 선택').setInputFiles({
    name: 'migration.avcpq.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document)),
  });
}

test('카탈로그 지문이 다르면 같은 SKU 라도 조용히 치환하지 않는다', async ({ page }) => {
  const saved = await saveQuote(page);
  await reopenWithSwappedCatalog(page, saved);

  // 지문이 다르므로 기준 충돌로 막힌다 — 여기까지는 기존 동작이다.
  await expect(page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' })).toBeVisible();

  await page.getByRole('button', { name: '현재 기준으로 다시 계산 — 미리보기' }).click();

  // ⛔ 여기가 핵심이다. 미리보기에 '전혀 다른 합성 품목'이 나타나면
  //    재계산이 번호만 보고 엉뚱한 제품으로 바꾼 것이다.
  await expect(page.getByText('전혀 다른 합성 품목', { exact: false })).toHaveCount(0);
  // 999000(새 제품의 단가)도 새어 들어오면 안 된다.
  await expect(page.getByText('999000', { exact: false })).toHaveCount(0);
});

test('치환을 막은 행은 적용한 뒤에도 옛 제품으로 남지 않는다 — 미해결로 되돌린다', async ({ page }) => {
  const saved = await saveQuote(page);
  await reopenWithSwappedCatalog(page, saved);
  await page.getByRole('button', { name: '현재 기준으로 다시 계산 — 미리보기' }).click();
  await page.getByRole('button', { name: '적용', exact: true }).click();

  // 적용 뒤에도 엉뚱한 제품이 들어오면 안 된다.
  await expect(page.getByText('전혀 다른 합성 품목', { exact: false })).toHaveCount(0);
  // 사람이 다시 골라야 한다는 것을, 왜 막혔는지와 함께 보여준다.
  await expect(page.getByText('다시 골라야', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('다른 제품이고', { exact: false }).first()).toBeVisible();
  // 미해결로 되돌아갔으므로 출력이 막힌다.
  await expect(page.getByRole('button', { name: 'Excel 다운로드' })).toBeDisabled();
});

test('취소하면 문서가 그대로 남는다 — 막혔다고 제품이 지워지지 않는다', async ({ page }) => {
  const saved = await saveQuote(page);
  await reopenWithSwappedCatalog(page, saved);
  await page.getByRole('button', { name: '현재 기준으로 다시 계산 — 미리보기' }).click();
  await page.getByRole('button', { name: '취소', exact: true }).click();

  await expect(page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' })).toBeVisible();
  await expect(page.getByRole('button', { name: '현재 기준으로 다시 계산 — 미리보기' })).toBeVisible();
  await expect(page.getByText('전혀 다른 합성 품목', { exact: false })).toHaveCount(0);
});

test('적용한 뒤 실행취소하면 옛 문서로 돌아간다', async ({ page }) => {
  const saved = await saveQuote(page);
  await reopenWithSwappedCatalog(page, saved);
  await page.getByRole('button', { name: '현재 기준으로 다시 계산 — 미리보기' }).click();
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await expect(page.getByText('다시 골라야', { exact: false }).first()).toBeVisible();

  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  // 되돌아가도 엉뚱한 제품이 생기지 않는다.
  await expect(page.getByText('전혀 다른 합성 품목', { exact: false })).toHaveCount(0);
});

test('치환이 막힌 행이 있으면 0·1·2 단계 출력이 전부 막힌다', async ({ page }) => {
  const saved = await saveQuote(page);
  await reopenWithSwappedCatalog(page, saved);
  await page.getByRole('button', { name: '현재 기준으로 다시 계산 — 미리보기' }).click();
  await page.getByRole('button', { name: '적용', exact: true }).click();

  for (const grade of ['2 고객용', '1 공유용', '0 영업팀용']) {
    await page.getByRole('radio', { name: grade }).check();
    await expect(page.getByRole('button', { name: 'Excel 다운로드' })).toBeDisabled();
  }
});

test('카탈로그 지문이 같으면 지금처럼 SKU 로 찾아 단가를 갱신한다 — 정상 경로를 막지 않는다', async ({ page }) => {
  const saved = await saveQuote(page);
  // 지문은 그대로 두고 단가만 올린다(같은 제품, 같은 판).
  await mockResources(page, {
    '/data/approved/prices.json': {
      schemaVersion: 1,
      generatedOn: '2026-01-01',
      sourceSha256: SHA_OLD,
      currency: 'KRW',
      prices: { [SKU]: { sellingUnitPrice: '20000', currency: 'KRW' } },
    },
  });
  await page.goto('/');
  await page.getByLabel('작업 파일 선택').setInputFiles({
    name: 'same-basis.avcpq.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...saved, versions: { ...saved.versions, rule: 'old-rule' } })),
  });
  await page.getByRole('button', { name: '현재 기준으로 다시 계산 — 미리보기' }).click();
  await page.getByRole('button', { name: '적용', exact: true }).click();

  // 같은 기준이므로 제품이 그대로 살아 있고 단가만 갱신된다.
  const row = page.locator('.q-quote-table tbody tr', { hasText: '합성 테스트 품목' });
  await expect(row.locator('td').nth(8)).toHaveText('20000');
  await expect(page.getByText('다시 골라야', { exact: false })).toHaveCount(0);
});
