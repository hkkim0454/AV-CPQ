import type { DiagramFile } from '../../import/diagram/types';

/** 거리 재산출용 원본. equipmentDB와 확장 필드를 문서 이력에 반입하지 않는다. */
export function captureCableSource(input: DiagramFile): DiagramFile {
  return {
    version: input.version,
    nodes: input.nodes.map(node => ({ id: node.id, data: {
      ...(node.data.name !== undefined ? { name: node.data.name } : {}),
    } })),
    lineTypes: input.lineTypes.map(line => ({ id: line.id, name: line.name })),
    edges: input.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target,
      data: {
        ...(edge.data?.lineTypeId !== undefined ? { lineTypeId: edge.data.lineTypeId } : {}),
        bomRows: (edge.data?.bomRows ?? []).map(row => ({
          ...(row.cableType !== undefined ? { cableType: row.cableType } : {}),
          ...(row.productName !== undefined ? { productName: row.productName } : {}),
          ...(row.length !== undefined ? { length: row.length } : {}),
          ...(row.quantity !== undefined ? { quantity: row.quantity } : {}),
          ...(row.lineTypeId !== undefined ? { lineTypeId: row.lineTypeId } : {}),
        })),
      },
    })),
  };
}
