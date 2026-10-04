import { useEffect, useState } from 'react';
import type { Catalog } from '../../data/catalog/load';
import type { QuoteDocument } from '../../domain/quote/types';
import { calcRouteMeters, type RouteInput } from '../../domain/quote/installation';
import { regenerateCables } from '../../import/diagram/regenerateCables';
import { rebuildCableRows } from '../../domain/quote/cableRebuild';

export function CableRoutePanel({ document, catalog, onApply, onPending }: {
  document: QuoteDocument;
  catalog: Catalog;
  onApply(expected: QuoteDocument, routes: readonly RouteInput[], resetRowIds: readonly string[]): void;
  onPending(pending: boolean): void;
}) {
  const [drafts, setDrafts] = useState<readonly RouteInput[]>(document.cableRoutes ?? []);
  const [preview, setPreview] = useState(false);
  const [resetIds, setResetIds] = useState<readonly string[]>([]);
  useEffect(() => {
    setDrafts(document.cableRoutes ?? []);
    setPreview(false);
    setResetIds([]);
    onPending(false);
  }, [document.cableSource, document.cableRoutes, onPending]);
  // 다른 견적 편집은 거리 초안을 취소하지 않는다. 이전 미리보기와
  // 덮어쓰기 승인만 무효화하고 새 문서 상태에서 다시 대조한다.
  useEffect(() => { setPreview(false); setResetIds([]); }, [document]);
  if (document.cableSource === undefined || document.cableSource.edges.length === 0) return null;
  const source = document.cableSource;
  const systemId = document.systems[0]!.systemId;
  const generated = preview ? regenerateCables(document, catalog, drafts) : undefined;
  const comparison = generated === undefined ? undefined : rebuildCableRows(document, document.cableBaseline ?? [], generated.rows, { resetRowIds: resetIds });
  // 확인 체크 후에도 충돌 설명을 유지한다.
  const initialComparison = generated === undefined ? undefined : rebuildCableRows(document, document.cableBaseline ?? [], generated.rows);
  const displayConflicts = [...new Map((initialComparison?.conflicts ?? []).map(conflict =>
    [JSON.stringify([conflict.kind, [...conflict.rowIds].sort()]), conflict])).values()];

  function update(edgeId: string, patch: Partial<RouteInput>) {
    setDrafts(current => {
      const existing = current.find(route => route.edgeId === edgeId) ?? { edgeId, systemId, source: 'measured-route' as const };
      return [...current.filter(route => route.edgeId !== edgeId), { ...existing, ...patch }];
    });
    setPreview(false);
    setResetIds([]);
    onPending(true);
  }
  function cancel() {
    setDrafts(document.cableRoutes ?? []);
    setPreview(false);
    setResetIds([]);
    onPending(false);
  }
  return <section className="q-card q-route-panel">
    <h3>케이블 구간 거리</h3>
    <p className="q-muted">측정 경로는 (수평+입상+입하)×1.3입니다. 확인된 총길이는 그대로 씁니다. 입력하지 않은 구간은 구성도 원본 값을 유지합니다.</p>
    {source.edges.map(edge => {
      const route = drafts.find(value => value.edgeId === edge.id);
      const sourceKind = route?.source ?? 'measured-route';
      const meters = route === undefined ? undefined : calcRouteMeters(route);
      const nodeName = (id: string) => source.nodes.find(node => node.id === id)?.data.name ?? id;
      const field = (key: 'horizontalMeters' | 'riseMeters' | 'dropMeters' | 'confirmedTotalMeters', label: string) =>
        <label className="q-grade-option">{label}<input aria-label={`${edge.id} ${label}`} inputMode="decimal"
          value={route?.[key] ?? ''} onChange={event => update(edge.id, { [key]: event.target.value })} /></label>;
      return <fieldset key={edge.id} className="q-card">
        <legend>{edge.id}: {nodeName(edge.source)} → {nodeName(edge.target)}</legend>
        <label>거리 기준 <select aria-label={`${edge.id} 거리 기준`} value={sourceKind}
          onChange={event => update(edge.id, { source: event.target.value as RouteInput['source'] })}>
          <option value="measured-route">측정 경로</option><option value="confirmed-total">확인된 총길이</option>
        </select></label>
        <div className="q-grade">{sourceKind === 'confirmed-total' ? field('confirmedTotalMeters', '확인된 총길이(m)') : <>
          {field('horizontalMeters', '수평거리(m)')}{field('riseMeters', '입상 높이(m)')}{field('dropMeters', '입하 높이(m)')}
        </>}</div>
        <p>{route === undefined ? '거리 미입력 — 원본 유지' : meters === undefined ? '거리 입력을 확인하세요. 미완성·음수·잘못된 숫자는 확정할 수 없습니다.' :
          sourceKind === 'confirmed-total' ? `확인된 총길이 ${meters}m (추가 보정 없음)` :
            `(${route.horizontalMeters}m + ${route.riseMeters}m + ${route.dropMeters}m) × 1.3 = ${meters}m`}</p>
      </fieldset>;
    })}
    <button type="button" className="q-button" onClick={() => setPreview(true)}>케이블 재산출 미리보기</button>
    {generated !== undefined && comparison !== undefined && <div className="q-notice">
      <h4>변경 예정 케이블·커넥터</h4>
      <ul>{comparison.rows.filter(row => comparison.nextBaselineRows.some(baseline => baseline.rowId === row.rowId))
        .map(row => row.type === 'item' && <li key={row.rowId}>{row.name} / {row.specification} / {row.quantity} {row.unit}</li>)}</ul>
      {comparison.changes.some(change => change.kind === 'preserved-deletion') && <p>직접 삭제한 케이블 행은 삭제 상태를 유지합니다.</p>}
      {displayConflicts.map((conflict, index) => <div key={index}>
        <p>{conflict.message}</p>
        <ul>{conflict.rowIds.map(id => {
          const row = document.rows.find(value => value.rowId === id);
          return <li key={id}>{row?.type === 'item' ? `${row.name} ${row.specification} / 현재 수량 ${row.quantity} / ${row.internalDescription ?? ''} / ${row.remark}` : '삭제한 행'}</li>;
        })}</ul>
        <label><input type="checkbox" checked={conflict.rowIds.every(id => resetIds.includes(id))}
          onChange={event => setResetIds(current => event.target.checked ? [...new Set([...current, ...conflict.rowIds])] : current.filter(id => !conflict.rowIds.includes(id)))} />
          이 항목의 수동 수정을 버리고 표시된 자동 산출값을 사용합니다
        </label>
      </div>)}
      {generated.warnings.map((warning, index) => <p key={index}>{warning.message}</p>)}
      <button type="button" className="q-button q-primary" disabled={!comparison.canApply}
        onClick={() => onApply(document, drafts, resetIds)}>재산출 적용</button>
      <button type="button" className="q-button" onClick={cancel}>재산출 취소</button>
    </div>}
  </section>;
}
