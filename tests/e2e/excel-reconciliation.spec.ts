/**
 * Task6: 화면으로 만든 양수 견적의 실다운로드를 Excel 독립 대사에 넘긴다.
 * 기대 금액은 생산 계산 함수를 호출하지 않고 아래 산식으로 고정했다.
 * 판매: 123457 * 3 = 370371; 잡자재 INT(370371 * .02) = 7407.
 * 노무: INT(286219 * .25 * 1.1 * .63) = 49587; * 3 = 148761.
 * 직접비: 377778 + 148761 = 526539.
 * DS: INT(148761*.0486/.00424/.00961) 각각 7229/630/1429,
 * 안전관리 INT(526539*.0311)=16375, 공과 INT((526539+7229+16375)*.1)=55014.
 * 일반: INT(526539*.06)=31592, INT(526539*.0207)=10899,
 * 보험 INT(148761*.0457)=6798. 기본 미적용 항목은 0.
 * 원가: 76543 * 3 = 229629. 실제 사용자 자료는 사용하지 않는다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { test, expect } from '@playwright/test';
import { mockResources, expandWorkspaceSections, showDetailColumns } from './fixtures';

const NAME = '합성 대사 장비';
const meta = { schemaVersion: 1, generatedOn: '2026-01-01' };
const catalogMeta = { ...meta, sourceSha256: 'a'.repeat(64) };
const laborMeta = { ...meta, sourceSha256: 'b'.repeat(64) };
const supplier = 'SYNTHETIC-SUPPLIER-ONLY';
const remark = 'SYNTHETIC-SALES-NOTE-ONLY';
const expected = {
  ds: { indirect: '80677', total: '607216', cover: '607000', indirectRows: ['7229', '630', '1429', '0', '0', '0', '16375', '0', '55014'] },
  general: { indirect: '49289', total: '575828', cover: '575000', indirectRows: ['31592', '10899', '6798', '0', '0', '0', '0'] },
};

for (const profile of ['ds', 'general'] as const) {
  test(`${profile}: 화면 입력 → 실제 0/2/0/2/1 다운로드와 독립 금액`, async ({ page }, testInfo) => {
    await mockResources(page, {
      '/data/approved/products.json': { ...catalogMeta, products: [{
        productId: 'FIX-0001', sku: 'FIX-0001', brand: '', model: 'FIX', quoteName: NAME,
        quoteSpec: 'FIX-SPEC', unit: 'EA', options: { group: '합성 장비' },
        currency: 'KRW', evidence: 'verified', laborMappingId: 'LM-1',
      }] },
      '/data/approved/prices.json': { ...catalogMeta, currency: 'KRW', prices: {
        'FIX-0001': { sellingUnitPrice: '123457', currency: 'KRW' },
      } },
      '/data/approved/labor-items.json': { ...laborMeta, laborItems: [{
        laborItemId: 'LI-1', code: 'SYNTHETIC-LABOR', description: '합성 공정',
        baseUnit: 'EA', source: 'fixture', revision: '1', wageUnit: 'M/D',
        trades: [{ trade: '통신내선공', quantity: '0.25' }],
      }] },
      '/data/approved/labor-mappings.json': { ...laborMeta, mappings: [{
        laborMappingId: 'LM-1', sku: 'FIX-0001', laborItemId: 'LI-1',
        conversionFactor: '1', surcharge: '0.1', itemRate: '0.63', confirmed: false, note: '합성 대사',
      }], unmappedSkus: [] },
    });
    await page.goto('/');
    await page.getByRole('button', { name: '품목 직접 선택' }).click();
    await page.getByLabel('품목 검색').fill(NAME);
    await page.getByRole('button', { name: '추가', exact: true }).click();
    await page.getByRole('button', { name: '견적 만들기' }).click();
  await expandWorkspaceSections(page);
  await showDetailColumns(page);
    const quantity = page.getByLabel(`${NAME} 수량`, { exact: true });
    await quantity.fill('3');
    await quantity.blur();
    await page.locator('.q-indirect-panel select').selectOption(profile);
    for (const [label, value] of [['거래처', supplier], ['영업비고', remark]]) {
      const field = page.getByLabel(`${NAME} ${label}`, { exact: true });
      await field.fill(value!);
      await field.blur();
    }
    await page.getByRole('button', { name: `${NAME} 노무 처리 펼치기` }).click();
    await expect(page.getByText('적용 노무 단가 49587', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Excel 다운로드' })).toBeDisabled();
    await page.getByRole('button', { name: '확인함', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Excel 다운로드' })).toBeEnabled();

    const totals = page.locator('.q-quote-table tfoot');
    for (const amount of ['377778', '148761', '526539', expected[profile].indirect, expected[profile].total]) {
      await expect(totals.getByText(amount, { exact: true })).toBeVisible();
    }
    await expect(page.getByText(`갑지 합계(절사): ${expected[profile].cover}`, { exact: true })).toBeVisible();
    await page.getByLabel('원가 파일 선택').setInputFiles({
      name: 'synthetic-cost.csv', mimeType: 'text/csv',
      buffer: Buffer.from('품명,규격,매입단가,통화,단위\n합성 원가,FIX-SPEC,76543,KRW,EA\n'),
    });
    await page.locator('.q-private-cost').getByRole('button', { name: '연결', exact: true }).click();
    await expect(page.locator('.q-private-cost').getByText(/원가 76543/)).toBeVisible();

    for (const [index, grade] of ([0, 2, 0, 2, 1] as const).entries()) {
      await page.getByRole('radio', { name: `${grade} ${grade === 0 ? '영업팀용' : grade === 1 ? '공유용' : '고객용'}` }).check();
      if (grade === 0) page.once('dialog', dialog => dialog.accept());
      const event = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Excel 다운로드' }).click();
      const download = await event;
      const stem = `${profile}-${index}-grade${grade}`;
      const file = testInfo.outputPath(`${stem}.xlsx`);
      await download.saveAs(file);
      const xml = Object.entries(unzipSync(readFileSync(file)))
        .filter(([name]) => name.endsWith('.xml')).map(([, bytes]) => strFromU8(bytes)).join('\n');
      if (grade === 0) expect(xml).toContain('<v>76543</v>');
      else for (const privateAmount of ['76543', '229629', '4592', '234221']) {
        // 단가뿐 아니라 품목 원가·잡자재 원가·원가 합계도 남으면 안 된다.
        expect(xml).not.toContain(privateAmount);
      }
      if (grade === 2) {
        expect(xml).not.toContain(supplier);
        expect(xml).not.toContain(remark);
      } else {
        expect(xml).toContain(supplier);
        expect(xml).toContain(remark);
      }

      // 주소는 이 한 품목+잡자재 시험의 고정 배치다. 금액은 위의 독립 산식이다.
      const cols = grade === 0 ? { q: 'F', mu: 'I', m: 'J', lu: 'K', l: 'L', t: 'M' }
        : grade === 1 ? { q: 'F', mu: 'G', m: 'H', lu: 'I', l: 'J', t: 'K' }
          : { q: 'E', mu: 'F', m: 'G', lu: 'H', l: 'I', t: 'J' };
      const end = profile === 'ds' ? 20 : 18;
      const detail: Record<string, string> = {
        [`${cols.q}6`]: '3', [`${cols.mu}6`]: '123457', [`${cols.m}6`]: '370371',
        [`${cols.lu}6`]: '49587', [`${cols.l}6`]: '148761', [`${cols.t}6`]: '519132',
        [`${cols.m}7`]: '7407', [`${cols.m}8`]: '377778', [`${cols.l}8`]: '148761',
        [`${cols.t}8`]: '526539', [`${cols.t}${end - 1}`]: expected[profile].indirect,
        [`${cols.t}${end}`]: expected[profile].total,
      };
      expected[profile].indirectRows.forEach((amount, i) => { detail[`${cols.t}${10 + i}`] = amount; });
      if (grade === 0) {
        detail.G6 = '76543'; detail.H6 = '229629'; detail.H7 = '4592'; detail.H8 = '234221';
      }
      writeFileSync(testInfo.outputPath(`${stem}.expected.json`), JSON.stringify({
        갑지: { H11: expected[profile].total, H12: expected[profile].cover }, 세부내역: detail,
      }, null, 2));
      writeFileSync(testInfo.outputPath(`${stem}.layout.json`), JSON.stringify({
        detailSheetIndex: 2, coverSheetIndex: 1, quantityColumn: cols.q,
        unitPriceColumn: cols.mu, amountColumn: cols.m, coverAmountTextCell: 'C8',
      }, null, 2));
    }
  });
}
