/**
 * 사용성 2차 Task D — 실제 화면 폭과 키보드 동선.
 *
 * ⛔ **페이지 전체가 옆으로 넘치면 안 된다.** 표의 내부 스크롤은 허용한다.
 * 좁은 화면에서 품명이 한 글자씩 줄바꿈되는 것도 막는다.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockResources } from './fixtures';

const SHA = 'a'.repeat(64);

/** 합성 20품목 · 2시스템 견적. 구성도로 두 공간을 만든다. */
function diagramOfTwoSystems(): unknown {
  const nodes = Array.from({ length: 20 }, (_, i) => ({
    id: `n${i}`,
    type: 'equipment',
    data: {
      name: `합성 장비 ${i}`,
      model: 'FIX',
      category: 'video',
      systemName: i < 10 ? '회의실 A' : '교육장 B',
    },
  }));
  return { version: '1.1', nodes, edges: [], lineTypes: [] };
}

function products(): unknown {
  return {
    schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: SHA,
    products: [{
      productId: 'FIX-0001', sku: 'FIX-0001', brand: '', model: 'FIX',
      quoteName: '아주 긴 합성 장비 이름 — 좁은 화면에서 줄바꿈을 보려고 길게 둔다',
      quoteSpec: 'FIX-SPEC-아주-긴-규격-문자열', unit: 'EA',
      options: { group: '합성 장비' }, currency: 'KRW', evidence: 'verified',
    }],
  };
}

async function openTwoSystemQuote(page: Page): Promise<void> {
  await mockResources(page, {
    '/data/approved/products.json': products(),
    '/data/approved/prices.json': {
      schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: SHA, currency: 'KRW',
      prices: { 'FIX-0001': { sellingUnitPrice: '100000', currency: 'KRW' } },
    },
  });
  await page.goto('/');
  await page.getByRole('button', { name: '구성도 JSON 열기' }).click();
  await page.getByLabel('구성도 파일 선택').setInputFiles({
    name: 'two-systems.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(diagramOfTwoSystems())),
  });
  await expect(page.locator('.q-quote-sheet')).toBeVisible();
}

/** 1px 은 소수 픽셀 반올림만 허용한다. */
async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const offenders: string[] = [];
    document.querySelectorAll('*').forEach((el) => {
      // 표는 `.q-table-wrap` 안에서 스스로 가로 스크롤한다 — 허용된 넘침이라
      // 센다면 영영 통과할 수 없다. 그 안쪽은 빼고 본다.
      if (el.closest('.q-table-wrap') !== null) return;
      const box = el.getBoundingClientRect();
      if (box.right > vw + 1 && (el as HTMLElement).offsetParent !== null) {
        offenders.push(`${el.tagName}.${String((el as HTMLElement).className).slice(0, 30)}`);
      }
    });
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: vw, offenders: offenders.slice(0, 8) };
  });
  // 넘치면 어느 요소 때문인지 메시지에 넣는다 — 숫자만 보면 고칠 수 없다.
  expect(`${overflow.scrollWidth <= overflow.clientWidth + 1 ? 'ok' : overflow.scrollWidth} ${overflow.offenders.join('|') || '없음'}`)
    .toBe('ok 없음');
}

for (const [label, width, height] of [['1440', 1440, 1000], ['390', 390, 844]] as const) {
  test(`${label}px — 페이지가 옆으로 넘치지 않는다`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openTwoSystemQuote(page);
    await assertNoHorizontalOverflow(page);

    // 설정 영역을 전부 펼쳐도 넘치지 않는다.
    const collapsed = page.locator('.q-section-toggle[aria-expanded="false"]');
    for (let i = 0; i < 20 && (await collapsed.count()) > 0; i += 1) await collapsed.first().click();
    await assertNoHorizontalOverflow(page);

    // 상세 열까지 켜도 **페이지**는 넘치지 않는다(표는 내부 스크롤을 쓴다).
    await page.getByRole('button', { name: '상세 열 표시' }).click();
    await assertNoHorizontalOverflow(page);

    await page.screenshot({ path: `.local/screens/workspace-${label}.png`, fullPage: true });
  });
}

test('1440px — 합계까지 가로 스크롤 없이 보인다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTwoSystemQuote(page);
  // 품명이 길다고 표가 옆으로 늘어나면, 합계를 볼 때마다 가로로 밀어야 한다.
  // 표의 내부 스크롤은 좁은 화면에서만 쓰는 수단이지 기본 상태가 아니다.
  const wrap = page.locator('.q-table-wrap').first();
  expect(await wrap.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});

test('390px — 품명이 한 글자씩 줄바꿈되지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTwoSystemQuote(page);
  // 표는 내부에서 가로 스크롤한다 — 그래서 칸이 극단적으로 좁아지지 않는다.
  const cell = page.locator('.q-quote-table tbody tr td').first();
  const box = await cell.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(40);
});

test('확인 항목에서 Enter 를 누르면 목적지 자체에 포커스가 간다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTwoSystemQuote(page);

  const firstIssue = page.locator('.q-review-item').first();
  await firstIssue.focus();
  await expect(firstIssue).toBeFocused();
  await page.keyboard.press('Enter');

  /*
   * ⛔ "BODY 가 아니다"로는 아무것도 증명하지 못한다 — 누른 단추에 그대로
   *    머물러 있어도 통과해 버린다. **목적지 요소 자체**인지 확인한다.
   *
   * 포커스는 다음 렌더에서 옮기므로 옮겨질 때까지 다시 본다. 어느 분류가
   * 먼저 오는지는 합성 자료에 달렸으니, 네 목적지 중 하나이기만 하면 된다.
   */
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const el = globalThis.document.activeElement as HTMLElement | null;
        if (el === null || el.tagName === 'BODY') return '아무 데도 못 감';
        if (el.classList.contains('q-review-item')) return '누른 단추에 그대로 있음';
        if (el.hasAttribute('data-warning-id')) return '목적지';
        if (el.classList.contains('q-labor-basis')) return '목적지';
        if ((el.getAttribute('aria-label') ?? '').includes('수량')) return '목적지';
        if (el.closest('[data-section="cables"]') !== null) return '목적지';
        return `엉뚱한 곳: ${el.tagName}.${el.className}`;
      }),
    )
    .toBe('목적지');
});

test('접기 단추가 aria-expanded 로 상태를 알린다', async ({ page }) => {
  await openTwoSystemQuote(page);
  const toggle = page.locator('.q-section-toggle').first();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
});
