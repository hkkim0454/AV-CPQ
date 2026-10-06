import { test, expect } from '@playwright/test';
import { mockResources } from './fixtures';

const SHA = 'f'.repeat(64);

/**
 * 모델명 기준 대조 4단계를 **실제 화면에서** 확인한다 (계획 2026-10-06).
 *
 * 사용자가 로컬 화면에서 `BRC-H800`을 못 불러오는 것을 확인한 것이 이 작업의
 * 발단이다(D30). 단위 시험은 도메인 함수까지만 증명하므로, 후보가 실제로
 * 화면에 뜨고 근거가 보이며 눌러서 연결까지 되는지는 여기서만 증명된다.
 *
 * 카탈로그 값은 **실물 그대로**다 — `VID-0006`의 규격은 `12배줌, BRC-H800`,
 * `HEC-0031`의 설명은 `WJD-2DV`다.
 */
function products(): unknown {
  return {
    schemaVersion: 1,
    generatedOn: '2026-01-01',
    sourceSha256: SHA,
    products: [
      {
        productId: 'VID-0006',
        sku: 'VID-0006',
        brand: '',
        model: '12배줌, BRC-H800',
        quoteName: '1" Exmor R PTZ Camera',
        quoteSpec: '12배줌, BRC-H800',
        unit: 'EA',
        options: { group: 'SONY/AVICS', description: '14.2메가픽셀, Genlock지원' },
        currency: 'KRW',
        evidence: 'review-required',
      },
      {
        // 설명 칸에만 모델명이 있다 — 이 제품은 *분배기 본체*이고 `WJD-2DV`는
        // 거기에 쓰는 다른 제품의 모델명이다. 화면이 그 사실을 알려야 한다.
        productId: 'HEC-0031',
        sku: 'HEC-0031',
        brand: '',
        model: '2분배기',
        quoteName: 'CATV 분배기',
        quoteSpec: '2분배기',
        unit: 'EA',
        options: { group: '분배기', description: 'WJD-2DV' },
        currency: 'KRW',
        evidence: 'review-required',
      },
    ],
  };
}

function prices(): unknown {
  return {
    schemaVersion: 1,
    generatedOn: '2026-01-01',
    sourceSha256: SHA,
    currency: 'KRW',
    prices: {
      'VID-0006': { sellingUnitPrice: '7000000', currency: 'KRW' },
      'HEC-0031': { sellingUnitPrice: '35000', currency: 'KRW' },
    },
  };
}

/** 사용자가 적은 그대로의 모델명이다. 카탈로그에는 앞에 `12배줌, `이 붙어 있다. */
function diagramJson(model: string): string {
  return JSON.stringify({
    version: '1',
    nodes: [{ id: 'n1', data: { model, name: '카메라', systemName: '회의실' } }],
    edges: [],
    lineTypes: [{ id: 'video', name: 'HDMI', color: '#ef4444' }],
  });
}

async function openDiagram(page: Parameters<typeof mockResources>[0], model: string): Promise<void> {
  await mockResources(page, {
    '/data/approved/products.json': products(),
    '/data/approved/prices.json': prices(),
  });
  await page.goto('/');
  await page.getByRole('button', { name: '구성도 JSON 열기' }).click();
  await page.getByLabel('구성도 파일 선택').setInputFiles({
    name: 'diagram.json',
    mimeType: 'application/json',
    buffer: Buffer.from(diagramJson(model)),
  });
}

test('BRC-H800 — 후보가 근거와 함께 화면에 뜨고, 눌러서 연결된다', async ({ page }) => {
  await openDiagram(page, 'BRC-H800');

  const warnings = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' });
  const item = warnings.locator('li', { hasText: 'BRC-H800' }).first();

  // 1) 후보를 올린다는 사실을 글로 알린다 — "카탈로그에 없다"로 끝나지 않는다.
  await expect(item).toContainText('후보로 올린다');
  await expect(item).toContainText('사람이 확인해야 한다');

  // 2) 어느 칸에서 어떤 글자가 맞았는지 보인다 (계획 §6).
  await expect(item).toContainText('모델 칸에서');
  await expect(item).toContainText('규격 칸에서');
  await expect(item).toContainText('BRC-H800');

  // 3) 아직 연결되지 않았다 — 견적 행에 카탈로그 품명도 단가도 없다.
  const rows = page.locator('.q-quote-table tbody tr');
  await expect(rows.filter({ hasText: '1" Exmor R PTZ Camera' })).toHaveCount(0);

  // 4) 사람이 고르면 그때 붙는다.
  await item.getByRole('button', { name: '선택' }).first().click();
  const linked = page.locator('.q-quote-table tbody tr', { hasText: '1" Exmor R PTZ Camera' });
  await expect(linked).toHaveCount(1);
  await expect(linked).toContainText('7000000');
  // 해소되면 알림 영역 자체가 사라진다. 없는 대상에는 not.toContainText 를 쓸 수 없다.
  await expect(warnings.locator('li', { hasText: '후보로 올린다' })).toHaveCount(0);
});

test('WJD-2DV — 설명 칸에서만 맞은 후보는 경고를 달고 뜬다 (부속품이 본체로 붙는 것을 막는다)', async ({ page }) => {
  await openDiagram(page, 'WJD-2DV');

  const warnings = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' });
  const item = warnings.locator('li', { hasText: 'WJD-2DV' }).first();

  await expect(item).toContainText('설명 칸에서');
  await expect(item).toContainText('설명 칸에서만 맞았습니다');
  await expect(item).toContainText('다른 제품일 수 있습니다');
});

test('정확히 일치하면 지금처럼 바로 붙는다 — 4단계가 기존 연결을 가로채지 않는다', async ({ page }) => {
  await openDiagram(page, '12배줌, BRC-H800');

  const linked = page.locator('.q-quote-table tbody tr', { hasText: '1" Exmor R PTZ Camera' });
  await expect(linked).toHaveCount(1);
  await expect(linked).toContainText('7000000');

  const warnings = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' });
  await expect(warnings.locator('li', { hasText: '후보로 올린다' })).toHaveCount(0);
});
