/**
 * 계산 기준 — 품셈(공수)과 노임을 **따로** 고른다 (계획 2026-10-04 Task 2, D20).
 *
 * ## 왜 따로인가
 *
 * 배포된 품셈 묶음은 `원가삭제_2026상반기_표준품셈` 하나에서 나왔다. 세 파일
 * (품셈 항목·노임표·매핑)의 `sourceSha256` 이 같아야 `buildLaborReference` 가
 * 통과시킨다. **그 검사는 그대로 둔다** — 섞어 쓰면 노무비가 틀린다는 사실은
 * 변하지 않았다.
 *
 * 그런데 견적서 가이드의 노임은 **하반기**다.
 *
 * ```
 * 배포 노임   WAGE-26년 상반기   통신관련기사 320,449
 * 가이드 3행  26년 하반기        통신관련기사 324,979
 * ```
 *
 * 화면이 상반기로 계산하고 Excel 이 하반기를 표시하면 **같은 견적서 안에서
 * 두 금액이 갈린다.** 그래서 가이드 출력에는 가이드 노임을 쓴다.
 *
 * ## 순서가 중요하다
 *
 * 1. 기존 세 파일을 **원래대로** 검증한다 (`buildLaborReference`). SHA 검사를
 *    없애거나 SHA 를 맞춰 조작하지 않는다.
 * 2. 그 다음 **노임만** 가이드 것으로 바꾼다. 품(공수)과 매핑은 그대로다.
 * 3. 바꾼 사실을 `wageTableId:내용해시` 로 기록한다. 기존 문서를 다시 열 때
 *    기록과 다르면 막고 명시적 재계산을 요구한다.
 *
 * ## 나중에 사용자가 직접 고칠 수 있어야 한다
 *
 * 사용자 요구: 관리 화면에서 **공정별 공수(품)와 반기별 직종 노임단가를 둘 다**
 * 고칠 수 있어야 한다. 그래서 둘의 출처를 하나로 묶지 않는다. 지금은 품이
 * 배포본 하나뿐이지만, 자리는 비워 둔다 — `basisId` 가 둘을 함께 가리킨다.
 */
import { buildLaborReference, type LaborReference } from './load';
import type { WageTable } from '../../domain/labor/types';
import type { GuideTemplate } from '../../export/ooxml/guideTemplate';

export class GuideBasisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuideBasisError';
  }
}

/** 어떤 기준으로 계산했는지. 견적 문서에 적어 둔다. */
export interface BasisVersions {
  /** 품셈 항목·매핑의 출처 해시. 배포본 그대로다. */
  labor: string;
  /** `WAGE-26년 하반기:9f3c…`. 이름이 같아도 값이 바뀌면 해시가 달라진다. */
  wage: string;
}

/** 고른 노임표로는 계산할 수 없는 것들. **숨기지 않고 함께 들고 다닌다.** */
export interface UnsupportedByWage {
  /** 고른 노임표에 없는 직종. */
  trades: readonly string[];
  /** 그 직종을 쓰는 품셈 항목. 이 품셈이 붙은 제품은 이 가이드로 못 낸다. */
  laborItemIds: readonly string[];
  /** 품셈이 전제하는 단위와 노임표 단위가 어긋나는 품셈 항목. */
  unitMismatchLaborItemIds: readonly string[];
}

export interface GuideBasis {
  /** 품은 배포본, 노임은 고른 것. `priceQuote` 에 그대로 넘긴다. */
  reference: LaborReference;
  /** 노임을 가이드 것으로 바꿨는가. */
  wageReplaced: boolean;
  versions: BasisVersions;
  unsupported: UnsupportedByWage;
}

export type WageChoice =
  /** 배포본 노임을 그대로 쓴다. 기존 견적을 다시 열 때. */
  | { kind: 'approved' }
  /** 가이드 노임으로 바꾼다. **새 견적이나 명시적 재계산에서만.** */
  | { kind: 'guide'; guide: GuideTemplate };

/**
 * 노임표의 **내용** 지문.
 *
 * ## `sourceSha256` 을 쓰지 않는 이유
 *
 * `sourceSha256` 은 **원본 파일**에 대한 메타데이터지 노임 값의 해시가 아니다.
 * 같은 SHA 를 그대로 둔 채 `wage-table.json` 안의 단가만 고치면, 값이 바뀌었는데
 * **버전은 그대로**다. 기존 견적을 다시 열 때 "같은 기준"으로 통과하고
 * 금액만 조용히 달라진다. 앞으로 사용자가 관리 화면에서 노임을 직접 고치면
 * 바로 그 상황이 된다.
 *
 * 그래서 기간·직종·단위·금액을 정렬해 이어 붙인 것에서 지문을 만든다.
 * 값이 한 자리라도 바뀌면 지문이 바뀐다.
 *
 * ## 암호학적 해시가 아니다
 *
 * 브라우저의 SHA-256(`crypto.subtle`)은 비동기라 동기 경로에서 못 쓴다.
 * 여기 쓰는 FNV-1a 는 **드리프트 탐지용**이지 위변조 방지용이 아니다.
 * 누가 일부러 같은 지문을 만드는 상황은 이 경계의 관심사가 아니다 —
 * 원가와 달리 노임표는 공개 자료다.
 */
export function wageContentFingerprint(table: WageTable): string {
  const canonical = [
    table.periodLabel,
    ...Object.keys(table.wages)
      .sort()
      .map((trade) => {
        const wage = table.wages[trade]!;
        return `${trade}|${wage.unit}|${wage.amount}`;
      }),
  ].join(String.fromCharCode(10));

  // FNV-1a 64비트. 결정적이고 플랫폼에 의존하지 않는다.
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < canonical.length; i += 1) {
    hash = ((hash ^ BigInt(canonical.charCodeAt(i))) * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

function wageVersion(table: WageTable): string {
  return `${table.wageTableId}:${wageContentFingerprint(table)}`;
}

/**
 * 품셈 항목·매핑의 출처.
 *
 * 이쪽은 **파일 출처**가 맞는 기준이다. 품(공수)은 `buildLaborReference` 가
 * 세 파일의 SHA 일치로 이미 묶어 놨고, 그 묶음을 가리키는 이름이 필요할 뿐이다.
 * 사용자가 공수를 직접 고치게 되면 그때는 여기도 내용 지문으로 바꿔야 한다.
 */
function laborSourceId(raw: unknown): string {
  const sha = (raw as { sourceSha256?: unknown } | null)?.sourceSha256;
  if (typeof sha !== 'string' || sha === '') {
    throw new GuideBasisError('노임표 파일에 sourceSha256 이 없다.');
  }
  return sha;
}

/**
 * 네 가이드의 노임이 **같은 표**인지 확인한다.
 *
 * 넷은 같은 날 같은 반기 자료에서 나왔다. 하나만 다른 반기로 교체되면
 * 0단계와 2단계가 서로 다른 노임으로 계산되고, 두 파일을 나란히 놓기 전에는
 * 아무도 모른다.
 */
export function assertGuidesAgree(guides: Iterable<GuideTemplate>): void {
  const seen = new Map<string, string[]>();
  for (const guide of guides) {
    const print = wageContentFingerprint(guide.wages);
    const ids = seen.get(print) ?? [];
    ids.push(guide.id);
    seen.set(print, ids);
  }
  if (seen.size <= 1) return;
  const groups = [...seen.values()].map((ids) => ids.join('+')).join(' / ');
  throw new GuideBasisError(
    `가이드들의 노임이 서로 다르다: ${groups}. 같은 반기 자료로 맞춰야 한다.`,
  );
}

export interface BuildGuideBasisInput {
  /** 배포된 세 파일. **셋 다 필수다** — 기존 검사를 그대로 통과해야 한다. */
  laborItemsRaw: unknown;
  wageTableRaw: unknown;
  laborMappingsRaw: unknown;
  choice: WageChoice;
}

/**
 * 기존 묶음을 먼저 검증하고, 그 다음 노임을 고른다.
 *
 * @throws 세 파일의 출처가 다르면 `buildLaborReference` 가 던진다. 그 검사는
 *   여기서 **무력화하지 않는다.**
 */
export function buildGuideBasis(input: BuildGuideBasisInput): GuideBasis {
  // 1) 기존 검사 — 품셈·노임·매핑이 같은 원본에서 나왔는지.
  const approved = buildLaborReference(
    input.laborItemsRaw,
    input.wageTableRaw,
    input.laborMappingsRaw,
  );
  const laborVersion = laborSourceId(input.wageTableRaw);

  if (input.choice.kind === 'approved') {
    return {
      reference: approved,
      wageReplaced: false,
      versions: {
        labor: laborVersion,
        wage: wageVersion(approved.wages),
      },
      unsupported: findUnsupported(approved, approved.wages),
    };
  }

  // 2) 노임만 가이드 것으로 바꾼다. 품(공수)과 매핑은 배포본 그대로다.
  const guide = input.choice.guide;

  return {
    reference: { ...approved, wages: guide.wages },
    wageReplaced: true,
    versions: {
      labor: laborVersion,
      wage: wageVersion(guide.wages),
    },
    unsupported: findUnsupported(approved, guide.wages),
  };
}

/**
 * 품셈이 쓰는 직종 중 고른 노임표에 없는 것을 찾는다.
 *
 * ## 왜 던지지 않는가
 *
 * 배포 품셈 1,331건 중 **2건**이 가이드에 없는 M/M 직종(응용 SW개발자,
 * 데이터베이스 운용자)을 쓴다. 그 2건 때문에 전체를 막으면 나머지 1,329건으로
 * 만드는 견적까지 못 낸다.
 *
 * 막는 일은 **그 행에서** 일어난다. `calculateLaborUnitPrice` 가 노임이 없는
 * 직종을 만나면 `wage-missing` 을 blocking 으로 세우고, 그러면 출력이 막힌다.
 * 여기서는 **무엇이 걸리는지 미리 알려주기만** 한다 — 화면이 "이 제품은 이
 * 가이드로 낼 수 없다"고 먼저 보여줄 수 있게.
 *
 * 상반기 값으로 채워 넣지 않는다. 기간이 다른 값을 섞는 것이다.
 */
function findUnsupported(
  approved: LaborReference,
  table: WageTable,
): UnsupportedByWage {
  const trades = new Set<string>();
  const laborItemIds = new Set<string>();
  const unitMismatch = new Set<string>();

  for (const item of approved.items) {
    for (const trade of item.trades) {
      const wage = table.wages[trade.trade];
      if (wage === undefined) {
        trades.add(trade.trade);
        laborItemIds.add(item.laborItemId);
        continue;
      }
      // 결정 D1: M/D 와 M/M 를 섞으면 약 20배 틀린다. 자동 환산하지 않는다.
      if (wage.unit !== item.wageUnit) unitMismatch.add(item.laborItemId);
    }
  }

  return {
    trades: [...trades].sort(),
    laborItemIds: [...laborItemIds].sort(),
    unitMismatchLaborItemIds: [...unitMismatch].sort(),
  };
}

/**
 * 문서에 적힌 기준과 지금 쓰려는 기준이 같은지 본다.
 *
 * 다르면 **막는다.** 조용히 다시 계산하면 사용자가 승인한 금액이 바뀐다
 * (설계서 §6.3). 바꾸려면 사용자가 명시적으로 재계산을 골라야 한다.
 */
export function assertSameBasis(
  recorded: Partial<BasisVersions> | undefined,
  current: BasisVersions,
): void {
  if (recorded === undefined) return;
  if (recorded.labor !== undefined && recorded.labor !== current.labor) {
    throw new GuideBasisError(
      `이 견적은 다른 품셈 기준으로 계산됐다 (${recorded.labor} → ${current.labor}). ` +
        '명시적으로 재계산을 골라야 바꿀 수 있다.',
    );
  }
  if (recorded.wage !== undefined && recorded.wage !== current.wage) {
    throw new GuideBasisError(
      `이 견적은 다른 노임 기준으로 계산됐다 (${recorded.wage} → ${current.wage}). ` +
        '명시적으로 재계산을 골라야 바꿀 수 있다.',
    );
  }
}
