import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { mockResources } from './fixtures';

/** 계획 2026-10-04-quote-workspace-ui Task 4 — 작업 파일 저장/열기. */

test('작업 파일로 저장했다가 다시 열면 그대로 돌아온다(같은 기준)', async ({ page }) => {
  await mockResources(page);
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('합성 테스트 품목');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();

  await expect(page.locator('.q-quote-table tbody tr', { hasText: '합성 테스트 품목' })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '작업 파일로 저장' }).click(),
  ]);
  const path = await download.path();
  expect(path).not.toBeNull();
  const savedText = readFileSync(path!, 'utf8');

  // 같은 세션을 비우고(새로고침) 방금 받은 파일을 다시 연다 — 같은 카탈로그라
  // 기준 충돌 없이 바로 견적 화면으로 돌아와야 한다.
  await page.goto('/');
  await page.getByLabel('작업 파일 선택').setInputFiles({
    name: 'saved.avcpq.json',
    mimeType: 'application/json',
    buffer: Buffer.from(savedText),
  });

  await expect(page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' })).toHaveCount(0);
  await expect(page.locator('.q-quote-table tbody tr', { hasText: '합성 테스트 품목' })).toBeVisible();
});

test('카탈로그가 바뀐 뒤 작업 파일을 열면 조용히 다시 계산하지 않고 알린다', async ({ page }) => {
  await mockResources(page);
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('합성 테스트 품목');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '작업 파일로 저장' }).click(),
  ]);
  const path = await download.path();
  const savedText = readFileSync(path!, 'utf8');

  const common = { schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: 'f'.repeat(64) };
  await mockResources(page, {
    '/data/approved/products.json': {
      ...common,
      products: [
        {
          productId: 'FIX-0001', sku: 'FIX-0001', brand: '', model: 'FIX', quoteName: '합성 테스트 품목',
          quoteSpec: 'FIX-SPEC', unit: 'EA', options: { group: '합성 장비' }, currency: 'KRW', evidence: 'verified',
        },
      ],
    },
    '/data/approved/prices.json': {
      ...common, currency: 'KRW', prices: { 'FIX-0001': { sellingUnitPrice: '10000', currency: 'KRW' } },
    },
  });
  await page.goto('/');
  await page.getByLabel('작업 파일 선택').setInputFiles({
    name: 'saved.avcpq.json',
    mimeType: 'application/json',
    buffer: Buffer.from(savedText),
  });

  const conflict = page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' });
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText('카탈로그');

  await conflict.getByRole('button', { name: '현재 기준으로 다시 계산 — 미리보기' }).click();
  await expect(conflict.getByText('바뀌는 행은 없습니다.')).toBeVisible();
  await conflict.getByRole('button', { name: '적용', exact: true }).click();
  await expect(conflict).toHaveCount(0);
  await expect(page.locator('.q-quote-table tbody tr', { hasText: '합성 테스트 품목' })).toBeVisible();
});

test('케이블 거리 수정이 적용 대기 중이면 작업 파일 저장을 막는다', async ({ page }) => {
  await mockResources(page);
  await page.goto('/');
  const diagram = {
    version: '1',
    nodes: [
      { id: 'n1', data: { model: '', name: '소스', systemName: '시스템1' } },
      { id: 'n2', data: { model: '', name: '싱크', systemName: '시스템1' } },
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2', data: { lineTypeId: 'video', bomRows: [] } }],
    lineTypes: [{ id: 'video', name: 'HDMI', color: '#ef4444' }],
  };
  await page.getByRole('button', { name: '구성도 JSON 열기' }).click();
  await page.locator('.q-card input[type="file"]').setInputFiles({
    name: 'diagram.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(diagram)),
  });

  await expect(page.getByRole('button', { name: '작업 파일로 저장' })).toBeEnabled();

  await page.getByLabel('e1 수평거리(m)').fill('10');
  await expect(page.getByRole('button', { name: '작업 파일로 저장' })).toBeDisabled();

  await page.getByRole('button', { name: '케이블 재산출 미리보기' }).click();
  await page.getByRole('button', { name: '재산출 취소' }).click();
  await expect(page.getByRole('button', { name: '작업 파일로 저장' })).toBeEnabled();
});

test('재계산은 미리보기→취소(원본 유지)→다시 미리보기→적용→실행취소/다시실행을 전부 지원한다(독립 검토 지적)', async ({ page }) => {
  await mockResources(page);
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('합성 테스트 품목');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '작업 파일로 저장' }).click(),
  ]);
  const savedText = readFileSync((await download.path())!, 'utf8');

  const common = { schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: 'f'.repeat(64) };
  await mockResources(page, {
    '/data/approved/products.json': {
      ...common,
      products: [{
        productId: 'FIX-0001', sku: 'FIX-0001', brand: '', model: 'FIX', quoteName: '합성 테스트 품목',
        quoteSpec: 'FIX-SPEC', unit: 'EA', options: { group: '합성 장비' }, currency: 'KRW', evidence: 'verified',
      }],
    },
    '/data/approved/prices.json': {
      ...common, currency: 'KRW', prices: { 'FIX-0001': { sellingUnitPrice: '20000', currency: 'KRW' } },
    },
  });
  await page.goto('/');
  await page.getByLabel('작업 파일 선택').setInputFiles({
    name: 'saved.avcpq.json', mimeType: 'application/json', buffer: Buffer.from(savedText),
  });

  const conflict = page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' });
  await expect(conflict).toBeVisible();

  // 1) 미리보기 — 아직 적용 전, 편집 화면은 뜨지 않는다.
  await conflict.getByRole('button', { name: '현재 기준으로 다시 계산 — 미리보기' }).click();
  await expect(conflict.getByText(/10000.*20000/)).toBeVisible();
  await expect(page.locator('.q-quote-table')).toHaveCount(0);

  // 2) 취소 — 원본 그대로, 충돌도 그대로다.
  await conflict.getByRole('button', { name: '취소', exact: true }).click();
  await expect(conflict).toBeVisible();
  await expect(page.getByText(/10000.*20000/)).toHaveCount(0);

  // 3) 다시 미리보기 — 취소가 내부 상태를 망가뜨리지 않았는지 확인.
  await conflict.getByRole('button', { name: '현재 기준으로 다시 계산 — 미리보기' }).click();
  await expect(conflict.getByText(/10000.*20000/)).toBeVisible();

  // 4) 적용 — 비로소 반영된다.
  await conflict.getByRole('button', { name: '적용', exact: true }).click();
  await expect(conflict).toHaveCount(0);
  const row = page.locator('.q-quote-table tbody tr', { hasText: '합성 테스트 품목' });
  await expect(row.locator('td').nth(6)).toHaveText('20000');

  // 5) 실행취소 — 재계산 자체를 되돌릴 수 있다(원래의 충돌 상태로).
  await page.getByRole('button', { name: '실행 취소' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' })).toBeVisible();

  // 6) 다시실행 — 적용한 재계산으로 되돌아간다.
  await page.getByRole('button', { name: '다시 실행' }).click();
  await expect(page.locator('.q-quote-table tbody tr', { hasText: '합성 테스트 품목' }).locator('td').nth(6)).toHaveText('20000');
});

test('재계산 중 카탈로그에서 사라진 품목은 옛 단가로 조용히 넘어가지 않고 다시 고르게 한다(독립 검토 지적)', async ({ page }) => {
  await mockResources(page);
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('합성 테스트 품목');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '작업 파일로 저장' }).click(),
  ]);
  const savedText = readFileSync((await download.path())!, 'utf8');
  const savedDocument = JSON.parse(savedText) as { rows: Array<{ rowId: string; type: string }> };
  const rowId = savedDocument.rows.find((r) => r.type === 'item')!.rowId;

  // 재열기 때 쓸 카탈로그에는 FIX-0001이 아예 없다 — 다른 SKU 하나만
  // 둔다. 저장 당시 해소해 둔 품목이 지금 카탈로그에서 사라진 상황이다.
  const common = { schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: 'f'.repeat(64) };
  await mockResources(page, {
    '/data/approved/products.json': {
      ...common,
      products: [{
        productId: 'REPLACEMENT', sku: 'REPLACEMENT', brand: '', model: 'REPL', quoteName: '대체 품목',
        quoteSpec: 'REPL-SPEC', unit: 'EA', options: { group: '합성 장비' }, currency: 'KRW', evidence: 'verified',
      }],
    },
    '/data/approved/prices.json': {
      ...common, currency: 'KRW', prices: { REPLACEMENT: { sellingUnitPrice: '30000', currency: 'KRW' } },
    },
  });
  await page.goto('/');
  await page.getByLabel('작업 파일 선택').setInputFiles({
    name: 'saved.avcpq.json', mimeType: 'application/json', buffer: Buffer.from(savedText),
  });

  const conflict = page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' });
  await conflict.getByRole('button', { name: '현재 기준으로 다시 계산 — 미리보기' }).click();
  await conflict.getByRole('button', { name: '적용', exact: true }).click();

  const removedWarning = page.getByRole('alert').filter({ hasText: '지금 카탈로그에 없다' });
  await expect(removedWarning).toBeVisible();

  await page.getByLabel(`${rowId} 다시 연결할 품목 검색`).fill('대체 품목');
  await page.getByRole('button', { name: '연결' }).click();

  await expect(removedWarning).toHaveCount(0);
  const row = page.locator('.q-quote-table tbody tr', { hasText: '대체 품목' });
  await expect(row.locator('td').nth(6)).toHaveText('30000');
});

test('재계산은 배관 행도 그룹 재검증을 거쳐 지금 단가로 갱신한다(독립 검토 지적)', async ({ page }) => {
  const conduitProducts = () => [
    { productId: 'DEV', sku: 'DEV', brand: '', model: 'DEV', quoteName: '합성 장비', quoteSpec: 'DEV',
      unit: 'EA', options: { group: '합성 장비' }, currency: 'KRW', evidence: 'verified' },
    { productId: 'FLEX-16', sku: 'FLEX-16', brand: '', model: '16mm', quoteName: '후렉시블 16mm', quoteSpec: '16mm',
      unit: '10M', options: { group: '후렉시블' }, currency: 'KRW', evidence: 'verified' },
  ];
  const sha1 = 'd'.repeat(64);
  await mockResources(page, {
    '/data/approved/products.json': { schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: sha1, products: conduitProducts() },
    '/data/approved/prices.json': {
      schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: sha1, currency: 'KRW',
      prices: { DEV: { sellingUnitPrice: '100000', currency: 'KRW' }, 'FLEX-16': { sellingUnitPrice: '31000', currency: 'KRW' } },
    },
  });
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('합성 장비');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();

  await page.getByLabel('시스템1 장비실→가장 먼 장비 거리(m)').fill('10');
  await page.getByLabel('시스템1 장비실→가장 먼 장비 거리(m)').blur();
  const warnings = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' });
  await warnings.getByRole('button', { name: '선택' }).first().click();
  await expect(page.locator('.q-quote-table tbody tr', { hasText: '후렉시블' }).locator('td').nth(6)).toHaveText('93000');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '작업 파일로 저장' }).click(),
  ]);
  const savedText = readFileSync((await download.path())!, 'utf8');

  const sha2 = 'e'.repeat(64);
  await mockResources(page, {
    '/data/approved/products.json': { schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: sha2, products: conduitProducts() },
    '/data/approved/prices.json': {
      schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: sha2, currency: 'KRW',
      prices: { DEV: { sellingUnitPrice: '100000', currency: 'KRW' }, 'FLEX-16': { sellingUnitPrice: '50000', currency: 'KRW' } },
    },
  });
  await page.goto('/');
  await page.getByLabel('작업 파일 선택').setInputFiles({
    name: 'saved.avcpq.json', mimeType: 'application/json', buffer: Buffer.from(savedText),
  });
  const conflict = page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' });
  await conflict.getByRole('button', { name: '현재 기준으로 다시 계산 — 미리보기' }).click();
  await conflict.getByRole('button', { name: '적용', exact: true }).click();

  await expect(page.locator('.q-quote-table tbody tr', { hasText: '후렉시블' }).locator('td').nth(6)).toHaveText('150000');
});

test('케이블 가격만 바뀌고 수동 수정이 없으면 재계산이 가짜 충돌을 내지 않는다(독립 검토 지적)', async ({ page }) => {
  const sha1 = 'c'.repeat(64);
  const product = () => [{
    productId: 'C3', sku: 'C3', brand: '', model: 'CABLE-3M', quoteName: '합성 HDMI', quoteSpec: '3M',
    unit: 'EA', options: { group: 'HDMI' }, currency: 'KRW', evidence: 'verified',
  }];
  await mockResources(page, {
    '/data/approved/products.json': { schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: sha1, products: product() },
    '/data/approved/prices.json': { schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: sha1, currency: 'KRW',
      prices: { C3: { sellingUnitPrice: '100', currency: 'KRW' } } },
  });
  await page.goto('/');
  await page.getByRole('button', { name: '구성도 JSON 열기' }).click();
  await page.locator('.q-card input[type="file"]').setInputFiles({
    name: 'routes.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: '1',
      nodes: [{ id: 'n1', data: { name: '시작', model: '' } }, { id: 'n2', data: { name: '끝', model: '' } }],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', data: { lineTypeId: 'hdmi',
        bomRows: [{ cableType: 'ready-made', productName: 'CABLE-3M', length: '3', quantity: '1' }] } }],
      lineTypes: [{ id: 'hdmi', name: 'HDMI' }],
    })),
  });

  // 수동 수정은 전혀 하지 않는다 — 수량·품목 전부 자동 산출 그대로 둔다.
  await expect(page.locator('.q-quote-table tbody tr', { hasText: '합성 HDMI' }).locator('td').nth(6)).toHaveText('100');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '작업 파일로 저장' }).click(),
  ]);
  const savedText = readFileSync((await download.path())!, 'utf8');

  const sha2 = 'f'.repeat(64);
  await mockResources(page, {
    '/data/approved/products.json': { schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: sha2, products: product() },
    '/data/approved/prices.json': { schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: sha2, currency: 'KRW',
      prices: { C3: { sellingUnitPrice: '200', currency: 'KRW' } } },
  });
  await page.goto('/');
  await page.getByLabel('작업 파일 선택').setInputFiles({
    name: 'saved.avcpq.json', mimeType: 'application/json', buffer: Buffer.from(savedText),
  });

  const conflict = page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' });
  await conflict.getByRole('button', { name: '현재 기준으로 다시 계산 — 미리보기' }).click();
  // 수동 수정이 없었으니 가격만 바뀌어도 충돌로 보면 안 된다.
  await expect(conflict.getByText('케이블 재산출이 수동 수정과 충돌해 적용할 수 없습니다')).toHaveCount(0);
  await expect(conflict.getByRole('button', { name: '적용', exact: true })).toBeEnabled();
  await conflict.getByRole('button', { name: '적용', exact: true }).click();

  await expect(page.locator('.q-quote-table tbody tr', { hasText: '합성 HDMI' }).locator('td').nth(6)).toHaveText('200');
});

test('재계산은 입력이 부족한 케이블 구간을 현재 규칙으로도 무조건 승인하지 않는다(독립 검토 지적)', async ({ page }) => {
  await mockResources(page);
  await page.goto('/');
  const diagram = {
    version: '1',
    nodes: [
      { id: 'n1', data: { model: '', name: '소스', systemName: '시스템1' } },
      { id: 'n2', data: { model: '', name: '싱크', systemName: '시스템1' } },
    ],
    // BOM이 아예 없다 — 경로/수량을 아무도 확인한 적이 없다.
    edges: [{ id: 'e1', source: 'n1', target: 'n2', data: { lineTypeId: 'video', bomRows: [] } }],
    lineTypes: [{ id: 'video', name: 'HDMI', color: '#ef4444' }],
  };
  await page.getByRole('button', { name: '구성도 JSON 열기' }).click();
  await page.locator('.q-card input[type="file"]').setInputFiles({
    name: 'diagram.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(diagram)),
  });
  const warningBefore = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' });
  await expect(warningBefore).toContainText('품목을 고른 뒤에도');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '작업 파일로 저장' }).click(),
  ]);
  const savedText = readFileSync((await download.path())!, 'utf8');
  const saved = JSON.parse(savedText) as { versions: { rule: string } };
  saved.versions.rule = 'old-rule-before-this-feature';

  await page.goto('/');
  await page.getByLabel('작업 파일 선택').setInputFiles({
    name: 'saved.avcpq.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)),
  });
  const conflict = page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' });
  await conflict.getByRole('button', { name: '현재 기준으로 다시 계산 — 미리보기' }).click();
  await conflict.getByRole('button', { name: '적용', exact: true }).click();

  // 입력 부족은 재계산으로도 안 풀린다 — 여전히 확인이 필요하다.
  const warningAfter = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' });
  await expect(warningAfter).toContainText('품목을 고른 뒤에도');
});

test('재계산 중 케이블 재산출이 수동 수정과 충돌하면 적용 전체를 막는다(독립 검토 지적)', async ({ page }) => {
  const cableProducts = () => [3, 5].map((m) => ({
    productId: `C${m}`, sku: `C${m}`, brand: '', model: `CABLE-${m}M`, quoteName: '합성 HDMI',
    quoteSpec: `${m}M`, unit: 'EA', options: { group: 'HDMI' }, currency: 'KRW', evidence: 'verified',
  }));
  const cablePrices = () => ({ C3: { sellingUnitPrice: '100', currency: 'KRW' }, C5: { sellingUnitPrice: '200', currency: 'KRW' } });
  const sha1 = 'a'.repeat(64);
  await mockResources(page, {
    '/data/approved/products.json': { schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: sha1, products: cableProducts() },
    '/data/approved/prices.json': { schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: sha1, currency: 'KRW', prices: cablePrices() },
  });
  await page.goto('/');
  await page.getByRole('button', { name: '구성도 JSON 열기' }).click();
  await page.locator('.q-card input[type="file"]').setInputFiles({
    name: 'routes.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: '1',
      nodes: [{ id: 'n1', data: { name: '시작', model: '' } }, { id: 'n2', data: { name: '끝', model: '' } }],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', data: { lineTypeId: 'hdmi',
        bomRows: [{ cableType: 'ready-made', productName: 'CABLE-3M', length: '3', quantity: '1' }] } }],
      lineTypes: [{ id: 'hdmi', name: 'HDMI' }],
    })),
  });

  // 구간 거리를 5m로 확정해 적용한다 — cableRoutes/cableBaseline이
  // 5M 기준으로 갱신된다(기존 cable-routes.spec.ts와 같은 절차).
  await page.getByLabel('e1 거리 기준', { exact: true }).selectOption('confirmed-total');
  await page.getByLabel('e1 확인된 총길이(m)', { exact: true }).fill('5');
  await page.getByRole('button', { name: '케이블 재산출 미리보기', exact: true }).click();
  await page.getByRole('button', { name: '재산출 적용', exact: true }).click();

  // 적용된 뒤(기준이 5M로 안정된 뒤) 수량만 수동으로 고친다 — 재산출이
  // 그 자동 산출값(1)과 다른 이 값(7)과 충돌하게 만든다.
  await page.getByLabel('합성 HDMI 수량', { exact: true }).fill('7');
  await page.getByLabel('합성 HDMI 수량', { exact: true }).blur();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '작업 파일로 저장' }).click(),
  ]);
  const savedText = readFileSync((await download.path())!, 'utf8');

  // 재열기용 카탈로그에서는 5M 제품을 뺀다 — 저장된 경로(확인된
  // 총길이 5m)로 다시 산출하면 더는 그 제품을 찾지 못해 내용이
  // 달라진다. 그 상태에서 수동으로 고친 수량(7)과 충돌해야 한다.
  const sha2 = 'b'.repeat(64);
  await mockResources(page, {
    '/data/approved/products.json': { schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: sha2, products: [cableProducts()[0]!] },
    '/data/approved/prices.json': { schemaVersion: 1, generatedOn: '2026-01-01', sourceSha256: sha2, currency: 'KRW', prices: { C3: cablePrices().C3 } },
  });
  await page.goto('/');
  await page.getByLabel('작업 파일 선택').setInputFiles({
    name: 'saved.avcpq.json', mimeType: 'application/json', buffer: Buffer.from(savedText),
  });

  const conflict = page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' });
  await conflict.getByRole('button', { name: '현재 기준으로 다시 계산 — 미리보기' }).click();
  await expect(conflict.getByText('케이블 재산출이 수동 수정과 충돌해 적용할 수 없습니다')).toBeVisible();
  await expect(conflict.getByRole('button', { name: '적용', exact: true })).toBeDisabled();

  // 'editing' 상태로 가지 않고도(케이블 패널에 못 들어가도) 이 화면
  // 안에서 충돌을 풀 수 있어야 한다(독립 검토 지적).
  await conflict.getByRole('checkbox', { name: '이 항목의 수동 수정을 버리고 자동 산출값을 사용합니다' }).check();
  await conflict.getByRole('button', { name: '선택한 항목으로 다시 미리보기' }).click();
  await expect(conflict.getByText('케이블 재산출이 수동 수정과 충돌해 적용할 수 없습니다')).toHaveCount(0);
  await expect(conflict.getByRole('button', { name: '적용', exact: true })).toBeEnabled();
});

test('저장 당시 미해결이던 장비 경고도 재열기 후 해소 UI가 그대로 복원된다(독립 검토 지적)', async ({ page }) => {
  await mockResources(page);
  await page.goto('/');
  const diagram = {
    version: '1',
    nodes: [{ id: 'unknown-1', data: { model: 'NOPE-MODEL-XYZ', name: '알 수 없는 장비', systemName: '시스템1' } }],
    edges: [],
    lineTypes: [],
  };
  await page.getByRole('button', { name: '구성도 JSON 열기' }).click();
  await page.locator('.q-card input[type="file"]').setInputFiles({
    name: 'diagram.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(diagram)),
  });

  const warningPanel = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' });
  await expect(warningPanel).toContainText('NOPE-MODEL-XYZ');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '작업 파일로 저장' }).click(),
  ]);
  const savedText = readFileSync((await download.path())!, 'utf8');

  await page.goto('/');
  await page.getByLabel('작업 파일 선택').setInputFiles({
    name: 'saved.avcpq.json', mimeType: 'application/json', buffer: Buffer.from(savedText),
  });

  const reopenedWarningPanel = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' });
  await expect(reopenedWarningPanel).toContainText('NOPE-MODEL-XYZ');

  await page.getByLabel('unknown-1 연결할 품목 검색').fill('합성 테스트 품목');
  await page.getByRole('button', { name: '연결' }).click();

  await expect(reopenedWarningPanel).toHaveCount(0);
  await expect(page.locator('.q-quote-table tbody tr', { hasText: '합성 테스트 품목' })).toBeVisible();
});
