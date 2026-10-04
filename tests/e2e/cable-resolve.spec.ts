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

test('같은 연결선의 다른 BOM 케이블은 미해결 품목 선택으로 덮어쓰지 않는다', async ({ page }) => {
  await setupCatalog(page);
  await page.goto('/');
  const diagram = JSON.parse(diagramWithUnresolvedHdmiCable());
  diagram.edges[0].data.bomRows.push({
    cableType: 'ready-made', productName: 'AOC-10M', length: '10', quantity: '1',
  });
  await page.getByRole('button', { name: '구성도 JSON 열기' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'two-cables.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(diagram)),
  });
  const optical = page.locator('.q-quote-table tbody tr', { hasText: 'HDMI Optical Cable' });
  await expect(optical).toContainText('120000');
  const warning = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' })
    .locator('li', { hasText: 'HDMI 케이블(미지정)' }).first();
  await warning.getByRole('listitem').filter({ hasText: '3M' }).getByRole('button', { name: '선택' }).click();
  await expect(optical).toHaveCount(1);
  await expect(optical).toContainText('120000');
  const copper = page.locator('.q-quote-table tbody tr', { hasText: 'HDMI Cable' });
  await expect(copper).toHaveCount(1);
  await expect(copper).toContainText('25000');
  await page.getByRole('button', { name: '실행 취소' }).click();
  await expect(optical).toContainText('120000');
  await expect(warning).toBeVisible();
});

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

/**
 * 구성도 노드 2쌍(연결선 2개)이 **같은 품명·같은 길이 계단**이면
 * `cables.ts`가 한 행으로 합친다(`ready:productName:step` 키) — 커넥터·
 * 배관과 같은 "병합 = 같은 것이라 하나로 본다" 설계다. 그래서 둘 중
 * 하나의 경고만 해소해도 **합쳐진 행 전체**가 바뀌고, 그 행에 연결된
 * 나머지 구간(edge)의 경고도 같이 사라진다 — 부분 해결이 아니다.
 * 사용자가 "꼭 검증하라"고 지적한 지점이라 별도 시험으로 못박는다.
 */
test('병합된 케이블 행 — 한 구간만 해소해도 합쳐진 다른 구간의 경고까지 같이 사라진다(의도된 동작)', async ({
  page,
}) => {
  await setupCatalog(page);
  await page.goto('/');

  const diagram = JSON.stringify({
    version: '1',
    nodes: [
      { id: 'n1', data: { model: '', name: '소스1', systemName: '시스템1' } },
      { id: 'n2', data: { model: '', name: '싱크1', systemName: '시스템1' } },
      { id: 'n3', data: { model: '', name: '소스2', systemName: '시스템1' } },
      { id: 'n4', data: { model: '', name: '싱크2', systemName: '시스템1' } },
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
      {
        id: 'e2',
        source: 'n3',
        target: 'n4',
        data: {
          lineTypeId: 'video',
          // e1과 품명·길이 계단(둘 다 2m)이 같다 — 같은 행으로 합쳐진다.
          bomRows: [{ cableType: 'ready-made', productName: 'HDMI 케이블(미지정)', length: '2', quantity: '1' }],
        },
      },
    ],
    lineTypes: [{ id: 'video', name: 'HDMI', color: '#ef4444' }],
  });

  await page.getByRole('button', { name: '구성도 JSON 열기' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'diagram.json',
    mimeType: 'application/json',
    buffer: Buffer.from(diagram),
  });

  const warnings = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' });
  // e1·e2 둘 다 미해결 경고를 낸다 — 두 구간이 각자 독립적으로 보고된다.
  await expect(warnings.locator('li', { hasText: 'HDMI 케이블(미지정)' })).toHaveCount(2);
  // 합쳐진 한 행만 있다 — 수량 2(두 구간)
  const row = page.locator('.q-quote-table tbody tr', { hasText: 'HDMI 케이블(미지정)' });
  await expect(row).toHaveCount(1);
  await expect(row.getByLabel(/수량/)).toHaveValue('2');

  // e1·e2 중 하나(먼저 뜬 경고)만 골라 해소한다.
  const firstWarning = warnings.locator('li', { hasText: 'HDMI 케이블(미지정)' }).first();
  await firstWarning.getByRole('listitem').filter({ hasText: '3M' }).getByRole('button', { name: '선택' }).click();

  // 합쳐진 행이므로 e1·e2 둘 다의 경고가 같이 사라진다 — 부분 해결이 아니다.
  await expect(warnings.locator('li', { hasText: 'HDMI 케이블(미지정)' })).toHaveCount(0);
  const resolvedRow = page.locator('.q-quote-table tbody tr', { hasText: 'HDMI Cable' });
  await expect(resolvedRow).toHaveCount(1);
  await expect(resolvedRow.getByLabel(/수량/)).toHaveValue('2'); // 합친 수량은 그대로 2다

  // 실행취소 — 둘 다 다시 미해결로 돌아간다.
  await page.getByRole('button', { name: '실행 취소' }).click();
  await expect(warnings.locator('li', { hasText: 'HDMI 케이블(미지정)' })).toHaveCount(2);
});

/**
 * 연결선에 BOM 자체가 없으면(`bomRows: []`) 몇 개가 필요한지 **아무도
 * 모른다** — `toRow`가 수량 '1'을 자리표시자로 채우고
 * `quantityUnresolved: true`를 남긴다. 품목(SKU)만 고르고 실제 수량은
 * 확인하지 않은 채 경고가 사라지면, 자리표시자 '1'이 조용히 "확정
 * 수량"으로 둔갑한다 — 독립 검토가 짚은 지점이라 실제 화면으로
 * 못박는다.
 */
test('BOM 없는 구간 — 품목만 골라서는 해소되지 않는다. 수량을 직접 확인해야 한다', async ({ page }) => {
  await setupCatalog(page);
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
  await page.locator('input[type="file"]').setInputFiles({
    name: 'no-bom.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(diagram)),
  });

  // 노드(n1/n2)는 모델이 없어 별도의 미해결 장비 경고도 같이 뜬다 —
  // 이 시험은 케이블 경고 하나만 짚는다.
  const warnings = page.getByRole('alert').filter({ hasText: '확인이 필요합니다' });
  const cableWarning = warnings.locator('li', { hasText: '품목을 고른 뒤에도' });
  await expect(cableWarning).toHaveCount(1);

  const groups = cableWarning.locator('.q-resolve-candidate-group');
  await groups.filter({ hasText: 'CS_HDMI 케이블' }).first().getByRole('listitem').filter({ hasText: '1M' })
    .getByRole('button', { name: '선택' }).click();

  // 품목은 들어왔지만(이름·가격이 보인다) 경고는 그대로 남는다 —
  // 수량을 아직 아무도 확인하지 않았기 때문이다(경고 문구는
  // computeActiveWarnings가 걸러줄 뿐 바꾸지 않으므로 그대로다).
  const row = page.locator('.q-quote-table tbody tr', { hasText: 'HDMI Cable' });
  await expect(row).toContainText('15000');
  await expect(cableWarning).toHaveCount(1);

  // 사람이 실제 수량을 입력하면 비로소 해소된다.
  await row.getByLabel(/수량/).fill('4');
  await row.getByLabel(/수량/).blur();
  await expect(cableWarning).toHaveCount(0);

  // 실행취소 — 수량 확정이 먼저 되돌아간다(경고가 다시 뜬다).
  await page.getByRole('button', { name: '실행 취소' }).click();
  await expect(cableWarning).toHaveCount(1);
  await expect(row.getByLabel(/수량/)).toHaveValue('1');
});
