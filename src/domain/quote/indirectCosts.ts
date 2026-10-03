/**
 * 간접비 기본 프로파일 — **요율의 단일 출처** (설계서 §5.4, `docs/template/mapping.md` §3.6).
 *
 * 원본 견적서 `견적서(NEGO)_…_260826.xlsx`의 5개 시트 전부에서 같은 9항목·같은 요율을
 * 실측했다. 추측값이 아니다.
 *
 * ## 왜 여기 있는가
 *
 * 원래 이 표는 `tests/fixtures/syntheticQuote.ts`에만 있었다. 테스트 픽스처다.
 * 구성도 변환기가 견적을 만들려면 **제품 코드에서** 같은 표가 필요한데, 그때
 * 픽스처를 복사하면 요율이 두 곳에서 관리된다. 한쪽만 고치면 조용히 어긋난다.
 *
 * 그래서 여기를 출처로 삼고 테스트 픽스처가 이것을 다시 내보낸다.
 *
 * ## 적용·미적용
 *
 * 원본은 연금·건강·노인장기요양 **세 항목의 금액 칸이 상수 `0`**이다.
 * 요율은 적혀 있지만 이 견적에서 쓰지 않았다는 뜻이다.
 *
 * **이것이 법정 미적용이라는 뜻은 아니다.** 공사 종류와 발주처에 따라 달라진다
 * (설계서 §5.4: "모든 공사에 같은 보험·경비 요율을 적용하지 않는다").
 * 기본값은 원본과 같게 두고, 켜고 끄는 것은 사용자가 한다. 자동으로 켜지 않는다.
 *
 * 발주처별 프로파일(`간접비_DS` / `간접비_SDC, SDI` 시트)은 별도 과제다.
 * 그때는 이 배열을 통째로 갈아끼우면 된다 — 시스템마다 다른 프로파일도 이미 가능하다.
 */
import type { IndirectCostRule } from './types';

/** 어느 원본에서 읽었는지. 요율의 출처를 화면과 감사에서 추적할 수 있게 한다. */
export const INDIRECT_COST_SOURCE = '원본 견적서 양식 2026-08 기준';

/**
 * 원본 양식의 간접비 9항목.
 *
 * 호출할 때마다 **새 배열**을 만든다. 견적마다 `applied`를 독립적으로 바꾸므로
 * 상수 배열을 공유하면 한 견적의 변경이 다른 견적에 번진다.
 */
export function standardIndirectCosts(): IndirectCostRule[] {
  const of = (
    itemId: string,
    name: string,
    basisLabel: string,
    basis: IndirectCostRule['basis'],
    rate: string,
    applied: boolean,
  ): IndirectCostRule => ({
    itemId,
    name,
    basisLabel,
    basis,
    rate,
    applied,
    source: INDIRECT_COST_SOURCE,
  });

  return [
    of('i1', '간접노무비', '노무비 대비', { kind: 'labor' }, '0.0486', true),
    of('i2', '고용보험료', '노무비 대비', { kind: 'labor' }, '0.00424', true),
    of('i3', '산재보험료', '노무비 대비', { kind: 'labor' }, '0.00961', true),
    // --- 아래 셋은 원본에서 금액 칸이 상수 0이다. 기본 미적용. ---
    of('i4', '연금보험료', '노무비 대비', { kind: 'labor' }, '0.01215', false),
    of('i5', '건강보험료', '노무비 대비', { kind: 'labor' }, '0.00957', false),
    of('i6', '노인장기요양보험료', '노무비 대비', { kind: 'labor' }, '0.00124', false),
    // ---
    of('i7', '산업안전보건관리비', '직접비 대비', { kind: 'direct' }, '0.0311', true),
    of('i8', '퇴직공제부금비', '노무비 대비', { kind: 'labor' }, '0.00621', true),
    of(
      'i9',
      '공과잡비',
      '직접비+간접노무비+산업안전관리비',
      { kind: 'composite', plusItemIds: ['i1', 'i7'] },
      '0.1',
      true,
    ),
  ];
}
