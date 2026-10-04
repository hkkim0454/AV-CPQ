import { test, expect } from '@playwright/test';
import { mockResources } from './fixtures';

const SHA = 'e'.repeat(64);

/**
 * HDMI 케이블을 제조사별 종류(품셈 묶음)·길이로 직접 고르는 화면
 * (사용자 요청 — "제조사별 종류, 길이를 내가 직접 선택할 수 있도록
 * 아래로 목록이 펼쳐지게"). 두 '종류'(일반 구리선/광케이블)를 넣어
 * `cableCandidates`가 선 종류 이름(여기서는 `HDMI`)으로 묶음을 올바로
 * 묶어 보여주는지까지 실제 화면에서 확인한다.
 */
function customProducts(): unknown {
  return {
    schemaVersion: 1,
    generatedOn: '2026-01-01',
    sourceSha256: SHA,
    products: [
      {
        productId: 'HDMI-CU-1',
        sku: 'HDMI-CU-1',
        brand: '',
        model: 'CU-1M',
        quoteName: 'HDMI Cable',
        quoteSpec: '1M',
        unit: 'EA',
        options: { group: 'CS_HDMI 케이블' },
        currency: 'KRW',
        evidence: 'review-required',
      },
      {
        productId: 'HDMI-CU-3',
        sku: 'HDMI-CU-3',
        brand: '',
        model: 'CU-3M',
        quoteName: 'HDMI Cable',
        quoteSpec: '3M',
        unit: 'EA',
        options: { group: 'CS_HDMI 케이블' },
        currency: 'KRW',
        evidence: 'review-required',
      },
      {
        productId: 'HDMI-AOC-10',
        sku: 'HDMI-AOC-10',
        brand: '',
        model: 'AOC-10M',
        quoteName: 'HDMI Optical Cable',
        quoteSpec: '10M',
        unit: 'EA',
        options: { group: 'CS_HDMI 케이블_AOC' },
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
      'HDMI-CU-1': { sellingUnitPrice: '15000', currency: 'KRW' },
      'HDMI-CU-3': { sellingUnitPrice: '25000', currency: 'KRW' },
      'HDMI-AOC-10': { sellingUnitPrice: '120000', currency: 'KRW' },
    },
  };
}

function diagramWithUnresolvedHdmiCable(): string {
  return JSON.stringify({
    version: '1',
    nodes: [
      { id: 'n1', data: { model: '', name: '소스', systemName: '시스템1' } },
      { id: 'n2', data: { model: '', name: '싱크', systemName: '시스템1' } },
    ],
    edges: [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        data: {
          lineTypeId: 'video',
          bomRows: [{ cableType: 'ready-made', productName: 'HDMI 케이블(미지정)', length: '2', quantity: '1' }],
        },
      },
    ],
    lineTypes: [{ id: 'video', name: 'HDMI', color: '#ef4444' }],
  });
}

async function setupCatalog(page: Parameters<typeof mockResources>[0]): Promise<void> {
  await mockResources(page, {
    '/data/approved/products.json': customProducts(),
    '/data/approved/prices.json': customPrices(),
  });
}

test('HDMI 케이블 — 제조사별 종류(묶음)로 나뉜 목록에서 길이를 직접 골라 해소한다', async ({ page }) => {
  await setupCatalog(page);
  await page.goto('/');

  await page.getByRole('button', { name: '구성도 JSON 열기' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'diagram.json',
    mimeType: 'application/json',
    buffer: Buffer.from(diagramWithUnresolvedHdmiCable()),
  });

  const warnings = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' });
  await expect(warnings).toContainText('HDMI 케이블(미지정)');

  // 제조사별 종류(묶음) 두 개가 각각 머리글로 "펼쳐져" 보인다.
  const groups = warnings.locator('.q-resolve-candidate-group');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0).locator('h4')).toHaveText('CS_HDMI 케이블');
  await expect(groups.nth(1).locator('h4')).toHaveText('CS_HDMI 케이블_AOC');

  // 길이까지 보이고, 원하는 길이를 직접 고를 수 있다.
  const cuGroup = groups.filter({ hasText: 'CS_HDMI 케이블' }).first();
  await expect(cuGroup).toContainText('1M');
  await expect(cuGroup).toContainText('3M');
  await cuGroup.getByRole('listitem').filter({ hasText: '3M' }).getByRole('button', { name: '선택' }).click();

  // 케이블 경고(와 그 후보 목록)만 사라진다 — 노드(n1/n2)는 모델이
  // 없어 별도의 미해결 장비 경고가 남는데, 그건 이 기능이 다루는
  // 대상이 아니므로 그대로 둔다.
  await expect(warnings).not.toContainText('HDMI 케이블(미지정)');
  await expect(warnings.locator('.q-resolve-candidate-group')).toHaveCount(0);
  const row = page.locator('.q-quote-table tbody tr', { hasText: 'HDMI Cable' });
  await expect(row).toContainText('3M');
  await expect(row).toContainText('25000');

  // 실행취소하면 경고도, 선택도 되돌아간다.
  await page.getByRole('button', { name: '실행 취소' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '확인이 필요합니다' })).toContainText(
    'HDMI 케이블(미지정)',
  );
});
