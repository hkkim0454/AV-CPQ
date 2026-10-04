/**
 * 원가 없는 작업 파일 — 저장·열기 (계획 2026-10-04-quote-workspace-ui
 * Task 4).
 *
 * `QuoteDocument`는 설계상 이미 원가 없는 타입이다(타입 자신의 주석이
 * 그 보증이다). 그래도 **실행 시 스키마로 한 번 더 확인한다** — 타입
 * 단언만으로 통과시키지 않는다. 모든 객체 스키마가 `.strict()`라
 * 미리 적어 두지 않은 칸이 섞여 있으면(예: 미래의 실수로 원가 비슷한
 * 필드가 행에 붙는 경우) 저장도 열기도 거부한다 — 조용히 걸러서
 * 내보내지 않는다.
 *
 * `encodeWorkFile`은 메모리의 문서를 그대로 믿지 않고 **저장 직전에도
 * 같은 스키마로 검증**한다. `decodeWorkFile`은 손상된 JSON·지원하지
 * 않는 `schemaVersion`을 **던지지 않고** 결과 타입으로 돌려준다 —
 * 호출부(워크스페이스)가 지금 열려 있는 작업을 잃지 않고 사유만
 * 보여줄 수 있어야 한다.
 */
import { z } from 'zod';
import type { QuoteDocument } from '../../domain/quote/types';

const decimalText = z.string().regex(/^-?\d+(\.\d+)?$/, '10진수 문자열이어야 한다');

/**
 * 케이블 구간 거리 입력 전용 — 빈 문자열도 허용한다(독립 검토 지적).
 *
 * `RouteInput`의 수평/입상/입하 칸은 **한 구간만 입력하고 나머지는 비워
 * 두는 중간 상태**를 그대로 저장할 수 있어야 한다(`CableRoutePanel`의
 * "입력하지 않은 구간은 원본 유지" 문구가 그 상태다). `calcRouteMeters`도
 * 빈 문자열을 "아직 못 정함"으로 다루지 "0"으로 다루지 않는다 — 스키마가
 * 더 엄격하게 굴어 미완성 작업을 저장 자체에서 막으면 안 된다.
 */
const routeMeters = z.union([decimalText, z.literal('')]).optional();

// ---------------------------------------------------------------------------
// 구성도 원본 — captureCableSource가 만드는 좁은 모양만 허용한다. 전체
// DiagramFile(알 수 없는 확장 필드 포함)을 그대로 받지 않는다.
// ---------------------------------------------------------------------------

const cableSourceBomRow = z
  .object({
    cableType: z.enum(['ready-made', 'manufactured']).optional(),
    productName: z.string().optional(),
    length: z.string().optional(),
    quantity: z.string().optional(),
    lineTypeId: z.string().optional(),
  })
  .strict();

const cableSourceNode = z
  .object({
    id: z.string(),
    data: z.object({ name: z.string().optional() }).strict(),
  })
  .strict();

const cableSourceLineType = z.object({ id: z.string(), name: z.string() }).strict();

const cableSourceEdge = z
  .object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    data: z
      .object({
        lineTypeId: z.string().optional(),
        bomRows: z.array(cableSourceBomRow),
      })
      .strict(),
  })
  .strict();

const cableSourceSchema = z
  .object({
    version: z.string(),
    nodes: z.array(cableSourceNode),
    lineTypes: z.array(cableSourceLineType),
    edges: z.array(cableSourceEdge),
  })
  .strict();

const routeInputSchema = z
  .object({
    edgeId: z.string(),
    systemId: z.string(),
    source: z.enum(['measured-route', 'confirmed-total']),
    horizontalMeters: routeMeters,
    riseMeters: routeMeters,
    dropMeters: routeMeters,
    confirmedTotalMeters: routeMeters,
  })
  .strict();

const importWarningSchema = z
  .object({
    owner: z.literal('cable-generation').optional(),
    code: z.enum([
      'misc-classification-missing',
      'misc-basis-review-required',
      'device-not-in-catalog',
      'device-ambiguous-match',
      'option-definition-missing',
      'price-not-registered',
      'unknown-line-type',
      'cable-item-unresolved',
      'cable-length-missing',
      'cable-length-exceeded',
      'cable-route-incomplete',
      'edge-endpoint-missing',
    ]),
    blocking: z.boolean(),
    message: z.string(),
    nodeId: z.string().optional(),
    edgeId: z.string().optional(),
    sourceCableKey: z.string().optional(),
    requiredCableMeters: z.string().optional(),
    candidates: z.array(z.string()).optional(),
    optionId: z.string().optional(),
    installationSystemId: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// 견적 행
// ---------------------------------------------------------------------------

const quoteRowSchema = z
  .object({
    rowId: z.string(),
    systemId: z.string(),
    productId: z.string().optional(),
    sku: z.string().optional(),
    name: z.string(),
    specification: z.string(),
    unit: z.string(),
    quantity: decimalText,
    quantityUnresolved: z.literal(true).optional(),
    sellingUnitPrice: decimalText.optional(),
    laborMode: z.enum(['mapped', 'manual', 'not-applicable', 'unresolved']),
    laborMappingId: z.string().optional(),
    manualLaborUnitPrice: decimalText.optional(),
    overrideReason: z.string().optional(),
    location: z.string().optional(),
    internalDescription: z.string().optional(),
    conversionNote: z.string().optional(),
    remark: z.string(),
    sourceNodeIds: z.array(z.string()).optional(),
    optionId: z.string().optional(),
    sourceEdgeIds: z.array(z.string()).optional(),
    sourceCableKey: z.string().optional(),
    sourceCableMembers: z.array(z.string()).optional(),
    origin: z.enum(['manual', 'sample', 'rule']),
    ruleInstanceId: z.string().optional(),
  })
  .strict();

const displayRowSchema = z
  .object({
    rowId: z.string(),
    systemId: z.string(),
    kind: z.enum(['group', 'subgroup', 'note']),
    name: z.string(),
    specification: z.string().optional(),
    materialNote: z.string().optional(),
    remark: z.string().optional(),
  })
  .strict();

const sheetRowSchema = z.discriminatedUnion('type', [
  quoteRowSchema.extend({ type: z.literal('item') }),
  displayRowSchema.extend({ type: z.literal('display') }),
]);

const derivedBasisSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('single-row-material'), sourceRowId: z.string() }).strict(),
  z
    .object({ kind: z.literal('material-sum-to-here'), excludedRowIds: z.array(z.string()).optional() })
    .strict(),
]);

const derivedRowSchema = quoteRowSchema
  .omit({ sellingUnitPrice: true })
  .extend({ derived: derivedBasisSchema, rate: decimalText })
  .strict();

// ---------------------------------------------------------------------------
// 시스템·간접비
// ---------------------------------------------------------------------------

const indirectBasisSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('labor') }).strict(),
  z.object({ kind: z.literal('direct') }).strict(),
  z.object({ kind: z.literal('composite'), plusItemIds: z.array(z.string()) }).strict(),
  z.object({ kind: z.literal('item'), itemId: z.string() }).strict(),
]);

const indirectCostRuleSchema = z
  .object({
    itemId: z.string(),
    conditionText: z.string().optional(),
    name: z.string(),
    basisLabel: z.string(),
    basis: indirectBasisSchema,
    rate: decimalText,
    applied: z.boolean(),
    source: z.string(),
  })
  .strict();

const quoteSystemSchema = z
  .object({
    systemId: z.string(),
    indirectProfileId: z.string().optional(),
    name: z.string(),
    summarySpec: z.string(),
    unit: z.string(),
    quantity: decimalText,
    remark: z.string(),
    indirectCosts: z.array(indirectCostRuleSchema),
    farthestDeviceMeters: decimalText.optional(),
    conduitRuns: decimalText.optional(),
    conduitType: z.enum(['flexible', 'cd']).optional(),
    conduitMaterialRate: decimalText.optional(),
    conduitMaterialRateManual: z.boolean().optional(),
  })
  .strict();

const coverGroupSchema = z
  .object({
    groupId: z.string(),
    marker: z.string(),
    name: z.string(),
    systemIds: z.array(z.string()),
  })
  .strict();

const quoteHeaderSchema = z
  .object({
    quoteNumber: z.string(),
    quoteDate: z.string(),
    customer: z.string(),
    projectName: z.string(),
    contact: z.string(),
    conditions: z.array(z.string()),
  })
  .strict();

const roundingPolicySchema = z.object({ coverTotalDigits: z.number().int() }).strict();

const documentVersionsSchema = z
  .object({
    catalog: z.string(),
    labor: z.string(),
    wage: z.string(),
    template: z.string(),
    rule: z.string(),
  })
  .strict();

// ---------------------------------------------------------------------------
// 부자재(현재 비활성 — D4) — 모양만 지키고 저장·복원한다.
// ---------------------------------------------------------------------------

const portSpecSchema = z
  .object({
    portId: z.string(),
    direction: z.enum(['in', 'out', 'bidirectional']),
    signal: z.enum([
      'hdmi',
      'displayport',
      'hdbaset',
      'usb',
      'analog-audio',
      'speaker-passive',
      'network',
      'control-serial',
    ]),
    count: z.number(),
    evidence: z.enum(['verified', 'review-required', 'conflicted']),
    note: z.string().optional(),
  })
  .strict();

const equipmentInstanceSchema = z
  .object({
    instanceId: z.string(),
    rowId: z.string().optional(),
    sku: z.string().optional(),
    label: z.string(),
    location: z.string().optional(),
    ports: z.array(portSpecSchema),
  })
  .strict();

const connectionSchema = z
  .object({
    connectionId: z.string(),
    fromInstanceId: z.string(),
    fromPortId: z.string(),
    toInstanceId: z.string(),
    toPortId: z.string(),
    signal: z.enum([
      'hdmi',
      'displayport',
      'hdbaset',
      'usb',
      'analog-audio',
      'speaker-passive',
      'network',
      'control-serial',
    ]),
    distanceM: decimalText.optional(),
    quantity: decimalText,
    note: z.string().optional(),
  })
  .strict();

const existingSupplySchema = z
  .object({
    supplyId: z.string(),
    sku: z.string().optional(),
    description: z.string(),
    quantity: decimalText,
    unit: z.string(),
    reason: z.enum(['existing-on-site', 'included-with-product', 'separate-contract']),
  })
  .strict();

// ---------------------------------------------------------------------------
// 문서 전체
// ---------------------------------------------------------------------------

export const quoteDocumentSchema = z
  .object({
    cableSource: cableSourceSchema.optional(),
    cableBaseline: z.array(sheetRowSchema).optional(),
    cableRoutes: z.array(routeInputSchema).optional(),
    cableWarnings: z.array(importWarningSchema).optional(),
    entryKind: z.enum(['diagram', 'picker']).optional(),
    importWarnings: z.array(importWarningSchema).optional(),
    schemaVersion: z.literal(1),
    documentId: z.string(),
    mode: z.enum(['material-and-labor', 'labor-only']),
    header: quoteHeaderSchema,
    coverGroups: z.array(coverGroupSchema),
    systems: z.array(quoteSystemSchema),
    rows: z.array(sheetRowSchema),
    derivedRows: z.array(derivedRowSchema),
    negoDeduction: decimalText,
    rounding: roundingPolicySchema,
    versions: documentVersionsSchema,
    equipment: z.array(equipmentInstanceSchema),
    connections: z.array(connectionSchema),
    existingSupplies: z.array(existingSupplySchema),
  })
  .strict();

export const WORK_FILE_SCHEMA_VERSION = 1 as const;

export type DecodeWorkFileResult =
  | { ok: true; document: QuoteDocument }
  | { ok: false; reason: string };

/**
 * `.strict()`는 **칸의 모양**만 본다 — 같은 ID가 두 번 나오거나, 행이
 * 없는 systemId를 가리키거나, 수량이 음수인 것은 구조적으로 전부
 * "유효한 모양"이라 그냥 통과한다(독립 검토 지적). 화면의 실제 UI는
 * 애초에 이런 상태를 만들 수 없다 —
 * `validateQuantityInput`(`domain/quote/validateInput.ts`)이 음수 입력을
 * 막고, 행은 항상 이미 있는 systemId로만 만들어진다. 작업 파일이
 * (손상되었든 변조되었든) 이 불변식을 어기면 그 불변식에 기대는 계산
 * (예: 시스템별 합계)이 조용히 틀어진다 — orphan 행은 어느 시스템
 * 합계에도 안 잡혀 합계에서 사라질 수 있다.
 *
 * 전부는 아니다 — `sourceCableMembers`/`sourceCableKey`처럼 더 깊은
 * 케이블 식별 관계까지는 이번 범위에서 보지 않는다(그 불변식은 아직
 * 이 파일 밖 코드만 알고 있다). 아래가 보는 것은 ID 유일성·소속 시스템
 * 참조·음수 금지·파생행의 source/exclusion 참조·케이블 경로가 가리키는
 * edge·케이블 기준 행의 존재뿐이다.
 */
function structuralIssues(document: QuoteDocument): string[] {
  const issues: string[] = [];
  const systemIds = new Set(document.systems.map((s) => s.systemId));
  const rowIds = new Set<string>();

  const checkRowId = (id: string, label: string) => {
    if (rowIds.has(id)) issues.push(`${label} ID가 중복됐다: ${id}`);
    rowIds.add(id);
  };
  const checkSystemRef = (systemId: string, label: string) => {
    if (!systemIds.has(systemId)) issues.push(`${label}의 systemId(${systemId})가 없는 시스템을 가리킨다.`);
  };

  for (const row of document.rows) {
    checkRowId(row.rowId, '행');
    checkSystemRef(row.systemId, `행 ${row.rowId}`);
    if (row.type === 'item' && row.quantity.trim().startsWith('-')) {
      issues.push(`행 ${row.rowId}의 수량이 음수다(${row.quantity}).`);
    }
  }

  for (const row of document.derivedRows) {
    checkRowId(row.rowId, '파생행');
    checkSystemRef(row.systemId, `파생행 ${row.rowId}`);
    const derived = row.derived;
    if (derived.kind === 'single-row-material') {
      const sourceRowId = derived.sourceRowId;
      if (!document.rows.some((r) => r.rowId === sourceRowId)) {
        issues.push(`파생행 ${row.rowId}의 sourceRowId(${sourceRowId})가 없는 행을 가리킨다.`);
      }
    } else {
      for (const excludedId of derived.excludedRowIds ?? []) {
        if (!document.rows.some((r) => r.rowId === excludedId)) {
          issues.push(`파생행 ${row.rowId}의 제외 행(${excludedId})이 없는 행을 가리킨다.`);
        }
      }
    }
  }

  for (const group of document.coverGroups) {
    for (const systemId of group.systemIds) {
      checkSystemRef(systemId, `갑지 그룹 ${group.groupId}`);
    }
  }

  if (document.cableSource !== undefined) {
    const edgeIds = new Set(document.cableSource.edges.map((e) => e.id));
    for (const route of document.cableRoutes ?? []) {
      if (!edgeIds.has(route.edgeId)) {
        issues.push(`케이블 경로가 구성도에 없는 edge(${route.edgeId})를 가리킨다.`);
      }
    }
  }
  for (const row of document.cableBaseline ?? []) {
    if (!rowIds.has(row.rowId)) {
      issues.push(`케이블 기준 행(${row.rowId})이 실제 rows에 없다.`);
    }
  }

  return issues;
}

/**
 * 저장 직전에도 같은 스키마로 다시 검증한다 — 메모리의 문서가 어떤
 * 경로로 만들어졌든(미래의 실수 포함) 허용 목록 밖의 칸이 있으면
 * 저장 자체를 거부한다. 구조적 관계(`structuralIssues`)도 저장
 * 시점에 먼저 본다 — 내부 버그라면 저장 때 바로 드러나는 편이 낫다.
 */
export function encodeWorkFile(document: QuoteDocument): string {
  const parsed = quoteDocumentSchema.parse(document);
  const issues = structuralIssues(parsed as unknown as QuoteDocument);
  if (issues.length > 0) {
    throw new Error(`작업 파일로 저장할 수 없다 — 문서 내부 상태가 일관되지 않는다: ${issues.join('; ')}`);
  }
  return JSON.stringify(parsed);
}

export function decodeWorkFile(text: string): DecodeWorkFileResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: '파일이 올바른 JSON이 아니다.' };
  }

  if (typeof raw !== 'object' || raw === null || !('schemaVersion' in raw)) {
    return { ok: false, reason: '작업 파일 형식이 아니다 — schemaVersion이 없다.' };
  }
  const schemaVersion = (raw as { schemaVersion: unknown }).schemaVersion;
  if (schemaVersion !== WORK_FILE_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `지원하지 않는 작업 파일 버전이다(schemaVersion: ${String(schemaVersion)}). ` +
        `이 프로그램은 ${WORK_FILE_SCHEMA_VERSION}만 연다.`,
    };
  }

  const result = quoteDocumentSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, reason: `작업 파일 내용이 올바르지 않다: ${result.error.message}` };
  }
  const document = result.data as unknown as QuoteDocument;
  const issues = structuralIssues(document);
  if (issues.length > 0) {
    return { ok: false, reason: `작업 파일 내용이 일관되지 않는다: ${issues.join('; ')}` };
  }
  return { ok: true, document };
}
