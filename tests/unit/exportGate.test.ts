import { describe, it, expect } from 'vitest';
import { exportGate, type WorkspaceStatus } from '@/app/workspace';
import type { PreparedQuote } from '@/export/variants/prepare';
import type { QuoteDocument } from '@/domain/quote/types';

/**
 * `exportGate` — 버튼 disabled 속성과 Excel 다운로드 핸들러가 **같은**
 * 판단 하나를 공유하는지 확인한다(2026-10-05 독립 검토 지적: 핸들러가
 * `status.kind`만 보고 `prepared.blocking`·`pendingCableEdit`는 버튼에만
 * 있었다 — 버튼이 비활성인 이유로 클릭이 안 된 것과 핸들러 자신이 막은
 * 것은 다른 사실인데 지금까지 구분 없이 섞여 있었다).
 */

function editingStatus(blocking: boolean): WorkspaceStatus {
  return {
    kind: 'editing',
    document: {} as QuoteDocument,
    prepared: { blocking } as unknown as PreparedQuote,
  };
}

describe('exportGate', () => {
  it('문서가 없으면(empty) 막는다', () => {
    const result = exportGate({ kind: 'empty' }, false);
    expect(result.allowed).toBe(false);
  });

  it('기준 충돌(basis-conflict) 상태면 막는다', () => {
    const result = exportGate({ kind: 'basis-conflict', document: {} as QuoteDocument, reason: '사유' }, false);
    expect(result.allowed).toBe(false);
  });

  it('prepared.blocking이면 editing 상태여도 막는다', () => {
    const result = exportGate(editingStatus(true), false);
    expect(result.allowed).toBe(false);
  });

  it('pendingCableEdit이면 blocking이 아니어도 막는다', () => {
    const result = exportGate(editingStatus(false), true);
    expect(result.allowed).toBe(false);
  });

  it('editing이고 blocking이 아니고 pendingCableEdit도 아니면 허용한다', () => {
    const result = exportGate(editingStatus(false), false);
    expect(result.allowed).toBe(true);
  });
});
