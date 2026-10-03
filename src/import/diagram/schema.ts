/**
 * 구성도 JSON 검증 (계획 2026-10-04 Task 1).
 *
 * **느슨하게 받는다.** `.strict()`를 쓰지 않는다 — av-builder가 필드를 추가해도
 * 깨지면 안 된다 (`docs/interface/av-builder.md` §5 호환 규칙).
 *
 * 요구하는 것은 변환에 꼭 필요한 뼈대뿐이다.
 *   `version` · `nodes` · `edges` · `lineTypes`
 *
 * 나머지는 전부 선택이다. 없으면 없는 대로 다루고, 그 결과를 경고로 남기는 것은
 * 뒤 단계(`devices.ts`·`cables.ts`)의 몫이다. 여기서 던지면 **지금 있는 파일을
 * 아예 못 읽는다.**
 */
import { z } from 'zod';
import type { DiagramFile } from './types';

const port = z.looseObject({
  id: z.string(),
  label: z.string().optional(),
  type: z.string().optional(),
  direction: z.string().optional(),
});

const nodeData = z.looseObject({
  id: z.string().optional(),
  name: z.string().optional(),
  model: z.string().optional(),
  manufacturer: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  inputs: z.array(port).optional(),
  outputs: z.array(port).optional(),
  bidirectional: z.array(port).optional(),
  // 수량은 숫자로 온다. 음수·소수는 받지 않는다 — 장착 개수다.
  selectedOptionQuantities: z.record(z.string(), z.number().int().nonnegative()).optional(),
  optionPortIds: z.array(z.string()).optional(),
  systemName: z.string().optional(),
});

const node = z.looseObject({
  id: z.string(),
  type: z.string().optional(),
  data: nodeData,
});

const bomRow = z.looseObject({
  cableType: z.enum(['ready-made', 'manufactured']).optional(),
  productName: z.string().optional(),
  // 길이·수량은 문자열로 받는다. 숫자로 받으면 부동소수 오차가 굳는다.
  length: z.union([z.string(), z.number()]).optional(),
  quantity: z.union([z.string(), z.number()]).optional(),
  lineTypeId: z.string().optional(),
});

const edge = z.looseObject({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  data: z
    .looseObject({
      lineTypeId: z.string().optional(),
      bomRows: z.array(bomRow).optional(),
    })
    .optional(),
});

const lineType = z.looseObject({
  id: z.string(),
  name: z.string(),
  color: z.string().optional(),
});

const option = z.looseObject({
  id: z.string(),
  model: z.string(),
  name: z.string().optional(),
  manufacturer: z.string().optional(),
});

const diagramFile = z.looseObject({
  version: z.string(),
  nodes: z.array(node),
  edges: z.array(edge),
  lineTypes: z.array(lineType),
  equipmentDB: z.array(z.unknown()).optional(),
  options: z.array(option).optional(),
});

export class DiagramParseError extends Error {
  constructor(
    message: string,
    readonly issues: readonly string[] = [],
  ) {
    super(message);
    this.name = 'DiagramParseError';
  }
}

/** 길이·수량을 문자열로 통일한다. av-builder가 숫자로 보낼 수도 있다. */
function toText(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'number' ? String(value) : value;
}

export function parseDiagram(raw: unknown): DiagramFile {
  const result = diagramFile.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.') || '(최상위)'}: ${i.message}`,
    );
    throw new DiagramParseError(
      `구성도 JSON을 읽을 수 없다.\n${issues.join('\n')}`,
      issues,
    );
  }

  const parsed = result.data;
  return {
    version: parsed.version,
    nodes: parsed.nodes.map((n) => ({
      id: n.id,
      ...(n.type !== undefined ? { type: n.type } : {}),
      data: n.data,
    })),
    edges: parsed.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.sourceHandle !== undefined ? { sourceHandle: e.sourceHandle } : {}),
      ...(e.targetHandle !== undefined ? { targetHandle: e.targetHandle } : {}),
      ...(e.data !== undefined
        ? {
            data: {
              ...(e.data.lineTypeId !== undefined ? { lineTypeId: e.data.lineTypeId } : {}),
              ...(e.data.bomRows !== undefined
                ? {
                    bomRows: e.data.bomRows.map((r) => ({
                      ...(r.cableType !== undefined ? { cableType: r.cableType } : {}),
                      ...(r.productName !== undefined ? { productName: r.productName } : {}),
                      ...(toText(r.length) !== undefined ? { length: toText(r.length)! } : {}),
                      ...(toText(r.quantity) !== undefined
                        ? { quantity: toText(r.quantity)! }
                        : {}),
                      ...(r.lineTypeId !== undefined ? { lineTypeId: r.lineTypeId } : {}),
                    })),
                  }
                : {}),
            },
          }
        : {}),
    })),
    lineTypes: parsed.lineTypes.map((l) => ({
      id: l.id,
      name: l.name,
      ...(l.color !== undefined ? { color: l.color } : {}),
    })),
    ...(parsed.equipmentDB !== undefined ? { equipmentDB: parsed.equipmentDB } : {}),
    ...(parsed.options !== undefined
      ? {
          options: parsed.options.map((o) => ({
            id: o.id,
            model: o.model,
            ...(o.name !== undefined ? { name: o.name } : {}),
            ...(o.manufacturer !== undefined ? { manufacturer: o.manufacturer } : {}),
          })),
        }
      : {}),
  };
}
