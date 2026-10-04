import type { Catalog } from '../../data/catalog/load';
import type { QuoteDocument } from '../../domain/quote/types';
import type { RouteInput } from '../../domain/quote/installation';
import { toRow } from '../../domain/quote/buildDocument';
import { buildCableLines } from './cables';
import { buildDerivedLines } from './derived';
import { cableToLine, deviceToLine } from './toQuote';
import type { ImportWarning } from './devices';

/** 장비·옵션을 다시 변환하지 않고 보존한 케이블 원본만 사용한다. */
export function regenerateCables(document: QuoteDocument, catalog: Catalog, routes: readonly RouteInput[]) {
  if (document.cableSource === undefined || document.systems[0] === undefined) throw new Error('케이블 원본이 없습니다.');
  const systemId = document.systems[0].systemId; // O18: 기존 첫 시스템 귀속을 유지한다.
  const cables = buildCableLines(document.cableSource, catalog, new Map(routes.map(route => [route.edgeId, route])));
  const connectors = buildDerivedLines(cables.lines, catalog);
  const rows = [
    ...cables.lines.map(line => toRow(`cable-${JSON.stringify([...(line.sourceCableMembers ?? [])].sort())}`, systemId, cableToLine(line))),
    ...connectors.lines.map((line, index) => toRow(`connector-${index}`, systemId,
      { ...deviceToLine(line), ruleInstanceId: 'diagram-connectors-v1' })),
  ];
  const warnings: ImportWarning[] = [...cables.warnings, ...connectors.warnings]
    .map(warning => ({ ...warning, owner: 'cable-generation' }));
  return { rows, warnings };
}
