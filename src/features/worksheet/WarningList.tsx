/**
 * 확인 경고 목록 (계획 2026-10-04-quote-workspace-ui Task 2).
 *
 * `warnings`는 이미 **지금 문서 상태로 걸러진** 유효한 경고만 받는다
 * (`computeActiveWarnings`, workspace의 `prepareNow`가 적용해
 * `prepared.importWarnings`로 내려준다) — 여기서 다시 거르지 않는다.
 * 표시와 `prepared.blocking`(출력 차단)이 같은 집합을 보게 하려고
 * 그 판단을 한 곳(workspace)에만 둔다.
 *
 * 일괄 지우기는 없다 — 실제 값을 해결해야 경고가 해소된다(계획 §3).
 * 미해결 모델(`device-not-in-catalog`/`device-ambiguous-match`)은
 * 후보가 있으면 그 목록에서, 없으면 카탈로그 검색으로 고른다. 옵션
 * 카드 경고(`optionId`가 있는 경고 — `option-definition-missing`과
 * 옵션 자체의 미등록·모호 매칭)는 `onResolveOption`으로 **본체와
 * 분리해** 그 옵션 행만 바꾼다.
 */
import { useState } from 'react';
import type { Catalog } from '../../data/catalog/load';
import type { ImportWarning } from '../../import/diagram/devices';

interface WarningListProps {
  warnings: readonly ImportWarning[];
  catalog: Catalog;
  onResolveDevice(nodeId: string, sku: string): void;
  onResolveOption(optionId: string, sku: string): void;
}

function CandidateList({
  candidates,
  catalog,
  onSelect,
}: {
  candidates: readonly string[];
  catalog: Catalog;
  onSelect(sku: string): void;
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
            <button type="button" className="q-button" onClick={() => onSelect(sku)}>
              선택
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SearchResolve({
  label,
  catalog,
  onSelect,
}: {
  label: string;
  catalog: Catalog;
  onSelect(sku: string): void;
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
        aria-label={label}
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
              <button type="button" className="q-button" onClick={() => onSelect(product.sku)}>
                연결
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WarningList({ warnings, catalog, onResolveDevice, onResolveOption }: WarningListProps) {
  if (warnings.length === 0) return null;

  return (
    <div className="q-card q-warning-list" role="alert">
      <h3>확인이 필요합니다 ({warnings.length}건)</h3>
      <ul>
        {warnings.map((warning, index) => {
          // optionId가 있으면 코드와 무관하게 옵션 경고다 — 본체와
          // 완전히 분리된 해소 경로(onResolveOption)를 쓴다. 같은
          // 노드라도 본체 행과 sourceNodeIds를 공유할 수 있어 코드만으로는
          // 구분이 안 된다 — optionId 유무로만 가른다.
          const isOption = warning.optionId !== undefined;
          const isDevice =
            !isOption &&
            (warning.code === 'device-not-in-catalog' || warning.code === 'device-ambiguous-match') &&
            warning.nodeId !== undefined;

          return (
            <li key={`${warning.code}-${warning.nodeId ?? warning.edgeId ?? index}-${warning.optionId ?? ''}`}>
              <strong>{warning.blocking ? '확정 차단' : '확인'}</strong> {warning.message}
              {(warning.nodeId !== undefined || warning.edgeId !== undefined) && (
                <span className="q-muted"> ({warning.nodeId ?? warning.edgeId})</span>
              )}
              {isOption &&
                (warning.candidates !== undefined && warning.candidates.length > 0 ? (
                  <CandidateList
                    candidates={warning.candidates}
                    catalog={catalog}
                    onSelect={(sku) => onResolveOption(warning.optionId!, sku)}
                  />
                ) : (
                  <SearchResolve
                    label={`${warning.optionId} 연결할 품목 검색`}
                    catalog={catalog}
                    onSelect={(sku) => onResolveOption(warning.optionId!, sku)}
                  />
                ))}
              {isDevice &&
                (warning.candidates !== undefined && warning.candidates.length > 0 ? (
                  <CandidateList
                    candidates={warning.candidates}
                    catalog={catalog}
                    onSelect={(sku) => onResolveDevice(warning.nodeId!, sku)}
                  />
                ) : (
                  <SearchResolve
                    label={`${warning.nodeId} 연결할 품목 검색`}
                    catalog={catalog}
                    onSelect={(sku) => onResolveDevice(warning.nodeId!, sku)}
                  />
                ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
