/**
 * 확인 항목 목록 — 지금 문서에서 **매번 새로 파생한다** (사용성 2차 Task A).
 *
 * 출력 전에 사람이 해결해야 하는 것들을 한곳에 모은다. 출처는 넷이다.
 *
 * ```
 * prepared.importWarnings              구성도·품목 연결·시공 입력
 * prepared.priced.laborWarnings        품셈·노임
 * prepared.priced.calculation.warnings 수량·단가·파생 행
 * pendingCableEdit                     케이블 거리 수정이 아직 반영 안 됨
 * ```
 *
 * ## 닫아서 없애는 state 를 만들지 않는다
 *
 * 목록은 호출할 때마다 원본 배열에서 다시 만든다. "읽음"·"무시함" 같은
 * 별도 상태를 두면 실행취소와 어긋난다 — 되돌렸는데 항목이 안 돌아오거나,
 * 고쳤는데 항목이 남는다.
 *
 * ## 문구로 추측하지 않는다
 *
 * 분류와 목적지는 `code` 와 구조화된 식별자(rowId·edgeId 등)로만 정한다.
 * 메시지가 같다는 이유로 합치지도 않는다 — **같은 품명을 쓰는 두 행은
 * 서로 다른 확인 항목**이고, 한쪽을 고쳐도 다른 쪽은 남아야 한다.
 *
 * ## 이 목록이 비어도 출력 가능을 뜻하지 않는다
 *
 * 출력 가부는 `exportGate` 가 정한다. 여기서 그 판단을 복제하지 않는다.
 */
import type { PreparedQuote } from '../../export/variants/prepare';
import type { ImportWarning } from '../../import/diagram/devices';
import type { LaborWarning } from '../../domain/labor/types';
import type { CalculationWarning } from '../../domain/calculation/calculate';

/** 누르면 어디로 가는가. */
export type ReviewTarget =
  /** 그 행의 노무 근거(LaborBasisPanel)를 연다. */
  | { kind: 'labor'; rowId: string }
  /** 그 행의 수량 입력에 포커스한다. */
  | { kind: 'quantity'; rowId: string }
  /** 기존 경고 목록의 그 항목(후보·검색)으로 간다. */
  | { kind: 'import'; warningId: string }
  /** 케이블 거리 입력 영역으로 간다. */
  | { kind: 'cables' }
  /**
   * 고칠 자리를 특정할 수 없다 — 목록 안에서 원문을 펼쳐 보여준다.
   * **없는 수정 기능을 약속하지 않는다.**
   */
  | { kind: 'detail'; source: 'labor' | 'calculation'; warningId: string };

export type ReviewCategory = 'labor' | 'quantity' | 'product' | 'installation' | 'calculation';

export interface ReviewItem {
  /** 렌더 key 이자 탐색 대상. 출처가 달라도 겹치지 않는다. */
  id: string;
  source: 'import' | 'labor' | 'calculation' | 'pending-cable';
  code: string;
  category: ReviewCategory;
  message: string;
  blocking: boolean;
  target: ReviewTarget;
  rowId?: string;
  systemId?: string;
}

/**
 * 고정 순서 tuple 을 문자열로 만든다.
 *
 * ⛔ **하이픈으로 이어 붙이지 않는다.** `a-b` 와 `a` + `-b` 가 같아진다.
 * ⛔ **`nodeId ?? edgeId` 처럼 칸을 버리지 않는다.** 노드 경고와 연결선
 * 경고가 같은 id 를 갖게 되어 한쪽을 누르면 다른 쪽으로 간다.
 */
function tupleId(parts: readonly (string | null)[]): string {
  return JSON.stringify(parts);
}

/**
 * 같은 tuple 이 여러 번 나와도 **전부 보존**하고 발생 순번을 붙인다.
 *
 * 순번은 완전히 같은 identity 의 렌더 key 를 가르는 용도일 뿐이다 —
 * 오래된 탐색 요청을 허용하는 근거가 아니다(그건 `sourcePrepared` 비교가 한다).
 */
function withOccurrence<T>(entries: readonly { key: string; value: T }[]): { id: string; value: T }[] {
  const seen = new Map<string, number>();
  return entries.map(({ key, value }) => {
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return { id: n === 0 ? key : `${key}#${n}`, value };
  });
}

/**
 * 구성도 경고에 **구조로** id 를 붙인다. 요약 목록과 `WarningList` 가
 * 같은 함수를 써야 "누른 항목"과 "이동할 항목"이 어긋나지 않는다.
 *
 * ⛔ `requiredCableMeters` 나 `message` 같은 **값**은 넣지 않는다. 거리가
 * 바뀔 때마다 id 가 달라지면 항목이 remount 되어 사람이 입력하던 검색어와
 * 펼친 상태가 사라진다. 오래된 요청을 막는 일은 `sourcePrepared` 비교가 한다.
 */
export function identifyImportWarnings(
  warnings: readonly ImportWarning[],
): { id: string; warning: ImportWarning }[] {
  const keyed = warnings.map((warning) => ({
    key: tupleId([
      'import',
      warning.code,
      warning.nodeId ?? null,
      warning.edgeId ?? null,
      warning.rowId ?? null,
      warning.optionId ?? null,
      warning.sourceCableKey ?? null,
      warning.installationSystemId ?? null,
      warning.owner ?? null,
    ]),
    value: warning,
  }));
  return withOccurrence(keyed).map(({ id, value }) => ({ id, warning: value }));
}

function identifyLaborWarnings(
  warnings: readonly LaborWarning[],
): { id: string; warning: LaborWarning }[] {
  const keyed = warnings.map((warning) => ({
    key: tupleId(['labor', warning.code, warning.rowId ?? null, warning.laborMappingId ?? null]),
    value: warning,
  }));
  return withOccurrence(keyed).map(({ id, value }) => ({ id, warning: value }));
}

function identifyCalculationWarnings(
  warnings: readonly CalculationWarning[],
): { id: string; warning: CalculationWarning }[] {
  const keyed = warnings.map((warning) => ({
    key: tupleId([
      'calculation',
      warning.code,
      warning.rowId ?? null,
      warning.systemId ?? null,
      warning.itemId ?? null,
    ]),
    value: warning,
  }));
  return withOccurrence(keyed).map(({ id, value }) => ({ id, warning: value }));
}

/**
 * 구성도 경고의 분류 — 시공 입력과 품목 연결을 가른다.
 *
 * 배관 경고는 코드가 따로 있지 않고 `device-not-in-catalog` 에
 * `installationSystemId` 가 붙어서 온다(`installation.ts`). 그래서 코드만
 * 보면 품목 연결과 구분되지 않는다 — **그 칸의 존재로 가른다.**
 */
function importCategory(warning: ImportWarning): ReviewCategory {
  if (warning.installationSystemId !== undefined) return 'installation';
  switch (warning.code) {
    case 'cable-route-incomplete':
    case 'cable-length-missing':
    case 'cable-length-exceeded':
      return 'installation';
    case 'misc-classification-missing':
    case 'misc-basis-review-required':
      return 'calculation';
    default:
      return 'product';
  }
}

/** 계산 경고 중 **그 행의 노무 근거**에서 고치는 것들. */
const LABOR_CALCULATION_CODES = new Set<CalculationWarning['code']>([
  'labor-unresolved',
  'labor-mapping-missing',
  'manual-labor-incomplete',
  'not-applicable-reason-missing',
]);

function calculationCategory(code: CalculationWarning['code']): ReviewCategory {
  if (code === 'quantity-unresolved') return 'quantity';
  if (LABOR_CALCULATION_CODES.has(code)) return 'labor';
  return 'calculation';
}

export function buildReviewItems(
  prepared: PreparedQuote,
  pendingCableEdit: boolean,
): ReviewItem[] {
  const items: ReviewItem[] = [];

  for (const { id, warning } of identifyImportWarnings(prepared.importWarnings)) {
    items.push({
      id,
      source: 'import',
      code: warning.code,
      category: importCategory(warning),
      message: warning.message,
      blocking: warning.blocking,
      // 구성도 경고는 기존 해소 UI(후보·검색·배관·케이블)가 있는 자리로 간다.
      // 전용 검증을 일반 카탈로그 검색으로 우회하지 않는다.
      target: { kind: 'import', warningId: id },
      ...(warning.rowId === undefined ? {} : { rowId: warning.rowId }),
      ...(warning.installationSystemId === undefined ? {} : { systemId: warning.installationSystemId }),
    });
  }

  for (const { id, warning } of identifyLaborWarnings(prepared.priced.laborWarnings)) {
    items.push({
      id,
      source: 'labor',
      code: warning.code,
      category: 'labor',
      message: warning.message,
      blocking: warning.blocking,
      // 행을 특정할 수 없으면 고칠 자리도 없다 — 원문만 펼쳐 보여준다.
      target:
        warning.rowId === undefined
          ? { kind: 'detail', source: 'labor', warningId: id }
          : { kind: 'labor', rowId: warning.rowId },
      ...(warning.rowId === undefined ? {} : { rowId: warning.rowId }),
    });
  }

  for (const { id, warning } of identifyCalculationWarnings(prepared.priced.calculation.warnings)) {
    const category = calculationCategory(warning.code);
    const target: ReviewTarget =
      warning.rowId !== undefined && category === 'quantity'
        ? { kind: 'quantity', rowId: warning.rowId }
        : warning.rowId !== undefined && category === 'labor'
          ? { kind: 'labor', rowId: warning.rowId }
          : { kind: 'detail', source: 'calculation', warningId: id };
    items.push({
      id,
      source: 'calculation',
      code: warning.code,
      category,
      message: warning.message,
      blocking: warning.blocking,
      target,
      ...(warning.rowId === undefined ? {} : { rowId: warning.rowId }),
      ...(warning.systemId === undefined ? {} : { systemId: warning.systemId }),
    });
  }

  if (pendingCableEdit) {
    items.push({
      id: tupleId(['pending-cable']),
      source: 'pending-cable',
      code: 'pending-cable-edit',
      category: 'installation',
      message: '케이블 거리 수정이 아직 견적에 반영되지 않았습니다. 적용하거나 취소해야 합니다.',
      blocking: true,
      target: { kind: 'cables' },
    });
  }

  return items;
}

/** 분류별 건수. **품목 수가 아니라 확인 항목 수**다. */
export function countByCategory(items: readonly ReviewItem[]): Record<ReviewCategory, number> {
  const counts: Record<ReviewCategory, number> = {
    labor: 0, quantity: 0, product: 0, installation: 0, calculation: 0,
  };
  for (const item of items) counts[item.category] += 1;
  return counts;
}

export const CATEGORY_LABEL: Record<ReviewCategory, string> = {
  labor: '노무 확인',
  quantity: '수량 확인',
  product: '품목 연결',
  installation: '시공 입력',
  calculation: '계산 확인',
};
