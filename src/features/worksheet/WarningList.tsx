/**
 * 확인 경고 목록 (계획 2026-10-04-quote-workspace-ui Task 2).
 *
 * 구성도/품셈/계산 경고를 전부 보여준다. 일괄 지우기는 없다 — 실제
 * 값을 해결해야 경고가 해소된다(계획 §3).
 *
 * 미해결 모델/옵션(`device-not-in-catalog`/`device-ambiguous-match`)은
 * 여기서 바로 해결할 수 있다. 후보(`candidates`, 모델이 여러 제품에
 * 걸린 경우)가 있으면 그 목록에서 고르고, 없으면 카탈로그를 검색해
 * 고른다 — 둘 다 **사람이 SKU 하나를 직접 고르는** 것이지 추측으로
 * 채우지 않는다. 경고를 지우는 것은 "해결 처리" 버튼이 아니라, 고른
 * 행이 실제로 `sku`와 `sellingUnitPrice`를 둘 다 갖게 됐는지를 문서에서
 * 다시 확인한 결과다 — 그래서 실행취소로 문서가 되돌아가면 이 경고도
 * 저절로 다시 뜬다(별도 "해결됨" 상태를 안 둔다).
 */
import { useState } from 'react';
import type { Catalog } from '../../data/catalog/load';
import type { ImportWarning } from '../../import/diagram/devices';
import type { QuoteDocument } from '../../domain/quote/types';

interface WarningListProps {
  warnings: readonly ImportWarning[];
  document: QuoteDocument;
  catalog: Catalog;
  onResolve(nodeId: string, sku: string): void;
}

function isResolved(document: QuoteDocument, nodeId: string): boolean {
  const row = document.rows.find(
    (r) => r.type === 'item' && (r.sourceNodeIds?.includes(nodeId) ?? false),
  );
  return row !== undefined && row.type === 'item' && row.sku !== undefined && row.sellingUnitPrice !== undefined;
}

function CandidateList({
  nodeId,
  candidates,
  catalog,
  onResolve,
}: {
  nodeId: string;
  candidates: readonly string[];
  catalog: Catalog;
  onResolve(nodeId: string, sku: string): void;
}) {
  const bySku = new Map(catalog.products.map((p) => [p.sku, p]));
  return (
    <ul className="q-resolve-candidates">
      {candidates.map((sku) => {
        const product = bySku.get(sku);
        return (
          <li key={sku}>
            <span>
              {sku}
              {product !== undefined ? ` — ${product.quoteName}` : ''}
            </span>
            <button type="button" className="q-button" onClick={() => onResolve(nodeId, sku)}>
              선택
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SearchResolve({
  nodeId,
  catalog,
  onResolve,
}: {
  nodeId: string;
  catalog: Catalog;
  onResolve(nodeId: string, sku: string): void;
}) {
  const [query, setQuery] = useState('');
  const trimmed = query.trim().toLowerCase();
  const matches =
    trimmed === ''
      ? []
      : catalog.products
          .filter((p) => p.quoteName.toLowerCase().includes(trimmed) || p.sku.toLowerCase().includes(trimmed))
          .slice(0, 10);

  return (
    <div className="q-resolve-search">
      <input
        aria-label={`${nodeId} 연결할 품목 검색`}
        placeholder="품명 또는 SKU로 검색"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {/* 후보가 없는 경우 추측하지 않는다 — 검색 결과가 없으면 미해결로 그냥 둔다. */}
      {matches.length > 0 && (
        <ul className="q-resolve-candidates">
          {matches.map((product) => (
            <li key={product.sku}>
              <span>
                {product.quoteName} ({product.sku})
              </span>
              <button type="button" className="q-button" onClick={() => onResolve(nodeId, product.sku)}>
                연결
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function isDeviceWarning(warning: ImportWarning): boolean {
  return warning.code === 'device-not-in-catalog' || warning.code === 'device-ambiguous-match';
}

export function WarningList({ warnings, document, catalog, onResolve }: WarningListProps) {
  // 실제로 해소된 미해결 모델/옵션 경고는 여기서만 숨긴다 — 경고 자체를
  // 지우지 않으므로(별도 "해결됨" 상태가 없다), 실행취소로 문서가
  // 되돌아가면 이 필터가 다시 평가되어 저절로 다시 뜬다.
  const visible = warnings.filter(
    (w) => !(isDeviceWarning(w) && w.nodeId !== undefined && isResolved(document, w.nodeId)),
  );
  if (visible.length === 0) return null;

  return (
    <div className="q-card q-warning-list" role="alert">
      <h3>확인이 필요합니다 ({visible.length}건)</h3>
      <ul>
        {visible.map((warning, index) => {
          const resolvable = isDeviceWarning(warning) && warning.nodeId !== undefined;
          return (
            <li key={`${warning.code}-${warning.nodeId ?? warning.edgeId ?? index}`}>
              <strong>{warning.blocking ? '확정 차단' : '확인'}</strong> {warning.message}
              {(warning.nodeId !== undefined || warning.edgeId !== undefined) && (
                <span className="q-muted"> ({warning.nodeId ?? warning.edgeId})</span>
              )}
              {resolvable &&
                (warning.candidates !== undefined && warning.candidates.length > 0 ? (
                  <CandidateList
                    nodeId={warning.nodeId!}
                    candidates={warning.candidates}
                    catalog={catalog}
                    onResolve={onResolve}
                  />
                ) : (
                  <SearchResolve nodeId={warning.nodeId!} catalog={catalog} onResolve={onResolve} />
                ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
