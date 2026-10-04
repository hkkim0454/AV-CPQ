import { describe, expect, it } from 'vitest';
import { decodeWorkFile, encodeWorkFile, WORK_FILE_SCHEMA_VERSION } from '@/services/files/workFile';
import { makeDocument, itemRow, system } from '../fixtures/document';
import type { QuoteDocument } from '@/domain/quote/types';

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
