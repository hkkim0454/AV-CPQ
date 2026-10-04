/**
 * 화면과 Excel 이 **같은 기준으로** 계산하게 맞춘다 (계획 2026-10-04 Task 3).
 *
 * ## 무엇을 막는가
 *
 * 노임표가 둘이다. 배포본은 상반기, 가이드는 하반기다. 어느 쪽으로 계산했는지
 * 문서에 적어 두지 않으면 **다시 열 때마다 그때의 최신 기준으로 계산된다.**
 * 사용자가 승인하고 보낸 견적서를 다시 열었더니 금액이 달라져 있는 일이
 * 생긴다 (설계서 §6.3).
 *
 * 그래서 세 가지 모드를 **호출부가 명시**한다. 기본값을 두지 않는다.
 *
 * ```
 * initialize-new        새 문서. 고른 기준으로 계산하고 그 기준을 적는다
 * preserve              기존 문서. 적힌 기준과 다르면 **막는다**
 * explicit-recalculate  사용자가 "새 기준으로 다시 계산"을 고름. 기준을 바꾼다
 * ```
 *
 * `preserve` 에서 문서에 기준이 **안 적혀 있으면** 그것도 막는다. 비어 있다고
 * 최신 기준을 채워 넣으면, 그게 바로 조용한 재계산이다.
 */
import { priceQuote, type LaborReference, type PricedQuote } from '../../domain/quote/priceQuote';
import type { QuoteDocument } from '../../domain/quote/types';
import {
  assertSameBasis,
  GuideBasisError,
  type BasisVersions,
} from '../../data/catalog/guideBasis';
import {
  indirectCostsFor,
  type GuideTemplateSet,
  type IndirectProfileId,
} from '../ooxml/guideTemplate';
import type { ImportWarning } from '../../import/diagram/devices';

export type WageMode = 'preserve' | 'initialize-new' | 'explicit-recalculate';

export interface PrepareInput {
  document: QuoteDocument;
  /** `buildGuideBasis` 가 만든 것. 품은 배포본, 노임은 고른 것. */
  laborReference: LaborReference;
  /** 쓰려는 기준의 이름표. 문서에 적히거나, 적힌 것과 대조된다. */
  basisVersions: BasisVersions;
  guides: GuideTemplateSet;
  /** 시스템별 간접비 프로파일. 한 문서에 DS 와 일반이 섞일 수 있다. */
  profileBySystem: ReadonlyMap<string, IndirectProfileId>;
  importWarnings: readonly ImportWarning[];
  wageMode: WageMode;
}

export interface PreparedQuote {
  /** 기준이 반영된 **복사본**. 입력 문서는 건드리지 않는다. */
  document: QuoteDocument;
  priced: PricedQuote;
  profileBySystem: ReadonlyMap<string, IndirectProfileId>;
  importWarnings: readonly ImportWarning[];
  /** 구성도·품셈·계산 경고를 **전부** 합친 결과. */
  blocking: boolean;
}

/**
 * 문서에 적힌 기준을 읽는다.
 *
 * `versions.wage` 가 `'unknown'` 이면 기준이 **없는** 것이다. 옛 문서나
 * 기준을 기록하기 전에 만들어진 문서다.
 */
function recordedBasis(document: QuoteDocument): Partial<BasisVersions> | undefined {
  const wage = document.versions.wage;
  const labor = document.versions.labor;
  const known = (value: string): string | undefined =>
    value === '' || value === 'unknown' ? undefined : value;
  const recorded: Partial<BasisVersions> = {};
  const knownWage = known(wage);
  const knownLabor = known(labor);
  if (knownWage !== undefined) recorded.wage = knownWage;
  if (knownLabor !== undefined) recorded.labor = knownLabor;
  return knownWage === undefined && knownLabor === undefined ? undefined : recorded;
}

/**
 * 시스템마다 간접비 규칙을 프로파일에 맞춰 다시 심는다.
 *
 * **같은 프로파일을 다시 계산할 때는 건드리지 않는다.** 사용자가 적용 여부나
 * 요율을 손봤을 수 있고, 그걸 초기화하면 승인한 금액이 바뀐다.
 */
function applyProfiles(
  document: QuoteDocument,
  profileBySystem: ReadonlyMap<string, IndirectProfileId>,
  guides: GuideTemplateSet,
  initialize: boolean,
): QuoteDocument {
  const systems = document.systems.map((system) => {
    const profile = profileBySystem.get(system.systemId);
    if (profile === undefined) return { ...system };
    if (!initialize && system.indirectProfileId === profile) {
      // 같은 프로파일 그대로다 — 사용자가 고친 요율·적용 여부를 지키려고 손대지 않는다.
      return { ...system };
    }
    return {
      ...system,
      indirectProfileId: profile,
      indirectCosts: indirectCostsFor(profile, guides),
    };
  });
  return { ...document, systems };
}

export function prepareQuote(input: PrepareInput): PreparedQuote {
  const recorded = recordedBasis(input.document);

  if (input.wageMode === 'preserve') {
    if (recorded === undefined) {
      // 비어 있다고 최신 기준을 채워 넣으면 그게 조용한 재계산이다.
      throw new GuideBasisError(
        '이 견적에는 계산 기준이 적혀 있지 않다. ' +
          '어느 기준으로 만든 것인지 모르는 채로 다시 계산하지 않는다. ' +
          '명시적으로 재계산을 골라야 한다.',
      );
    }
    assertSameBasis(recorded, input.basisVersions);
  } else if (input.wageMode === 'initialize-new') {
    if (recorded !== undefined) {
      // 기존 문서에 새 기준을 덮어쓰는 경로로 쓰이면 안 된다.
      throw new GuideBasisError(
        '이미 계산 기준이 적힌 문서다. 새 문서용 경로로 열 수 없다. ' +
          'preserve 로 열거나 명시적으로 재계산을 골라야 한다.',
      );
    }
  }
  // 'explicit-recalculate' 는 사용자가 고른 것이다. 기준을 바꾼다.

  const document = applyProfiles(
    {
      ...input.document,
      versions: {
        ...input.document.versions,
        labor: input.basisVersions.labor,
        wage: input.basisVersions.wage,
      },
    },
    input.profileBySystem,
    input.guides,
    input.wageMode !== 'preserve',
  );

  const priced = priceQuote(document, input.laborReference);

  return {
    document,
    priced,
    profileBySystem: input.profileBySystem,
    importWarnings: input.importWarnings,
    // 셋 중 하나라도 막으면 막는다. `priced.blocking` 만 보면 구성도 경고가 빠진다.
    blocking: input.importWarnings.some((w) => w.blocking) || priced.blocking,
  };
}
