/**
 * 모델명 기준 대조 4단계의 **수정 전후 비교** (계획 2026-10-06 Task 3).
 * 진단용이며 제품 코드가 아니다.
 *
 * 실행:
 *   npx vite-node tools/probe_model_search.ts > 결과.json
 *
 * 같은 구성도·같은 카탈로그로 돌린 뒤, 항목마다 **연결된 SKU** 와 **후보 목록**을
 * JSON 으로 뽑는다. 수정 전 커밋에서 한 번, 수정 후에서 한 번 돌려 두 파일을
 * `probe_model_search_diff.ts` 로 비교한다.
 *
 * ⛔ 건수를 합격 조건으로 쓰지 않는다 (계획 §Task 3). "미매칭이 줄었다" 도
 *    합격 조건이 아니다. 비교는 **항목 성격별 규칙**으로만 한다.
 */
import { readFileSync } from 'node:fs';

import { buildCatalog } from '../src/data/catalog/load';
import { matchByModel, normalizeModel } from '../src/import/diagram/matchCatalog';

const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

const catalog = buildCatalog(read('data/approved/products.json'), read('data/approved/prices.json'));

const diagram = read(process.argv[2] ?? '.local/samples/av-diagram.json') as {
  equipmentDB?: Array<{ id?: string; model?: string }>;
};
const entries = diagram.equipmentDB ?? [];

/** 정규화 키가 이보다 짧으면 2·3·4 단계에 아예 오지 않는다. 코드와 같은 값이다. */
const MIN_KEY_LENGTH = 5;

interface Snapshot {
  readonly id: string;
  readonly model: string;
  readonly matchedBy: string;
  /** 자동으로 연결된 제품. 4단계는 여기를 절대 채우지 않는다. */
  readonly linkedSku: string | undefined;
  readonly ambiguousSkus: readonly string[] | undefined;
  readonly candidates: ReadonlyArray<{ sku: string; fields: string[]; texts: string[] }> | undefined;
  /** 왜 2~4 단계에 오지 못했는지 — 보고에서 숨기지 않는다 (계획 §4-5). */
  readonly skipped: 'empty-model' | 'key-too-short' | undefined;
}

const snapshots: Snapshot[] = entries.map((entry, index) => {
  const model = entry.model?.trim() ?? '';
  const result = matchByModel(entry.model, catalog);

  const skipped =
    model === ''
      ? ('empty-model' as const)
      : normalizeModel(model).length < MIN_KEY_LENGTH && result.matchedBy !== 'model-exact'
        ? ('key-too-short' as const)
        : undefined;

  return {
    id: entry.id ?? `#${index}`,
    model,
    matchedBy: result.matchedBy,
    linkedSku: result.product?.sku,
    ambiguousSkus: result.ambiguousSkus,
    candidates: result.modelSearchCandidates?.map((c) => ({
      sku: c.sku,
      fields: c.matches.map((m) => m.field),
      texts: c.matches.map((m) => m.text),
    })),
    ...(skipped !== undefined ? { skipped } : { skipped: undefined }),
  };
});

process.stdout.write(`${JSON.stringify({ total: snapshots.length, snapshots }, null, 1)}\n`);
