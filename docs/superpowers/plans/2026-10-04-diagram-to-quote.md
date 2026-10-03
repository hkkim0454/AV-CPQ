# 구성도 → 견적서 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** av-builder 가 내보낸 구성도 JSON 을 읽어 `QuoteDocument` 를 만든다. 장비·옵션 카드·케이블·커넥터·배관이 견적 행으로 들어가고, 기존 계산 엔진과 exporter 를 그대로 태워 **원본 양식 Excel 까지** 나온다.

**Architecture:** 순수 변환 파이프라인. `DiagramFile → 검증 → 장비 행 → 케이블 행 → 파생 행(커넥터·배관) → QuoteDocument`. 각 단계가 순수 함수라 전부 vitest 로 덮인다. 계산·Excel 은 **이미 있는 것을 재사용**하고 손대지 않는다. 카탈로그는 단가·품셈 **조회용**으로만 쓴다.

**Tech Stack:** TypeScript 5.9, Zod 4.1, Vitest 3.2, decimal.js 10.6 (기존 스택. 새 의존성 없음)

**Spec:**
- `docs/interface/av-builder.md` — **JSON 규격. 이 계획의 입력 계약**
- `docs/decisions/2026-10-03-scope-and-data.md` — **D7 범위**, **D8 케이블·커넥터·배관 규칙**, D1 카탈로그, D3 가격 분리
- `docs/design-spec.md` — §5.6 미등록 가격, §6.1 행 모델, §7.3 멱등성, §7.5 미해결 차단
- `docs/stage-status.md` — 끝난 것과 전제. **착수 전 읽는다**

---

## Global Constraints

- **계산 엔진과 exporter 를 수정하지 않는다.** `src/domain/calculation/**`, `src/domain/labor/**`, `src/export/**` 는 읽기 전용이다. 이 계획은 그 앞단에 `QuoteDocument` 를 만들어 넣을 뿐이다. 고쳐야 할 이유가 생기면 멈추고 `Ruling:` 으로 보고한다.
- **`undefined` 는 미등록, `0` 은 0원** (설계서 §5.6). 구성도에 있는 장비인데 카탈로그에 없으면 `sellingUnitPrice` 를 **넣지 않는다.** 0 으로 채우지 않는다.
- **추측해서 채우지 않는다.** 매칭이 모호하면 `evidence: 'review-required'` + 경고를 남긴다. 설계서 §7.5 의 "미확인을 확인 완료로 바꾸는 우회 버튼을 만들지 않는다" 와 같은 원칙이다.
- **같은 JSON 을 두 번 불러도 결과가 같아야 한다** (설계서 §7.3 멱등성). 수량이 누적되지 않는다.
- **모르는 필드는 거부하지 않는다 — 그리고 버리지도 않는다.** av-builder 가 필드를 추가해도 깨지지 않아야 하고(`docs/interface/av-builder.md` §5), 나중에 그 중 하나가 필요해졌을 때 다시 파싱하지 않도록 index signature 로 들고 간다. 실물에 `series`·`dimmed`·`imageUrl`·`isReused` 가 있었다.
- **`lineTypes` 의 id 를 하드코딩하지 않는다.** 사용자가 새 선 종류를 추가할 수 있다. 모르는 id 는 경고만 세우고 진행한다.
- 금액·수량은 전부 `DecimalText`(string). `Decimal` 문자열화는 `toFixed()` 로 통일한다.
- Task 완료 조건은 **`npm run verify`** (typecheck → test → audit:exports). "테스트 통과"만 쓰지 않는다 — 없는 값은 테스트가 쳐다보지 않는다.
- 커밋 메시지는 한국어 한 줄.

### 실물 입력 (측정값)

`av-diagram-1791037942542.json` 기준.

```
version "1.1"
nodes 5        장비 — name / model / manufacturer / category / inputs / outputs / bidirectional
edges 4        연결 — source·sourceHandle → target·targetHandle, data.lineTypeId
lineTypes 7    sdi · video(HDMI) · network(LAN) · audio · usb · control · (사용자 추가 DP)
equipmentDB 674
```

- `model` 기준 카탈로그 매칭 **554/674 = 82%**
- 옵션 카드: `selectedOptionQuantities: {"eqopt-xlsx-454":4, "eqopt-xlsx-456":4}` — **수량만 있고 정의가 없다** (av-builder 미구현, `docs/interface/av-builder.md` §2)
- `edges[].data.bomRows` 가 이 샘플에서는 **전부 비어 있다**

### D8 규칙 (전부 이 계획에서 구현)

| | 규칙 |
|---|---|
| 케이블 길이 | `(직각 경로 + 상하 높이) × 1.3` — 도면 연동은 **이 계획 범위 밖**. 여기서는 선에 적힌 길이를 쓴다 |
| 완제품 | 길이 계단 `1·2·3·5·7·10·15·20m` 으로 **올림**, 개수(EA) |
| 벌크 | 길이 합산 후 **10M 단위 올림** |
| 커넥터 | **구간당 3개**(사용 2 + 예비 1) → 10EA 묶음 올림 |
| 배관 | **공간 1개당 50m** 고정 → Conduit 10M × 5. 60% 규칙은 폐기 |

---

## Review Focus

1. **옵션 카드 정의가 없는 JSON** — 현재 av-builder 가 `selectedOptionQuantities` 만 내보낸다. 이 계획이 `options` 를 **필수로 요구하면 지금 있는 파일을 아예 못 읽는다.** 반대로 조용히 무시하면 카드 15줄(74만~190만원/장)이 통째로 빠진 견적이 나간다. Task 3 이 "수량은 살리고 제품은 미상으로 두되 **blocking 경고**" 로 고정한다.
2. **카탈로그에 없는 장비 120건** — Televic 회의시스템, ATEN KVM, 규격만 있는 스크린 등. `sellingUnitPrice` 를 0 으로 채우면 설계서 §5.6 위반이고, 행을 빼면 견적에서 장비가 사라진다. Task 2 가 "행은 만들되 단가 미등록 + 경고" 로 고정한다.
3. **같은 모델 장비가 여러 대** — 구성도에 PTZ 카메라 노드가 3개 있었다. 3행으로 낼지 1행 수량 3으로 낼지에 따라 견적서가 달라진다. 설계서 §6.1 은 `rowId ≠ productId` 를 요구하지만, 견적서 실물은 `SRG-X40UH 4EA` 처럼 **합쳐서** 쓴다. Task 4 가 "같은 SKU + 같은 시스템이면 합산" 으로 고정한다.
4. **두 번 불러오기** — 같은 JSON 을 다시 불러오면 수량이 두 배가 되면 안 된다(설계서 §7.3). Task 6 이 같은 입력을 두 번 넣어 결과가 같음을 고정한다.
5. **`bomRows` 가 빈 연결** — 실물 샘플이 그렇다. 케이블 품목을 못 정하면 선은 있는데 케이블이 없는 견적이 된다. Task 5 가 "선 종류별 기본 케이블로 행을 만들되 **수량 미입력 + blocking**" 으로 고정한다. 설계서 §7.5 의 "미해결 필수 항목은 확정을 차단" 이다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/import/diagram/schema.ts` | **신규** 구성도 JSON 의 Zod 스키마. 모르는 필드 허용 |
| `src/import/diagram/types.ts` | **신규** 파싱 결과 타입 |
| `src/import/diagram/matchCatalog.ts` | **신규** `model` → 카탈로그 SKU 조회 |
| `src/import/diagram/devices.ts` | **신규** nodes + 옵션 카드 → 장비 행 |
| `src/import/diagram/cables.ts` | **신규** edges + bomRows → 케이블 행 (D8 규칙 1) |
| `src/import/diagram/derived.ts` | **신규** 커넥터·배관 행 (D8 규칙 2·3) |
| `src/import/diagram/toQuote.ts` | **신규** 전부 묶어 `QuoteDocument` 생성 |
| `tests/unit/diagramSchema.test.ts` | 스키마·모르는 필드·버전 |
| `tests/unit/matchCatalog.test.ts` | 매칭·미등록 |
| `tests/unit/diagramDevices.test.ts` | 장비 행·옵션 카드·합산 |
| `tests/unit/diagramCables.test.ts` | 완제품 계단·벌크 10M·빈 bomRows |
| `tests/unit/diagramDerived.test.ts` | 커넥터·배관 |
| `tests/integration/diagramToQuote.test.ts` | 실물 JSON → Excel 까지 |
| `tests/fixtures/diagram.ts` | 구성도 픽스처 빌더 |

---

### Task 1: JSON 스키마와 읽기

**Files:**
- Create: `src/import/diagram/schema.ts`, `src/import/diagram/types.ts`
- Test: `tests/unit/diagramSchema.test.ts`, `tests/fixtures/diagram.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DiagramPort { id: string; label?: string; type?: string; direction?: string }
  export interface DiagramNodeData {
    id?: string; name?: string; model?: string; manufacturer?: string;
    category?: string; description?: string;
    inputs?: DiagramPort[]; outputs?: DiagramPort[]; bidirectional?: DiagramPort[];
    /** 옵션 id → 장착 수량. av-builder 가 options 정의를 아직 안 내보낸다. */
    selectedOptionQuantities?: Record<string, number>;
    /** av-builder 가 추가할 예정. 없을 수 있다. */
    systemName?: string;
  }
  export interface DiagramNode { id: string; type?: string; data: DiagramNodeData }
  export interface DiagramBomRow {
    cableType?: 'ready-made' | 'manufactured';
    productName?: string; length?: string; quantity?: string; lineTypeId?: string;
  }
  export interface DiagramEdge {
    id: string; source: string; target: string;
    sourceHandle?: string; targetHandle?: string;
    data?: { lineTypeId?: string; bomRows?: DiagramBomRow[] };
  }
  export interface DiagramLineType { id: string; name: string; color?: string }
  /** av-builder 가 §2 를 구현하면 채워진다. 지금은 비어 온다. */
  export interface DiagramOption { id: string; model: string; name?: string; manufacturer?: string }
  export interface DiagramFile {
    version: string;
    nodes: DiagramNode[];
    edges: DiagramEdge[];
    lineTypes: DiagramLineType[];
    equipmentDB?: unknown[];
    options?: DiagramOption[];
  }
  export function parseDiagram(raw: unknown): DiagramFile;   // 실패 시 throw
  ```

스키마는 **느슨하게** 짠다. `.strict()` 를 쓰지 않는다 — av-builder 가 필드를 추가해도 깨지면 안 된다(`docs/interface/av-builder.md` §5).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/diagramSchema.test.ts
import { describe, expect, it } from 'vitest';
import { parseDiagram } from '../../src/import/diagram/schema.js';

const min = () => ({
  version: '1.1',
  nodes: [{ id: 'n1', type: 'equipment', data: { name: 'PTZ 카메라', model: 'SRG-A40' } }],
  edges: [],
  lineTypes: [{ id: 'video', name: 'HDMI', color: '#ef4444' }],
});

describe('parseDiagram', () => {
  it('최소 구성을 읽는다', () => {
    const d = parseDiagram(min());
    expect(d.version).toBe('1.1');
    expect(d.nodes[0].data.model).toBe('SRG-A40');
  });

  it('모르는 필드를 무시하고 통과시킨다 — av-builder 가 필드를 추가해도 깨지지 않는다', () => {
    const raw = { ...min(), 미래필드: 1, nodes: [{ ...min().nodes[0], 새필드: true, data: { ...min().nodes[0].data, 또다른: 'x' } }] };
    expect(() => parseDiagram(raw)).not.toThrow();
  });

  it('version 이 없으면 던진다', () => {
    const raw = { ...min() } as Record<string, unknown>;
    delete raw.version;
    expect(() => parseDiagram(raw)).toThrow(/version/);
  });

  it('nodes 가 없으면 던진다', () => {
    const raw = { ...min() } as Record<string, unknown>;
    delete raw.nodes;
    expect(() => parseDiagram(raw)).toThrow();
  });

  it('edges 가 비어 있어도 된다 — 장비만 놓고 선을 안 그은 구성도', () => {
    expect(parseDiagram(min()).edges).toEqual([]);
  });

  it('options 가 없어도 된다 — av-builder 가 아직 안 내보낸다', () => {
    expect(parseDiagram(min()).options).toBeUndefined();
  });

  it('selectedOptionQuantities 를 보존한다', () => {
    const raw = { ...min(), nodes: [{ id: 'n1', data: { name: 'M', model: 'XDM-12', selectedOptionQuantities: { 'eqopt-454': 4 } } }] };
    expect(parseDiagram(raw).nodes[0].data.selectedOptionQuantities).toEqual({ 'eqopt-454': 4 });
  });

  it('bomRows 를 보존한다', () => {
    const raw = { ...min(), edges: [{ id: 'e1', source: 'n1', target: 'n1',
      data: { lineTypeId: 'video', bomRows: [{ cableType: 'ready-made', productName: 'HDMI 3m', length: '3', quantity: '2' }] } }] };
    expect(parseDiagram(raw).edges[0].data?.bomRows?.[0].quantity).toBe('2');
  });

  it('사용자가 추가한 lineType 도 읽는다 — id 를 하드코딩하지 않는다', () => {
    const raw = { ...min(), lineTypes: [...min().lineTypes, { id: 'lt-1784014150344', name: 'DP', color: '#ff8585' }] };
    expect(parseDiagram(raw).lineTypes.map((l) => l.id)).toContain('lt-1784014150344');
  });

  it('JSON 이 아닌 값이면 던진다', () => {
    expect(() => parseDiagram('문자열')).toThrow();
    expect(() => parseDiagram(null)).toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/unit/diagramSchema.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// src/import/diagram/schema.ts
/**
 * av-builder 구성도 JSON 읽기.
 *
 * 규격: docs/interface/av-builder.md
 * 핵심 약속: **모르는 필드는 무시한다.** av-builder 가 필드를 추가해도 깨지지 않는다.
 *           그래서 .strict() 를 쓰지 않는다.
 */
import { z } from 'zod';
import type { DiagramFile } from './types.js';

const port = z.object({
  id: z.string(),
  label: z.string().optional(),
  type: z.string().optional(),
  direction: z.string().optional(),
}).loose();

const nodeData = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  model: z.string().optional(),
  manufacturer: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  inputs: z.array(port).optional(),
  outputs: z.array(port).optional(),
  bidirectional: z.array(port).optional(),
  selectedOptionQuantities: z.record(z.string(), z.number()).optional(),
  systemName: z.string().optional(),
}).loose();

const bomRow = z.object({
  cableType: z.enum(['ready-made', 'manufactured']).optional(),
  productName: z.string().optional(),
  length: z.string().optional(),
  quantity: z.string().optional(),
  lineTypeId: z.string().optional(),
}).loose();

const diagram = z.object({
  version: z.string(),
  nodes: z.array(z.object({
    id: z.string(), type: z.string().optional(), data: nodeData,
  }).loose()),
  edges: z.array(z.object({
    id: z.string(), source: z.string(), target: z.string(),
    sourceHandle: z.string().optional(), targetHandle: z.string().optional(),
    data: z.object({
      lineTypeId: z.string().optional(),
      bomRows: z.array(bomRow).optional(),
    }).loose().optional(),
  }).loose()),
  lineTypes: z.array(z.object({
    id: z.string(), name: z.string(), color: z.string().optional(),
  }).loose()),
  equipmentDB: z.array(z.unknown()).optional(),
  options: z.array(z.object({
    id: z.string(), model: z.string(),
    name: z.string().optional(), manufacturer: z.string().optional(),
  }).loose()).optional(),
}).loose();

export function parseDiagram(raw: unknown): DiagramFile {
  return diagram.parse(raw) as DiagramFile;
}
```

> Zod 4 에서 "모르는 키 허용" 이 `.loose()` 인지 `.passthrough()` 인지 **먼저 확인**한다. 기존 `src/data/catalog/schema.ts` 가 `.strict()` 를 쓰고 있으니 그 반대쪽 API 를 쓰면 된다. 동작(모르는 필드 통과)은 바꾸지 않는다.

- [ ] **Step 4: 통과 확인**

Run: `npm run verify && npx vitest run tests/unit/diagramSchema.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/import/diagram/schema.ts src/import/diagram/types.ts tests/unit/diagramSchema.test.ts tests/fixtures/diagram.ts
git commit -m "구성도: av-builder JSON 스키마 — 모르는 필드 허용"
```

---

### Task 2: 카탈로그 매칭

**Files:**
- Create: `src/import/diagram/matchCatalog.ts`
- Test: `tests/unit/matchCatalog.test.ts`

**Interfaces:**
- Consumes: `Catalog` (`src/data/catalog/load.ts`), `CatalogProduct`
- Produces:
  ```ts
  export interface MatchResult {
    readonly product?: CatalogProduct;
    /** 카탈로그에 없으면 undefined. **0 으로 채우지 않는다** (설계서 §5.6). */
    readonly sellingUnitPrice?: DecimalText;
    readonly matchedBy: 'model-exact' | 'model-normalized' | 'none';
  }
  export function matchByModel(model: string | undefined, catalog: Catalog): MatchResult;
  ```

정규화: 대문자화 후 `공백 - _ / ( ) . , " ” “ × x * #` 제거. `XDM-CTR100` 과 `XDMCTR100` 이 같아진다.
**부분일치는 하지 않는다.** `MR-4S` 가 `MR-4S-4K` 에 붙으면 다른 제품이 된다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/matchCatalog.test.ts
import { describe, expect, it } from 'vitest';
import { matchByModel } from '../../src/import/diagram/matchCatalog.js';
import type { Catalog } from '../../src/data/catalog/load.js';

const cat = (): Catalog => ({
  sourceSha256: 'a'.repeat(64),
  products: [
    { productId: 'VID-0138', sku: 'VID-0138', brand: '', model: 'XDM-12', quoteName: 'UHD Matrix Frame',
      quoteSpec: 'XDM-12', unit: 'EA', options: {}, currency: 'KRW', evidence: 'review-required' },
    { productId: 'VID-0009', sku: 'VID-0009', brand: '', model: 'SRG-X40UH', quoteName: 'HD PTZ Camera',
      quoteSpec: 'SRG-X40UH', unit: 'EA', options: {}, currency: 'KRW', evidence: 'review-required' },
  ],
  prices: new Map([['VID-0138', '5300000']]),
  pricesAvailable: true,
});

describe('matchByModel', () => {
  it('모델명이 정확히 같으면 붙는다', () => {
    const r = matchByModel('XDM-12', cat());
    expect(r.product?.sku).toBe('VID-0138');
    expect(r.sellingUnitPrice).toBe('5300000');
    expect(r.matchedBy).toBe('model-exact');
  });

  it('하이픈·공백·대소문자 차이를 넘어 붙는다', () => {
    expect(matchByModel('xdm 12', cat()).product?.sku).toBe('VID-0138');
    expect(matchByModel('XDM12', cat()).matchedBy).toBe('model-normalized');
  });

  it('카탈로그에 없으면 product 가 undefined 다 — 행은 호출부가 만든다', () => {
    const r = matchByModel('D-Cerno AE', cat());
    expect(r.product).toBeUndefined();
    expect(r.matchedBy).toBe('none');
  });

  it('단가가 없는 제품은 sellingUnitPrice 가 undefined 다 — 0 이 아니다 (설계서 §5.6)', () => {
    const r = matchByModel('SRG-X40UH', cat());
    expect(r.product?.sku).toBe('VID-0009');
    expect(r.sellingUnitPrice).toBeUndefined();
    expect(r.sellingUnitPrice).not.toBe('0');
  });

  it('prices.json 이 없을 때도 제품은 붙고 단가만 비어 있다 — 결정 D3', () => {
    const c = { ...cat(), prices: new Map<string, string>(), pricesAvailable: false };
    const r = matchByModel('XDM-12', c);
    expect(r.product?.sku).toBe('VID-0138');
    expect(r.sellingUnitPrice).toBeUndefined();
  });

  it('부분일치로 붙이지 않는다 — MR-4S 가 MR-4S-4K 에 붙으면 다른 제품이 된다', () => {
    const c: Catalog = { ...cat(), products: [
      { ...cat().products[0], sku: 'X-1', model: 'MR-4S-4K', quoteSpec: 'MR-4S-4K' },
    ] };
    expect(matchByModel('MR-4S', c).matchedBy).toBe('none');
  });

  it('model 이 없으면 none 이다', () => {
    expect(matchByModel(undefined, cat()).matchedBy).toBe('none');
    expect(matchByModel('', cat()).matchedBy).toBe('none');
  });

  it('너무 짧은 모델명은 붙이지 않는다 — 오매칭 방지', () => {
    const c: Catalog = { ...cat(), products: [{ ...cat().products[0], model: 'A1', quoteSpec: 'A1' }] };
    expect(matchByModel('A1', c).matchedBy).toBe('none');
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인**

Run: `npx vitest run tests/unit/matchCatalog.test.ts`
Expected: FAIL → 구현 후 PASS (8 tests)

구현은 `quoteSpec` 과 `model` 양쪽으로 색인을 만들고, 정규화 키가 5자 미만이면 매칭하지 않는다.

- [ ] **Step 3: 실물로 매칭률 확인**

실물 JSON 의 `equipmentDB` 674건을 돌려 **554건(82%) 내외**가 나오는지 확인한다. 크게 낮으면 정규화가 잘못된 것이다.

- [ ] **Step 4: 커밋**

```bash
git add src/import/diagram/matchCatalog.ts tests/unit/matchCatalog.test.ts
git commit -m "구성도: 모델명으로 카탈로그 조회 — 부분일치 금지"
```

---

### Task 3: 장비 행과 옵션 카드

**Files:**
- Create: `src/import/diagram/devices.ts`
- Test: `tests/unit/diagramDevices.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ImportWarning {
    code: 'device-not-in-catalog' | 'option-definition-missing' | 'price-not-registered' | 'unknown-line-type';
    blocking: boolean;
    message: string;
    nodeId?: string;
    edgeId?: string;
  }
  export interface DeviceLine {
    sku?: string;
    name: string;
    specification: string;
    unit: string;
    quantity: DecimalText;
    sellingUnitPrice?: DecimalText;
    /** 옵션 카드는 주 장비 아래 `- ` 로 붙는다 — 견적서 관행 */
    isAccessory: boolean;
    sourceNodeIds: string[];
  }
  export function buildDeviceLines(
    diagram: DiagramFile, catalog: Catalog,
  ): { lines: DeviceLine[]; warnings: ImportWarning[] };
  ```

**합산 규칙 (Review Focus #3):** 같은 SKU(없으면 같은 모델명)인 노드는 **한 행으로 합치고 수량을 더한다.**
근거: DSR·평택 견적서 실물이 `SRG-X40UH 4EA` 처럼 합쳐 쓴다. 노드 id 는 `sourceNodeIds` 에 모두 보존한다.

**옵션 카드 (Review Focus #1):** `selectedOptionQuantities` 의 키를 `options` 에서 찾는다.

| 상황 | 처리 |
|---|---|
| `options` 에 있음 | 그 모델로 행 생성 → 카탈로그 조회 |
| `options` 가 없거나 키가 없음 | **행은 만든다.** 품명 `옵션 카드 (미상)`, 규격에 옵션 id, 단가 미등록, **`blocking: true` 경고** |

행을 빼면 카드 15줄이 조용히 사라진다. 행을 남기고 막는 쪽이 맞다 (설계서 §7.5).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/diagramDevices.test.ts
import { describe, expect, it } from 'vitest';
import { buildDeviceLines } from '../../src/import/diagram/devices.js';
// cat(), node(), diagram() 헬퍼는 tests/fixtures/diagram.ts 에 만든다.

describe('장비 행', () => {
  it('노드 하나가 행 하나가 된다', () => {
    const { lines } = buildDeviceLines(diagram([node('n1', 'PTZ 카메라', 'SRG-X40UH')]), cat());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ sku: 'VID-0009', name: 'HD PTZ Camera', quantity: '1', isAccessory: false });
  });

  it('같은 모델 노드 3개는 한 행 수량 3 이 된다 — 견적서 실물이 그렇다', () => {
    const { lines } = buildDeviceLines(diagram([
      node('n1', 'PTZ 카메라', 'SRG-X40UH'),
      node('n2', 'PTZ 카메라', 'SRG-X40UH'),
      node('n3', 'PTZ 카메라', 'SRG-X40UH'),
    ]), cat());
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe('3');
    expect(lines[0].sourceNodeIds).toEqual(['n1', 'n2', 'n3']);
  });

  it('카탈로그에 없는 장비도 행을 만든다 — 빼면 견적에서 장비가 사라진다', () => {
    const { lines, warnings } = buildDeviceLines(diagram([node('n1', '델리게이트', 'D-Cerno AE')]), cat());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ sku: undefined, name: '델리게이트', quantity: '1' });
    expect(lines[0].sellingUnitPrice).toBeUndefined();
    expect(warnings.some((w) => w.code === 'device-not-in-catalog' && w.blocking)).toBe(true);
  });

  it('단가 미등록은 0 으로 채우지 않는다 (설계서 §5.6)', () => {
    const { lines } = buildDeviceLines(diagram([node('n1', 'PTZ', 'SRG-X40UH')]), cat());
    expect(lines[0].sellingUnitPrice).toBeUndefined();
  });
});

describe('옵션 카드', () => {
  const matrix = (q: Record<string, number>) =>
    node('m1', '비디오 매트릭스', 'XDM-12', { selectedOptionQuantities: q });

  it('options 에 정의가 있으면 그 모델로 행을 만든다', () => {
    const d = diagram([matrix({ 'eqopt-454': 4 })]);
    d.options = [{ id: 'eqopt-454', model: 'XDM-HOS100', name: 'HDMI 4채널 output card' }];
    const { lines, warnings } = buildDeviceLines(d, cat());
    const card = lines.find((l) => l.isAccessory);
    expect(card).toMatchObject({ name: 'HDMI 4채널 output card', quantity: '4', isAccessory: true });
    expect(warnings.some((w) => w.code === 'option-definition-missing')).toBe(false);
  });

  it('options 가 없으면 행은 만들되 blocking 경고를 세운다 — 카드가 조용히 사라지면 안 된다', () => {
    const { lines, warnings } = buildDeviceLines(diagram([matrix({ 'eqopt-454': 4 })]), cat());
    const card = lines.find((l) => l.isAccessory);
    expect(card).toBeDefined();
    expect(card!.quantity).toBe('4');
    expect(card!.sellingUnitPrice).toBeUndefined();
    expect(card!.specification).toContain('eqopt-454');
    const w = warnings.find((x) => x.code === 'option-definition-missing');
    expect(w?.blocking).toBe(true);
  });

  it('옵션 카드는 주 장비 바로 다음에 온다', () => {
    const d = diagram([matrix({ 'eqopt-454': 2 }), node('n9', 'PTZ', 'SRG-X40UH')]);
    d.options = [{ id: 'eqopt-454', model: 'XDM-HOS100' }];
    const { lines } = buildDeviceLines(d, cat());
    expect(lines[0].isAccessory).toBe(false);
    expect(lines[1].isAccessory).toBe(true);
    expect(lines[2].isAccessory).toBe(false);
  });

  it('수량 0 인 옵션은 행을 만들지 않는다', () => {
    const { lines } = buildDeviceLines(diagram([matrix({ 'eqopt-454': 0 })]), cat());
    expect(lines.filter((l) => l.isAccessory)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인**

Run: `npm run verify && npx vitest run tests/unit/diagramDevices.test.ts`
Expected: FAIL → PASS (8 tests)

- [ ] **Step 3: 커밋**

```bash
git add src/import/diagram/devices.ts tests/unit/diagramDevices.test.ts tests/fixtures/diagram.ts
git commit -m "구성도: 장비 행과 옵션 카드 — 정의 없으면 막는다"
```

---

### Task 4: 케이블 행 (D8 규칙 1)

**Files:**
- Create: `src/import/diagram/cables.ts`
- Test: `tests/unit/diagramCables.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const READY_MADE_STEPS = [1, 2, 3, 5, 7, 10, 15, 20] as const;
  /** 완제품 길이를 계단으로 올린다. 20m 초과는 가장 큰 계단을 반환하고 경고는 호출부가 세운다. */
  export function snapToStep(meters: number): number;
  /** 벌크를 10M 단위로 올린다. 반환은 10M 묶음 개수. */
  export function bulkUnits(meters: number): number;
  export interface CableLine {
    sku?: string; name: string; specification: string;
    unit: string;                  // 'EA' | '10M'
    quantity?: DecimalText;        // 미정이면 undefined
    sellingUnitPrice?: DecimalText;
    /** 몇 개 구간에서 왔는지. 커넥터 계산의 입력 (D8 규칙 2) */
    segmentCount: number;
    lineTypeId: string;
  }
  export function buildCableLines(
    diagram: DiagramFile, catalog: Catalog,
  ): { lines: CableLine[]; warnings: ImportWarning[] };
  ```

**빈 `bomRows` (Review Focus #5):** 선은 있는데 케이블 품목이 없으면 — **선 종류별로 행을 만들되 수량을 비우고 `blocking` 경고.** 선을 무시하면 케이블 없는 견적이 나간다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/diagramCables.test.ts
import { describe, expect, it } from 'vitest';
import { bulkUnits, buildCableLines, snapToStep } from '../../src/import/diagram/cables.js';

describe('완제품 길이 계단 — D8', () => {
  it.each([
    [0.5, 1], [1, 1], [1.2, 2], [3, 3], [3.1, 5], [5, 5], [6, 7], [7, 7],
    [8, 10], [10, 10], [12, 15], [15, 15], [16, 20], [20, 20],
  ])('%sm → %sm', (input, want) => {
    expect(snapToStep(input)).toBe(want);
  });

  it('20m 를 넘으면 가장 큰 계단을 준다 — 호출부가 경고를 세운다', () => {
    expect(snapToStep(33.8)).toBe(20);
  });
});

describe('벌크 10M 단위 — D8', () => {
  it.each([[1, 1], [10, 1], [11, 2], [25, 3], [30, 3], [31, 4], [300, 30]])('%sm → 10M×%s', (m, u) => {
    expect(bulkUnits(m)).toBe(u);
  });

  it('0m 는 0 묶음이다', () => {
    expect(bulkUnits(0)).toBe(0);
  });
});

describe('케이블 행 생성', () => {
  it('완제품은 개수로 집계한다 — 5m 두 구간은 2EA 지 10EA 가 아니다 (설계서 §7.4)', () => {
    const d = diagramWithEdges([
      edge('e1', 'video', [{ cableType: 'ready-made', productName: 'HDMI Cable 5m', length: '5', quantity: '1' }]),
      edge('e2', 'video', [{ cableType: 'ready-made', productName: 'HDMI Cable 5m', length: '5', quantity: '1' }]),
    ]);
    const { lines } = buildCableLines(d, cat());
    const hdmi = lines.find((l) => l.name.includes('HDMI Cable 5m'))!;
    expect(hdmi.unit).toBe('EA');
    expect(hdmi.quantity).toBe('2');
    expect(hdmi.segmentCount).toBe(2);
  });

  it('벌크는 길이를 합산한 뒤 10M 로 올린다', () => {
    const d = diagramWithEdges([
      edge('e1', 'network', [{ cableType: 'manufactured', productName: 'UTP Cable (CAT6)', length: '12', quantity: '1' }]),
      edge('e2', 'network', [{ cableType: 'manufactured', productName: 'UTP Cable (CAT6)', length: '15', quantity: '1' }]),
    ]);
    const { lines } = buildCableLines(d, cat());
    const utp = lines.find((l) => l.name.includes('UTP'))!;
    expect(utp.unit).toBe('10M');
    expect(utp.quantity).toBe('3');     // 27m → 3묶음
    expect(utp.segmentCount).toBe(2);
  });

  it('bomRows 가 비면 행을 만들되 수량을 비우고 막는다 — 선을 무시하면 안 된다', () => {
    const d = diagramWithEdges([edge('e1', 'video', [])]);
    const { lines, warnings } = buildCableLines(d, cat());
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBeUndefined();
    expect(lines[0].lineTypeId).toBe('video');
    expect(warnings.some((w) => w.blocking && w.edgeId === 'e1')).toBe(true);
  });

  it('모르는 lineTypeId 는 경고만 세우고 진행한다 — 사용자가 선 종류를 추가할 수 있다', () => {
    const d = diagramWithEdges([edge('e1', 'lt-신규', [])]);
    const { warnings } = buildCableLines(d, cat());
    expect(warnings.some((w) => w.code === 'unknown-line-type')).toBe(true);
  });

  it('cableType 이 없으면 완제품으로 본다 — 안전한 쪽', () => {
    const d = diagramWithEdges([edge('e1', 'video', [{ productName: 'HDMI 3m', length: '3', quantity: '1' }])]);
    expect(buildCableLines(d, cat()).lines[0].unit).toBe('EA');
  });

  it('같은 제품이 여러 구간에 나오면 한 행으로 합친다', () => {
    const d = diagramWithEdges([
      edge('e1', 'video', [{ cableType: 'ready-made', productName: 'HDMI 3m', length: '3', quantity: '2' }]),
      edge('e2', 'video', [{ cableType: 'ready-made', productName: 'HDMI 3m', length: '3', quantity: '4' }]),
    ]);
    const { lines } = buildCableLines(d, cat());
    expect(lines.filter((l) => l.name.includes('HDMI 3m'))).toHaveLength(1);
    expect(lines[0].quantity).toBe('6');
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인**

Run: `npm run verify && npx vitest run tests/unit/diagramCables.test.ts`
Expected: FAIL → PASS

- [ ] **Step 3: 커밋**

```bash
git add src/import/diagram/cables.ts tests/unit/diagramCables.test.ts
git commit -m "구성도: 케이블 행 — 완제품 계단과 벌크 10M (D8)"
```

---

### Task 5: 커넥터와 배관 (D8 규칙 2·3)

**Files:**
- Create: `src/import/diagram/derived.ts`
- Test: `tests/unit/diagramDerived.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const CONNECTORS_PER_SEGMENT = 3;   // 사용 2 + 예비 1
  export const CONNECTOR_PACK = 10;          // 10EA 묶음
  export const CONDUIT_METERS_PER_SYSTEM = 50;
  export const CONDUIT_PACK_METERS = 10;
  /** 구간 수 → 10EA 묶음 개수. */
  export function connectorPacks(segmentCount: number): number;
  export function buildDerivedLines(
    cables: readonly CableLine[], systemCount: number, catalog: Catalog,
  ): { lines: DeviceLine[]; warnings: ImportWarning[] };
  ```

커넥터는 **커넥터가 필요한 케이블**(UTP 계열)에만 붙인다. HDMI 완제품에는 커넥터가 없다.
판단은 `lineTypeId` 가 아니라 **벌크 여부**로 한다 — 벌크는 현장에서 잘라 쓰므로 커넥터가 필요하다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/diagramDerived.test.ts
import { describe, expect, it } from 'vitest';
import { buildDerivedLines, connectorPacks } from '../../src/import/diagram/derived.js';

describe('커넥터 — D8 규칙 2 (구간당 3개, 10EA 묶음)', () => {
  it.each([
    [1, 1],    // 3개 → 1묶음
    [3, 1],    // 9개 → 1묶음
    [4, 2],    // 12개 → 2묶음
    [7, 3],    // 21개 → 3묶음
    [10, 3],   // 30개 → 3묶음
  ])('%s구간 → %s묶음', (seg, packs) => {
    expect(connectorPacks(seg)).toBe(packs);
  });

  it('구간 0 이면 커넥터가 없다', () => {
    expect(connectorPacks(0)).toBe(0);
  });

  it('실제 견적서 역산과 맞는다 — 평택 LED 3.3구간 → 1묶음', () => {
    expect(connectorPacks(3)).toBe(1);
  });

  it('벌크 케이블에만 붙는다 — 완제품 HDMI 에는 커넥터가 없다', () => {
    const { lines } = buildDerivedLines(
      [{ name: 'HDMI Cable 5m', unit: 'EA', segmentCount: 5, lineTypeId: 'video', specification: '' }] as never,
      1, cat(),
    );
    expect(lines.filter((l) => l.name.includes('Connector'))).toHaveLength(0);
  });

  it('벌크 UTP 에는 붙는다', () => {
    const { lines } = buildDerivedLines(
      [{ name: 'UTP Cable (CAT6)', unit: '10M', segmentCount: 4, lineTypeId: 'network', specification: '' }] as never,
      1, cat(),
    );
    const conn = lines.find((l) => l.name.includes('Connector'))!;
    expect(conn.quantity).toBe('2');     // 4구간 × 3 = 12개 → 2묶음
    expect(conn.unit).toBe('10EA');
  });
});

describe('배관 — D8 규칙 3 (공간당 50m 고정)', () => {
  it('시스템 1개면 10M × 5 다', () => {
    const { lines } = buildDerivedLines([], 1, cat());
    const c = lines.find((l) => l.name.includes('Conduit'))!;
    expect(c.quantity).toBe('5');
    expect(c.unit).toBe('10M');
  });

  it('시스템 3개면 10M × 15 다', () => {
    const { lines } = buildDerivedLines([], 3, cat());
    expect(lines.find((l) => l.name.includes('Conduit'))!.quantity).toBe('15');
  });

  it('케이블 총 길이와 무관하다 — 60% 규칙은 폐기됐다', () => {
    const many = [{ name: 'UTP Cable (CAT6)', unit: '10M', segmentCount: 40, lineTypeId: 'network', specification: '' }] as never;
    const a = buildDerivedLines([], 1, cat());
    const b = buildDerivedLines(many, 1, cat());
    const q = (r: typeof a) => r.lines.find((l) => l.name.includes('Conduit'))!.quantity;
    expect(q(a)).toBe(q(b));
  });

  it('시스템 0 이면 배관도 0 이다', () => {
    const { lines } = buildDerivedLines([], 0, cat());
    expect(lines.filter((l) => l.name.includes('Conduit'))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인**

Run: `npm run verify && npx vitest run tests/unit/diagramDerived.test.ts`
Expected: FAIL → PASS

- [ ] **Step 3: 커밋**

```bash
git add src/import/diagram/derived.ts tests/unit/diagramDerived.test.ts
git commit -m "구성도: 커넥터 구간당 3개, 배관 공간당 50m (D8)"
```

---

### Task 6: QuoteDocument 생성과 끝까지 통과

**Files:**
- Create: `src/import/diagram/toQuote.ts`
- Test: `tests/integration/diagramToQuote.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ImportOptions {
    header: QuoteHeader;
    /** 노드에 systemName 이 없을 때 쓸 이름. */
    defaultSystemName: string;
    negoDeduction?: DecimalText;
  }
  export interface ImportResult {
    document: QuoteDocument;
    warnings: ImportWarning[];
    /** 하나라도 blocking 이면 Excel 출력을 막는다. */
    blocking: boolean;
  }
  export function diagramToQuote(
    diagram: DiagramFile, catalog: Catalog, options: ImportOptions,
  ): ImportResult;
  ```

행 순서는 견적서 관행을 따른다: **장비(+옵션 카드) → 케이블 → 커넥터 → 배관.**

- [ ] **Step 1: 실패하는 통합 테스트 작성**

```ts
// tests/integration/diagramToQuote.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDiagram } from '../../src/import/diagram/schema.js';
import { diagramToQuote } from '../../src/import/diagram/toQuote.js';
import { calculateQuote } from '../../src/domain/calculation/calculate.js';

const header = () => ({ quoteNumber: 'T-1', quoteDate: '2026-10-04', customer: '고객',
  projectName: '테스트 회의실', contact: '', conditions: [] });

describe('구성도 → 견적 문서', () => {
  it('장비·케이블·커넥터·배관이 이 순서로 들어간다', () => {
    const r = diagramToQuote(fixture(), cat(), { header: header(), defaultSystemName: '회의실' });
    const names = r.document.rows.filter((x) => x.type === 'item').map((x) => (x as { name: string }).name);
    const idx = (p: string) => names.findIndex((n) => n.includes(p));
    expect(idx('PTZ')).toBeLessThan(idx('UTP'));
    expect(idx('UTP')).toBeLessThan(idx('Connector'));
    expect(idx('Connector')).toBeLessThan(idx('Conduit'));
  });

  it('두 번 불러도 결과가 같다 — 수량이 누적되지 않는다 (설계서 §7.3)', () => {
    const a = diagramToQuote(fixture(), cat(), { header: header(), defaultSystemName: '회의실' });
    const b = diagramToQuote(fixture(), cat(), { header: header(), defaultSystemName: '회의실' });
    const strip = (d: typeof a.document) => JSON.stringify(d.rows);
    expect(strip(a.document)).toBe(strip(b.document));
  });

  it('만들어진 문서가 계산 엔진을 그대로 통과한다 — 엔진을 고치지 않는다', () => {
    const r = diagramToQuote(fixture(), cat(), { header: header(), defaultSystemName: '회의실' });
    expect(() => calculateQuote(r.document)).not.toThrow();
  });

  it('옵션 정의가 없으면 blocking 이다', () => {
    const r = diagramToQuote(fixtureWithUndefinedOption(), cat(), { header: header(), defaultSystemName: '회의실' });
    expect(r.blocking).toBe(true);
    expect(r.warnings.some((w) => w.code === 'option-definition-missing')).toBe(true);
  });

  it('간접비 9항목이 시스템에 붙는다 — 기본값은 적용 6 / 미적용 3', () => {
    const r = diagramToQuote(fixture(), cat(), { header: header(), defaultSystemName: '회의실' });
    const s = r.document.systems[0];
    expect(s.indirectCosts).toHaveLength(9);
    expect(s.indirectCosts.filter((i) => i.applied)).toHaveLength(6);
  });

  it('systemName 이 있으면 시스템을 나눈다', () => {
    const r = diagramToQuote(fixtureTwoSystems(), cat(), { header: header(), defaultSystemName: '기타' });
    expect(r.document.systems.map((s) => s.name).sort()).toEqual(['대회의실', '접견실']);
  });
});

describe('실물 파일', () => {
  const PATH = '.local/samples/av-diagram.json';

  it.skipIf(!existsSyncSafe(PATH))('실물 export 를 끝까지 통과시킨다', () => {
    const d = parseDiagram(JSON.parse(readFileSync(PATH, 'utf8')));
    const r = diagramToQuote(d, realCatalog(), { header: header(), defaultSystemName: '회의실' });
    expect(r.document.rows.length).toBeGreaterThan(0);
    const calc = calculateQuote(r.document);
    expect(calc.systems).toHaveLength(r.document.systems.length);
    // 옵션 정의가 아직 없으므로 blocking 이 맞다
    expect(r.blocking).toBe(true);
  });
});
```

> `.local/samples/av-diagram.json` 에 사용자가 준 실물 export 를 둔다. `.local/` 은 gitignore 대상이라 저장소에 들어가지 않는다. 파일이 없으면 이 테스트는 건너뛴다 — 다른 개발자 환경에서 실패하면 안 된다.

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인**

Run: `npm run verify && npx vitest run tests/integration/diagramToQuote.test.ts`
Expected: FAIL → PASS

간접비 9항목은 **반드시 아래에서 가져온다.** 요율을 이 계획 안에 다시 적지 않는다.

```ts
import { standardIndirectCosts } from '@/domain/quote/indirectCosts';
```

커밋 `b128205` 에서 테스트 픽스처(`tests/fixtures/syntheticQuote.ts`)에만 있던 정의를
제품 코드로 옮겼고, 픽스처가 그것을 re-export 한다. 두 곳이 **같은 함수 객체인지**를
테스트가 직접 비교하므로(`expect(fixture.standardIndirectCosts).toBe(standardIndirectCosts)`),
누군가 요율을 다시 적으면 테스트가 깨진다.

호출마다 새 배열을 만든다 — 한 견적에서 `applied` 를 바꿔도 다른 견적에 번지지 않는다.
기본값은 원본과 같다(적용 6 / 미적용 3). 연금·건강·노인장기요양은 미적용이고 요율은 보존한다.

- [ ] **Step 3: 실물로 Excel 까지 내보내 확인**

```bash
npm run build:approved   # 카탈로그가 없으면
npx vitest run tests/integration/diagramToQuote.test.ts
```

그리고 실물 JSON 으로 Excel 을 만들어 `.local/out/diagram-quote.xlsx` 로 저장한 뒤,
기존 `tools/verify_in_excel.ps1` 로 검증한다. **exporter 를 고치지 않고 통과해야 한다.**

- [ ] **Step 4: 커밋**

```bash
git add src/import/diagram/toQuote.ts tests/integration/diagramToQuote.test.ts
git commit -m "구성도: QuoteDocument 생성 — 계산 엔진·exporter 무수정 통과"
```

---

## 이 계획이 끝나면

```
av-builder JSON  →  QuoteDocument  →  계산  →  원본 양식 Excel
```

**명령줄에서 끝까지 됩니다.** 화면은 아직 없다 — 화면은 `2026-10-03-stage3a-quote-sheet-render.md` 가 만든다.
두 계획이 만나면 「구성도 불러오기 → 보고 고치기 → Excel 다운로드」가 완성된다.

## 이 계획이 하지 않는 것

| 항목 | 어디로 |
|---|---|
| 화면 | 단계 3-A 계획 |
| 도면 → 케이블 거리 산출 (D8 규칙 1 의 `(직각경로+상하)×1.3`) | 별도 계획. **도면 파일과 축척이 필요** |
| 브라켓·함체 등 연동 항목 (DSR 12줄) | 결정 D5 — **사용자에게 질문 후** |
| 공사·용역·잡비 (DSR 13줄) | 샘플 견적서에서 가져오기. 별도 계획 |
| `ProductPicker` 품목 직접 선택 | **결정 D7 로 범위 밖** |

## 남은 결정

| 항목 | 상태 |
|---|---|
| av-builder 옵션 카드 정의 export | **av-builder 담당** (O15). 이 계획은 없는 상태로도 동작한다 |
| 연동 항목 표 내용 | **사용자에게 질문할 것** (D5) |
| 도면 축척·천장고 입력 방식 | 도면 계획에서 |
