/**
 * Task6 노무 확인 보완 Task D — 합성 양수 품셈으로 **화면 조작만으로**
 * 노무 확인 → 0/1/2 세 등급 실제 다운로드까지 간다.
 *
 * `download.spec.ts`의 기존 양성 시나리오는 `laborMode:'manual'` +
 * 수동 0원 + JSON 직접 수정으로 품셈 미확인 차단을 **우회**한다(그
 * 파일 자신의 주석이 이유를 적어 뒀다). 이 파일은 그 대신 실제
 * `laborMode:'mapped'` 행을 만들고, 그 행의 품셈 연결 미확인
 * (`mapping-unconfirmed`) 차단을 화면의 "확인함" 버튼으로 직접 풀어
 * 낸다. JSON을 손으로 고치지 않는다.
 *
 * 실제 노임은 `/data/approved/wage-table.json`이 아니라 **가이드
 * 템플릿(`guide-pumsem.xlsx`, 공개된 노임 공표 수치)에서 온다**
 * (`workspace.ts`의 `WAGE_GUIDE_ID` — 배포본 노임표를 화면 계산에 직접
 * 쓰지 않는다는 결정). 그래서 이 테스트는 구체적인 노임 숫자를
 * 가정하지 않는다 — 품셈 항목·매핑 연결만 합성해 끼운다.
 */
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { test, expect, type Page, type Download } from '@playwright/test';
import { mockResources } from './fixtures';

const SKU = 'FIX-0001';

/**
 * 품목에 품셈 연결(`laborMappingId`)을 더해 `laborMode:'mapped'`가
 * 되게 한다 — 기본 fixture는 연결이 없어 `unresolved`다.
 */
function productsWithLaborMapping(): unknown {
  return {
    schemaVersion: 1,
    generatedOn: '2026-01-01',
    sourceSha256: 'a'.repeat(64),
    products: [
      {
        productId: SKU,
        sku: SKU,
        brand: '',
        model: 'FIX',
        quoteName: '합성 테스트 품목',
        quoteSpec: 'FIX-SPEC',
        unit: 'EA',
        options: { group: '합성 장비' },
        currency: 'KRW',
        evidence: 'verified',
        laborMappingId: 'LM-1',
      },
    ],
  };
}

/** 전역 `confirmed`는 그대로 `false`다 — 정책을 풀지 않는다. */
function laborMappingsWithOne(): unknown {
  return {
    schemaVersion: 1,
    generatedOn: '2026-01-01',
    sourceSha256: 'b'.repeat(64),
    mappings: [
      {
        laborMappingId: 'LM-1',
        sku: SKU,
        laborItemId: 'LI-1',
        conversionFactor: '1',
        surcharge: '0',
        itemRate: '1',
        confirmed: false,
        note: '합성 테스트 — 자동 매칭, 미확인',
      },
    ],
    unmappedSkus: [],
  };
}

async function downloadedBytes(download: Download): Promise<Uint8Array> {
  const path = await download.path();
  return new Uint8Array(readFileSync(path!));
}

async function buildMappedQuote(page: Page): Promise<void> {
  await mockResources(page, {
    '/data/approved/products.json': productsWithLaborMapping(),
    '/data/approved/labor-mappings.json': laborMappingsWithOne(),
  });
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('합성 테스트 품목');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();
}

test('mapped 행 하나만 있고 미확인이면 출력이 막힌다', async ({ page }) => {
  await buildMappedQuote(page);
  await expect(page.getByRole('button', { name: 'Excel 다운로드' })).toBeDisabled();
  await expect(page.getByText('해결되지 않은 구성도/품셈/계산 경고가 있어', { exact: false })).toBeVisible();
});

test('화면에서 근거를 펼쳐 확인하면 풀리고, 0/1/2 세 등급을 실제로 내려받는다', async ({ page }) => {
  await buildMappedQuote(page);

  await page.getByRole('button', { name: '합성 테스트 품목 노무 처리 펼치기' }).click();
  // 계산 근거(직종별 공수·노임 → 적용 노무 단가)가 화면에 그대로 보인다.
  await expect(page.getByText('통신내선공', { exact: false })).toBeVisible();
  await expect(page.getByText('적용 노무 단가', { exact: false })).toBeVisible();

  await expect(page.getByRole('button', { name: 'Excel 다운로드' })).toBeDisabled();
  await page.getByRole('button', { name: '확인함' }).click();
  await expect(page.getByText('에 확인했습니다', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Excel 다운로드' })).toBeEnabled();

  for (const grade of ['2 고객용', '1 공유용', '0 영업팀용']) {
    await page.getByRole('radio', { name: grade }).check();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Excel 다운로드' }).click();
    const download = await downloadEvent;
    const bytes = await downloadedBytes(download);
    const files = unzipSync(bytes);
    expect(files['[Content_Types].xml']).toBeDefined();
  }
});

test('확인 뒤 계산 근거(수량)가 바뀌면 다시 막힌다 — 화면 조작만으로', async ({ page }) => {
  await buildMappedQuote(page);
  await page.getByRole('button', { name: '합성 테스트 품목 노무 처리 펼치기' }).click();
  await page.getByRole('button', { name: '확인함' }).click();
  await expect(page.getByRole('button', { name: 'Excel 다운로드' })).toBeEnabled();

  // 지문에는 행 수량도 들어간다 — 수량을 바꾸면 지금 근거와 저장된
  // 지문이 달라져 확인이 무효가 된다(원인 스냅샷 없이 일반 문구).
  const quantityInput = page.getByLabel('합성 테스트 품목 수량');
  await quantityInput.fill('3');
  await quantityInput.blur();

  await expect(page.getByRole('button', { name: 'Excel 다운로드' })).toBeDisabled();
  await expect(page.getByText('이전 확인이 더는 유효하지 않습니다', { exact: false })).toBeVisible();

  // 바뀐 근거를 다시 확인하면 또 풀린다.
  await page.getByRole('button', { name: '확인함' }).click();
  await expect(page.getByRole('button', { name: 'Excel 다운로드' })).toBeEnabled();
});
