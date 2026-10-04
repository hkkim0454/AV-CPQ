/**
 * 초기 자료 로딩 — 승인 데이터와 정제 가이드 템플릿만 읽는다 (계획
 * 2026-10-04-quote-workspace-ui Task 1).
 *
 * 원가 입력은 여기서 다루지 않는다 — 원가는 전용 경계
 * (`src/services/private-cost/`)에서만 다룬다 (설계서 §8.4).
 *
 * 실패를 한데 뭉개지 않는다. 각 파일별로 "이 파일을 못 읽었다"는 사유를
 * 모아서 화면에 그대로 보여준다 — `undefined` 가격이 '미등록'인 것과
 * 같은 원칙이다(설계서 §5.6): 조용히 기본값으로 메우지 않는다.
 *
 * 예외: `prices.json`은 없어도 된다(결정 D3) — 판매단가 배포를 나중에
 * 가릴 수 있어야 하므로, 이건 "실패"가 아니라 "미등록"으로 다룬다.
 */
import { buildLaborReference, loadCatalog, type Catalog, type LaborReference } from '../data/catalog/load';
import {
  GUIDE_IDS,
  readGuideTemplate,
  type GuideId,
  type GuideManifest,
  type GuideTemplate,
  type GuideTemplateSet,
} from '../export/ooxml/guideTemplate';

export interface Resources {
  catalog: Catalog;
  laborReference: LaborReference;
  guides: GuideTemplateSet;
}

export type ResourcesResult = { kind: 'ready'; resources: Resources } | { kind: 'error'; reasons: string[] };

export interface LoadResourcesOptions {
  /** `import.meta.env.BASE_URL`. 끝에 `/`가 있어야 한다. */
  baseUrl?: string;
  /** 테스트에서 갈아끼운다. */
  fetchImpl?: typeof fetch;
}

const LABOR_FILES = ['labor-items.json', 'wage-table.json', 'labor-mappings.json'] as const;
type LaborFileName = (typeof LABOR_FILES)[number];

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export async function loadResources(options: LoadResourcesOptions = {}): Promise<ResourcesResult> {
  const base = options.baseUrl ?? '/';
  const get = options.fetchImpl ?? fetch;
  const reasons: string[] = [];

  let catalog: Catalog | undefined;
  try {
    catalog = await loadCatalog({ baseUrl: base, fetchImpl: get });
  } catch (err) {
    reasons.push(messageOf(err, '제품 목록을 읽을 수 없다.'));
  }

  const laborRaw: Partial<Record<LaborFileName, unknown>> = {};
  for (const name of LABOR_FILES) {
    try {
      const res = await get(`${base}data/approved/${name}`);
      if (!res.ok) {
        reasons.push(`${name}을 읽을 수 없다 (HTTP ${res.status}).`);
        continue;
      }
      laborRaw[name] = await res.json();
    } catch {
      reasons.push(`${name}을 읽을 수 없다 (네트워크 오류).`);
    }
  }

  let laborReference: LaborReference | undefined;
  if (
    laborRaw['labor-items.json'] !== undefined &&
    laborRaw['wage-table.json'] !== undefined &&
    laborRaw['labor-mappings.json'] !== undefined
  ) {
    try {
      laborReference = buildLaborReference(
        laborRaw['labor-items.json'],
        laborRaw['wage-table.json'],
        laborRaw['labor-mappings.json'],
      );
    } catch (err) {
      reasons.push(messageOf(err, '품셈 기준을 읽을 수 없다.'));
    }
  }

  let manifest: GuideManifest | undefined;
  try {
    const res = await get(`${base}templates/sanitized/guide-manifest.json`);
    if (!res.ok) {
      reasons.push(`가이드 목록(guide-manifest.json)을 읽을 수 없다 (HTTP ${res.status}).`);
    } else {
      manifest = (await res.json()) as GuideManifest;
    }
  } catch {
    reasons.push('가이드 목록(guide-manifest.json)을 읽을 수 없다 (네트워크 오류).');
  }

  const guides: Partial<Record<GuideId, GuideTemplate>> = {};
  if (manifest !== undefined) {
    for (const id of GUIDE_IDS) {
      try {
        const res = await get(`${base}templates/sanitized/guide-${id}.xlsx`);
        if (!res.ok) {
          reasons.push(`가이드 '${id}'를 읽을 수 없다 (HTTP ${res.status}).`);
          continue;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        guides[id] = readGuideTemplate(id, bytes, manifest);
      } catch (err) {
        // `readGuideTemplate`이 항상 가이드 id를 메시지에 넣지는 않는다 —
        // 예를 들어 손상된 zip 자체는 fflate가 원인 메시지를 그대로
        // 던진다(가이드 id 없이). 어느 가이드가 깨졌는지 모르면 사용자가
        // 고칠 수 없으므로, 여기서 항상 id를 붙인다.
        reasons.push(`가이드 '${id}'를 읽을 수 없다: ${messageOf(err, '알 수 없는 오류')}`);
      }
    }
  }

  const guidesReady = GUIDE_IDS.every((id) => guides[id] !== undefined);

  if (catalog === undefined || laborReference === undefined || manifest === undefined || !guidesReady) {
    return { kind: 'error', reasons };
  }

  return {
    kind: 'ready',
    resources: { catalog, laborReference, guides: guides as GuideTemplateSet },
  };
}
