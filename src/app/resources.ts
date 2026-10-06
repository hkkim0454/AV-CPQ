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
import { buildLaborReference, loadCatalog, type Catalog } from '../data/catalog/load';
import { skuMigrationFileSchema } from '../data/catalog/schema';
import type { SkuMigrationTable } from '../data/catalog/skuMigration';
import {
  GUIDE_IDS,
  readGuideTemplate,
  type GuideId,
  type GuideManifest,
  type GuideTemplate,
  type GuideTemplateSet,
} from '../export/ooxml/guideTemplate';

/**
 * 품셈·노임·매핑의 **원자료**(아직 파싱만 한 JSON). 완성된 `LaborReference`를
 * 여기서 만들어 내보내지 않는다 — `buildLaborReference`가 그대로 돌려주는
 * 것은 배포본(**상반기**) 노임이고, 실제 견적 계산은 가이드 노임(**하반기**,
 * `buildGuideBasis({..., choice:{kind:'guide', guide}})`)을 써야 한다(계획
 * 2026-10-04-quote-workspace-ui Task 2 독립 검토 지적). 그 선택은 어느
 * 가이드/프로파일을 쓸지 아는 쪽(`src/app/workspace.ts`)의 책임이다.
 */
export interface LaborBasisRaw {
  laborItemsRaw: unknown;
  wageTableRaw: unknown;
  laborMappingsRaw: unknown;
}

export interface Resources {
  catalog: Catalog;
  laborBasisRaw: LaborBasisRaw;
  guides: GuideTemplateSet;
  /**
   * SKU 대응표 (품셈 교체 Task 4). **없는 것이 정상 경로다** — 카탈로그를
   * 교체한 적이 없으면 필요 없다.
   *
   * 없으면 재계산은 **저장 지문과 지금 지문이 같을 때만** SKU 로 제품을
   * 찾는다. 지문이 다른데 대응표가 없으면 치환하지 않고 미해결로 되돌린다
   * — 조용히 엉뚱한 제품으로 바뀌는 것보다 낫다.
   */
  skuMigration?: SkuMigrationTable;
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

  // 배포본(approved) 기준으로 파싱·상호 검증만 한다(다른 원본이 섞였는지 등).
  // 그 결과(상반기 노임 포함)는 버린다 — 계산에는 쓰지 않는다. 여기서는
  // "이 세 파일이 서로 맞는 원본에서 나온, 읽을 수 있는 JSON인가"만 확인한다.
  let laborBasisRaw: LaborBasisRaw | undefined;
  if (
    laborRaw['labor-items.json'] !== undefined &&
    laborRaw['wage-table.json'] !== undefined &&
    laborRaw['labor-mappings.json'] !== undefined
  ) {
    try {
      buildLaborReference(
        laborRaw['labor-items.json'],
        laborRaw['wage-table.json'],
        laborRaw['labor-mappings.json'],
      );
      laborBasisRaw = {
        laborItemsRaw: laborRaw['labor-items.json'],
        wageTableRaw: laborRaw['wage-table.json'],
        laborMappingsRaw: laborRaw['labor-mappings.json'],
      };
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

  // SKU 대응표 — 없는 것이 정상이다(가격 파일과 같은 원칙). 404도, 깨진
  // JSON도 실패로 세지 않는다. 다만 **깨진 파일을 조용히 무시하지는 않는다** —
  // 사유를 남겨 화면에 보여준다. 대응표가 없으면 재계산이 더 보수적으로
  // (치환하지 않고) 동작할 뿐이다.
  let skuMigration: SkuMigrationTable | undefined;
  try {
    const res = await get(`${base}data/approved/sku-migration.json`);
    if (res.ok) {
      const parsed = skuMigrationFileSchema.safeParse(await res.json());
      if (parsed.success) skuMigration = parsed.data;
      else reasons.push('SKU 대응표(sku-migration.json)의 형식이 맞지 않는다 — 대응 없이 진행한다.');
    }
  } catch {
    // 네트워크 오류도 "대응표 없음"으로 본다. 이 파일은 필수가 아니다.
  }

  const guidesReady = GUIDE_IDS.every((id) => guides[id] !== undefined);

  if (catalog === undefined || laborBasisRaw === undefined || manifest === undefined || !guidesReady) {
    return { kind: 'error', reasons };
  }

  return {
    kind: 'ready',
    resources: {
      catalog,
      laborBasisRaw,
      guides: guides as GuideTemplateSet,
      ...(skuMigration === undefined ? {} : { skuMigration }),
    },
  };
}
