import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
import { mockResources } from './fixtures';

/**
 * Task5 "내 PC의 원가 파일과 모델 확인" — 집중 항목만 검증한다(독립
 * 검토 지적 2026-10-05): 원가 파일 교체/문서 교체 시 세션 폐기, 지연
 * 응답 무효화, 고객/작업 파일 격리, 통화/단위 확인 입력, 단위/통화
 * 불일치 차단, 제품 재검증, 실제 B~H 다단 헤더 XLSX(갑지 포함)의
 * 시트·헤더행·열매핑 확인(2026-10-05 추가).
 *
 * 숫자는 전부 합성이다. 실제 원가 파일은 사용자 PC에만 있다.
 */

const COST_CSV_HEADER = '품명,규격,매입단가,통화,단위';
const COST_PRICE_A = '1234567';
const COST_PRICE_B = '7654321';

test('독립 검토: 손상된 새 원가 파일을 골라도 이전 원가 연결은 즉시 폐기된다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);
  await selectCostFile(page, 'old.csv', Buffer.from('품명,규격,매입단가,통화,단위\n장비,FIX-SPEC,1234567,KRW,EA\n'));
  const panel = page.locator('.q-private-cost');
  await panel.getByRole('button', { name: '연결', exact: true }).click();
  await expect(panel.getByText(/원가 1234567/)).toBeVisible();
  await selectCostFile(page, 'invalid.csv', Buffer.from('wrong\ninvalid\n'));
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(panel.getByText(/원가 1234567/)).toHaveCount(0);
});

test('독립 검토: 견적 수량 편집은 같은 문서의 원가 연결을 지우지 않는다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);
  await selectCostFile(page, 'cost.csv', Buffer.from('품명,규격,매입단가,통화,단위\n장비,FIX-SPEC,1234567,KRW,EA\n'));
  const panel = page.locator('.q-private-cost');
  await panel.getByRole('button', { name: '연결', exact: true }).click();
  await expect(panel.getByText(/원가 1234567/)).toBeVisible();
  await page.getByLabel('합성 테스트 품목 수량', { exact: true }).fill('2');
  await page.getByLabel('합성 테스트 품목 수량', { exact: true }).blur();
  await expect(panel.getByText(/원가 1234567/)).toBeVisible();
});

function costCsv(price: string): Buffer {
  return Buffer.from(`${COST_CSV_HEADER}\nPTZ 카메라,FIX,${price},KRW,EA\n`, 'utf8');
}

function costCsvNoCurrencyUnit(price: string): Buffer {
  return Buffer.from(`품명,규격,매입단가\nPTZ 카메라,FIX,${price}\n`, 'utf8');
}

async function createDocument(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: '품목 직접 선택' }).click();
  await page.getByLabel('품목 검색').fill('합성 테스트 품목');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '견적 만들기' }).click();
  await expect(page.locator('.q-quote-table tbody tr', { hasText: '합성 테스트 품목' })).toBeVisible();
}

async function selectCostFile(page: import('@playwright/test').Page, name: string, bytes: Buffer): Promise<void> {
  await page.getByLabel('원가 파일 선택').setInputFiles({ name, mimeType: 'text/csv', buffer: bytes });
}

test('원가 파일을 고르면 인식된 줄 수가 보인다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);
  await selectCostFile(page, 'cost-a.csv', costCsv(COST_PRICE_A));
  await expect(page.getByRole('status').filter({ hasText: '1줄 인식됨' })).toBeVisible();
});

test('원가 파일 교체 — 두 번째 파일을 고르면 첫 파일의 인식 결과가 아니라 두 번째 것만 남는다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);
  await selectCostFile(page, 'cost-a.csv', costCsv(COST_PRICE_A));
  await expect(page.getByRole('status').filter({ hasText: 'cost-a.csv' })).toBeVisible();

  await selectCostFile(page, 'cost-b.csv', costCsv(COST_PRICE_B));
  await expect(page.getByRole('status').filter({ hasText: 'cost-b.csv' })).toBeVisible();
  await expect(page.getByText('cost-a.csv')).toHaveCount(0);
});

test('문서 교체 — 작업 파일을 다시 열면(같은 내용이라도 새 문서 객체) 원가 연결이 폐기된다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);
  await selectCostFile(page, 'cost-a.csv', costCsv(COST_PRICE_A));
  await expect(page.getByRole('status').filter({ hasText: '1줄 인식됨' })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '작업 파일로 저장' }).click(),
  ]);
  const savedText = readFileSync((await download.path())!, 'utf8');

  // 같은 내용을 다시 열어도 decodeWorkFile은 매번 새 객체를 만든다 —
  // 참조 동일성으로 유효성을 가르는 로직이 내용이 아니라 "다시 열었다는
  // 사실" 자체에 반응하는지 확인한다.
  await page.getByLabel('작업 파일 선택').setInputFiles({
    name: 'reopened.avcpq.json',
    mimeType: 'application/json',
    buffer: Buffer.from(savedText),
  });
  await expect(page.getByRole('alert').filter({ hasText: '계산 기준이 바뀌었습니다' })).toHaveCount(0);
  await expect(page.locator('.q-quote-table tbody tr', { hasText: '합성 테스트 품목' })).toBeVisible();

  await expect(page.getByRole('status').filter({ hasText: '인식됨' })).toHaveCount(0);
  await expect(page.getByText('cost-a.csv')).toHaveCount(0);
});

test('격리 — 원가 파일을 연결한 채로 작업 파일을 저장해도 원가 값이나 파일명이 들어가지 않는다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);
  await selectCostFile(page, 'cost-secret.csv', costCsv(COST_PRICE_A));
  await expect(page.getByRole('status').filter({ hasText: '1줄 인식됨' })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '작업 파일로 저장' }).click(),
  ]);
  const savedText = readFileSync((await download.path())!, 'utf8');

  expect(savedText).not.toContain(COST_PRICE_A);
  expect(savedText).not.toContain('cost-secret.csv');
  expect(savedText).not.toContain('privateCostSession');
});

test('통화/단위 열이 없는 원가 파일 — 추측하지 않고 확인 입력을 받은 뒤에만 인식된다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);
  await selectCostFile(page, 'no-currency-unit.csv', costCsvNoCurrencyUnit(COST_PRICE_A));

  const confirm = page.getByRole('alert').filter({ hasText: '통화·단위 확인이 필요하다' });
  await expect(confirm).toBeVisible();
  // 확인 전에는 아직 인식되지 않는다 — 추측해서 채우지 않는다.
  await expect(page.getByRole('status').filter({ hasText: '인식됨' })).toHaveCount(0);

  const confirmButton = confirm.getByRole('button', { name: '확인' });
  await expect(confirmButton).toBeDisabled();

  await confirm.getByLabel('원가 파일 통화 확인').fill('KRW');
  await confirm.getByLabel('원가 파일 단위 확인').fill('EA');
  await confirmButton.click();

  await expect(page.getByRole('status').filter({ hasText: '1줄 인식됨' })).toBeVisible();
});

test('모델 후보 연결 — SKU가 없는 행은 모델명 후보 중 사람이 직접 골라 연결한다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);
  // 고정 카탈로그 품목의 SKU(FIX-0001)를 원가 파일에 넣지 않는다 —
  // 모델명(규격 FIX-SPEC)으로만 찾아야 하는 상황을 만든다.
  const csv = Buffer.from('품명,규격,매입단가,통화,단위\nPTZ 카메라,FIX-SPEC,1234567,KRW,EA\n', 'utf8');
  await selectCostFile(page, 'cost-model-only.csv', csv);
  await expect(page.getByRole('status').filter({ hasText: '1줄 인식됨' })).toBeVisible();

  const row = page.locator('.q-private-cost tbody tr', { hasText: '합성 테스트 품목' });
  await expect(row).toBeVisible();
  await expect(row.getByText('미등록')).toHaveCount(0);
  await row.getByRole('button', { name: '연결' }).click();

  await expect(row.getByText(/원가 1234567/)).toBeVisible();
});

test('단위가 다른 원가는 임의로 비교·변환해 계산하지 않고 차단한다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page); // 합성 테스트 품목의 단위는 EA다.
  const csv = Buffer.from('품명,규격,매입단가,통화,단위\nPTZ 카메라,FIX-SPEC,1234567,KRW,M\n', 'utf8');
  await selectCostFile(page, 'cost-unit-mismatch.csv', csv);

  const row = page.locator('.q-private-cost tbody tr', { hasText: '합성 테스트 품목' });
  await row.getByRole('button', { name: '연결' }).click();

  await expect(row.getByText('단위가 다르다')).toBeVisible();
  await expect(row.getByText(/원가 1234567/)).toHaveCount(0);
});

test('통화가 다른 원가(USD)는 임의로 비교·변환해 계산하지 않고 차단한다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page); // 견적 쪽은 시스템 전체가 KRW 고정이다.
  const csv = Buffer.from('품명,규격,매입단가,통화,단위\nPTZ 카메라,FIX-SPEC,1234567,USD,EA\n', 'utf8');
  await selectCostFile(page, 'cost-currency-mismatch.csv', csv);

  const row = page.locator('.q-private-cost tbody tr', { hasText: '합성 테스트 품목' });
  await row.getByRole('button', { name: '연결' }).click();

  await expect(row.getByText('통화가 다르다')).toBeVisible();
  await expect(row.getByText(/원가 1234567/)).toHaveCount(0);
});

test('지원하지 않는 확장자를 선택해도 이전 원가 연결은 즉시 폐기된다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);
  await selectCostFile(page, 'old.csv', Buffer.from('품명,규격,매입단가,통화,단위\n장비,FIX-SPEC,1234567,KRW,EA\n'));
  const panel = page.locator('.q-private-cost');
  await panel.getByRole('button', { name: '연결', exact: true }).click();
  await expect(panel.getByText(/원가 1234567/)).toBeVisible();

  await selectCostFile(page, 'not-supported.txt', Buffer.from('아무 내용'));
  await expect(panel.getByRole('alert').filter({ hasText: '지원하지 않는 파일 형식' })).toBeVisible();
  await expect(panel.getByText(/원가 1234567/)).toHaveCount(0);
});

test('원가 비우기 — 다음 파일을 고르지 않아도 바로 연결이 사라진다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);
  await selectCostFile(page, 'cost.csv', Buffer.from('품명,규격,매입단가,통화,단위\n장비,FIX-SPEC,1234567,KRW,EA\n'));
  const panel = page.locator('.q-private-cost');
  await panel.getByRole('button', { name: '연결', exact: true }).click();
  await expect(panel.getByText(/원가 1234567/)).toBeVisible();

  await panel.getByRole('button', { name: '원가 비우기' }).click();
  await expect(panel.getByText(/원가 1234567/)).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: '연결된 원가' })).toHaveCount(0);
});

interface FullFlowAuditResult {
  requestDumps: string[];
  webSockets: string[];
  consoleMessages: string[];
  storages: { local: string; session: string; idbNames: string; cacheNames: string };
  savedText: string;
}

/**
 * 원가 선택~연결~편집(수량)~작업 파일 저장 전체 흐름을 돌면서, 요청
 * 전체 내용(URL·헤더·POST 본문)·웹소켓·콘솔·localStorage/sessionStorage/
 * IndexedDB/Cache·저장된 작업 파일까지 전부 모은다. 온라인/오프라인
 * 둘 다 같은 흐름·같은 감사를 돌려야 한다(독립 검토 지적 2026-10-05:
 * 오프라인 통과만으로는 "유출 없음"을 증명하지 못한다 — 온라인에서도
 * 똑같이 확인해야 한다).
 */
async function runFullFlowAudit(
  page: import('@playwright/test').Page,
  secretPrice: string,
  secretFileName: string,
): Promise<FullFlowAuditResult> {
  const requestDumps: string[] = [];
  page.on('request', (req) => {
    requestDumps.push(`${req.url()}|${JSON.stringify(req.headers())}|${req.postData() ?? ''}`);
  });
  const webSockets: string[] = [];
  page.on('websocket', (ws) => webSockets.push(ws.url()));
  const consoleMessages: string[] = [];
  page.on('console', (msg) => consoleMessages.push(msg.text()));

  const csv = Buffer.from(`품명,규격,매입단가,통화,단위\nPTZ 카메라,FIX-SPEC,${secretPrice},KRW,EA\n`, 'utf8');
  await selectCostFile(page, secretFileName, csv);
  await expect(page.getByRole('status').filter({ hasText: '1줄 인식됨' })).toBeVisible();

  const row = page.locator('.q-private-cost tbody tr', { hasText: '합성 테스트 품목' });
  await row.getByRole('button', { name: '연결' }).click();
  await expect(row.getByText(new RegExp(`원가 ${secretPrice}`))).toBeVisible();

  // 편집 — 수량을 바꿔도(같은 문서) 원가 연결은 유지된 채로 흐름이 이어진다.
  await page.getByLabel('합성 테스트 품목 수량', { exact: true }).fill('3');
  await page.getByLabel('합성 테스트 품목 수량', { exact: true }).blur();
  await expect(row.getByText(new RegExp(`원가 ${secretPrice}`))).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '작업 파일로 저장' }).click(),
  ]);
  const savedText = readFileSync((await download.path())!, 'utf8');

  const storages = await page.evaluate(async () => {
    const dump = (storage: Storage): string =>
      Array.from({ length: storage.length }, (_, i) => storage.key(i))
        .map((key) => `${key}=${storage.getItem(key ?? '')}`)
        .join(';');
    const idbNames = (await indexedDB.databases()).map((d) => d.name ?? '').join(';');
    const cacheNames = ('caches' in window ? await caches.keys() : []).join(';');
    return { local: dump(window.localStorage), session: dump(window.sessionStorage), idbNames, cacheNames };
  });

  return { requestDumps, webSockets, consoleMessages, storages, savedText };
}

function assertNoLeak(result: FullFlowAuditResult, secretPrice: string, secretFileName: string): void {
  // 네트워크 — 어떤 요청도(URL·헤더·본문 어디에도) 비밀 가격·원가 파일명을 담지 않는다.
  expect(result.requestDumps.some((dump) => dump.includes(secretPrice))).toBe(false);
  expect(result.requestDumps.some((dump) => dump.includes(secretFileName))).toBe(false);
  // 웹소켓 — 아예 열지 않는다.
  expect(result.webSockets).toEqual([]);
  // 콘솔 — 어디에도 비밀 가격을 찍지 않는다.
  expect(result.consoleMessages.some((text) => text.includes(secretPrice))).toBe(false);
  // 저장소 — localStorage/sessionStorage/IndexedDB/Cache 어디에도 없다.
  expect(result.storages.local).not.toContain(secretPrice);
  expect(result.storages.session).not.toContain(secretPrice);
  expect(result.storages.idbNames).not.toContain(secretPrice);
  expect(result.storages.cacheNames).not.toContain(secretPrice);
  // 작업 파일 — 저장된 JSON에도 없다.
  expect(result.savedText).not.toContain(secretPrice);
  expect(result.savedText).not.toContain(secretFileName);
}

test('감사(오프라인) — 선택·연결·편집·저장 전체가 되고, 요청 전체 내용·웹소켓·저장소·IndexedDB/Cache·콘솔·작업 파일 어디에도 원가가 새지 않는다', async ({
  page,
  context,
}) => {
  await mockResources(page);
  await createDocument(page);

  // 초기 자산 로딩이 끝난 뒤 오프라인으로 전환한다 — 이 지점부터는
  // 네트워크가 전혀 없어도 원가 선택·연결·편집·저장이 전부 돼야 한다.
  await context.setOffline(true);
  const result = await runFullFlowAudit(page, '919191917', 'cost-offline-secret.csv');
  await context.setOffline(false);

  assertNoLeak(result, '919191917', 'cost-offline-secret.csv');
});

test('감사(온라인) — 오프라인 통과만으로는 유출 없음을 증명하지 못한다 — 네트워크가 있는 상태에서도 같은 흐름·같은 감사를 돈다', async ({
  page,
}) => {
  await mockResources(page);
  await createDocument(page);

  // 오프라인으로 바꾸지 않는다 — 초기 자산 로딩용 mockResources 라우트
  // 말고 진짜 네트워크가 열려 있는 상태에서 똑같은 흐름을 돌아, 원가가
  // 든 경로가 실제로 외부 요청을 내지 않는지 확인한다.
  const result = await runFullFlowAudit(page, '828282827', 'cost-online-secret.csv');

  assertNoLeak(result, '828282827', 'cost-online-secret.csv');
});

test('격리 — 원가 파일 선택은 네트워크 요청을 전혀 내지 않는다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);

  const requests: string[] = [];
  page.on('request', (req) => requests.push(req.url()));

  await selectCostFile(page, 'cost-a.csv', costCsv(COST_PRICE_A));
  await expect(page.getByRole('status').filter({ hasText: '1줄 인식됨' })).toBeVisible();

  expect(requests.filter((url) => url.includes('cost-a.csv'))).toEqual([]);
  expect(requests.some((url) => url.includes(COST_PRICE_A))).toBe(false);
});

// ---------------------------------------------------------------------------
// 실제 B~H 다단 헤더 XLSX(갑지 포함) — 시트·헤더행·열매핑 확인(승인 필수 범위)
// ---------------------------------------------------------------------------

function inlineCell(ref: string, text: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
}

function numberCell(ref: string, value: string): string {
  return `<c r="${ref}"><v>${value}</v></c>`;
}

function formulaCell(ref: string, formula: string, cachedValue: string): string {
  return `<c r="${ref}"><f>${formula}</f><v>${cachedValue}</v></c>`;
}

function singleSheetXlsx(sheetName: string, rows: Uint8Array): Buffer {
  const workbookXml = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  const relsXml = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>',
  );
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'xl/workbook.xml': workbookXml,
      'xl/_rels/workbook.xml.rels': relsXml,
      'xl/worksheets/sheet1.xml': rows,
    }),
  );
}

/**
 * 실제 가이드류 입력 모양: 1~5행은 설명/병합 제목 영역, 6행이 진짜
 * 머리글, 7~8행이 품목, 9~10행은 잡자재비·합계(수식)다. "헤더행+1부터
 * 끝까지 전부 데이터"라고 가정하면 9~10행의 수식 집계값이 품목 가격
 * 자리로 섞여 들어가거나(수식은 price-formula로 막히지만 그 전까지는
 * 파일 전체가 막힌 걸로 보인다), 데이터 끝을 사람이 직접 골라 제외할
 * 수 있어야 한다(독립 검토 지적 2026-10-05, 신규 원가 실파일 없이
 * 합성으로만 검증한다).
 */
function guideLikeXlsx(): Buffer {
  const sheet = sheetXml(
    `<row r="1">${inlineCell('A1', '2026년 정보통신공사 원가표')}</row>` +
      `<row r="2">${inlineCell('A2', '담당: 홍길동')}</row>` +
      `<row r="3">${inlineCell('A3', '작성일: 2026-10-05')}</row>` +
      `<row r="4"></row>` +
      `<row r="5">${inlineCell('A5', '(단위: 원)')}</row>` +
      `<row r="6">${inlineCell('B6', '품명')}${inlineCell('C6', '규격')}${inlineCell('G6', '매입단가')}${inlineCell('H6', '총액')}</row>` +
      `<row r="7">${inlineCell('B7', 'PTZ 카메라')}${inlineCell('C7', 'FIX-SPEC')}${numberCell('G7', '1234567')}${numberCell('H7', '1234567')}</row>` +
      `<row r="8">${inlineCell('B8', 'NVR')}${inlineCell('C8', 'NVR-16')}${numberCell('G8', '800000')}${numberCell('H8', '800000')}</row>` +
      `<row r="9">${inlineCell('B9', '잡자재비')}${inlineCell('C9', '-집계9-')}${formulaCell('G9', '(G7+G8)*0.02', '40731')}${formulaCell('H9', '(H7+H8)*0.02', '40731')}</row>` +
      `<row r="10">${inlineCell('B10', '합계')}${inlineCell('C10', '-집계10-')}${formulaCell('G10', 'SUM(G7:G9)', '2075298')}${formulaCell('H10', 'SUM(H7:H9)', '2075298')}</row>`,
  );
  return singleSheetXlsx('원가입력', sheet);
}

function sheetXml(rows: string): Uint8Array {
  return strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<sheetData>${rows}</sheetData></worksheet>`,
  );
}

/**
 * 실제 원가 파일 모양: "갑지"(표지) 시트 + "원가입력" 시트. 원가입력의
 * 1행은 설명 제목이고 2행이 진짜 머리글이다 — B품명/C규격/G매입단가/
 * H총액(총액은 일부러 터무니없는 값을 넣어 읽지 않는지 확인한다).
 * 통화·단위 열은 아예 없다 — 실제 파일 그대로다.
 */
function realShapeXlsx(duplicatePriceHeader = false): Buffer {
  const coverSheet = sheetXml(`<row r="1">${inlineCell('A1', '㈜서울영상테크 견적서')}</row>`);
  const costSheet = sheetXml(
    `<row r="1">${inlineCell('A1', '2026년 하반기 원가표(사내 전용)')}</row>` +
      `<row r="2">${inlineCell('B2', '품명')}${inlineCell('C2', '규격')}${duplicatePriceHeader ? inlineCell('D2', '단가') : ''}${inlineCell('G2', duplicatePriceHeader ? '단가' : '매입단가')}${inlineCell('H2', '총액')}</row>` +
      `<row r="3">${inlineCell('B3', 'PTZ 카메라')}${inlineCell('C3', 'FIX-SPEC')}${duplicatePriceHeader ? numberCell('D3', '777') : ''}${numberCell('G3', '1234567')}${numberCell('H3', '99999999')}</row>`,
  );
  const workbookXml = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' +
      '<sheet name="갑지" sheetId="1" r:id="rId1"/>' +
      '<sheet name="원가입력" sheetId="2" r:id="rId2"/>' +
      '</sheets></workbook>',
  );
  const relsXml = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      // 갑지(탭 1번)가 sheet2.xml, 원가입력(탭 2번)이 sheet1.xml이다 —
      // 파일 이름 정렬로 고르면 틀린다는 것을 그대로 증명한다.
      '<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet2.xml"/>' +
      '<Relationship Id="rId2" Type="worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>',
  );
  const zipped = zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/workbook.xml': workbookXml,
    'xl/_rels/workbook.xml.rels': relsXml,
    'xl/worksheets/sheet1.xml': costSheet,
    'xl/worksheets/sheet2.xml': coverSheet,
  });
  return Buffer.from(zipped);
}

test('독립 검토: 같은 단가 머리글이 둘이어도 선택한 G열을 읽는다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);
  await selectCostFile(page, 'duplicate-header.xlsx', realShapeXlsx(true));
  await page.getByText('원가입력', { exact: true }).locator('..').getByRole('button', { name: '이 시트 선택' }).click();
  await page.getByRole('button', { name: '2행을 머리글로 선택' }).click();
  await page.getByRole('button', { name: '전체 포함(끝까지)' }).click();
  await page.getByLabel('열 매핑 — 매입단가').selectOption('6');
  await page.getByRole('alert').filter({ hasText: '열 매핑을 확인하세요' }).getByRole('button', { name: '확인', exact: true }).click();
  await page.getByLabel('원가 파일 통화 확인').fill('KRW');
  await page.getByLabel('원가 파일 단위 확인').fill('EA');
  await page.getByRole('button', { name: '확인', exact: true }).click();
  const row = page.locator('.q-private-cost tbody tr', { hasText: '합성 테스트 품목' });
  await row.getByRole('button', { name: '연결', exact: true }).click();
  await expect(row.getByText(/원가 1234567/)).toBeVisible();
});

test('실제 모양 XLSX(갑지+다단 헤더) — 시트·헤더행·열매핑을 직접 확인해야 읽힌다, H열은 안 쓴다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);

  await selectCostFile(page, 'real-cost.xlsx', realShapeXlsx());

  // 1) 시트 선택 — "갑지"가 ZIP 파일 이름상 먼저가 아니라는 것과 무관하게
  //    실제 탭 이름 둘 다 보여야 한다. 표지가 아니라 "원가입력"을 고른다.
  const sheetStep = page.getByRole('alert').filter({ hasText: '어느 시트를 읽을지' });
  await expect(sheetStep).toBeVisible();
  await expect(sheetStep.getByText('갑지', { exact: true })).toBeVisible();
  await expect(sheetStep.getByText('원가입력', { exact: true })).toBeVisible();
  await sheetStep.getByText('원가입력', { exact: true }).locator('..').getByRole('button', { name: '이 시트 선택' }).click();

  // 2) 머리글 행 선택 — 1행(설명 제목)이 아니라 2행을 고른다.
  const headerStep = page.getByRole('alert').filter({ hasText: '어느 행이 머리글' });
  await expect(headerStep).toBeVisible();
  await expect(headerStep.getByText('2026년 하반기 원가표')).toBeVisible(); // 1행 — 머리글이 아니다
  await headerStep.getByRole('button', { name: '2행을 머리글로 선택' }).click();
  await page.getByRole('button', { name: '전체 포함(끝까지)' }).click();

  // 3) 열 매핑 확인 — B/C/G는 자동 추정되어 있어야 하고, H(총액)는 어떤
  //    필드에도 배정하지 않는다. 통화/단위 열이 없으므로 매핑에 없다.
  const mappingStep = page.getByRole('alert').filter({ hasText: '열 매핑을 확인하세요' });
  await expect(mappingStep).toBeVisible();
  await expect(mappingStep.getByLabel('열 매핑 — 품명')).toHaveValue('1'); // B(0-based index 1)
  await expect(mappingStep.getByLabel('열 매핑 — 규격/모델')).toHaveValue('2'); // C
  await expect(mappingStep.getByLabel('열 매핑 — 매입단가')).toHaveValue('6'); // G
  await mappingStep.getByRole('button', { name: '확인', exact: true }).click();

  // 4) 통화/단위 열이 없으므로 확인 입력으로 이어진다(기존 흐름 재사용).
  const defaultsStep = page.getByRole('alert').filter({ hasText: '통화·단위 확인이 필요하다' });
  await expect(defaultsStep).toBeVisible();
  await defaultsStep.getByLabel('원가 파일 통화 확인').fill('KRW');
  await defaultsStep.getByLabel('원가 파일 단위 확인').fill('EA');
  await defaultsStep.getByRole('button', { name: '확인' }).click();

  await expect(page.getByRole('status').filter({ hasText: '1줄 인식됨' })).toBeVisible();

  const row = page.locator('.q-private-cost tbody tr', { hasText: '합성 테스트 품목' });
  await row.getByRole('button', { name: '연결' }).click();
  // G열 매입단가(1234567)는 들어가고, H열 총액(99999999)은 전혀 쓰이지 않는다.
  await expect(row.getByText(/원가 1234567/)).toBeVisible();
  await expect(page.getByText('99999999')).toHaveCount(0);
});

test('시트/헤더행/열매핑을 바꾸려고 파일을 다시 고르면 이전 연결이 즉시 폐기된다', async ({ page }) => {
  await mockResources(page);
  await createDocument(page);

  await selectCostFile(page, 'real-cost.xlsx', realShapeXlsx());
  await page
    .getByRole('alert')
    .filter({ hasText: '어느 시트를 읽을지' })
    .getByText('원가입력', { exact: true })
    .locator('..')
    .getByRole('button', { name: '이 시트 선택' })
    .click();
  await page.getByRole('button', { name: '2행을 머리글로 선택' }).click();
  await page.getByRole('button', { name: '전체 포함(끝까지)' }).click();
  await page.getByRole('alert').filter({ hasText: '열 매핑을 확인하세요' }).getByRole('button', { name: '확인', exact: true }).click();
  await page.getByLabel('원가 파일 통화 확인').fill('KRW');
  await page.getByLabel('원가 파일 단위 확인').fill('EA');
  await page.getByRole('button', { name: '확인' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1줄 인식됨' })).toBeVisible();

  const row = page.locator('.q-private-cost tbody tr', { hasText: '합성 테스트 품목' });
  await row.getByRole('button', { name: '연결' }).click();
  await expect(row.getByText(/원가 1234567/)).toBeVisible();

  // 같은 파일을 다시 골라 시트를 바꾼다 — 이전 연결은 즉시 폐기되고
  // 마법사부터 다시 시작해야 한다.
  await selectCostFile(page, 'real-cost.xlsx', realShapeXlsx());
  await expect(page.getByText(/원가 1234567/)).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: '어느 시트를 읽을지' })).toBeVisible();
});

test('실제 가이드류 구조(병합 제목 1~5행, 품목 6행부터, 잡자재비·합계 수식 9~10행) — 데이터 끝을 직접 골라 집계 행을 제외한다', async ({
  page,
}) => {
  await mockResources(page);
  await createDocument(page);

  await selectCostFile(page, 'guide-like.xlsx', guideLikeXlsx());
  // 시트가 1개뿐이라 시트 선택은 건너뛰고 바로 머리글 행 선택으로 간다.
  await expect(page.getByRole('alert').filter({ hasText: '어느 행이 머리글' })).toBeVisible();
  await page.getByRole('button', { name: '6행을 머리글로 선택' }).click();

  // 데이터 끝 선택 — 8행(품목 마지막 줄)에서 "여기까지 품목"을 눌러
  // 9~10행(잡자재비·합계)을 데이터에서 아예 제외한다.
  const dataEndStep = page.getByRole('alert').filter({ hasText: '품목이 어디서 끝나는지' });
  await expect(dataEndStep).toBeVisible();
  await expect(dataEndStep.getByRole('cell', { name: '잡자재비' })).toBeVisible();
  await expect(dataEndStep.getByRole('cell', { name: '합계', exact: true })).toBeVisible();
  await dataEndStep.getByRole('button', { name: '8행까지 품목으로 선택' }).click();

  await page.getByRole('alert').filter({ hasText: '열 매핑을 확인하세요' }).getByRole('button', { name: '확인', exact: true }).click();
  await page.getByLabel('원가 파일 통화 확인').fill('KRW');
  await page.getByLabel('원가 파일 단위 확인').fill('EA');
  await page.getByRole('button', { name: '확인' }).click();

  // 품목 2줄만 인식된다 — 잡자재비·합계는 아예 데이터가 아니었다.
  await expect(page.getByRole('status').filter({ hasText: '2줄 인식됨' })).toBeVisible();

  const row = page.locator('.q-private-cost tbody tr', { hasText: '합성 테스트 품목' });
  await row.getByRole('button', { name: '연결' }).click();
  await expect(row.getByText(/원가 1234567/)).toBeVisible();
  // 잡자재비·합계의 수식 캐시값은 어디에도 나타나지 않는다.
  await expect(page.getByText('40731')).toHaveCount(0);
  await expect(page.getByText('2075298')).toHaveCount(0);
});

test('데이터 끝을 "전체 포함"으로 두면 잡자재비 수식이 걸려 파일 전체가 막힌다 — 수식값을 품목 가격으로 조용히 읽지 않는다', async ({
  page,
}) => {
  await mockResources(page);
  await createDocument(page);

  await selectCostFile(page, 'guide-like.xlsx', guideLikeXlsx());
  await page.getByRole('button', { name: '6행을 머리글로 선택' }).click();
  await page.getByRole('button', { name: '전체 포함(끝까지)' }).click();
  await page.getByRole('alert').filter({ hasText: '열 매핑을 확인하세요' }).getByRole('button', { name: '확인', exact: true }).click();

  // 잡자재비(9행)의 수식이 걸려 바로 오류로 막힌다 — 통화/단위 확인
  // 단계로도 안 넘어간다(price-formula가 currency/unit과 무관한
  // "다른 오류"라 needs-defaults 분기를 타지 않는다).

  // 잡자재비 행(9행)의 수식이 걸려 오류로 막힌다 — 조용히 통과해
  // "2줄 인식됨"이 되거나 수식값(40731)을 품목 가격으로 읽지 않는다.
  await expect(page.getByRole('status').filter({ hasText: '인식됨' })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: '수식' })).toBeVisible();
  await expect(page.getByText('40731')).toHaveCount(0);
});
