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
 *
 * 배관 경고(`installationSystemId`가 있는 경고 —
 * `domain/quote/installation.ts`)는 **일반 카탈로그 검색을 보여주지
 * 않는다.** 그 시스템의 현재 배관 종류에 맞는 후보만 고를 수 있다 —
 * CD관처럼 후보가 0건이면 고를 것이 아예 없다(차단). 품명 검색으로
 * 아무 제품이나 붙여 그 차단을 우회하지 못하게 하는 것이 설계
 * 의도다(독립 검토 지적). `onResolveConduit`도 같은 이유로 `nodeId`가
 * 아니라 `installationSystemId`로 호출한다 — 해소 함수 자체가
 * 도메인 경계에서 묶음을 한 번 더 검증한다.
 *
 * 케이블 경고(`optionId`·`installationSystemId`가 없고 `edgeId`만
 * 있는 `cable-item-unresolved`)는 `onResolveCable`로 해소한다
 * (`sourceEdgeIds`로 그 구간 행만 찾는다 — `cables.ts`). 후보
 * (`cableCandidates`)를 **품셈 묶음(제조사별 종류)별로 묶어** 보여준다
 * — 사람이 종류와 길이를 한눈에 보고 고를 수 있어야 한다는 요청에
 * 따른 것이다.
 */
import { useState } from 'react';
import type { Catalog, CatalogProduct } from '../../data/catalog/load';
import type { ImportWarning } from '../../import/diagram/devices';

interface WarningListProps {
  warnings: readonly ImportWarning[];
  catalog: Catalog;
  onResolveDevice(nodeId: string, sku: string): void;
  onResolveOption(optionId: string, sku: string): void;
  onResolveConduit(systemId: string, sku: string): void;
  onResolveCable(edgeId: string, sku: string, sourceCableKey?: string): void;
}

function CandidateList({
  candidates,
  catalog,
  onSelect,
  groupByFamily = false,
}: {
  candidates: readonly string[];
  catalog: Catalog;
  onSelect(sku: string): void;
  /** 제조사별 종류(품셈 묶음)별로 묶어 "아래로 펼쳐진" 목록을 보여준다. */
  groupByFamily?: boolean;
}) {
  const bySku = new Map(catalog.products.map((p) => [p.sku, p]));

  if (!groupByFamily) {
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

  const byGroup = new Map<string, CatalogProduct[]>();
  for (const sku of candidates) {
    const product = bySku.get(sku);
    if (product === undefined) continue;
    const group = product.options['group'] ?? '기타';
    const existing = byGroup.get(group);
    if (existing === undefined) byGroup.set(group, [product]);
    else existing.push(product);
  }

  return (
    <div className="q-resolve-candidates-grouped">
      {[...byGroup.entries()].map(([group, products]) => (
        <div key={group} className="q-resolve-candidate-group">
          <h4>{group}</h4>
          <ul className="q-resolve-candidates">
            {products.map((product) => (
              <li key={product.sku}>
                <span>
                  {product.quoteSpec !== '' ? product.quoteSpec : product.quoteName} ({product.sku})
                </span>
                <button type="button" className="q-button" onClick={() => onSelect(product.sku)}>
                  선택
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
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

export function WarningList({
  warnings,
  catalog,
  onResolveDevice,
  onResolveOption,
  onResolveConduit,
  onResolveCable,
}: WarningListProps) {
  if (warnings.length === 0) return null;

  return (
    <div className="q-card q-warning-list" role="alert">
      <h3>확인이 필요합니다 ({warnings.length}건)</h3>
      <ul>
        {warnings.map((warning, index) => {
          // installationSystemId가 있으면 배관 경고다 — 일반 검색을
          // 보여주지 않는다(위 docstring 참고). optionId가 있으면
          // 코드와 무관하게 옵션 경고다 — 본체와 완전히 분리된 해소
          // 경로(onResolveOption)를 쓴다. 같은 노드라도 본체 행과
          // sourceNodeIds를 공유할 수 있어 코드만으로는 구분이 안 된다
          // — optionId 유무로만 가른다. 케이블 경고는 노드도 시스템도
          // 아니고 edgeId만 있다 — 그걸로 가른다.
          const isConduit = warning.installationSystemId !== undefined;
          const isOption = !isConduit && warning.optionId !== undefined;
          const isCable =
            !isConduit && !isOption && warning.code === 'cable-item-unresolved' && warning.edgeId !== undefined;
          const isDevice =
            !isConduit &&
            !isOption &&
            !isCable &&
            (warning.code === 'device-not-in-catalog' || warning.code === 'device-ambiguous-match') &&
            warning.nodeId !== undefined;

          return (
            <li key={`${warning.code}-${warning.nodeId ?? warning.edgeId ?? index}-${warning.optionId ?? ''}`}>
              <strong>{warning.blocking ? '확정 차단' : '확인'}</strong> {warning.message}
              {(warning.nodeId !== undefined || warning.edgeId !== undefined) && (
                <span className="q-muted"> ({warning.nodeId ?? warning.edgeId})</span>
              )}
              {isConduit && warning.candidates !== undefined && warning.candidates.length > 0 && (
                <CandidateList
                  candidates={warning.candidates}
                  catalog={catalog}
                  onSelect={(sku) => onResolveConduit(warning.installationSystemId!, sku)}
                />
              )}
              {isCable &&
                (warning.candidates !== undefined && warning.candidates.length > 0 ? (
                  <CandidateList
                    candidates={warning.candidates}
                    catalog={catalog}
                    groupByFamily
                    onSelect={(sku) => onResolveCable(warning.edgeId!, sku, warning.sourceCableKey)}
                  />
                ) : warning.requiredCableMeters !== undefined ? (
                  <p>필요 거리 {warning.requiredCableMeters}m를 충족하는 승인 품목이 없습니다. 거리 또는 구성도 케이블 종류를 확인하세요.</p>
                ) : (
                  <SearchResolve
                    label={`${warning.edgeId} 연결할 품목 검색`}
                    catalog={catalog}
                    onSelect={(sku) => onResolveCable(warning.edgeId!, sku, warning.sourceCableKey)}
                  />
                ))}
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
