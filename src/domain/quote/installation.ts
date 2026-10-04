/**
 * 천장고·경로·배관 계산 (계획 2026-10-04-quote-workspace-ui Task 3,
 * 결정 D8 보강·D19·D22).
 *
 * ## 거리 두 종류
 *
 * - **케이블 경로** (`RouteInput`, 선 하나): `measured-route`는
 *   `(수평 + 입상 + 입하) × 1.3`. `confirmed-total`은 사람이 이미 실측해
 *   확인한 최종 산출거리이므로 **그대로 쓴다** — 1.3을 다시 곱하거나
 *   수평/입상/입하와 합쳐 재보정하지 않는다(그러면 두 배로 부풀거나
 *   사람의 실측값을 기계가 덮어쓴다).
 * - **배관** (`SpaceInput`, 공간 하나): `장비실→가장 먼 장비 거리 × 줄 수`.
 *   `×2`(왕복)도 `×1.3`(케이블 여유분)도 붙이지 않는다 — 사용자가 이미
 *   "가장 먼 거리"로 여유를 두고 있고, 줄 수를 직접 조정해 현장에 맞춘다
 *   (결정 D8). 계산 근거는 화면에 그대로 보인다 (`10m × 3줄 = 30m`).
 *
 * `RouteInput`은 이 세션에서 **함수만 완성**했다. `cables.ts`의 구간별
 * 입력 화면은 아직 없다 — 그 전까지는 기존 `bomRows.length` 기반 경로를
 * 건드리지 않는다.
 *
 * ## 배관 품목 분류는 이름이 아니라 품셈 묶음(`options.group`)으로 한다
 *
 * `Conduit`이 품명에 없는 **케이블 트레이도 배관**이다(결정 D22-1).
 * 품명 문자열 검사 대신 카탈로그 추출이 이미 심어 둔 `options.group`
 * 값으로 판정한다 — 실측: 후렉시블 제품은 전부 `group === '후렉시블'`,
 * 트레이는 `group === '케이블 트레이'`. 품셈에 `CD관` 묶음은 **아직
 * 없다** — `CONDUIT_GROUP.cd`로 걸러도 후보가 0건이면 그 사실 그대로
 * 차단한다. 0원이나 후렉시블로 대신 채우지 않는다.
 *
 * ## 트레이는 10M 품목이 아니다
 *
 * 후렉시블·CD관은 10M 단위로 판다. 케이블 트레이는 `EA`, **3M 기준**이다
 * (결정 D22-2 실측). 같은 "길이를 올림해 수량을 정한다" 규칙이지만
 * 단위가 다르므로 하나로 뭉뚱그리면 트레이 수량이 3배 넘게 틀린다.
 * `purchaseUnitMetersForGroup`가 묶음별로 다른 단위를 돌려준다.
 *
 * ## 기타자재 비율의 기본값은 품셈 설명 칸에 적힌 값이다
 *
 * 후렉시블 20%, CD관 40% — 추측이 아니라 품셈 `배관 기타자재` 행
 * 설명 칸의 실측값이다(결정 D22-2). 트레이의 비율은 **아직 없다**(O25,
 * 미결정) — 이 모듈은 트레이를 배관 종류 선택지(`ConduitType`)에 넣지
 * 않는다. 넣으려면 그 비율부터 사용자에게 확인해야 한다.
 */
import type { Catalog, CatalogProduct } from '../../data/catalog/load';
import type { ImportWarning } from '../../import/diagram/devices';
import { dec, text } from '../calculation/rounding';
import { validateDecimalInput, type DecimalValidation } from './validateInput';
import { withResolvedProduct } from './resolveProduct';
import type { ConduitType, DecimalText, QuoteDocument, QuoteSystem } from './types';

// ---------------------------------------------------------------------------
// 케이블 경로 (RouteInput) — 함수만. 화면 입력은 다음 단계.
// ---------------------------------------------------------------------------

export interface RouteInput {
  edgeId: string;
  systemId: string;
  source: 'measured-route' | 'confirmed-total';
  horizontalMeters?: DecimalText;
  riseMeters?: DecimalText;
  dropMeters?: DecimalText;
  confirmedTotalMeters?: DecimalText;
}

/** `1.3` — 직각 경로 우회·여유분(결정 D8). 배관에는 쓰지 않는다. */
export const CABLE_ROUTE_SLACK_FACTOR = '1.3';

/**
 * 경로 산출거리. 거리를 아직 정할 수 없으면(필요한 값이 비었으면)
 * **`undefined`를 돌려준다** — `0`이나 추정값으로 메우지 않는다.
 *
 * `confirmed-total`은 사람이 이미 현장에서 실측한 **최종** 값이다.
 * 같은 입력에 수평/입상/입하가 함께 있어도 다시 더하거나 1.3을 곱하지
 * 않는다 — 그러면 사람의 실측을 기계가 다시 보정해 틀어진다.
 */
export function calcRouteMeters(route: RouteInput): DecimalText | undefined {
  if (route.source === 'confirmed-total') {
    if (route.confirmedTotalMeters === undefined) return undefined;
    if (!validateDecimalInput(route.confirmedTotalMeters, '산출거리').ok) return undefined;
    return route.confirmedTotalMeters;
  }

  const { horizontalMeters, riseMeters, dropMeters } = route;
  if (horizontalMeters === undefined || riseMeters === undefined || dropMeters === undefined) {
    return undefined;
  }
  if (
    !validateDecimalInput(horizontalMeters, '수평거리').ok ||
    !validateDecimalInput(riseMeters, '입상').ok ||
    !validateDecimalInput(dropMeters, '입하').ok
  ) {
    return undefined;
  }

  const sum = dec(horizontalMeters).plus(dec(riseMeters)).plus(dec(dropMeters));
  return text(sum.times(dec(CABLE_ROUTE_SLACK_FACTOR)));
}

// ---------------------------------------------------------------------------
// 배관 (SpaceInput) — 거리 × 줄 수. 시스템(공간) 안에 둔다.
// ---------------------------------------------------------------------------

/** 공간의 새 배관 입력에 쓰는 기본 줄 수(결정 D8). */
export const DEFAULT_CONDUIT_RUNS = '3';

/** 배관 종류 → 품셈 `options.group` 원문(결정 D22-1). */
export const CONDUIT_GROUP: Record<ConduitType, string> = {
  flexible: '후렉시블',
  cd: 'CD관',
};

/** 품셈 설명 칸에 적힌 기타자재 비율(%) — 추측값이 아니다(결정 D22-2). */
export const DEFAULT_CONDUIT_MATERIAL_RATE: Record<ConduitType, DecimalText> = {
  flexible: '20',
  cd: '40',
};

/** 케이블 트레이의 품셈 묶음 이름(결정 D22-2). 비율은 아직 미정(O25)이다. */
export const TRAY_GROUP = '케이블 트레이';

/** 후렉시블·CD관의 판매 단위(m). */
export const CONDUIT_BULK_UNIT_METERS = 10;
/** 케이블 트레이의 판매 단위(m) — 10M이 아니다(결정 D22-2 실측). */
export const TRAY_UNIT_METERS = 3;

/**
 * 묶음 이름으로 "길이를 올림해 수량을 정하는" 품목의 판매 단위(m)를
 * 돌려준다. 모르는 묶음이면 `undefined` — 10M을 기본값으로 추측하지
 * 않는다.
 */
export function purchaseUnitMetersForGroup(group: string | undefined): number | undefined {
  if (group === CONDUIT_GROUP.flexible || group === CONDUIT_GROUP.cd) return CONDUIT_BULK_UNIT_METERS;
  if (group === TRAY_GROUP) return TRAY_UNIT_METERS;
  return undefined;
}

/** `group`이 배관 분류에 속하는지(결정 D22-1 — 트레이도 배관이다). */
export function isConduitGroup(group: string | undefined): boolean {
  return purchaseUnitMetersForGroup(group) !== undefined;
}

/**
 * 길이를 판매 단위로 올림한 개수. `meters`가 0 이하이면 0개 —
 * 수량을 비워 두는 것은 호출부(엔진의 "미등록" 경로) 책임이다.
 *
 * 구매 묶음(30M/50M 등) 표시는 참고 정보일 뿐 이 계산에 들어오지
 * 않는다(결정 D22 — O26 닫힘). `20m → 2`, `21m → 3`이다.
 */
export function ceilPurchaseUnits(meters: DecimalText, unitMeters: number): number {
  const m = dec(meters);
  if (m.lessThanOrEqualTo(0)) return 0;
  return m.dividedBy(unitMeters).ceil().toNumber();
}

/** 줄 수 검증 — 정수만 받는다. 소수 줄 수는 의미가 없다. */
export function validateConduitRuns(raw: string): DecimalValidation {
  const base = validateDecimalInput(raw, '줄 수');
  if (!base.ok) return base;
  if (!Number.isInteger(Number(base.value))) {
    return { ok: false, reason: '줄 수는 정수만 입력할 수 있습니다.' };
  }
  if (base.value === '0') {
    return { ok: false, reason: '줄 수는 1 이상이어야 합니다.' };
  }
  return base;
}

/**
 * 배관 길이 = 가장 먼 장비까지의 거리 × 줄 수. `×2`(왕복)도
 * `×1.3`(케이블 여유분)도 더하지 않는다 — 사용자가 "가장 먼 거리"를
 * 쓰는 것 자체가 이미 의도된 여유다(결정 D8).
 *
 * 둘 중 하나라도 비었거나 형식이 잘못됐으면 `undefined` —
 * "입력 필요" 상태를 그대로 유지하고 0m로 대체하지 않는다.
 */
export function calcConduitMeters(
  farthestDeviceMeters: DecimalText | undefined,
  conduitRuns: DecimalText | undefined,
): DecimalText | undefined {
  if (farthestDeviceMeters === undefined || conduitRuns === undefined) return undefined;
  if (!validateDecimalInput(farthestDeviceMeters, '거리').ok) return undefined;
  if (!validateConduitRuns(conduitRuns).ok) return undefined;
  return text(dec(farthestDeviceMeters).times(dec(conduitRuns)));
}

/** 화면에 그대로 보여줄 산출 근거 문구(결정 D8 — "계산을 숨기지 않는다"). */
export function conduitBasisText(
  farthestDeviceMeters: DecimalText,
  conduitRuns: DecimalText,
  conduitMeters: DecimalText,
): string {
  return `${farthestDeviceMeters}m × ${conduitRuns}줄 = ${conduitMeters}m`;
}

// ---------------------------------------------------------------------------
// 재산출 — 시스템 입력에서 배관 행 + 배관 기타자재 파생행을 만든다
// ---------------------------------------------------------------------------

/** 재산출로 교체할 배관 행을 다시 찾기 위한 표식. 실제 구성도 nodeId와
 *  겹치지 않도록 접두사를 둔다(실제 `eq-xlsx-…` 체계와 다르다). */
export function conduitRowSentinel(systemId: string): string {
  return `derived:conduit:${systemId}`;
}

export type InstallationPatch = Partial<
  Pick<QuoteSystem, 'farthestDeviceMeters' | 'conduitRuns' | 'conduitType' | 'conduitMaterialRate'>
>;

function conduitCandidates(catalog: Catalog, conduitType: ConduitType): readonly string[] {
  const group = CONDUIT_GROUP[conduitType];
  return catalog.products.filter((p: CatalogProduct) => p.options['group'] === group).map((p) => p.sku);
}

export function conduitLabel(conduitType: ConduitType): string {
  return conduitType === 'flexible' ? '후렉시블' : 'CD관';
}

type ItemSheetRow = Extract<QuoteDocument['rows'][number], { type: 'item' }>;

function findConduitRow(document: QuoteDocument, systemId: string): ItemSheetRow | undefined {
  const sentinel = conduitRowSentinel(systemId);
  return document.rows.find(
    (r): r is ItemSheetRow => r.type === 'item' && (r.sourceNodeIds?.includes(sentinel) ?? false),
  );
}

/**
 * 시스템의 배관 입력을 patch하고, 유효하면 배관 행과 `배관 기타자재`
 * 파생행을 재산출한다. 재산출은 **이 시스템에서 생성된 행을 교체**하며
 * 누적 추가하지 않는다(`conduitRowSentinel`로 찾는다). 사용자가 이미
 * 고른 SKU는, 배관 종류가 바뀌어 그 제품이 더는 해당 묶음이 아닌
 * 경우에만 지운다 — 그 밖에는 수량·근거 문구만 갱신하고 그대로 둔다.
 *
 * 경고는 여기서 만들지 않는다 — `computeInstallationWarnings`가 문서
 * 상태에서 매번 다시 파생한다(독립 검토 지적: 경고를 여기서 만들어
 * 별도 state에 쌓으면 실행취소가 문서만 되돌리고 그 state는 남아
 * 어긋난다).
 */
export function applyInstallationPatch(
  document: QuoteDocument,
  systemId: string,
  patch: InstallationPatch,
  catalog: Catalog,
): QuoteDocument {
  const system = document.systems.find((s) => s.systemId === systemId);
  if (system === undefined) return document;

  // 기타자재 비율 — 처음 생기면 선택한 종류의 기본값을 심는다. 종류가
  // 바뀌는데 비율이 아직 "기본값"이면(사용자가 명시로 지정한 적 없음)
  // 새 종류의 기본값으로 따라간다. 사용자가 명시로 지정했으면(우연히
  // 기본값과 같은 숫자를 넣었더라도) 그대로 둔다(결정 D22-2) — 값만
  // 보고 "손댔는지"를 추정하지 않고 `conduitMaterialRateManual`로
  // 출처를 명시적으로 따진다.
  const previousType = system.conduitType ?? 'flexible';
  const nextType = patch.conduitType ?? previousType;
  let nextRate = system.conduitMaterialRate;
  let nextRateManual = system.conduitMaterialRateManual ?? false;
  if (patch.conduitMaterialRate !== undefined) {
    nextRate = patch.conduitMaterialRate;
    nextRateManual = true;
  } else if (nextRate === undefined) {
    nextRate = DEFAULT_CONDUIT_MATERIAL_RATE[nextType];
    nextRateManual = false;
  } else if (nextType !== previousType && !nextRateManual) {
    nextRate = DEFAULT_CONDUIT_MATERIAL_RATE[nextType];
  }

  // 줄 수는 "새 공간의 기본값 3"이다(결정 D8) — 사용자가 그 칸을 아직
  // 건드리지 않았어도, 거리를 넣는 순간 3으로 실제 기록된다. 화면
  // 기본값 표시에만 맡기면 거리만 넣고 줄 수 칸을 안 건드린 사람은
  // 계산이 아예 안 된다.
  const nextConduitRuns = patch.conduitRuns ?? system.conduitRuns ?? DEFAULT_CONDUIT_RUNS;

  const patchedSystem: QuoteSystem = {
    ...system,
    ...patch,
    conduitRuns: nextConduitRuns,
    conduitMaterialRateManual: nextRateManual,
    ...(patch.conduitMaterialRate === undefined && nextRate !== undefined ? { conduitMaterialRate: nextRate } : {}),
  };
  const withSystems: QuoteDocument = {
    ...document,
    systems: document.systems.map((s) => (s.systemId === systemId ? patchedSystem : s)),
  };

  const conduitMeters = calcConduitMeters(patchedSystem.farthestDeviceMeters, patchedSystem.conduitRuns);
  if (conduitMeters === undefined) {
    // 거리·줄 수가 아직 없거나 형식이 틀렸다 — 행을 만들지 않는다.
    return withSystems;
  }

  const conduitType: ConduitType = patchedSystem.conduitType ?? 'flexible';
  const ratePercent = patchedSystem.conduitMaterialRate ?? DEFAULT_CONDUIT_MATERIAL_RATE[conduitType];
  const quantity = String(ceilPurchaseUnits(conduitMeters, CONDUIT_BULK_UNIT_METERS));
  const sentinel = conduitRowSentinel(systemId);
  const basisText = conduitBasisText(patchedSystem.farthestDeviceMeters!, patchedSystem.conduitRuns!, conduitMeters);

  const existing = findConduitRow(withSystems, systemId);

  const group = CONDUIT_GROUP[conduitType];
  const existingStillValid =
    existing?.sku !== undefined && catalog.products.find((p) => p.sku === existing.sku)?.options['group'] === group;

  const rowId = existing?.rowId ?? `derived-conduit-${systemId}`;
  const conduitRow: ItemSheetRow = existingStillValid
    ? { ...existing!, rowId, unit: `${CONDUIT_BULK_UNIT_METERS}M`, quantity, remark: basisText, sourceNodeIds: [sentinel] }
    : {
        type: 'item',
        rowId,
        systemId,
        name: `${conduitLabel(conduitType)} 배관 (미정)`,
        specification: '',
        unit: `${CONDUIT_BULK_UNIT_METERS}M`,
        quantity,
        laborMode: 'unresolved',
        remark: basisText,
        origin: 'rule',
        sourceNodeIds: [sentinel],
      };

  const rows = existing !== undefined
    ? withSystems.rows.map((r) => (r === existing ? conduitRow : r))
    : [...withSystems.rows, conduitRow];

  const derivedRowId = `derived-conduitmat-${systemId}`;
  const materialRow = {
    rowId: derivedRowId,
    systemId,
    name: '배관 기타자재',
    specification: `배관자재${ratePercent}%`,
    unit: '식',
    quantity: '1',
    laborMode: 'not-applicable' as const,
    remark: `배관 자재 금액 × ${ratePercent}% (결정 D19·D22)`,
    origin: 'rule' as const,
    derived: { kind: 'single-row-material' as const, sourceRowId: rowId },
    rate: text(dec(ratePercent).dividedBy(100)),
  };
  const derivedRows = [...withSystems.derivedRows.filter((d) => d.rowId !== derivedRowId), materialRow];

  return { ...withSystems, rows, derivedRows };
}

/**
 * 배관 행에 쓸 경고를 **문서+카탈로그에서 매번 새로 파생한다**(독립
 * 검토 지적 — 이전에는 `applyInstallationPatch`가 만든 경고를 workspace
 * 쪽 별도 state에 쌓았는데, 그러면 실행취소가 문서만 되돌리고 그
 * state는 그대로 남아 "행은 사라졌는데 경고는 남는다" 같은 불일치가
 * 생겼다. 이 함수는 순수 함수이고 매번 현재 문서를 그대로 읽으므로,
 * 호출하는 쪽(`workspace.prepareNow`)이 문서를 undo/redo해도 항상
 * 그 시점 문서와 일치하는 경고를 돌려준다.
 */
export function computeInstallationWarnings(document: QuoteDocument, catalog: Catalog): readonly ImportWarning[] {
  const warnings: ImportWarning[] = [];
  for (const system of document.systems) {
    const row = findConduitRow(document, system.systemId);
    if (row === undefined) continue; // 거리·줄 수 미입력 — 행이 없으니 경고도 없다
    if (row.sku !== undefined && row.sellingUnitPrice !== undefined) continue; // 이미 해소됐다

    const conduitType: ConduitType = system.conduitType ?? 'flexible';
    const candidates = conduitCandidates(catalog, conduitType);
    warnings.push({
      code: 'device-not-in-catalog',
      blocking: true,
      message:
        candidates.length === 0
          ? `품셈에 ${conduitLabel(conduitType)} 품목이 없습니다. 선택을 바꾸거나 품셈 파일에 품목을 추가해야 합니다.`
          : `배관 자재(${conduitLabel(conduitType)})를 선택하세요 — 후보 ${candidates.length}건.`,
      nodeId: conduitRowSentinel(system.systemId),
      installationSystemId: system.systemId,
      candidates,
    });
  }
  return warnings;
}

/**
 * 배관 행을 실제로 해소한다. **현재 그 시스템의 배관 종류
 * (`conduitType`)에 맞는 품셈 묶음(`options.group`)에 속한 SKU만
 * 받는다** — 일반 `resolveDevice`처럼 아무 SKU나 받으면 CD관처럼
 * 후보가 없어 차단된 상태를 엉뚱한 제품(심지어 배관이 아닌 장비)으로
 * 조용히 메워 우회할 수 있다(독립 검토 지적). 검증에 실패하면 문서를
 * 바꾸지 않는다 — 화면이 후보 밖의 선택지를 주지 않더라도, 이 경계
 * 자체가 거부해야 "후보 목록이 전부"라는 보장이 선다.
 */
export function resolveConduitProduct(
  document: QuoteDocument,
  systemId: string,
  sku: string,
  catalog: Catalog,
): QuoteDocument {
  const system = document.systems.find((s) => s.systemId === systemId);
  if (system === undefined) return document;
  const product = catalog.products.find((p) => p.sku === sku);
  if (product === undefined) return document;

  const conduitType: ConduitType = system.conduitType ?? 'flexible';
  if (product.options['group'] !== CONDUIT_GROUP[conduitType]) return document; // 묶음 불일치 — 거부

  const sentinel = conduitRowSentinel(systemId);
  const price = catalog.prices.get(sku);
  return {
    ...document,
    rows: document.rows.map((r) => {
      if (r.type !== 'item' || !(r.sourceNodeIds?.includes(sentinel) ?? false)) return r;
      return withResolvedProduct(r, product, price);
    }),
  };
}
