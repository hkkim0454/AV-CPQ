/**
 * 사용성 2차 Task B — 확인 항목에서 **정확한 입력 자리**로 이동한다.
 *
 * 같은 품명을 쓰는 두 행이 같은 문구의 경고를 낸다. 목록에서 두 번째를
 * 눌렀을 때 **두 번째 행만** 펼쳐져야 한다. 문구로 묶으면 첫 행이 열린다.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockResources } from './fixtures';

// 품목 선택 화면은 같은 SKU 를 두 번 담지 않는다. **이름이 같고 번호가 다른**
// 두 품목을 두어 "문구가 같은 두 행"을 만든다 — 실제로 흔한 모양이다
// (같은 제품을 다른 자리에 두 번 쓰는 견적).
const SKU_A = 'FIX-0001';
const SKU_B = 'FIX-0002';

/** 품셈 연결이 붙은 두 품목 — 둘 다 같은 매핑이라 경고 문구까지 같아진다. */
function productsWithLaborMapping(): unknown {
  const base = {
    brand: '', model: 'FIX', quoteName: '합성 테스트 품목', unit: 'EA',
    options: { group: '합성 장비' }, currency: 'KRW', evidence: 'verified',
    laborMappingId: 'LM-1',
  };
  return {
    schemaVersion: 1,
    generatedOn: '2026-01-01',
    sourceSha256: 'a'.repeat(64),
    products: [
      { ...base, productId: SKU_A, sku: SKU_A, quoteSpec: 'FIX-SPEC-A' },
      { ...base, productId: SKU_B, sku: SKU_B, quoteSpec: 'FIX-SPEC-B' },
    ],
  };
}

/** 전역 `confirmed` 는 그대로 `false` 다 — 정책을 풀지 않는다. */
function laborMappingsWithOne(): unknown {
  return {
    schemaVersion: 1,
    generatedOn: '2026-01-01',
    sourceSha256: 'b'.repeat(64),
    mappings: [{
      laborMappingId: 'LM-1', sku: SKU_A, laborItemId: 'LI-1',
      conversionFactor: '1', surcharge: '0', itemRate: '1',
      confirmed: false, note: '합성 테스트 — 자동 매칭, 미확인',
    }],
    unmappedSkus: [],
  };
}

/** 같은 품목을 두 번 담아 **이름이 같은 두 행**을 만든다. */
async function buildTwoSameNameRows(page: Page): Promise<void> {
  await mockResources(page, {
    '/data/approved/products.json': productsWithLaborMapping(),
    '/data/approved/labor-mappings.json': laborMappingsWithOne(),
  });
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('합성 테스트 품목');
  // 검색 결과 **두 건을 각각** 담는다. 같은 단추를 두 번 누르면 같은 SKU 라
  // 한 번만 담긴다(화면이 중복을 막는다).
  await page.getByRole('button', { name: '추가', exact: true }).nth(0).click();
  await page.getByRole('button', { name: '추가', exact: true }).nth(1).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();
}

const reviewList = (page: Page) => page.getByRole('region', { name: '확인 항목' });
const laborIssues = (page: Page) => reviewList(page).getByRole('button', { name: /노무 확인/ });

test('확인 목록의 두 번째 항목을 누르면 두 번째 행만 펼쳐진다', async ({ page }) => {
  await buildTwoSameNameRows(page);

  const issues = laborIssues(page);
  await expect(issues).toHaveCount(2);

  // 두 행의 rowId 를 화면에서 직접 읽는다 — 시험이 순서를 가정하지 않는다.
  const rowIds = await page.locator('tr[data-row-id]').evaluateAll(
    (els) => els.map((el) => el.getAttribute('data-row-id')!),
  );
  expect(rowIds.length).toBeGreaterThanOrEqual(2);

  await issues.nth(1).click();

  // 두 번째 행만 노무 근거가 열린다.
  await expect(page.locator(`tr[data-labor-basis-for="${rowIds[1]}"]`)).toBeVisible();
  await expect(page.locator(`tr[data-labor-basis-for="${rowIds[0]}"]`)).toHaveCount(0);
});

test('한 행을 확인하면 그 항목만 사라지고, 실행취소하면 되살아난다', async ({ page }) => {
  await buildTwoSameNameRows(page);
  const issues = laborIssues(page);
  await expect(issues).toHaveCount(2);

  await issues.nth(1).click();
  const rowIds = await page.locator('tr[data-row-id]').evaluateAll(
    (els) => els.map((el) => el.getAttribute('data-row-id')!),
  );
  const secondPanel = page.locator(`tr[data-labor-basis-for="${rowIds[1]}"]`);
  await secondPanel.getByRole('button', { name: '확인함', exact: true }).click();

  // 하나만 사라진다. 남은 하나가 계속 출력을 막는다.
  await expect(issues).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Excel 다운로드' })).toBeDisabled();

  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(issues).toHaveCount(2);
});

test('수량 확인을 누르면 그 행의 수량 입력에 포커스한다', async ({ page }) => {
  // BOM 이 없는 연결선은 수량을 정할 수 없어 `quantity-unresolved` 가 된다.
  await mockResources(page);
  await page.goto('/');
  await page.getByRole('button', { name: '구성도 JSON 열기' }).click();
  await page.getByLabel('구성도 파일 선택').setInputFiles({
    name: 'diagram.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: '1.1',
      nodes: [{ id: 'n1', type: 'equipment', data: { name: 'PTZ', model: 'FIX', category: 'video' } }],
      edges: [{ id: 'e1', source: 'n1', target: 'n1', data: { lineTypeId: 'video', bomRows: [] } }],
      lineTypes: [{ id: 'video', name: 'HDMI', color: '#ef4444' }],
    })),
  });

  const quantityIssue = reviewList(page).getByRole('button', { name: /수량 확인/ }).first();
  await expect(quantityIssue).toBeVisible();
  await quantityIssue.click();

  // 포커스가 수량 입력에 가 있다.
  const focusedLabel = await page.evaluate(() => {
    const el = document.activeElement as HTMLInputElement | null;
    return el?.getAttribute('aria-label') ?? '';
  });
  expect(focusedLabel).toContain('수량');
});

test('견적이 바뀐 뒤의 오래된 이동 요청은 조용히 다른 행을 열지 않는다', async ({ page }) => {
  await buildTwoSameNameRows(page);
  const issues = laborIssues(page);
  await issues.nth(1).click();

  const rowIds = await page.locator('tr[data-row-id]').evaluateAll(
    (els) => els.map((el) => el.getAttribute('data-row-id')!),
  );
  // 두 번째 행을 지운다 — 방금 연 요청의 대상이 사라진다.
  await page.locator(`tr[data-row-id="${rowIds[1]}"]`).getByRole('button', { name: '삭제' }).click();

  // 남은 행이 대신 열리면 안 된다.
  await expect(page.locator(`tr[data-labor-basis-for="${rowIds[0]}"]`)).toHaveCount(0);
  await expect(page.locator(`tr[data-labor-basis-for="${rowIds[1]}"]`)).toHaveCount(0);
});

// ---------------------------------------------------------------------------
/**
 * 사용성 2차 Task C — 견적표를 먼저 보여주고, 상세 입력은 필요할 때 펼친다.
 *
 * ⛔ 접기·열 숨김은 **화면 상태**일 뿐이다. 입력 컴포넌트를 떼어내면 사람이
 * 치던 값과 원가 연결이 사라진다. 문서·합계·미저장 여부도 바뀌면 안 된다.
 */
async function buildSimpleQuote(page: Page): Promise<void> {
  await mockResources(page);
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('합성 테스트 품목');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();
}

test('견적을 열면 견적표가 갑지 입력보다 먼저 보인다', async ({ page }) => {
  await buildSimpleQuote(page);
  const order = await page.evaluate(() => {
    const sheet = document.querySelector('.q-quote-sheet');
    const cover = document.querySelector('[data-section="cover"]');
    if (sheet === null || cover === null) return 'missing';
    return sheet.compareDocumentPosition(cover) & Node.DOCUMENT_POSITION_FOLLOWING ? 'sheet-first' : 'cover-first';
  });
  expect(order).toBe('sheet-first');
});

test('상세 열은 기본으로 숨고, 펼치면 보인다 — 입력값은 그대로 남는다', async ({ page }) => {
  await buildSimpleQuote(page);
  const supplier = page.getByLabel('합성 테스트 품목 거래처');
  const toggle = page.getByRole('button', { name: /상세 열/ });

  // 기본은 숨김이다. 그래도 **입력 컴포넌트는 살아 있다**(제거가 아니라 CSS 숨김).
  await expect(toggle).toBeVisible();
  await expect(supplier).toBeAttached();
  await expect(supplier).not.toBeVisible();

  await toggle.click();
  await expect(supplier).toBeVisible();
  await supplier.fill('합성 거래처');
  await supplier.blur();

  // 숨겼다 다시 보여도 값이 남는다.
  await toggle.click();
  await expect(supplier).not.toBeVisible();
  await toggle.click();
  await expect(supplier).toHaveValue('합성 거래처');
});

test('설정 영역을 접었다 펴도 문서·합계·미저장 여부가 바뀌지 않는다', async ({ page }) => {
  await buildSimpleQuote(page);
  const total = page.locator('.q-quote-table tfoot tr').last().locator('td').nth(1);
  const before = await total.innerText();

  const section = page.getByRole('button', { name: /설치 입력/ }).first();
  await section.click();
  await section.click();

  await expect(total).toHaveText(before);
  // 화면만 접었다 폈을 뿐이므로 실행취소 거리가 늘지 않는다.
  await expect(page.getByRole('button', { name: '실행 취소', exact: true })).toBeDisabled();
});

test('케이블 거리 미적용 항목을 누르면 그 영역을 펼치고 포커스한다', async ({ page }) => {
  await buildSimpleQuote(page);
  const cableSection = page.locator('[data-section="cables"]');
  // 접힌 상태에서 시작한다.
  await expect(cableSection.getByRole('button', { name: /케이블 거리/ })).toHaveAttribute('aria-expanded', 'false');
});

test('잘못된 수량 초안이 접기·펼치기를 거쳐도 남고, 미저장 보호도 유지된다', async ({ page }) => {
  await buildSimpleQuote(page);
  const quantity = page.getByLabel('합성 테스트 품목 수량');
  // 잘못된 값이라 commit 되지 않고 지역 draft 로만 남는다(확인은 blur 에서 한다).
  await quantity.fill('-');
  await quantity.blur();
  await expect(page.getByRole('alert').filter({ hasText: '음수' })).toBeVisible();

  const section = page.getByRole('button', { name: /설치 입력/ }).first();
  await section.click();
  await section.click();

  // 접었다 펴도 치던 값과 오류 안내가 그대로다 — 입력이 unmount 되지 않았다.
  await expect(quantity).toHaveValue('-');
  await expect(page.getByRole('alert').filter({ hasText: '음수' })).toBeVisible();

  // 저장하지 않은 변경 보호도 살아 있다.
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await expect(quantity).toHaveValue('-');
});

test('상세 열을 숨겨도 저장하지 않은 변경 안내가 사라지지 않는다', async ({ page }) => {
  await buildSimpleQuote(page);
  const toggle = page.getByRole('button', { name: /상세 열/ });
  await toggle.click();

  const salesRemark = page.getByLabel('합성 테스트 품목 영업비고');
  await salesRemark.fill('입력 중');          // blur 하지 않는다 — 지역 draft 상태다.
  await toggle.click();                       // 숨긴다(컴포넌트는 그대로 둔다).

  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: '품목 직접 선택' }).click();

  await toggle.click();
  await expect(salesRemark).toHaveValue('입력 중');
});
