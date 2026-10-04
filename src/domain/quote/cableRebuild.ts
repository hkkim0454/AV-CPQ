import type { QuoteDocument, SheetRow } from './types';

export interface CableRebuildConflict {
  kind: 'manual-change' | 'topology-change' | 'mixed-deletion' | 'removed-manual-row';
  rowIds: string[];
  message: string;
}
export interface CableRebuildChange {
  kind: 'added' | 'updated' | 'removed' | 'preserved-deletion';
  rowIds: string[];
}
export interface CableRebuildResult {
  /** 검토용 제안이다. canApply가 false이면 문서에 적용하지 않는다. */
  rows: SheetRow[];
  conflicts: CableRebuildConflict[];
  changes: CableRebuildChange[];
  canApply: boolean;
  /** 다음 대조의 자동 기준. 수동 값은 넣지 않으며 삭제 유지 행도 보존한다. */
  nextBaselineRows: SheetRow[];
}

const metadata = new Set(['rowId', 'sourceCableMembers', 'sourceCableKey', 'sourceEdgeIds']);
const productFields = new Set(['sku', 'productId', 'name', 'specification', 'unit', 'sellingUnitPrice', 'laborMode', 'laborMappingId', 'manualLaborUnitPrice']);
const record = (row: SheetRow) => row as unknown as Record<string, unknown>;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function changedFields(a: SheetRow, b: SheetRow): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter(key => !metadata.has(key) && !equal(record(a)[key], record(b)[key]));
}
function role(row: SheetRow): string {
  return JSON.stringify([row.systemId, row.type === 'item' ? row.ruleInstanceId ?? 'cable' : row.kind]);
}
function members(row: SheetRow): string[] {
  return row.type === 'item' ? [...new Set(row.sourceCableMembers ?? [])].sort() : [];
}
function related(a: SheetRow, b: SheetRow): boolean {
  if (role(a) !== role(b)) return false;
  const am = members(a), bm = members(b);
  if (am.length === 0 || bm.length === 0) return am.length === 0 && bm.length === 0;
  return am.some(member => bm.includes(member));
}
function sameIdentity(a: SheetRow, b: SheetRow): boolean {
  return role(a) === role(b) && equal(members(a), members(b));
}

/** 자동 생성 블록만 대조한다. 원본·현재 문서·기준 행을 변경하지 않는다. */
export function rebuildCableRows(
  document: QuoteDocument,
  previousAutomaticRows: readonly SheetRow[],
  nextAutomaticRows: readonly SheetRow[],
  options: { resetRowIds?: readonly string[] } = {},
): CableRebuildResult {
  const reset = new Set(options.resetRowIds ?? []);
  const previousIds = new Set(previousAutomaticRows.map(row => row.rowId));
  const currentById = new Map(document.rows.map(row => [row.rowId, row]));
  const conflicts: CableRebuildConflict[] = [];
  const changes: CableRebuildChange[] = [];
  const generated: SheetRow[] = [];
  const nextBaselineRows: SheetRow[] = [];
  const assignedIds = new Set<string>();
  const usedIds = new Set([...document.rows.map(row => row.rowId), ...previousIds]);
  const conflict = (kind: CableRebuildConflict['kind'], rows: readonly SheetRow[], message: string) => {
    conflicts.push({ kind, rowIds: rows.map(row => row.rowId), message });
  };
  const allocate = (row: SheetRow, preserveId = false): SheetRow => {
    let id = row.rowId;
    if (preserveId && previousIds.has(id) && !assignedIds.has(id)) usedIds.delete(id);
    let suffix = 1;
    while (usedIds.has(id)) id = `${row.rowId}-rebuilt-${suffix++}`;
    usedIds.add(id);
    assignedIds.add(id);
    return id === row.rowId ? row : { ...row, rowId: id };
  };

  for (const next of nextAutomaticRows) {
    const prior = previousAutomaticRows.filter(row => related(row, next));
    const deleted = prior.filter(row => !currentById.has(row.rowId) && !reset.has(row.rowId));
    const nextMembers = members(next);
    const deletedMembers = new Set(deleted.flatMap(members));
    const whollyDeleted = deleted.length > 0 && (nextMembers.length === 0
      ? deleted.length === prior.length
      : nextMembers.every(member => deletedMembers.has(member)));
    if (whollyDeleted) {
      const same = deleted.find(row => sameIdentity(row, next));
      nextBaselineRows.push(allocate(same === undefined ? next : { ...next, rowId: same.rowId }, same !== undefined));
      changes.push({ kind: 'preserved-deletion', rowIds: deleted.map(row => row.rowId) });
      continue;
    }
    if (deleted.length > 0) conflict('mixed-deletion', prior, '삭제한 구간과 남긴 구간이 합쳐집니다. 삭제 상태를 확인해야 합니다.');

    const old = prior[0];
    const oneToOne = prior.length === 1 && old !== undefined && sameIdentity(old, next)
      && nextAutomaticRows.filter(row => related(old, row)).length === 1;
    if (oneToOne && old !== undefined) {
      const current = currentById.get(old.rowId);
      let proposed: SheetRow = { ...next, rowId: old.rowId };
      if (current !== undefined && !reset.has(old.rowId)) {
        const manual = changedFields(old, current);
        const automatic = changedFields(old, next);
        const productChanged = automatic.some(field => productFields.has(field));
        const conflicting = manual.filter(field =>
          ((field === 'quantity' || productFields.has(field)) && automatic.length > 0)
          || ((field === 'remark' || field === 'internalDescription') && productChanged)
          || (field !== 'remark' && field !== 'internalDescription' && automatic.includes(field)));
        if (conflicting.length > 0) conflict('manual-change', [old], `직접 수정한 값과 재산출 결과가 겹칩니다: ${conflicting.join(', ')}`);
        // 충돌이 있어도 제안에서는 수동 값을 남긴다. reset을 선택한 뒤 다시 산출한다.
        const merged = { ...proposed } as unknown as Record<string, unknown>;
        for (const field of manual) {
          if (Object.prototype.hasOwnProperty.call(current, field)) merged[field] = record(current)[field];
          else delete merged[field];
        }
        proposed = merged as unknown as SheetRow;
      }
      proposed = allocate(proposed, true);
      generated.push(proposed);
      nextBaselineRows.push({ ...next, rowId: proposed.rowId });
      if (!equal(current, proposed)) changes.push({ kind: 'updated', rowIds: [old.rowId] });
      continue;
    }
    const edited = prior.filter(row => {
      const current = currentById.get(row.rowId);
      return current !== undefined && !reset.has(row.rowId) && changedFields(row, current).length > 0;
    });
    if (edited.length > 0) conflict('topology-change', edited, '직접 수정한 케이블 행이 합쳐지거나 나뉩니다. 수정값 처리 방법을 확인해야 합니다.');
    const added = allocate(next);
    generated.push(added);
    nextBaselineRows.push(added);
    changes.push({ kind: 'added', rowIds: [generated[generated.length - 1]!.rowId] });
  }
  for (const previous of previousAutomaticRows) {
    if (nextAutomaticRows.some(row => related(previous, row))) {
      if (currentById.has(previous.rowId) && !generated.some(row => row.rowId === previous.rowId)) {
        changes.push({ kind: 'removed', rowIds: [previous.rowId] });
      }
      continue;
    }
    const current = currentById.get(previous.rowId);
    if (current !== undefined && !reset.has(previous.rowId) && changedFields(previous, current).length > 0) {
      conflict('removed-manual-row', [previous], '직접 수정한 행이 새 산출 결과에서 사라집니다.');
    }
    changes.push({ kind: 'removed', rowIds: [previous.rowId] });
  }

  const rows: SheetRow[] = [];
  let inserted = false;
  for (const row of document.rows) {
    if (previousIds.has(row.rowId)) {
      if (!inserted) { rows.push(...generated); inserted = true; }
    } else rows.push(row);
  }
  if (!inserted) rows.push(...generated);
  return { rows, conflicts, changes, canApply: conflicts.length === 0, nextBaselineRows };
}
