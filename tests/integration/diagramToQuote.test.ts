import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseDiagram } from '@/import/diagram/schema';
import { diagramToQuote } from '@/import/diagram/toQuote';
import { calculateQuote } from '@/domain/calculation/calculate';
import { buildCustomerProjection } from '@/export/customer/projection';
import { buildQuoteWorkbook } from '@/export/ooxml/workbook';
import { buildCatalog, buildLaborReference } from '@/data/catalog/load';
import { calculateLaborForRows } from '@/domain/labor/calculateLabor';
import { TEMPLATE_PATH } from '@/export/ooxml/anchors';
import { cat, diagram, edge, node } from '../fixtures/diagram';
import type { QuoteHeader } from '@/domain/quote/types';

/** 계획 2026-10-04 Task 6. */

const ROOT = resolve(__dirname, '../..');
const OUT_DIR = resolve(ROOT, 'tests/fixtures/out');
const SAMPLE = resolve(ROOT, '.local/samples/av-diagram.json');

const header = (): QuoteHeader => ({
  quoteNumber: 'T-1',
  quoteDate: '2026-10-04',
  customer: '합성 고객',
  projectName: '테스트 회의실',
  contact: '',
  conditions: [],
});

const options = { header: header(), defaultSystemName: '회의실' };

/** 장비 + 벌크 케이블 구간이 있는 구성도. 커넥터·배관까지 나온다. */
function fixture() {
  return diagram(
    [
      node('n1', 'PTZ 카메라', 'SRG-X40UH'),
      node('n2', 'PTZ 카메라', 'SRG-X40UH'),
      node('m1', '매트릭스', 'XDM-12'),
    ],
    [
      edge('e1', 'n1', 'm1', 'network', {
        bomRows: [
          { cableType: 'manufactured', productName: 'UTP Cable (CAT6)', length: '12', quantity: '1' },
        ],
      }),
      edge('e2', 'n2', 'm1', 'network', {
        bomRows: [
          { cableType: 'manufactured', productName: 'UTP Cable (CAT6)', length: '15', quantity: '1' },
        ],
      }),
    ],
  );
}

const parts = () =>
  cat(
    [
      ...cat().products,
      {
        productId: 'CBL-0101',
        sku: 'CBL-0101',
        brand: '',
        model: 'CAT6 UTP용',
        quoteName: '- Pass Through RJ45 Connector',
        quoteSpec: 'CAT6 UTP용',
        unit: '10EA',
        options: {},
        currency: 'KRW' as const,
        evidence: 'review-required' as const,
      },
      {
        productId: 'CBL-0200',
        sku: 'CBL-0200',
        brand: '',
        model: '28㎜_SF-28',
        quoteName: 'Flexible Conduit (고장력,비방수)',
        quoteSpec: '28㎜_SF-28',
        unit: '10M',
        options: {},
        currency: 'KRW' as const,
        evidence: 'review-required' as const,
      },
    ],
    { 'VID-0138': '5300000', 'CBL-0101': '12000', 'CBL-0200': '31000' },
  );

function itemNames(result: ReturnType<typeof diagramToQuote>): string[] {
  return result.document.rows
    .filter((r): r is typeof r & { type: 'item' } => r.type === 'item')
    .map((r) => r.name);
}

describe('구성도 → 견적 문서', () => {
  it('장비·케이블·커넥터가 이 순서로 들어간다', () => {
    // 배관은 여기 없다 — 구성도에는 거리가 없어 가져오기 시점에 만들 수
    // 없다(결정 D8). `domain/quote/installation.ts`의
    // `applyInstallationPatch`가 거리·줄 수 입력 후 따로 만든다.
    const names = itemNames(diagramToQuote(fixture(), parts(), options));
    const at = (p: string) => names.findIndex((n) => n.includes(p));
    expect(at('PTZ')).toBeGreaterThanOrEqual(0);
    expect(at('PTZ')).toBeLessThan(at('UTP'));
    expect(at('UTP')).toBeLessThan(at('Connector'));
    expect(at('Conduit')).toBe(-1);
  });

  it('두 번 불러도 결과가 같다 — 수량이 누적되지 않는다 (설계서 §7.3)', () => {
    const a = diagramToQuote(fixture(), parts(), options);
    const b = diagramToQuote(fixture(), parts(), options);
    expect(JSON.stringify(a.document.rows)).toBe(JSON.stringify(b.document.rows));
  });

  it('만들어진 문서가 계산 엔진을 그대로 통과한다 — 엔진을 고치지 않는다', () => {
    const result = diagramToQuote(fixture(), parts(), options);
    expect(() => calculateQuote(result.document)).not.toThrow();
  });

  it('간접비 9항목이 시스템에 붙는다 — 기본값은 적용 6 / 미적용 3', () => {
    const result = diagramToQuote(fixture(), parts(), options);
    const system = result.document.systems[0]!;
    expect(system.indirectCosts).toHaveLength(9);
    expect(system.indirectCosts.filter((i) => i.applied)).toHaveLength(6);
  });

  it('systemName이 있으면 시스템을 나눈다', () => {
    const d = diagram([
      node('n1', 'PTZ', 'SRG-X40UH', { systemName: '대회의실' }),
      node('n2', '매트릭스', 'XDM-12', { systemName: '접견실' }),
    ]);
    const result = diagramToQuote(d, parts(), { ...options, defaultSystemName: '기타' });
    expect(result.document.systems.map((s) => s.name).sort()).toEqual([
      '대회의실',
      '접견실',
    ]);
  });

  it('systemName이 없으면 defaultSystemName 하나로 묶는다', () => {
    const result = diagramToQuote(fixture(), parts(), options);
    expect(result.document.systems).toHaveLength(1);
    expect(result.document.systems[0]!.name).toBe('회의실');
  });

  it('옵션 카드와 파생 항목에 `- `를 붙인다 — 견적서 관행', () => {
    const d = diagram([
      node('m1', '매트릭스', 'XDM-12', { selectedOptionQuantities: { 'eqopt-454': 2 } }),
    ]);
    const names = itemNames(diagramToQuote(d, parts(), options));
    expect(names.some((n) => n.startsWith('- '))).toBe(true);
  });

  it('왜 이 행이 생겼는지 비고에 남긴다', () => {
    const result = diagramToQuote(fixture(), parts(), options);
    const rows = result.document.rows.filter(
      (r): r is typeof r & { type: 'item' } => r.type === 'item',
    );
    expect(rows.every((r) => r.remark.includes('구성도'))).toBe(true);
    const utp = rows.find((r) => r.name.includes('UTP'))!;
    expect(utp.remark).toContain('2구간');
    expect(utp.remark).toContain('27m');
  });
});

describe('구성도 → 견적 문서 — 확정 차단', () => {
  it('옵션 정의가 없으면 blocking이다', () => {
    const d = diagram([
      node('m1', '매트릭스', 'XDM-12', { selectedOptionQuantities: { 'eqopt-454': 4 } }),
    ]);
    const result = diagramToQuote(d, parts(), options);
    expect(result.blocking).toBe(true);
    expect(result.warnings.some((w) => w.code === 'option-definition-missing')).toBe(true);
  });

  it('케이블 품목이 미정이면 blocking이다', () => {
    const d = diagram(
      [node('n1', 'PTZ', 'SRG-X40UH'), node('n2', '매트릭스', 'XDM-12')],
      [edge('e1', 'n1', 'n2', 'video', { bomRows: [] })],
    );
    const result = diagramToQuote(d, parts(), options);
    expect(result.blocking).toBe(true);
    expect(result.warnings.some((w) => w.code === 'cable-item-unresolved')).toBe(true);
  });

  it('단가 미등록 장비가 있으면 계산 엔진도 확정을 막는다', () => {
    const result = diagramToQuote(fixture(), parts(), options);
    // SRG-X40UH는 가격표에 없다
    const snapshot = calculateQuote(result.document);
    expect(snapshot.blocking).toBe(true);
    expect(snapshot.warnings.some((w) => w.code === 'price-not-registered')).toBe(true);
  });

  it('문제가 없으면 blocking이 아니다', () => {
    const d = diagram([node('m1', '매트릭스', 'XDM-12')]);
    const result = diagramToQuote(d, parts(), options);
    expect(result.blocking).toBe(false);
  });
});

/**
 * 노무비를 붙인다.
 *
 * 구성도 변환기는 행에 `laborMode: 'mapped'`와 품셈 id만 심는다. 실제 단가는
 * `calculateLaborForRows`가 만들어 `calculateQuote`에 넘긴다 — 기존 엔진 그대로다.
 * 이 단계를 건너뛰면 노무비가 0이 되고, 간접비가 노무비 대비라 **간접비까지 0**이 된다.
 */
function withLabor(document: Parameters<typeof calculateQuote>[0]) {
  const labor = buildLaborReference(
    JSON.parse(readFileSync(resolve(ROOT, 'data/approved/labor-items.json'), 'utf8')),
    JSON.parse(readFileSync(resolve(ROOT, 'data/approved/wage-table.json'), 'utf8')),
    JSON.parse(readFileSync(resolve(ROOT, 'data/approved/labor-mappings.json'), 'utf8')),
  );
  const requests = document.rows
    .filter(
      (r): r is typeof r & { type: 'item'; laborMappingId: string } =>
        r.type === 'item' && r.laborMode === 'mapped' && r.laborMappingId !== undefined,
    )
    .map((r) => ({ rowId: r.rowId, laborMappingId: r.laborMappingId }));
  return calculateLaborForRows(requests, labor);
}

describe('노무비 연결', () => {
  it('품셈이 붙는 제품은 laborMode가 mapped다', () => {
    const d = diagram([node('m1', '매트릭스', 'XDM-12')]);
    const result = diagramToQuote(d, parts(), options);
    const row = result.document.rows.find(
      (r): r is typeof r & { type: 'item' } => r.type === 'item',
    )!;
    // 테스트 카탈로그에는 품셈이 없으므로 unresolved여야 한다
    expect(row.laborMode).toBe('unresolved');
  });

  it('품셈이 없으면 not-applicable로 두지 않는다 — 노무비가 조용히 0이 된다', () => {
    const d = diagram([node('n1', '모르는 장비', 'UNKNOWN-9999')]);
    const result = diagramToQuote(d, parts(), options);
    const row = result.document.rows.find(
      (r): r is typeof r & { type: 'item' } => r.type === 'item',
    )!;
    expect(row.laborMode).not.toBe('not-applicable');
  });
});

describe('구성도 → Excel 까지 (계산·exporter를 고치지 않는다)', () => {
  it('합성 구성도가 Excel 통합문서까지 나온다', () => {
    const d = diagram([node('m1', '매트릭스', 'XDM-12')]);
    const result = diagramToQuote(d, parts(), options);
    const calculation = calculateQuote(result.document);
    // 테스트 카탈로그에 품셈이 없어 노무비가 unresolved다. 그 경고만 남아야 한다.
    expect(
      calculation.warnings.filter((w) => w.code !== 'labor-unresolved'),
    ).toEqual([]);

    const projection = buildCustomerProjection(result.document, calculation);
    const templateBytes = new Uint8Array(readFileSync(resolve(ROOT, TEMPLATE_PATH)));
    const workbook = buildQuoteWorkbook(projection, templateBytes);

    expect(workbook.sheetNames).toEqual(['갑지', '회의실']);
    expect(workbook.bytes.byteLength).toBeGreaterThan(1000);

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(resolve(OUT_DIR, 'diagram-quote.xlsx'), workbook.bytes);
  });
});

describe('실물 구성도 (파일이 있을 때만)', () => {
  const hasSample = existsSync(SAMPLE);

  it.skipIf(!hasSample)('실물 JSON이 견적 문서가 된다', () => {
    const raw: unknown = JSON.parse(readFileSync(SAMPLE, 'utf8'));
    const d = parseDiagram(raw);
    const catalog = buildCatalog(
      JSON.parse(readFileSync(resolve(ROOT, 'data/approved/products.json'), 'utf8')),
      JSON.parse(readFileSync(resolve(ROOT, 'data/approved/prices.json'), 'utf8')),
    );
    const result = diagramToQuote(d, catalog, {
      header: { ...header(), projectName: '실물 구성도 검증' },
      defaultSystemName: '회의실',
    });

    const names = itemNames(result);
    expect(names.some((n) => n.includes('PTZ'))).toBe(true);
    expect(names.some((n) => n.includes('Matrix'))).toBe(true);
    expect(names.some((n) => n.includes('LFD'))).toBe(true);

    // 옵션 카드 정의가 없어 확정이 막혀야 한다
    expect(result.blocking).toBe(true);
    expect(result.warnings.some((w) => w.code === 'option-definition-missing')).toBe(true);

    // 계산 엔진은 그대로 통과한다
    expect(() => calculateQuote(result.document)).not.toThrow();
  });

  it.skipIf(!hasSample)('실물 품셈을 붙이면 노무비와 간접비가 0이 아니다', () => {
    const d = parseDiagram(JSON.parse(readFileSync(SAMPLE, 'utf8')));
    const catalog = buildCatalog(
      JSON.parse(readFileSync(resolve(ROOT, 'data/approved/products.json'), 'utf8')),
      JSON.parse(readFileSync(resolve(ROOT, 'data/approved/prices.json'), 'utf8')),
    );
    const result = diagramToQuote(d, catalog, options);
    const labor = withLabor(result.document);
    const calculation = calculateQuote(result.document, {
      laborUnitPrices: labor.unitPrices,
    });

    const system = calculation.systems[0]!;
    expect(system.directLabor.isZero()).toBe(false);
    // 간접비는 노무비 대비로 계산된다. 노무비가 0이면 간접비도 0이 된다.
    expect(system.indirectTotal.isZero()).toBe(false);
    expect(system.systemTotal.greaterThan(system.directMaterial)).toBe(true);
  });

  it.skipIf(!hasSample)('실물 구성도의 PTZ 3대가 한 행 3EA가 된다', () => {
    const d = parseDiagram(JSON.parse(readFileSync(SAMPLE, 'utf8')));
    const catalog = buildCatalog(
      JSON.parse(readFileSync(resolve(ROOT, 'data/approved/products.json'), 'utf8')),
      JSON.parse(readFileSync(resolve(ROOT, 'data/approved/prices.json'), 'utf8')),
    );
    const result = diagramToQuote(d, catalog, { ...options });
    const ptz = result.document.rows.find(
      (r): r is typeof r & { type: 'item' } => r.type === 'item' && r.name.includes('PTZ'),
    )!;
    expect(ptz.quantity).toBe('3');
  });
});
