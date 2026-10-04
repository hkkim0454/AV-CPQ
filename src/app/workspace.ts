/**
 * 문서 수정·취소/복구·준비 결과 (계획 2026-10-04-quote-workspace-ui Task 2).
 *
 * 화면은 금액 식을 복제하지 않는다 — 문서가 바뀔 때마다 같은 도메인
 * 경로(`prepareQuote`)를 다시 불러 `PreparedQuote`를 얻고, 화면은 그
 * 결과만 읽는다.
 *
 * 원가 세션은 여기서 다루지 않는다 — 실행취소 이력에도 넣지 않는다
 * (계획 §1).
 */
import { useCallback, useMemo, useState } from 'react';
import { buildGuideBasis, GuideBasisError } from '../data/catalog/guideBasis';
import { prepareQuote, type PreparedQuote } from '../export/variants/prepare';
import { priceQuote } from '../domain/quote/priceQuote';
import { indirectCostsFor, type IndirectProfileId } from '../export/ooxml/guideTemplate';
import { toRow, CURRENT_RULE_VERSION } from '../domain/quote/buildDocument';
import { computeDocumentBasisConflicts, describeBasisConflicts } from '../domain/quote/basisConflict';
import { computeActiveWarnings } from '../domain/quote/activeWarnings';
import { withResolvedProduct } from '../domain/quote/resolveProduct';
import { synchronizeMiscMaterials, computeMiscMaterialWarnings } from '../domain/quote/miscMaterials';
import { regenerateCables } from '../import/diagram/regenerateCables';
import { lengthOf } from '../import/diagram/cables';
import { rebuildCableRows } from '../domain/quote/cableRebuild';
import type { RouteInput } from '../domain/quote/installation';
import { calcRouteMeters } from '../domain/quote/installation';
import {
  applyInstallationPatch,
  computeInstallationWarnings,
  conduitRowSentinel,
  CONDUIT_GROUP,
  isConduitSentinel,
  resolveConduitProduct,
  type InstallationPatch,
} from '../domain/quote/installation';
import type { QuoteDocument, QuoteHeader } from '../domain/quote/types';
import type { ImportWarning } from '../import/diagram/devices';
import type { Resources } from './resources';

export interface LoadedDocument {
  document: QuoteDocument;
  importWarnings: readonly ImportWarning[];
}

export type WorkspaceStatus =
  | { kind: 'empty' }
  | {
      kind: 'editing';
      document: QuoteDocument;
      prepared: PreparedQuote;
    }
  | {
      /**
       * 작업 파일을 저장할 때와 지금 환경의 계산 기준(카탈로그·가이드
       * 템플릿·노임)이 다르다 — 조용히 새 기준으로 계산하지 않는다.
       * `previewRecalculateWithCurrentBasis`+`applyRecalculatedBasis`를 명시적으로 거쳐야 벗어난다
       * (계획 Task 4, 설계서 §6.3).
       */
      kind: 'basis-conflict';
      document: QuoteDocument;
      reason: string;
    };

export interface Workspace {
  status: WorkspaceStatus;
  canUndo: boolean;
  canRedo: boolean;
  loadDocument(input: LoadedDocument): void;
  /**
   * 저장된 작업 파일을 연다 — `loadDocument`와 달리 새 견적 입구가
   * 아니므로 `seedDefaultProfile`/`synchronizeMiscMaterials`를 부르지
   * 않는다. 기준이 지금과 다르면 `status.kind`가 `'basis-conflict'`로
   * 나타난다.
   */
  openWorkFile(document: QuoteDocument): void;
  /**
   * 기준 충돌 상태(`basis-conflict`)에서 지금 쓸 후보 문서를 미리
   * 만든다 — 아직 적용하지 않는다(계획 §「복사본→전후차이→적용」).
   * 결과는 `recalcPreview`로 나온다. `resetRowIds`를 주면 그 케이블
   * 행들의 수동 수정을 버리고 자동 산출값을 쓴 것으로 다시 미리본다
   * (`recalcPreview.cableConflictDetails`에서 어느 행이 걸렸는지 안다).
   */
  previewRecalculateWithCurrentBasis(resetRowIds?: readonly string[]): void;
  /** 미리 만든 후보를 실제로 적용한다 — 실행취소로 이전 상태로 돌아갈 수 있다. */
  applyRecalculatedBasis(): void;
  /** 미리보기를 버린다 — 문서는 그대로다. */
  cancelRecalculateWithCurrentBasis(): void;
  /** 지금 미리 계산된 후보(없으면 undefined). */
  recalcPreview: RecalculationPreview | undefined;
  /** `catalog-item-removed` 경고 전용 — 입구와 무관하게 그 행만 다시 찾는다. */
  resolveRow(rowId: string, sku: string): void;
  setQuantity(rowId: string, quantity: string): void;
  setDescription(rowId: string, description: string): void;
  setRemark(rowId: string, remark: string): void;
  setHeader(patch: Partial<QuoteHeader>): void;
  setProfile(systemId: string, profile: IndirectProfileId): void;
  setIndirectRule(systemId: string, itemId: string, patch: { applied?: boolean; rate?: string }): void;
  /** 기존 견적에 품목을 더한다. 카탈로그에 없는 SKU는 조용히 무시한다 — 호출부가 검색 결과에서만 골라 준다. */
  addItem(systemId: string, sku: string, quantity: string): void;
  removeRow(rowId: string): void;
  /**
   * 미해결 모델/옵션 경고를 실제로 해소한다 — 그 노드가 합쳐진 행을
   * 찾아 카탈로그 제품으로 바꿔 심는다. 수량·비고·설명(사람이 이미
   * 고쳤을 수 있다)·rowId는 그대로 둔다.
   */
  resolveDevice(nodeId: string, sku: string): void;
  /** 옵션 카드 경고를 해소한다 — optionId로 정확히 그 옵션 행만 찾는다. */
  resolveOption(optionId: string, sku: string): void;
  /** 미해결 케이블 경고를 해소한다 — sourceEdgeIds로 그 구간 행만 찾는다. */
  resolveCable(edgeId: string, sku: string, sourceCableKey?: string): void;
  applyCableRoutes(expected: QuoteDocument, routes: readonly RouteInput[], resetRowIds: readonly string[]): void;
  /**
   * 배관 입력(거리·줄 수·종류·기타자재 비율)을 바꾸고, 유효하면 배관
   * 행과 `배관 기타자재` 파생행을 재산출한다(`installation.ts`).
   */
  setInstallationInput(systemId: string, patch: InstallationPatch): void;
  /**
   * 배관 경고를 해소한다 — 일반 `resolveDevice`와 달리 그 시스템의
   * 현재 배관 종류에 맞는 품셈 묶음인지 도메인 경계에서 검증한다.
   */
  resolveConduit(systemId: string, sku: string): void;
  undo(): void;
  redo(): void;
}

/**
 * 노임은 가이드 것(하반기)을 쓴다 — 배포본(상반기)을 그대로 화면 계산에
 * 쓰지 않는다(독립 검토 지적). 어느 가이드를 고르든 노임 **값**은 네
 * 가이드가 전부 같다(실측 확인) — 다른 것은 간접비 규칙뿐이고, 그건
 * `indirectCostsFor(profile, guides)`가 시스템별 프로파일로 따로
 * 심는다. 그래도 매번 다른 가이드를 고르면 `BasisVersions.wage` 라벨만
 * 달라질 수 있어 하나로 고정한다 — 안 그러면 저장한 작업 파일을 다시
 * 열 때 "기준이 바뀌었다"는 거짓 경고가 날 수 있다.
 */
const WAGE_GUIDE_ID = 'pumsem';

interface History {
  past: QuoteDocument[];
  present: QuoteDocument | undefined;
  future: QuoteDocument[];
}

const EMPTY_HISTORY: History = { past: [], present: undefined, future: [] };

function importWarningsFor(document: QuoteDocument, original: readonly ImportWarning[]): readonly ImportWarning[] {
  return document.cableWarnings === undefined ? original : [
    ...original.filter(warning => warning.owner !== 'cable-generation'), ...document.cableWarnings,
  ];
}

/**
 * 프로파일은 **문서 안에만** 둔다(`QuoteSystem.indirectProfileId`) —
 * 별도 state로 안 둔다. 실제로 찾은 결함: `profileBySystem`을 문서와
 * 다른 state로 두면, 프로파일을 바꾼 뒤 실행취소를 눌렀을 때 문서만
 * 이전 상태로 돌아가고 `profileBySystem`은 그대로 남아 — 되돌아간
 * 문서(예: 일반)를 바뀐 프로파일(예: DS)로 다시 계산하는 일이 생겼다.
 * 문서 하나만 이력에 담으면 실행취소가 둘을 항상 같이 되돌린다.
 */
function profileMapOf(document: QuoteDocument): Map<string, IndirectProfileId> {
  return new Map(
    document.systems.map((s) => [
      s.systemId,
      (s.indirectProfileId as IndirectProfileId | undefined) ?? 'ds',
    ]),
  );
}

/**
 * 새 문서(아직 프로파일을 고른 적 없는 시스템)에만 기본값을 심는다
 * (결정 D12 — 새 견적 기본 간접비는 DS다).
 *
 * **이미 프로파일이 있는 시스템은 건드리지 않는다.** 저장된 작업
 * 파일을 다시 열 때도 이 함수를 거치는데, 무조건 심으면 사용자가
 * 이미 고른 프로파일과 손본 요율(`indirectCosts`)을 조용히 DS
 * 기본값으로 덮어쓰게 된다 — 독립 검토 지적.
 */
function seedDefaultProfile(document: QuoteDocument, guides: Resources['guides']): QuoteDocument {
  return {
    ...document,
    systems: document.systems.map((s) =>
      s.indirectProfileId !== undefined
        ? s
        : { ...s, indirectProfileId: 'ds', indirectCosts: indirectCostsFor('ds', guides) },
    ),
  };
}

/**
 * 명시적 재계산에서만 쓴다 — 이미 품목(sku)을 고른 행을 **지금 카탈로그**
 * 값으로 다시 찾는다(독립 검토 지적: 버전 문자열만 올리고 실제 단가는
 * 그대로 남았었다).
 *
 * 배관 행은 그 시스템의 **지금** 배관 종류(묶음)와 실제로 맞는지까지
 * 확인한 뒤에만 갱신한다 — `resolveConduitProduct`와 같은 검증이다.
 * 맞지 않으면(묶음이 바뀌었거나 sku 자체가 사라졌으면) 건드리지 않고
 * 그대로 둔다 — 뒤이어 도는 `applyInstallationPatch`/
 * `computeInstallationWarnings`가 스스로 다시 검증해 미해결·차단으로
 * 되돌린다(배관은 이미 그 메커니즘이 있다).
 *
 * 배관이 아닌 행의 sku가 카탈로그에서 아예 사라졌으면 **옛 단가를 지금
 * 기준인 것처럼 쓰지 않는다** — 미해결로 되돌리고(품명·단가·품셈연결을
 * 지운다) `catalog-item-removed` 경고를 달아 다시 고르게 한다(독립
 * 검토 지적).
 */
function refreshResolvedRows(
  document: QuoteDocument,
  catalog: Resources['catalog'],
): { document: QuoteDocument; removedWarnings: readonly ImportWarning[] } {
  const conduitTypeBySentinel = new Map(
    document.systems.map((s) => [conduitRowSentinel(s.systemId), s.conduitType ?? 'flexible']),
  );
  const removedWarnings: ImportWarning[] = [];
  const rows = document.rows.map((r) => {
    if (r.type !== 'item' || r.sku === undefined) return r;
    const sentinel = r.sourceNodeIds?.find((id) => conduitTypeBySentinel.has(id) && isConduitSentinel(id));
    if (sentinel !== undefined) {
      const conduitType = conduitTypeBySentinel.get(sentinel)!;
      const product = catalog.products.find((p) => p.sku === r.sku);
      if (product !== undefined && product.options['group'] === CONDUIT_GROUP[conduitType]) {
        return withResolvedProduct(r, product, catalog.prices.get(r.sku));
      }
      return r;
    }
    const product = catalog.products.find((p) => p.sku === r.sku);
    if (product !== undefined) return withResolvedProduct(r, product, catalog.prices.get(r.sku));
    const removedSku = r.sku;
    const { sku: _sku, productId: _productId, sellingUnitPrice: _price, laborMappingId: _laborMappingId, ...rest } =
      r;
    removedWarnings.push({
      code: 'catalog-item-removed',
      blocking: true,
      message: `행 '${r.name}'(${removedSku})이 지금 카탈로그에 없다 — 다시 골라야 한다.`,
      rowId: r.rowId,
    });
    return { ...rest, laborMode: 'unresolved' as const };
  });
  return { document: { ...document, rows }, removedWarnings };
}

/** 저장된 케이블 경로(`cableRoutes`)를 **지금 코드(=지금 rule)** 로 다시 돌린다. */
function regenerateCablesUnderCurrentRule(
  document: QuoteDocument,
  catalog: Resources['catalog'],
  resetRowIds: readonly string[] = [],
): { document: QuoteDocument; conflict: boolean; conflictDetails: readonly { rowIds: readonly string[]; message: string }[] } {
  if (document.cableSource === undefined) return { document, conflict: false, conflictDetails: [] };
  const generated = regenerateCables(document, catalog, document.cableRoutes ?? []);
  // `resetRowIds`가 비어 있으면 수동 수정을 함부로 버리지 않는다. 충돌이
  // 있으면(canApply===false) 이 재계산 전체를 적용하지 않는다(독립
  // 검토 지적: "입력 부족/충돌 시 차단"). `resetRowIds`를 주면 그
  // 행들만 사용자가 명시적으로 "자동 산출값 사용"을 고른 것으로
  // 본다 — 케이블 패널의 재산출 적용과 같은 선택지를
  // basis-conflict 화면에서도 쓸 수 있게 한다(독립 검토 지적).
  const result = rebuildCableRows(document, document.cableBaseline ?? [], generated.rows, { resetRowIds });
  if (!result.canApply) {
    return {
      document,
      conflict: true,
      conflictDetails: result.conflicts.map((c) => ({ rowIds: c.rowIds, message: c.message })),
    };
  }
  return {
    document: {
      ...document,
      rows: result.rows,
      cableBaseline: result.nextBaselineRows,
      cableWarnings: generated.warnings,
    },
    conflict: false,
    conflictDetails: [],
  };
}

/** 배관 입력(거리·줄 수)을 그대로 다시 제출해 **지금 코드**로 수량·행을 재산출한다. */
function regenerateConduitUnderCurrentRule(document: QuoteDocument, catalog: Resources['catalog']): QuoteDocument {
  return document.systems.reduce((doc, system) => applyInstallationPatch(doc, system.systemId, {}, catalog), document);
}

type ItemSheetRow = Extract<QuoteDocument['rows'][number], { type: 'item' }>;

function rowSnapshot(row: ItemSheetRow): { quantity: string; sku: string | undefined; sellingUnitPrice: string | undefined } {
  return { quantity: row.quantity, sku: row.sku, sellingUnitPrice: row.sellingUnitPrice };
}

/**
 * 재계산 미리보기용 행 단위 차이 — 단가뿐 아니라 수량·품목(sku)이
 * 바뀌거나 행이 늘거나 줄어든 것까지 전부 본다(독립 검토 지적: 전에는
 * `priceChanges`만 있어서 수량·행 추가/삭제 변화가 화면에 전혀 안
 * 보였다).
 */
function computeRecalculationRowChanges(
  before: QuoteDocument,
  after: QuoteDocument,
): readonly RecalculationRowChange[] {
  const beforeById = new Map(before.rows.filter((r): r is ItemSheetRow => r.type === 'item').map((r) => [r.rowId, r]));
  const afterById = new Map(after.rows.filter((r): r is ItemSheetRow => r.type === 'item').map((r) => [r.rowId, r]));
  const ids = new Set([...beforeById.keys(), ...afterById.keys()]);
  const changes: RecalculationRowChange[] = [];
  for (const rowId of ids) {
    const b = beforeById.get(rowId);
    const a = afterById.get(rowId);
    if (b === undefined && a !== undefined) {
      changes.push({ rowId, kind: 'added', name: a.name, after: rowSnapshot(a) });
    } else if (b !== undefined && a === undefined) {
      changes.push({ rowId, kind: 'removed', name: b.name, before: rowSnapshot(b) });
    } else if (b !== undefined && a !== undefined) {
      const before_ = rowSnapshot(b);
      const after_ = rowSnapshot(a);
      const differs =
        before_.quantity !== after_.quantity || before_.sku !== after_.sku || before_.sellingUnitPrice !== after_.sellingUnitPrice;
      if (differs) changes.push({ rowId, kind: 'changed', name: a.name, before: before_, after: after_ });
    }
  }
  return changes;
}

export interface RecalculationRowChange {
  rowId: string;
  kind: 'added' | 'removed' | 'changed';
  name: string;
  before?: { quantity: string; sku: string | undefined; sellingUnitPrice: string | undefined };
  after?: { quantity: string; sku: string | undefined; sellingUnitPrice: string | undefined };
}

export interface RecalculationPreview {
  /**
   * 이 후보를 만든 원본 문서(참조 동일성 비교용) — 그 사이 다른 문서를
   * 열거나 undo/redo로 `history.present`가 바뀌면 이 미리보기는
   * 더는 유효하지 않다(독립 검토 지적: A 문서 미리보기를 띄운 채 B
   * 문서를 열어도 미리보기가 안 사라져서, 적용하면 A 후보가 B를
   * 덮어쓸 뻔했다). `applyRecalculatedBasis`와 노출되는 `recalcPreview`
   * 둘 다 이 값을 `history.present`와 대조해서만 유효하다고 본다.
   */
  sourceDocument: QuoteDocument;
  /** 적용하면 될 문서. 아직 history에 들어가지 않았다. */
  candidate: QuoteDocument;
  /** 행 단위 변경 — 수량·품목(sku)·단가가 바뀌거나, 행이 늘거나 줄었다(독립 검토 지적). */
  rowChanges: readonly RecalculationRowChange[];
  /** 간접비 절사 자릿수가 바뀌는가(가이드 템플릿 변경 등). */
  roundingChanged: boolean;
  /** 노임/품셈 기준이 바뀌는가. */
  laborOrWageChanged: boolean;
  /** 저장 당시 기준으로 다시 계산한 합계. 재현할 수 없으면 undefined. */
  beforeTotal: string | undefined;
  afterTotal: string;
  /**
   * 케이블 재산출이 수동 수정과 충돌해 적용하지 못했다 — true면 이
   * 재계산 전체를 적용할 수 없다(`applyRecalculatedBasis`가 거부한다).
   * `cableConflictDetails`에 걸린 행과 사유가 있다 —
   * `previewRecalculateWithCurrentBasis(resetRowIds)`로 그 행들의
   * 수동 수정을 버리고 자동 산출값을 쓰도록 다시 미리볼 수 있다
   * (독립 검토 지적: 전에는 이 충돌을 풀 수 있는 화면이 basis-conflict
   * 상태에서는 아예 보이지 않았다 — 케이블 패널은 'editing' 상태에서만
   * 뜬다).
   */
  cableConflict: boolean;
  cableConflictDetails: readonly { rowIds: readonly string[]; message: string }[];
}

/**
 * `resources`는 초기 자료가 준비되기 전(로딩/실패 중)에는 `undefined`다.
 * 툴바의 입구 버튼은 그 사이에도 셸 자체가 죽지 않도록 계속 보여야
 * 한다(계획 §5 Review Focus 5번) — 그래서 이 훅은 늘 같은 순서로
 * 불려야 하고(React 훅 규칙), `resources`가 없을 때는 빈 상태로
 * 조용히 멈춘다.
 */
export function useWorkspace(resources: Resources | undefined): Workspace {
  const basis = useMemo(
    () =>
      resources === undefined
        ? undefined
        : buildGuideBasis({
            laborItemsRaw: resources.laborBasisRaw.laborItemsRaw,
            wageTableRaw: resources.laborBasisRaw.wageTableRaw,
            laborMappingsRaw: resources.laborBasisRaw.laborMappingsRaw,
            choice: { kind: 'guide', guide: resources.guides[WAGE_GUIDE_ID] },
          }),
    [resources],
  );

  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  // 변환 시점에 나온 **원본** 경고 전부 — 실행취소로 문서가 바뀌어도
  // 이 목록 자체는 바뀌지 않는다. 실제로 화면에 보여줄 "지금 유효한"
  // 부분집합은 매번 `computeActiveWarnings(document, allImportWarnings)`로
  // 다시 계산한다(`prepareNow`).
  const [allImportWarnings, setAllImportWarnings] = useState<readonly ImportWarning[]>([]);
  /**
   * 이 문서가 새 입구(`loadDocument`)로 왔는지, 저장된 작업 파일을 다시
   * 연(`openWorkFile`) 것인지(독립 검토 지적). 재열기는 **무조건**
   * `preserve`로 다뤄야 한다 — labor/wage가 우연히 `'unknown'`이어도
   * `initialize-new`로 새지 않게(조용한 재계산 금지) 이 구분이 필요하다.
   * 새 문서는 반대로 labor/wage가 아직 `'unknown'`인 게 정상이라
   * `initialize-new`를 그대로 써야 한다.
   */
  const [documentOrigin, setDocumentOrigin] = useState<'new' | 'reopened'>('new');

  type PrepareResult = { kind: 'ok'; prepared: PreparedQuote } | { kind: 'conflict'; reason: string };

  const prepareNow = useCallback(
    (document: QuoteDocument): PrepareResult | undefined => {
      if (basis === undefined || resources === undefined) return undefined;

      // labor/wage/template보다 먼저 본다 — 이 둘은 `prepareQuote`의
      // `assertSameBasis`/`assertSameTemplate`가 다루지 않는 축이다
      // (catalog/rule). 여기서 걸리면 prepareQuote를 아예 부르지 않는다 —
      // 어차피 명시적 재계산 전에는 의미 없는 계산이다. 재열기 문서는
      // `'unknown'` 자체가 충돌이다 — 다섯 축을 전부 지운 파일도 걸러야
      // 한다(독립 검토 지적).
      const versionConflicts = computeDocumentBasisConflicts(
        document,
        { catalogSha256: resources.catalog.sourceSha256 },
        { treatUnknownAsConflict: documentOrigin === 'reopened' },
      );
      if (versionConflicts.length > 0) {
        return { kind: 'conflict', reason: describeBasisConflicts(versionConflicts) };
      }

      try {
        const prepared = prepareQuote({
          document,
          laborReference: basis.reference,
          basisVersions: basis.versions,
          guides: resources.guides,
          // 문서 자신이 들고 있는 프로파일에서 그대로 끌어낸다 — 별도
          // state가 없으니 실행취소가 문서를 되돌리면 이 맵도 같이
          // 저절로 되돌아간다.
          profileBySystem: profileMapOf(document),
          // 원본 경고(allImportWarnings)가 아니라 **지금 문서 상태로 다시
          // 평가한** 부분집합을 넘긴다 — 그래야 해결한 경고가 여기서도
          // 빠지고, `blocking`(출력 차단)도 실제로 풀린다. 화면
          // (WarningList)도 이 함수가 돌려주는 `prepared.importWarnings`를
          // 그대로 쓴다 — 표시와 차단 판정이 같은 집합을 보게 된다.
          // 배관 경고(`computeInstallationWarnings`)는 별도 state 없이
          // 이 문서에서 매번 새로 파생한다 — 그래야 실행취소로 배관 행이
          // 사라지거나 종류가 바뀌어도 경고가 항상 그 시점 문서와 맞는다.
          importWarnings: [
            ...computeActiveWarnings(document, importWarningsFor(document, allImportWarnings)),
            ...computeInstallationWarnings(document, resources.catalog),
            ...computeMiscMaterialWarnings(document, resources.catalog),
          ],
          // 재열기 문서는 labor/wage가 우연히 'unknown'이어도 무조건
          // preserve다(독립 검토 지적) — 'unknown'을 "아직 기준 없는 새
          // 문서"로 오인해 initialize-new로 새면 조용한 재계산이 된다.
          // 새 문서만 'unknown'일 때 initialize-new로 처음 기준을 적는다.
          wageMode:
            documentOrigin === 'reopened'
              ? 'preserve'
              : document.versions.wage === 'unknown'
                ? 'initialize-new'
                : 'preserve',
          // 재열기는 labor/wage/template 중 하나라도 비면 전부 막는다
          // (독립 검토 지적) — catalog/rule은 computeDocumentBasisConflicts
          // 가 이미 `treatUnknownAsConflict`로 같은 규율을 적용한다.
          strictUnknown: documentOrigin === 'reopened',
        });
        return { kind: 'ok', prepared };
      } catch (err) {
        // 저장된 작업 파일의 labor/wage/템플릿 기준이 지금과 다르면
        // `assertSameBasis`/`assertSameTemplate`가 이 오류를 던진다 —
        // 화면 깨짐이 아니라 기준 충돌 화면으로 보여준다.
        if (err instanceof GuideBasisError) return { kind: 'conflict', reason: err.message };
        throw err;
      }
    },
    [basis, resources, allImportWarnings, documentOrigin],
  );

  const prepareResult = useMemo(
    () => (history.present === undefined ? undefined : prepareNow(history.present)),
    [history.present, prepareNow],
  );

  const loadDocument = useCallback(
    (input: LoadedDocument) => {
      // 자료가 아직 준비되지 않았으면 조용히 멈춘다 — 그 사이 입구
      // 버튼은 비활성이라 화면에서는 실제로 호출되지 않는다.
      if (basis === undefined || resources === undefined) return;
      // 케이블 생성 소유 경고는 `cableWarnings`가 따로 들고 다닌다(진단
      // 문서 쪽). 여기 `document.importWarnings`에는 그 나머지(장비·옵션
      // 등)만 얼려 둔다 — 저장된 작업 파일을 다시 열 때도 미해결 후보
      // 선택 UI가 복원되게 하려는 것이다(독립 검토 지적: 전에는 이
      // 경고들이 문서가 아니라 이 훅의 state에만 있어서 재열기 후
      // 사라졌다).
      const nonCableWarnings = input.importWarnings.filter((w) => w.owner !== 'cable-generation');
      const withWarnings: QuoteDocument = { ...input.document, importWarnings: nonCableWarnings };
      const seeded = synchronizeMiscMaterials(seedDefaultProfile(withWarnings, resources.guides), resources.catalog);
      // `prepareNow`를 재사용하지 않는다 — 그건 `allImportWarnings` 상태를
      // 클로저로 캡처하는데, 이 함수 안의 `setAllImportWarnings` 호출은
      // 비동기라 이 시점엔 아직 반영 전이다(이전 문서의 경고가 섞인다).
      // 그래서 여기서는 `input.importWarnings`를 직접 쓴다. 갓 들어온
      // 문서라 아직 아무 것도 해결되지 않았으므로
      // `computeActiveWarnings`를 거쳐도 결과는 같지만, 경로를 하나로
      // 유지하려고 그대로 거친다.
      //
      // 즉시 한 번 준비해 기준을 문서에 찍은 **그** 문서를 현재 상태로
      // 삼는다 — 안 그러면 다음 렌더의 재준비가 'initialize-new'를 다시
      // 타려다 "이미 기준이 적힌 문서" 예외를 만난다.
      const first = prepareQuote({
        document: seeded,
        laborReference: basis.reference,
        basisVersions: basis.versions,
        guides: resources.guides,
        profileBySystem: profileMapOf(seeded),
        importWarnings: [
          ...computeActiveWarnings(seeded, importWarningsFor(seeded, input.importWarnings)),
          ...computeInstallationWarnings(seeded, resources.catalog),
          ...computeMiscMaterialWarnings(seeded, resources.catalog),
        ],
        wageMode: 'initialize-new',
      });
      setAllImportWarnings(input.importWarnings);
      setDocumentOrigin('new');
      setHistory({ past: [], present: first.document, future: [] });
    },
    [basis, resources],
  );

  const openWorkFile = useCallback((document: QuoteDocument) => {
    // 저장 문서 전용 진입로다 — `seedDefaultProfile`/`synchronizeMiscMaterials`를
    // 여기서 부르지 않는다(인계 지시). 기준이 지금과 다르면
    // `prepareNow`가 걸러 `status.kind`를 `'basis-conflict'`로 보여준다.
    // 사용자가 `previewRecalculateWithCurrentBasis`를 명시적으로 골라야 그때
    // 비로소 자동 보정 함수들이 돈다 — 조용한 재계산 금지.
    //
    // `document.importWarnings`(장비·옵션 등, 케이블 생성 소유 제외)를
    // 그대로 복원한다 — 안 그러면 재열기 후 미해결 후보 선택 UI가
    // 사라진다(독립 검토 지적). 케이블 쪽은 `importWarningsFor`가
    // `document.cableWarnings`에서 직접 가져온다.
    setAllImportWarnings(document.importWarnings ?? []);
    setDocumentOrigin('reopened');
    setHistory({ past: [], present: document, future: [] });
  }, []);

  const [recalcPreview, setRecalcPreview] = useState<RecalculationPreview | undefined>(undefined);

  /**
   * 후보 복사본을 만들 뿐 history를 건드리지 않는다(독립 검토 지적 —
   * 계획이 요구하는 "복사본→전후차이→적용" 중 앞 두 단계). 실제로
   * 반영하려면 `applyRecalculatedBasis`를 따로 불러야 한다.
   */
  const previewRecalculateWithCurrentBasis = useCallback((resetRowIds: readonly string[] = []) => {
    if (basis === undefined || resources === undefined || history.present === undefined) return;
    const present = history.present;

    // 1) 케이블을 **원본(아직 가격 갱신 전) 문서**로 먼저 재산출한다 —
    //    `rebuildCableRows`의 수동 수정 판정은 "기준 행 대비 지금
    //    문서가 바뀌었나"를 본다. 가격을 먼저 갱신해 버리면 사람이
    //    손대지 않은 단가 변경까지 수동 수정으로 오인해 가짜 충돌을
    //    낸다(독립 검토 지적). 케이블은 수동 수정과 충돌하면 이
    //    재계산 전체를 막는다 — `resetRowIds`를 주면 그 행들만
    //    명시적으로 "자동 산출값 사용"을 고른 것으로 풀어 준다.
    const { document: cableRegenerated, conflict: cableConflict, conflictDetails: cableConflictDetails } =
      regenerateCablesUnderCurrentRule(present, resources.catalog, resetRowIds);
    // 2) 이제(수동 수정 판정이 끝난 뒤) 남은 행을 지금 카탈로그로 다시
    //    찾는다(배관은 전용 검증, 사라진 sku는 미해결로 되돌리고
    //    경고를 단다). 케이블 행은 위 재산출이 이미 지금 카탈로그로
    //    새로 지었으므로 여기서는 그대로 재확인만 된다.
    const { document: refreshed, removedWarnings } = refreshResolvedRows(cableRegenerated, resources.catalog);
    const conduitRegenerated = regenerateConduitUnderCurrentRule(refreshed, resources.catalog);
    const seeded = synchronizeMiscMaterials(seedDefaultProfile(conduitRegenerated, resources.guides), resources.catalog);
    // 사용자가 명시적으로 고른 시점에만 저장 당시의 낡은 카탈로그
    // 기준표를 지금 값으로 올려 적는다. `template`은 `prepareQuote`
    // 자신이 `explicit-recalculate`일 때 올린다(중복 금지). `rule`은
    // 여기서 올린다 — `prepareQuote`가 모르는 축이다.
    const withCurrentVersions: QuoteDocument = {
      ...seeded,
      versions: { ...seeded.versions, catalog: resources.catalog.sourceSha256, rule: CURRENT_RULE_VERSION },
      // 새로 찾은 `catalog-item-removed` 경고를 문서 자신에 얼린다 —
      // 저장했다 다시 열어도 해소 UI가 복원되게 한다(§C와 같은 이유).
      importWarnings: [...(present.importWarnings ?? []), ...removedWarnings],
    };
    const prepared = prepareQuote({
      document: withCurrentVersions,
      laborReference: basis.reference,
      basisVersions: basis.versions,
      guides: resources.guides,
      profileBySystem: profileMapOf(withCurrentVersions),
      importWarnings: [
        ...computeActiveWarnings(
          withCurrentVersions,
          importWarningsFor(withCurrentVersions, [...allImportWarnings, ...removedWarnings]),
        ),
        ...computeInstallationWarnings(withCurrentVersions, resources.catalog),
        ...computeMiscMaterialWarnings(withCurrentVersions, resources.catalog),
      ],
      wageMode: 'explicit-recalculate',
    });

    const rowChanges = computeRecalculationRowChanges(present, prepared.document);
    const roundingChanged = present.rounding.coverTotalDigits !== prepared.document.rounding.coverTotalDigits;
    const laborOrWageChanged =
      present.versions.labor !== prepared.document.versions.labor ||
      present.versions.wage !== prepared.document.versions.wage;

    // 저장 당시 노임/품셈 기준(labor/wage)이 **지금 것과 실제로 같을
    // 때만** 이전 합계를 다시 계산한다(독립 검토 지적: `priceQuote`는
    // 버전 대조 없이 넘겨받은 참조로 그냥 계산하므로, 저장 당시
    // 기준이 지금과 다른데도 지금 노임표로 돌리면 "과거 합계"를
    // 사칭하는 숫자가 나온다 — 재현이 아니라 창작이다). `present`의
    // 행 자체(품목 단가·수량·절사 자릿수)는 저장된 그대로이므로,
    // labor/wage만 같으면 지금 `basis.reference`로 다시 돌려도 원래
    // 계산과 같은 값이 나온다 — catalog/template/rule이 그 사이
    // 바뀌었어도 이 값 자체에는 영향이 없다(그 축들은 rowChanges 등
    // 다른 항목으로 따로 보여준다).
    const laborWageUnchanged =
      present.versions.labor !== '' &&
      present.versions.labor !== 'unknown' &&
      present.versions.labor === basis.versions.labor &&
      present.versions.wage !== '' &&
      present.versions.wage !== 'unknown' &&
      present.versions.wage === basis.versions.wage;
    let beforeTotal: string | undefined;
    if (laborWageUnchanged) {
      try {
        const beforePriced = priceQuote(present, basis.reference);
        // 기준이 같아도 계산 자체가 막혔으면(예: 품셈이 못 다루는
        // 직종) 그 합계는 신뢰할 수 있는 "완결된 계산"이 아니다 —
        // 일부가 빠지거나 0으로 깔린 값일 수 있다. 숫자를 보여주는
        // 대신 재현 불가로 둔다(독립 검토 지적).
        beforeTotal = beforePriced.blocking ? undefined : beforePriced.calculation.cover.finalTotal.toString();
      } catch {
        beforeTotal = undefined;
      }
    } else {
      beforeTotal = undefined;
    }
    const afterTotal = prepared.priced.calculation.cover.finalTotal.toString();

    setRecalcPreview({
      sourceDocument: present,
      candidate: prepared.document,
      rowChanges,
      roundingChanged,
      laborOrWageChanged,
      beforeTotal,
      afterTotal,
      cableConflict,
      cableConflictDetails,
    });
  }, [basis, resources, history.present, allImportWarnings]);

  const applyRecalculatedBasis = useCallback(() => {
    // `sourceDocument`가 지금의 `history.present`와 다르면(그 사이 다른
    // 문서를 열었거나 undo/redo로 바뀌었다) 이 후보는 더는 유효하지
    // 않다 — 적용을 거부하고 미리보기를 버린다(독립 검토 지적).
    if (
      recalcPreview === undefined ||
      recalcPreview.cableConflict ||
      recalcPreview.sourceDocument !== history.present
    ) {
      setRecalcPreview(undefined);
      return;
    }
    const candidate = recalcPreview.candidate;
    setHistory((h) => (h.present === undefined ? h : { past: [...h.past, h.present], present: candidate, future: [] }));
    setAllImportWarnings(candidate.importWarnings ?? []);
    setRecalcPreview(undefined);
  }, [recalcPreview, history.present]);

  const cancelRecalculateWithCurrentBasis = useCallback(() => {
    setRecalcPreview(undefined);
  }, []);

  const commit = useCallback((mutate: (document: QuoteDocument) => QuoteDocument) => {
    setHistory((h) => {
      if (h.present === undefined) return h;
      const changed = mutate(h.present);
      if (changed === h.present) return h;
      const present = resources === undefined ? changed : synchronizeMiscMaterials(changed, resources.catalog);
      return { past: [...h.past, h.present], present, future: [] };
    });
  }, [resources]);

  const resolveRow = useCallback(
    (rowId: string, sku: string) => {
      if (resources === undefined) return;
      const product = resources.catalog.products.find((p) => p.sku === sku);
      if (product === undefined) return;
      const price = resources.catalog.prices.get(sku);
      commit((document) => ({
        ...document,
        rows: document.rows.map((r) => (r.type === 'item' && r.rowId === rowId ? withResolvedProduct(r, product, price) : r)),
      }));
    },
    [commit, resources],
  );

  const mutateRow = useCallback(
    (rowId: string, patch: (row: QuoteDocument['rows'][number]) => QuoteDocument['rows'][number]) => {
      commit((document) => ({
        ...document,
        rows: document.rows.map((r) => (r.rowId === rowId ? patch(r) : r)),
      }));
    },
    [commit],
  );

  const applyCableRoutes = useCallback((expected: QuoteDocument, routes: readonly RouteInput[], resetRowIds: readonly string[]) => {
    if (resources === undefined) return;
    commit(document => {
      // 다른 편집 뒤에 이전 미리보기를 적용하지 않는다.
      if (document !== expected || document.cableSource === undefined) return document;
      const generated = regenerateCables(document, resources.catalog, routes);
      const result = rebuildCableRows(document, document.cableBaseline ?? [], generated.rows, { resetRowIds });
      if (!result.canApply) return document;
      return { ...document, rows: result.rows, cableBaseline: result.nextBaselineRows,
        cableRoutes: routes.map(route => ({ ...route })), cableWarnings: generated.warnings };
    });
  }, [resources, commit]);

  const setQuantity = useCallback(
    (rowId: string, quantity: string) => {
      mutateRow(rowId, (r) => {
        if (r.type !== 'item') return r;
        // 사람이 수량을 직접 입력했다 — 자리표시자 표식을 지운다(독립
        // 검토 지적). 이제부터는 이 값이 무엇이든(우연히 '1'이어도)
        // 사람이 확인한 수량이지 자동으로 채운 임시값이 아니다.
        const { quantityUnresolved: _quantityUnresolved, ...rest } = r;
        return { ...rest, quantity };
      });
    },
    [mutateRow],
  );

  const setDescription = useCallback(
    (rowId: string, description: string) => {
      mutateRow(rowId, (r) => (r.type === 'item' ? { ...r, internalDescription: description } : r));
    },
    [mutateRow],
  );

  const setRemark = useCallback(
    (rowId: string, remark: string) => {
      mutateRow(rowId, (r) => (r.type === 'item' ? { ...r, remark } : r));
    },
    [mutateRow],
  );

  const setHeader = useCallback(
    (patch: Partial<QuoteHeader>) => {
      commit((document) => ({ ...document, header: { ...document.header, ...patch } }));
    },
    [commit],
  );

  const setProfile = useCallback(
    (systemId: string, profile: IndirectProfileId) => {
      if (resources === undefined) return;
      const guides = resources.guides;
      // 이 시스템에 **처음** 심는 프로파일이거나 실제로 바뀐 경우에만
      // 그 프로파일의 기본 간접비 규칙을 새로 심는다. 이미 이 프로파일로
      // 심어 둔 규칙이 있으면(사용자가 적용 여부·요율을 손봤을 수 있다)
      // 조용히 덮어쓰지 않는다. 프로파일 자체가 문서 안에 있으므로 이
      // 한 번의 commit으로 문서와 프로파일이 항상 같이 이력에 쌓인다.
      commit((document) => ({
        ...document,
        systems: document.systems.map((s) =>
          s.systemId === systemId && s.indirectProfileId !== profile
            ? { ...s, indirectProfileId: profile, indirectCosts: indirectCostsFor(profile, guides) }
            : s,
        ),
      }));
    },
    [commit, resources],
  );

  const setIndirectRule = useCallback(
    (systemId: string, itemId: string, patch: { applied?: boolean; rate?: string }) => {
      commit((document) => ({
        ...document,
        systems: document.systems.map((s) =>
          s.systemId === systemId
            ? {
                ...s,
                indirectCosts: s.indirectCosts.map((rule) =>
                  rule.itemId === itemId ? { ...rule, ...patch } : rule,
                ),
              }
            : s,
        ),
      }));
    },
    [commit],
  );

  const addItem = useCallback(
    (systemId: string, sku: string, quantity: string) => {
      if (resources === undefined) return;
      const product = resources.catalog.products.find((p) => p.sku === sku);
      if (product === undefined) return; // 호출부가 검색 결과에서만 고르므로 정상적으로는 안 생긴다.
      const price = resources.catalog.prices.get(sku);
      const description = product.options['description'];
      const newRow = toRow(`added-${crypto.randomUUID()}`, systemId, {
        sku: product.sku,
        name: product.quoteName,
        specification: product.quoteSpec,
        unit: product.unit,
        quantity,
        ...(price !== undefined ? { sellingUnitPrice: price } : {}),
        ...(description !== undefined && description !== '' ? { internalDescription: description } : {}),
        ...(product.laborMappingId !== undefined ? { laborMappingId: product.laborMappingId } : {}),
        remark: '직접 선택(추가)',
      });
      commit((document) => ({ ...document, rows: [...document.rows, newRow] }));
    },
    [commit, resources],
  );

  const resolveDevice = useCallback(
    (nodeId: string, sku: string) => {
      if (resources === undefined) return;
      const product = resources.catalog.products.find((p) => p.sku === sku);
      if (product === undefined) return; // 호출부가 검색/후보 목록에서만 고르므로 정상적으로는 안 생긴다.
      const price = resources.catalog.prices.get(sku);

      commit((document) => ({
        ...document,
        rows: document.rows.map((r) => {
          // 옵션 행은 제외한다 — 같은 노드의 본체와 옵션이 `sourceNodeIds`를
          // 공유할 수 있다. 본체를 골랐다고 옵션까지 같은 제품으로
          // 바뀌면 안 된다(옵션은 `resolveOption`이 optionId로 정확히
          // 찾아 따로 처리한다). 배관 행(표식이 `isConduitSentinel`에
          // 걸림)도 제외한다 — 배관은 `resolveConduitProduct`만 받아야
          // 묶음(options.group) 검증이 항상 적용된다. 화면은 이미
          // 배관 경고를 `onResolveConduit`으로만 보내지만, 이 경계
          // 자체도 일반 경로로는 거부해야 "검증은 항상 거친다"는
          // 보장이 선다(독립 검토 지적).
          if (
            r.type !== 'item' ||
            r.optionId !== undefined ||
            !(r.sourceNodeIds?.includes(nodeId) ?? false) ||
            r.sourceNodeIds?.some(isConduitSentinel)
          ) {
            return r;
          }
          return withResolvedProduct(r, product, price);
        }),
      }));
    },
    [commit, resources],
  );

  const resolveOption = useCallback(
    (optionId: string, sku: string) => {
      if (resources === undefined) return;
      const product = resources.catalog.products.find((p) => p.sku === sku);
      if (product === undefined) return;
      const price = resources.catalog.prices.get(sku);

      commit((document) => ({
        ...document,
        rows: document.rows.map((r) => {
          if (r.type !== 'item' || r.optionId !== optionId) return r;
          return withResolvedProduct(r, product, price);
        }),
      }));
    },
    [commit, resources],
  );

  const resolveCable = useCallback(
    (edgeId: string, sku: string, sourceCableKey?: string) => {
      if (resources === undefined) return;
      const product = resources.catalog.products.find((p) => p.sku === sku);
      if (product === undefined) return;
      const price = resources.catalog.prices.get(sku);

      commit((document) => {
        const targets = document.rows.filter((r) => r.type === 'item' &&
          (r.sourceEdgeIds?.includes(edgeId) ?? false) &&
          (sourceCableKey === undefined || r.sourceCableKey === sourceCableKey));
        // 예전 자료에 집계 키가 없으면 대상이 하나일 때만 연결한다.
        // 같은 edge의 다른 BOM 품목을 추측으로 함께 바꾸지 않는다.
        if (targets.length !== 1) return document;
        const target = targets[0]!;
        if (target.type === 'item' && target.unit === 'EA') {
          const required = (document.cableRoutes ?? []).filter(route => target.sourceEdgeIds?.includes(route.edgeId))
            .map(calcRouteMeters).filter((meters): meters is string => meters !== undefined);
          if (required.some(meters => (lengthOf(product) ?? -1) < Number(meters))) return document;
        }
        return {
          ...document,
          rows: document.rows.map((r) => r.type === 'item' && r.rowId === targets[0]!.rowId
            ? withResolvedProduct(r, product, price) : r),
        };
      });
    },
    [commit, resources],
  );

  const setInstallationInput = useCallback(
    (systemId: string, patch: InstallationPatch) => {
      if (resources === undefined) return;
      // 순수 함수 하나만 문서에 적용한다 — 경고는 별도로 들고 다니지
      // 않는다(`prepareNow`가 매번 `computeInstallationWarnings`로
      // 다시 파생한다). React state updater 실행 시점에 기대는 부수
      // 효과가 없으므로 undo/redo와 항상 맞는다(독립 검토 지적).
      commit((document) => applyInstallationPatch(document, systemId, patch, resources.catalog));
    },
    [commit, resources],
  );

  const resolveConduit = useCallback(
    (systemId: string, sku: string) => {
      if (resources === undefined) return;
      commit((document) => resolveConduitProduct(document, systemId, sku, resources.catalog));
    },
    [commit, resources],
  );

  const removeRow = useCallback(
    (rowId: string) => {
      commit((document) => ({
        ...document,
        rows: document.rows.filter((r) => r.rowId !== rowId),
      }));
    },
    [commit],
  );

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.present === undefined || h.past.length === 0) return h;
      const previous = h.past[h.past.length - 1]!;
      return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((h) => {
      if (h.present === undefined || h.future.length === 0) return h;
      const next = h.future[0]!;
      return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
    });
  }, []);

  const status: WorkspaceStatus =
    history.present === undefined || prepareResult === undefined
      ? { kind: 'empty' }
      : prepareResult.kind === 'conflict'
        ? { kind: 'basis-conflict', document: history.present, reason: prepareResult.reason }
        : { kind: 'editing', document: history.present, prepared: prepareResult.prepared };

  // 미리보기가 만들어진 뒤 다른 문서를 열었거나(loadDocument/openWorkFile)
  // undo/redo로 문서가 바뀌었으면 이 미리보기는 더는 지금 문서의 것이
  // 아니다 — 노출 시점에 항상 다시 확인한다(독립 검토 지적). 상태를
  // 일일이 각 액션에서 지우는 대신 여기서 한 번만 비교하면, 문서를
  // 바꾸는 새 경로가 생겨도 빠뜨릴 일이 없다.
  const effectiveRecalcPreview =
    recalcPreview !== undefined && recalcPreview.sourceDocument === history.present ? recalcPreview : undefined;

  return {
    status,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    loadDocument,
    openWorkFile,
    previewRecalculateWithCurrentBasis,
    applyRecalculatedBasis,
    cancelRecalculateWithCurrentBasis,
    recalcPreview: effectiveRecalcPreview,
    resolveRow,
    setQuantity,
    setDescription,
    setRemark,
    setHeader,
    setProfile,
    setIndirectRule,
    addItem,
    removeRow,
    resolveDevice,
    resolveOption,
    resolveCable,
    applyCableRoutes,
    setInstallationInput,
    resolveConduit,
    undo,
    redo,
  };
}
