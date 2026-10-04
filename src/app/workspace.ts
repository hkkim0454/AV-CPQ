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
import type { QuoteDocument } from '../domain/quote/types';
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
      importWarnings: readonly ImportWarning[];
      prepared: PreparedQuote;
      profileBySystem: ReadonlyMap<string, IndirectProfileId>;
    };

export interface Workspace {
  status: WorkspaceStatus;
  canUndo: boolean;
  canRedo: boolean;
  loadDocument(input: LoadedDocument): void;
  setQuantity(rowId: string, quantity: string): void;
  setDescription(rowId: string, description: string): void;
  setRemark(rowId: string, remark: string): void;
  setProfile(systemId: string, profile: IndirectProfileId): void;
  setIndirectRule(systemId: string, itemId: string, patch: { applied?: boolean; rate?: string }): void;
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

function defaultProfiles(document: QuoteDocument): Map<string, IndirectProfileId> {
  // 새 문서는 프로파일을 아직 고르지 않은 시스템들이다. 기본은 '일반' —
  // 조용히 다른 값으로 단정하지 않는다. 사용자가 Task2 패널에서 바로
  // 바꿀 수 있다.
  return new Map(document.systems.map((s) => [s.systemId, 'general' as const]));
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
  const [importWarnings, setImportWarnings] = useState<readonly ImportWarning[]>([]);
  const [profileBySystem, setProfileBySystemState] = useState<ReadonlyMap<string, IndirectProfileId>>(
    new Map(),
  );

  const prepareNow = useCallback(
    (document: QuoteDocument, profiles: ReadonlyMap<string, IndirectProfileId>): PreparedQuote | undefined => {
      if (basis === undefined || resources === undefined) return undefined;
      return prepareQuote({
        document,
        laborReference: basis.reference,
        basisVersions: basis.versions,
        guides: resources.guides,
        profileBySystem: profiles,
        importWarnings,
        // 문서에 아직 기준이 안 적혀 있으면(새로 변환한 직후) 처음 적는다.
        // 그 다음부터는 같은 기준인지만 대조한다 — 조용한 재계산이 아니다.
        wageMode: document.versions.wage === 'unknown' ? 'initialize-new' : 'preserve',
      });
    },
    [basis, resources, importWarnings],
  );

  const prepared = useMemo(
    () => (history.present === undefined ? undefined : prepareNow(history.present, profileBySystem)),
    [history.present, profileBySystem, prepareNow],
  );

  const loadDocument = useCallback(
    (input: LoadedDocument) => {
      // 자료가 아직 준비되지 않았으면 조용히 멈춘다 — 그 사이 입구
      // 버튼은 비활성이라 화면에서는 실제로 호출되지 않는다.
      if (basis === undefined || resources === undefined) return;
      const profiles = defaultProfiles(input.document);
      // `prepareNow`를 재사용하지 않는다 — 그건 `importWarnings` 상태를
      // 클로저로 캡처하는데, 이 함수 안의 `setImportWarnings` 호출은
      // 비동기라 이 시점엔 아직 반영 전이다(이전 문서의 경고가 섞인다).
      // 그래서 여기서는 `input.importWarnings`를 직접 쓴다.
      //
      // 즉시 한 번 준비해 기준을 문서에 찍은 **그** 문서를 현재 상태로
      // 삼는다 — 안 그러면 다음 렌더의 재준비가 'initialize-new'를 다시
      // 타려다 "이미 기준이 적힌 문서" 예외를 만난다.
      const first = prepareQuote({
        document: input.document,
        laborReference: basis.reference,
        basisVersions: basis.versions,
        guides: resources.guides,
        profileBySystem: profiles,
        importWarnings: input.importWarnings,
        wageMode: 'initialize-new',
      });
      setImportWarnings(input.importWarnings);
      setProfileBySystemState(profiles);
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

  const setProfile = useCallback(
    (systemId: string, profile: IndirectProfileId) => {
      if (resources === undefined) return;
      const guides = resources.guides;
      setProfileBySystemState((prev) => {
        const next = new Map(prev);
        next.set(systemId, profile);
        return next;
      });
      // 이 시스템에 **처음** 심는 프로파일이거나 실제로 바뀐 경우에만
      // 그 프로파일의 기본 간접비 규칙을 새로 심는다. 이미 이 프로파일로
      // 심어 둔 규칙이 있으면(사용자가 적용 여부·요율을 손봤을 수 있다)
      // 조용히 덮어쓰지 않는다.
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
      : { kind: 'editing', document: history.present, importWarnings, prepared, profileBySystem };

  return {
    status,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    loadDocument,
    setQuantity,
    setDescription,
    setRemark,
    setProfile,
    setIndirectRule,
    undo,
    redo,
  };
}
