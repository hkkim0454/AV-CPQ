/**
 * 합성 승인 데이터 fixture (계획 2026-10-04-quote-workspace-ui Task 1).
 *
 * 실제 저장소의 승인 카탈로그를 쓰지 않는다 — 이 파일이 만드는 값은
 * 전부 가짜(SKU "FIX-0001" 등)다. 가이드 템플릿(xlsx)만 예외로 저장소의
 * `templates/sanitized/`를 그대로 쓴다 — 이미 실제 회사 자료를 지운
 * 정제본이고(§8.4), 구조가 복잡한 xlsx를 테스트마다 다시 합성하는 것은
 * 이 테스트가 보려는 것(화면의 로딩/실패 처리)과 무관한 비용이다.
 *
 * `page.route()`로 네트워크 요청 자체를 가로챈다 — `public/`이나
 * `dist/`에 이 합성 자료를 실제로 쓰지 않는다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const SKU = 'FIX-0001';
const SHA_CATALOG = 'a'.repeat(64);
const SHA_LABOR = 'b'.repeat(64);

function syntheticProducts(): unknown {
  return {
    schemaVersion: 1,
    generatedOn: '2026-01-01',
    sourceSha256: SHA_CATALOG,
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
      },
    ],
  };
}

function syntheticPrices(): unknown {
  return {
    schemaVersion: 1,
    generatedOn: '2026-01-01',
    sourceSha256: SHA_CATALOG,
    currency: 'KRW',
    prices: { [SKU]: { sellingUnitPrice: '10000', currency: 'KRW' } },
  };
}

function syntheticLaborItems(): unknown {
  return {
    schemaVersion: 1,
    generatedOn: '2026-01-01',
    sourceSha256: SHA_LABOR,
    laborItems: [
      {
        laborItemId: 'LI-1',
        code: 'C1',
        description: '합성 품셈 항목',
        baseUnit: 'EA',
        source: 'fixture',
        revision: '1',
        wageUnit: 'M/D',
        trades: [{ trade: '통신내선공', quantity: '1' }],
      },
    ],
  };
}

function syntheticWageTable(): unknown {
  return {
    schemaVersion: 1,
    generatedOn: '2026-01-01',
    sourceSha256: SHA_LABOR,
    wageTable: {
      wageTableId: 'W-1',
      periodLabel: 'fixture',
      source: 'fixture',
      wages: { 통신내선공: { amount: '150000', unit: 'M/D' } },
    },
  };
}

function syntheticLaborMappings(): unknown {
  return {
    schemaVersion: 1,
    generatedOn: '2026-01-01',
    sourceSha256: SHA_LABOR,
    mappings: [],
    unmappedSkus: [],
  };
}

const GUIDE_FILES = ['guide-won.xlsx', 'guide-pumsem.xlsx', 'guide-ds.xlsx', 'guide-ds-won.xlsx'] as const;

/** `missing` = 404. `Buffer`/객체가 아니면 기본 fixture를 쓴다. */
export type MockOverride = 'missing' | Buffer | unknown;

/**
 * 초기 자료 요청을 전부 가로채 합성 fixture로 답한다. `overrides`로 특정
 * 경로만 깨뜨리거나(필수 파일 실패), 빼거나(판매가 없음), 손상시킨다
 * (손상 가이드 실패).
 */
export async function mockResources(
  page: Page,
  overrides: Record<string, MockOverride> = {},
): Promise<void> {
  const guideManifestRaw = readFileSync(resolve(ROOT, 'templates/sanitized/guide-manifest.json'), 'utf8');

  const defaults: Record<string, MockOverride> = {
    '/data/approved/products.json': syntheticProducts(),
    '/data/approved/prices.json': syntheticPrices(),
    '/data/approved/labor-items.json': syntheticLaborItems(),
    '/data/approved/wage-table.json': syntheticWageTable(),
    '/data/approved/labor-mappings.json': syntheticLaborMappings(),
    '/templates/sanitized/guide-manifest.json': JSON.parse(guideManifestRaw),
  };
  for (const name of GUIDE_FILES) {
    defaults[`/templates/sanitized/${name}`] = readFileSync(resolve(ROOT, 'templates/sanitized', name));
  }

  const merged = { ...defaults, ...overrides };

  for (const [path, value] of Object.entries(merged)) {
    await page.route(`**${path}`, async (route) => {
      if (value === 'missing') {
        await route.fulfill({ status: 404, body: '' });
        return;
      }
      if (Buffer.isBuffer(value)) {
        await route.fulfill({ status: 200, body: value, contentType: 'application/octet-stream' });
        return;
      }
      await route.fulfill({
        status: 200,
        body: JSON.stringify(value),
        contentType: 'application/json; charset=utf-8',
      });
    });
  }
}

/**
 * 설정 영역(갑지·케이블·설치·간접비·원가)을 전부 펼친다.
 *
 * 2차 개선에서 견적표를 먼저 보여주려고 이 영역들을 **접은 채로** 시작한다
 * (`WorkspaceSection`). 그 입력을 쓰는 기존 시험은 먼저 펼쳐야 한다.
 *
 * ⛔ 접기는 **화면 상태일 뿐**이라 이 조작으로 문서·합계·미저장 여부가
 * 바뀌지 않는다. 단언을 약하게 만들지 않고, 사람이 하는 조작을 그대로 한다.
 */
export async function expandWorkspaceSections(page: Page): Promise<void> {
  // 작업 파일·구성도 읽기는 비동기다. 아직 편집 화면이 그려지기 전이면
  // 접기 단추가 하나도 없어 **아무것도 펼치지 않고 지나간다** — 먼저 기다린다.
  // 편집 화면이 아닌 경우(기준 충돌 등)도 있으므로 실패는 삼킨다.
  await page
    .locator('.q-quote-sheet')
    .first()
    .waitFor({ state: 'attached', timeout: 5000 })
    .catch(() => undefined);
  const collapsed = page.locator('.q-section-toggle[aria-expanded="false"]');
  // 펼칠 때마다 수가 줄므로 매번 다시 센다.
  for (let guard = 0; guard < 20; guard += 1) {
    if ((await collapsed.count()) === 0) return;
    await collapsed.first().click();
  }
}

/**
 * 견적표의 상세 열(설명·비고·거래처·영업비고)을 보이게 한다.
 *
 * 2차 개선에서 표를 좁히려고 이 네 열을 **CSS 로 감춘 채** 시작한다. 입력은
 * 그대로 살아 있지만 보이지 않으므로, 그 칸을 쓰는 시험은 먼저 펼친다.
 */
export async function showDetailColumns(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: '상세 열 표시' });
  if (await toggle.isVisible().catch(() => false)) await toggle.click();
}
