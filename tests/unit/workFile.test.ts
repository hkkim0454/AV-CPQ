import { describe, expect, it } from 'vitest';
import { decodeWorkFile, encodeWorkFile, WORK_FILE_SCHEMA_VERSION } from '@/services/files/workFile';
import { calculateQuote } from '@/domain/calculation/calculate';
import { makeDocument, itemRow, system } from '../fixtures/document';
import type { QuoteDocument, SheetRow } from '@/domain/quote/types';

/** 계획 2026-10-04-quote-workspace-ui Task 4. */

function baseDoc(): QuoteDocument {
  return makeDocument({
    systems: [system('S1', { indirect: [] })],
    rows: [itemRow('r1', 'S1', { quantity: '2', price: '10000' })],
  });
}

describe('encodeWorkFile/decodeWorkFile — 왕복', () => {
  it('기본 문서를 저장했다 다시 열면 그대로 복원된다', () => {
    const doc = baseDoc();
    const text = encodeWorkFile(doc);
    const result = decodeWorkFile(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document).toEqual(doc);
  });

  it('케이블 원본·기준 행·경로·경고까지 왕복한다', () => {
    const doc: QuoteDocument = {
      ...baseDoc(),
      cableSource: {
        version: '1',
        nodes: [{ id: 'n1', data: { name: '소스' } }],
        lineTypes: [{ id: 'video', name: 'HDMI' }],
        edges: [
          {
            id: 'e1',
            source: 'n1',
            target: 'n2',
            data: { lineTypeId: 'video', bomRows: [{ cableType: 'ready-made', productName: 'HDMI', length: '2' }] },
          },
        ],
      },
      cableBaseline: [],
      cableRoutes: [{ edgeId: 'e1', systemId: 'S1', source: 'measured-route', horizontalMeters: '10', riseMeters: '0', dropMeters: '0' }],
      cableWarnings: [{ code: 'cable-item-unresolved', blocking: true, message: '확인 필요', edgeId: 'e1' }],
    };
    const result = decodeWorkFile(encodeWorkFile(doc));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document).toEqual(doc);
  });

  it('배관(설치) 입력이 있는 시스템도 왕복한다', () => {
    const doc: QuoteDocument = {
      ...baseDoc(),
      systems: [
        {
          ...system('S1', { indirect: [] }),
          farthestDeviceMeters: '10',
          conduitRuns: '3',
          conduitType: 'flexible',
          conduitMaterialRate: '20',
          conduitMaterialRateManual: false,
        },
      ],
    };
    const result = decodeWorkFile(encodeWorkFile(doc));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document).toEqual(doc);
  });

  it('잡자재비(material-sum-to-here, excludedRowIds 포함) 파생행도 왕복한다', () => {
    const doc: QuoteDocument = {
      ...baseDoc(),
      derivedRows: [
        {
          rowId: 'd1',
          systemId: 'S1',
          name: '잡자재비',
          specification: 'LED 캐비넷 제외 재료비의 2%',
          unit: '식',
          quantity: '1',
          laborMode: 'not-applicable',
          remark: '',
          origin: 'rule',
          ruleInstanceId: 'misc-material-led-excluded-v1',
          rate: '0.02',
          derived: { kind: 'material-sum-to-here', excludedRowIds: ['r1'] },
        },
      ],
    };
    const result = decodeWorkFile(encodeWorkFile(doc));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document).toEqual(doc);
  });
});

describe('encodeWorkFile — 허용 목록 밖 칸은 저장을 거부한다', () => {
  it('행에 원가 비슷한 미지정 필드가 섞이면 저장 자체를 막는다', () => {
    const doc = baseDoc();
    const poisoned = {
      ...doc,
      rows: doc.rows.map((row) => (row.rowId === 'r1' ? { ...row, purchasePrice: '5000' } : row)),
    } as unknown as QuoteDocument;
    expect(() => encodeWorkFile(poisoned)).toThrow();
  });

  it('문서 최상위에 지정하지 않은 필드가 섞이면 저장을 막는다', () => {
    const poisoned = { ...baseDoc(), supplierNote: '비공개 매입처' } as unknown as QuoteDocument;
    expect(() => encodeWorkFile(poisoned)).toThrow();
  });
});

describe('decodeWorkFile — 손상·형식 오류를 작업 중단 없이 사유로 돌려준다', () => {
  it('JSON이 아니면 사유를 보여준다', () => {
    const result = decodeWorkFile('이것은 JSON이 아니다{{{');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('JSON');
  });

  it('schemaVersion이 없으면 거부한다', () => {
    const result = decodeWorkFile(JSON.stringify({ foo: 'bar' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('schemaVersion');
  });

  it('지원하지 않는 schemaVersion은 거부한다', () => {
    const result = decodeWorkFile(JSON.stringify({ ...baseDoc(), schemaVersion: 99 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('99');
  });

  it('최상위에 허용 목록 밖 필드가 있으면 거부한다(저장 시뿐 아니라 열 때도 다시 검증한다)', () => {
    const result = decodeWorkFile(JSON.stringify({ ...baseDoc(), buyerCostNote: '비공개' }));
    expect(result.ok).toBe(false);
  });

  it('필수 필드가 빠지면 거부한다', () => {
    const broken = baseDoc() as unknown as Record<string, unknown>;
    delete broken['header'];
    const result = decodeWorkFile(JSON.stringify(broken));
    expect(result.ok).toBe(false);
  });

  it('현재 지원 버전은 1이다', () => {
    expect(WORK_FILE_SCHEMA_VERSION).toBe(1);
  });
});

describe('구조적 관계 검증 — 모양은 맞아도 참조가 깨진 문서는 거부한다(독립 검토 지적)', () => {
  it('행 ID가 중복되면 저장도 열기도 거부한다', () => {
    const doc = baseDoc();
    const duplicated: QuoteDocument = { ...doc, rows: [...doc.rows, { ...doc.rows[0]! }] };
    expect(() => encodeWorkFile(duplicated)).toThrow(/중복/);
    const result = decodeWorkFile(JSON.stringify(duplicated));
    expect(result.ok).toBe(false);
  });

  it('행이 없는 systemId를 가리키면 거부한다 — orphan 행은 합계에서 조용히 사라질 수 있다', () => {
    const doc = baseDoc();
    const orphaned: QuoteDocument = {
      ...doc,
      rows: [...doc.rows, { ...(doc.rows[0] as Extract<SheetRow, { type: 'item' }>), rowId: 'r2', systemId: '없는시스템' }],
    };
    expect(() => encodeWorkFile(orphaned)).toThrow(/시스템/);
  });

  it('수량이 음수면 거부한다 — 화면은 애초에 음수 입력을 막는다', () => {
    const doc = baseDoc();
    const negative: QuoteDocument = {
      ...doc,
      rows: doc.rows.map((r) => (r.rowId === 'r1' ? { ...r, quantity: '-1' } : r)),
    };
    expect(() => encodeWorkFile(negative)).toThrow(/음수/);
  });

  it('파생행의 sourceRowId가 없는 행을 가리키면 거부한다', () => {
    const doc = baseDoc();
    const broken: QuoteDocument = {
      ...doc,
      derivedRows: [
        {
          rowId: 'd1', systemId: 'S1', name: '파생', specification: '', unit: '식', quantity: '1',
          laborMode: 'not-applicable', remark: '', origin: 'rule', rate: '1',
          derived: { kind: 'single-row-material', sourceRowId: '없는행' },
        },
      ],
    };
    expect(() => encodeWorkFile(broken)).toThrow(/sourceRowId/);
  });

  it('잡자재비 제외 행 목록이 없는 행을 가리키면 거부한다', () => {
    const doc = baseDoc();
    const broken: QuoteDocument = {
      ...doc,
      derivedRows: [
        {
          rowId: 'd1', systemId: 'S1', name: '잡자재비', specification: '', unit: '식', quantity: '1',
          laborMode: 'not-applicable', remark: '', origin: 'rule', rate: '0.02',
          derived: { kind: 'material-sum-to-here', excludedRowIds: ['없는행'] },
        },
      ],
    };
    expect(() => encodeWorkFile(broken)).toThrow(/제외 행/);
  });

  it('케이블 경로가 구성도에 없는 edge를 가리키면 거부한다', () => {
    const doc: QuoteDocument = {
      ...baseDoc(),
      cableSource: { version: '1', nodes: [], lineTypes: [], edges: [] },
      cableRoutes: [{ edgeId: '없는edge', systemId: 'S1', source: 'measured-route', horizontalMeters: '10' }],
    };
    expect(() => encodeWorkFile(doc)).toThrow(/edge/);
  });

  it('미완성 케이블 경로(일부 구간 빈 문자열)는 정상적으로 저장·복원된다 — 빈 값은 "아직 못 정함"이지 오류가 아니다', () => {
    const doc: QuoteDocument = {
      ...baseDoc(),
      cableSource: {
        version: '1', nodes: [], lineTypes: [],
        edges: [{ id: 'e1', source: 'n1', target: 'n2', data: { bomRows: [] } }],
      },
      cableRoutes: [{ edgeId: 'e1', systemId: 'S1', source: 'measured-route', horizontalMeters: '10', riseMeters: '', dropMeters: '' }],
    };
    const result = decodeWorkFile(encodeWorkFile(doc));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.cableRoutes).toEqual(doc.cableRoutes);
  });
});

describe('사유 없는 옛 manual 행 — 작업 파일 decode 경로(Task 6 보완 Task B)', () => {
  function docWithReasonlessManualRow(): QuoteDocument {
    const row = itemRow('r1', 'S1', { quantity: '2', price: '10000', laborPrice: '5000' });
    // overrideReason은 스키마상 optional이다 — Task B 이전에 저장된
    // 옛 파일을 흉내 낸다. itemRow 픽스처가 넣어 주는 사유를 지운다.
    const { overrideReason: _overrideReason, ...reasonless } = row as SheetRow & { type: 'item' };
    return makeDocument({
      systems: [system('S1', { indirect: [] })],
      rows: [reasonless as SheetRow],
    });
  }

  it('사유 없는 manual 행도 저장·복원은 거부하지 않는다 — 스키마가 사유를 강제하지 않는다', () => {
    const doc = docWithReasonlessManualRow();
    const result = decodeWorkFile(encodeWorkFile(doc));
    expect(result.ok).toBe(true);
  });

  it('복원한 문서를 계산하면 사유가 없어 여전히 차단한다 — 자동으로 승인하지 않는다', () => {
    const doc = docWithReasonlessManualRow();
    const result = decodeWorkFile(encodeWorkFile(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const snap = calculateQuote(result.document);
    expect(snap.blocking).toBe(true);
    expect(snap.warnings.some((w) => w.code === 'manual-labor-incomplete')).toBe(true);
  });

  it('사유를 입력하고 다시 계산하면 차단이 풀린다', () => {
    const doc = docWithReasonlessManualRow();
    const result = decodeWorkFile(encodeWorkFile(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fixed: QuoteDocument = {
      ...result.document,
      rows: result.document.rows.map((r) =>
        r.type === 'item' && r.rowId === 'r1' ? { ...r, overrideReason: '사유를 나중에 채움' } : r,
      ),
    };
    const snap = calculateQuote(fixed);
    expect(snap.blocking).toBe(false);
  });
});
