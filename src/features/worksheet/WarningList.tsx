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
 * (`cableCandidates`)를 사용자 확정 큰 분류별로 접어 보여준다.
 * 분류가 안 되거나 카탈로그에 없는 후보도 미분류에 남긴다.
 */
import { useEffect, useRef, useState } from 'react';
import { CandidateDetail } from '../catalog/CandidateDetail';
import type { Catalog } from '../../data/catalog/load';
import type { ImportWarning } from '../../import/diagram/devices';
import { isDescriptionOnlyCandidate, type ModelSearchCandidate } from '../../import/diagram/matchCatalog';
import { groupCableCandidates } from './cableCandidateCategories';
import { decideNavigation, identifyImportWarnings } from './reviewItems';

interface WarningListProps {
  warnings: readonly ImportWarning[];
  catalog: Catalog;
  onResolveDevice(nodeId: string, sku: string): void;
  onResolveOption(optionId: string, sku: string): void;
  onResolveConduit(systemId: string, sku: string): void;
  onResolveCable(edgeId: string, sku: string, sourceCableKey?: string): void;
  /** `catalog-item-removed` 전용. */
  onResolveRow(rowId: string, sku: string): void;
  /**
   * 확인 목록에서 온 이동 요청. 행 이동(`QuoteSheet`)과 **같은 계약**이다 —
   * 한쪽만 느슨하면 그쪽으로 오래된 요청이 새어 들어간다.
   *
   * `nonce` 로 한 번만 소비하고, 소비 직전과 스크롤·포커스 직전에
   * `sourcePrepared` 가 지금 결과와 같은 참조인지 본다.
   */
  navigation?: ImportNavigation | undefined;
  /** 지금 계산 결과 — 요청이 낡았는지 **참조 동일성**으로 가른다. */
  prepared?: unknown;
  /** 대상이 없거나 오래된 요청일 때 알린다. 다른 항목을 대신 열지 않는다. */
  onNavigationMissed?: ((message: string) => void) | undefined;
}

/** 구성도 경고로 가는 이동 요청. 목적지는 공유 식별자다. */
export interface ImportNavigation {
  warningId: string;
  sourcePrepared: unknown;
  nonce: number;
}

  /**
 * 4단계 모델명 검색이 올린 후보의 **근거** — 어느 칸에서 어떤 글자가 맞았는지다
 * (계획 2026-10-06 §5·§6). 설명 칸에서만 맞은 것은 *다른 제품의 부속품*일 수 있어
 * 경고를 함께 적는다. 금액만 보여주고 고르게 하지 않는다.
 */
function MatchEvidence({ candidate }: { candidate: ModelSearchCandidate }) {
  const label: Record<string, string> = {
    model: '모델',
    quoteSpec: '규격',
    quoteName: '품명',
    description: '설명',
  };
  const descriptionOnly = isDescriptionOnlyCandidate(candidate);
  return (
    <p className="q-muted">
      {candidate.matches.map((m, i) => (
        <span key={`${m.field}-${i}`}>
          {i > 0 ? ' · ' : ''}
          {label[m.field] ?? m.field} 칸에서 ‘{m.text}’
        </span>
      ))}
      {descriptionOnly && (
        <strong> ⚠ 설명 칸에서만 맞았습니다. 그 제품에 쓰는 다른 제품일 수 있습니다.</strong>
      )}
    </p>
  );
}

function CandidateList({
  candidates,
  catalog,
  onSelect,
  groupByCableCategory = false,
  evidence,
}: {
  candidates: readonly string[];
  catalog: Catalog;
  onSelect(sku: string): void;
  /** 케이블 후보만 사용자 확정 큰 분류별로 접어 보여준다. */
  groupByCableCategory?: boolean;
  /** 4단계 후보일 때만 있다. SKU 별 판단 근거다. */
  evidence?: readonly ModelSearchCandidate[];
}) {
  const bySku = new Map(catalog.products.map((p) => [p.sku, p]));
  const evidenceBySku = new Map((evidence ?? []).map((c) => [c.sku, c]));

  if (!groupByCableCategory) {
    return (
      <ul className="q-resolve-candidates">
        {candidates.map((sku) => {
          const product = bySku.get(sku);
          const found = evidenceBySku.get(sku);
          return (
            <li key={sku}>
              {product !== undefined ? (
                <CandidateDetail product={product} catalog={catalog} />
              ) : (
                <span>{sku}</span>
              )}
              {found !== undefined && <MatchEvidence candidate={found} />}
              <button type="button" className="q-button" onClick={() => onSelect(sku)}>
                선택
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="q-resolve-candidates-grouped">
      {groupCableCandidates(candidates, bySku).map(({ category, skus }) => (
        <details key={category} className="q-resolve-candidate-group">
          <summary>{category} ({skus.length}건)</summary>
          <ul className="q-resolve-candidates">
            {skus.map((sku) => {
              const product = bySku.get(sku);
              return (
                <li key={sku}>
                  {product !== undefined ? (
                    <div>
                      <CandidateDetail product={product} catalog={catalog} />
                      <div className="q-muted">묶음 {product.options['group'] ?? '미등록'}</div>
                    </div>
                  ) : (
                    <span>SKU {sku} · 제품 정보 미등록</span>
                  )}
                  <button type="button" className="q-button" onClick={() => onSelect(sku)}>
                    선택
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
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
              <CandidateDetail product={product} catalog={catalog} />
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
  onResolveRow,
  navigation,
  prepared,
  onNavigationMissed,
}: WarningListProps) {
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  const handledNonce = useRef<number | undefined>(undefined);
  const [pendingFocus, setPendingFocus] = useState<ImportNavigation | undefined>(undefined);

  // ⛔ **여기서 조기 반환하지 않는다.** 아래 `useEffect` 가 훅이라서, 경고가
  // 0건일 때만 건너뛰면 0건 → 1건이 되는 순간 훅 수가 달라진다. React 는
  // "Rendered more hooks than during the previous render" 로 화면을 통째로
  // 죽인다(실측: 배관 거리를 입력해 경고가 처음 생기는 순간 전체가 사라졌다).
  // 반환은 모든 훅을 부른 **뒤에** 한다.

  // 요약 목록과 **같은 함수**로 식별한다. 배열 index 를 key 로 쓰면 앞선
  // 경고가 사라질 때 뒤 항목이 remount 되어 입력하던 검색어가 날아가고,
  // `nodeId ?? edgeId` 로 뭉개면 노드 경고와 연결선 경고가 같은 key 를 갖는다.
  const identified = identifyImportWarnings(warnings);

  // --- 이동 요청 소비 ---------------------------------------------------
  //
  // 행 이동과 같은 계약이다. (1) nonce 로 **한 번만** 소비하고 (2) 소비
  // 직전과 (3) 스크롤·포커스 직전에 `sourcePrepared` 를 다시 본다.
  //
  // ⛔ 단순히 `id === navigateToWarningId` 로 ref 에서 스크롤하면,
  // 다른 이유로 재렌더될 때마다 **옛 요청이 다시 스크롤**하고, 같은 항목을
  // 다시 눌러도 state 가 그대로라 **아무 일도 일어나지 않는다.**
  const decide = (request: ImportNavigation) =>
    decideNavigation({
      sourcePrepared: request.sourcePrepared,
      currentPrepared: prepared,
      targetExists: identified.some((x) => x.id === request.warningId),
    });

  useEffect(() => {
    if (navigation === undefined || navigation.nonce === handledNonce.current) return;
    handledNonce.current = navigation.nonce;
    const decision = decide(navigation);
    if (decision.kind !== 'go') {
      onNavigationMissed?.(decision.message);
      return;
    }
    setPendingFocus(navigation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  useEffect(() => {
    if (pendingFocus === undefined) return;
    setPendingFocus(undefined);
    const stillOk = decide(pendingFocus);
    if (stillOk.kind !== 'go') {
      onNavigationMissed?.(stillOk.message);
      return;
    }
    const target = itemRefs.current.get(pendingFocus.warningId);
    if (target === undefined) {
      onNavigationMissed?.('이동할 대상을 찾지 못했습니다. 확인 목록에서 다시 선택해 주세요.');
      return;
    }
    target.scrollIntoView({ block: 'center', behavior: 'auto' });
    target.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFocus]);

  if (warnings.length === 0) return null;

  return (
    <div className="q-card q-warning-list" role="alert">
      <h3>확인이 필요합니다 ({warnings.length}건)</h3>
      <ul>
        {identified.map(({ id: warningId, warning }) => {
          // installationSystemId가 있으면 배관 경고다 — 일반 검색을
          // 보여주지 않는다(위 docstring 참고). optionId가 있으면
          // 코드와 무관하게 옵션 경고다 — 본체와 완전히 분리된 해소
          // 경로(onResolveOption)를 쓴다. 같은 노드라도 본체 행과
          // sourceNodeIds를 공유할 수 있어 코드만으로는 구분이 안 된다
          // — optionId 유무로만 가른다. 케이블 경고는 노드도 시스템도
          // 아니고 edgeId만 있다 — 그걸로 가른다.
          const isRemoved = warning.code === 'catalog-item-removed' && warning.rowId !== undefined;
          const isConduit = !isRemoved && warning.installationSystemId !== undefined;
          const isOption = !isRemoved && !isConduit && warning.optionId !== undefined;
          const isCable =
            !isRemoved &&
            !isConduit &&
            !isOption &&
            warning.code === 'cable-item-unresolved' &&
            warning.edgeId !== undefined;
          const isDevice =
            !isRemoved &&
            !isConduit &&
            !isOption &&
            !isCable &&
            (warning.code === 'device-not-in-catalog' || warning.code === 'device-ambiguous-match') &&
            warning.nodeId !== undefined;

          return (
            <li
              key={warningId}
              data-warning-id={warningId}
              // 포커스를 받아야 키보드 사용자가 이동한 자리를 안다.
              tabIndex={-1}
              ref={(el) => {
                if (el === null) itemRefs.current.delete(warningId);
                else itemRefs.current.set(warningId, el);
              }}
            >
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
                    groupByCableCategory
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
                    {...(warning.modelSearchCandidates !== undefined
                      ? { evidence: warning.modelSearchCandidates }
                      : {})}
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
                    {...(warning.modelSearchCandidates !== undefined
                      ? { evidence: warning.modelSearchCandidates }
                      : {})}
                    onSelect={(sku) => onResolveDevice(warning.nodeId!, sku)}
                  />
                ) : (
                  <SearchResolve
                    label={`${warning.nodeId} 연결할 품목 검색`}
                    catalog={catalog}
                    onSelect={(sku) => onResolveDevice(warning.nodeId!, sku)}
                  />
                ))}
              {isRemoved && (
                <SearchResolve
                  label={`${warning.rowId} 다시 연결할 품목 검색`}
                  catalog={catalog}
                  onSelect={(sku) => onResolveRow(warning.rowId!, sku)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
