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
import { buildGuideBasis } from '../data/catalog/guideBasis';
import { prepareQuote, type PreparedQuote } from '../export/variants/prepare';
import { indirectCostsFor, type IndirectProfileId } from '../export/ooxml/guideTemplate';
import { toRow } from '../domain/quote/buildDocument';
import { computeActiveWarnings } from '../domain/quote/activeWarnings';
import { withResolvedProduct } from '../domain/quote/resolveProduct';
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
    };

export interface Workspace {
  status: WorkspaceStatus;
  canUndo: boolean;
  canRedo: boolean;
  loadDocument(input: LoadedDocument): void;
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
      (s.indirectProfileId as IndirectProfileId | undefined) ?? 'general',
    ]),
  );
}

/** 새 문서는 프로파일을 아직 고르지 않았다 — 기본 '일반'을 문서에 바로 심는다. */
function seedDefaultProfile(document: QuoteDocument, guides: Resources['guides']): QuoteDocument {
  return {
    ...document,
    systems: document.systems.map((s) => ({
      ...s,
      indirectProfileId: 'general',
      indirectCosts: indirectCostsFor('general', guides),
    })),
  };
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

  const prepareNow = useCallback(
    (document: QuoteDocument): PreparedQuote | undefined => {
      if (basis === undefined || resources === undefined) return undefined;
      return prepareQuote({
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
        importWarnings: computeActiveWarnings(document, allImportWarnings),
        // 문서에 아직 기준이 안 적혀 있으면(새로 변환한 직후) 처음 적는다.
        // 그 다음부터는 같은 기준인지만 대조한다 — 조용한 재계산이 아니다.
        wageMode: document.versions.wage === 'unknown' ? 'initialize-new' : 'preserve',
      });
    },
    [basis, resources, allImportWarnings],
  );

  const prepared = useMemo(
    () => (history.present === undefined ? undefined : prepareNow(history.present)),
    [history.present, prepareNow],
  );

  const loadDocument = useCallback(
    (input: LoadedDocument) => {
      // 자료가 아직 준비되지 않았으면 조용히 멈춘다 — 그 사이 입구
      // 버튼은 비활성이라 화면에서는 실제로 호출되지 않는다.
      if (basis === undefined || resources === undefined) return;
      const seeded = seedDefaultProfile(input.document, resources.guides);
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
        importWarnings: computeActiveWarnings(seeded, input.importWarnings),
        wageMode: 'initialize-new',
      });
      setAllImportWarnings(input.importWarnings);
      setHistory({ past: [], present: first.document, future: [] });
    },
    [basis, resources],
  );

  const commit = useCallback((mutate: (document: QuoteDocument) => QuoteDocument) => {
    setHistory((h) => {
      if (h.present === undefined) return h;
      return { past: [...h.past, h.present], present: mutate(h.present), future: [] };
    });
  }, []);

  const mutateRow = useCallback(
    (rowId: string, patch: (row: QuoteDocument['rows'][number]) => QuoteDocument['rows'][number]) => {
      commit((document) => ({
        ...document,
        rows: document.rows.map((r) => (r.rowId === rowId ? patch(r) : r)),
      }));
    },
    [commit],
  );

  const setQuantity = useCallback(
    (rowId: string, quantity: string) => {
      mutateRow(rowId, (r) => (r.type === 'item' ? { ...r, quantity } : r));
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
          // 찾아 따로 처리한다).
          if (r.type !== 'item' || r.optionId !== undefined || !(r.sourceNodeIds?.includes(nodeId) ?? false)) {
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
    history.present === undefined || prepared === undefined
      ? { kind: 'empty' }
      : { kind: 'editing', document: history.present, prepared };

  return {
    status,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    loadDocument,
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
    undo,
    redo,
  };
}
