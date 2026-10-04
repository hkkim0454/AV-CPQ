import { describe, expect, it } from 'vitest';
import { rebuildCableRows } from '@/domain/quote/cableRebuild';
import { itemRow, makeDocument, system } from '../fixtures/document';
import type { SheetRow } from '@/domain/quote/types';

function cable(id: string, members: string[], extra: object = {}): SheetRow {
  return { ...itemRow(id, 'S1', { quantity: '1', price: '100', name: '케이블' }), sourceCableMembers: members,
    sku: 'SKU', ruleInstanceId: 'cable', ...extra } as SheetRow;
}
const doc = (rows: SheetRow[]) => makeDocument({ systems: [system('S1', { indirect: [] })], rows });

describe('케이블 재산출 대조', () => {
  it('1대1은 ID와 수동 비고를 유지하며 자동 수량을 갱신한다', () => {
    const old = cable('old', ['a']);
    const result = rebuildCableRows(doc([{ ...old, remark: '메모' }]), [old], [cable('new', ['a'], { quantity: '2' })]);
    expect(result.canApply).toBe(true);
    expect(result.rows[0]).toMatchObject({ rowId: 'old', quantity: '2', remark: '메모' });
  });
  it('수동 수량과 자동 수량 변경은 명시적 초기화 없이는 충돌한다', () => {
    const old = cable('old', ['a']);
    const current = doc([cable('old', ['a'], { quantity: '7' })]);
    const next = [cable('new', ['a'], { quantity: '2' })];
    expect(rebuildCableRows(current, [old], next).canApply).toBe(false);
    expect(rebuildCableRows(current, [old], next, { resetRowIds: ['old'] }).rows[0]).toMatchObject({ quantity: '2', rowId: 'old' });
  });
  it('수동 제품을 자동 결과에 덮지 않고 제품 변경 시 충돌한다', () => {
    const old = cable('old', ['a']);
    const current = doc([cable('old', ['a'], { sku: 'MANUAL' })]);
    expect(rebuildCableRows(current, [old], [cable('new', ['a'], { sku: 'NEXT' })]).canApply).toBe(false);
  });
  it('수동 수정이 있는 병합·분할은 충돌한다', () => {
    const old = cable('old', ['a', 'b']);
    expect(rebuildCableRows(doc([{ ...old, remark: '메모' }]), [old], [cable('a', ['a']), cable('b', ['b'])]).canApply).toBe(false);
  });
  it('삭제한 행의 분할 결과는 다시 생기지 않고 혼합 병합은 차단한다', () => {
    const deleted = cable('d', ['a', 'b']);
    const live = cable('l', ['c']);
    expect(rebuildCableRows(doc([]), [deleted], [cable('a', ['a']), cable('b', ['b'])]).rows).toEqual([]);
    expect(rebuildCableRows(doc([live]), [deleted, live], [cable('all', ['a', 'b', 'c'])]).canApply).toBe(false);
  });
  it('무관한 행과 그 순서는 보존하고 생성 블록만 교체한다', () => {
    const old = cable('old', ['a']);
    const before = itemRow('device', 'S1', { quantity: '1' });
    const after = itemRow('manual', 'S1', { quantity: '3' });
    const result = rebuildCableRows(doc([before, old, after]), [old], [cable('new', ['a'], { quantity: '2' })]);
    expect(result.rows.map(row => row.rowId)).toEqual(['device', 'old', 'manual']);
    expect(result.rows[0]).toBe(before);
    expect(result.rows[2]).toBe(after);
  });
  it('구성원이 없는 커넥터는 규칙 ID로 연결한다', () => {
    const old = cable('old', [], { ruleInstanceId: 'connector' });
    expect(rebuildCableRows(doc([old]), [old], [cable('new', [], { ruleInstanceId: 'connector', quantity: '2' })]).rows[0]).toMatchObject({ rowId: 'old', quantity: '2' });
  });
  it('자동 비고가 바뀌어도 제품이 같으면 수동 설명과 비고를 보존한다', () => {
    const old = cable('old', ['a'], { internalDescription: '자동 설명', remark: '이전 구간' });
    const current = doc([cable('old', ['a'], { internalDescription: '수동 설명', remark: '수동 비고' })]);
    const result = rebuildCableRows(current, [old], [cable('new', ['a'], { internalDescription: '새 자동 설명', remark: '새 구간', quantity: '2' })]);
    expect(result.canApply).toBe(true);
    expect(result.rows[0]).toMatchObject({ internalDescription: '수동 설명', remark: '수동 비고', quantity: '2' });
  });
  it('삭제를 명시적으로 초기화하면 재산출 행을 복구한다', () => {
    const old = cable('old', ['a']);
    const result = rebuildCableRows(doc([]), [old], [cable('new', ['a'])], { resetRowIds: ['old'] });
    expect(result.canApply).toBe(true);
    expect(result.rows).toHaveLength(1);
  });
  it('분할된 행의 추가뿐 아니라 이전 행 제거도 변경 목록에 남긴다', () => {
    const old = cable('old', ['a', 'b']);
    const result = rebuildCableRows(doc([old]), [old], [cable('a', ['a']), cable('b', ['b'])]);
    expect(result.canApply).toBe(true);
    expect(result.changes).toContainEqual({ kind: 'removed', rowIds: ['old'] });
  });
  it('새 행의 임시 ID가 뒤쪽 1대1 행과 같아도 기존 ID를 빼앗지 않는다', () => {
    const old = cable('stable', ['b']);
    const result = rebuildCableRows(doc([old]), [old], [cable('stable', ['a']), cable('temp', ['b'])]);
    expect(result.rows[0]!.rowId).not.toBe('stable');
    expect(result.rows[1]!.rowId).toBe('stable');
  });
  it('다음 자동 기준에는 안정 ID를 적되 수동 비고를 섞지 않는다', () => {
    const old = cable('old', ['a']);
    const current = doc([{ ...old, remark: '수동 비고' }]);
    const result = rebuildCableRows(current, [old], [cable('new', ['a'], { quantity: '2' })]);
    expect(result.nextBaselineRows[0]).toMatchObject({ rowId: 'old', remark: '', quantity: '2' });
    const repeated = rebuildCableRows(doc(result.rows), result.nextBaselineRows, [cable('new', ['a'], { quantity: '3' })]);
    expect(repeated.canApply).toBe(true);
    expect(repeated.rows[0]).toMatchObject({ rowId: 'old', remark: '수동 비고', quantity: '3' });
  });
  it('삭제된 병합 행이 분할된 뒤 다음 재산출에서도 삭제 상태를 유지한다', () => {
    const old = cable('old', ['a', 'b']);
    const next = [cable('a', ['a']), cable('b', ['b'])];
    const first = rebuildCableRows(doc([]), [old], next);
    expect(first.nextBaselineRows).toHaveLength(2);
    const second = rebuildCableRows(doc(first.rows), first.nextBaselineRows, next);
    expect(second.rows).toEqual([]);
    expect(second.nextBaselineRows.map(row => row.rowId)).toEqual(first.nextBaselineRows.map(row => row.rowId));
  });
});
