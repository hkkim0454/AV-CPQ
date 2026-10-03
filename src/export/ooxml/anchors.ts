/**
 * 정리된 템플릿의 **모델 행 번호**.
 *
 * `tools/build_template.py`가 이 행들에 서식과 고정 문구를 남긴다.
 * exporter는 여기서 `s=` 스타일 인덱스를 수확해 실제 행을 만든다.
 * 템플릿을 다시 만들 때 build_template.py의 상수와 이 파일이 함께 움직여야 한다.
 *
 * 근거: `docs/template/mapping.md` §3, §5.
 */

export const TEMPLATE_PATH = 'templates/sanitized/quote-template.xlsx';

/** 템플릿 안의 시트 이름. */
export const TEMPLATE_COVER_SHEET = '갑지';
export const TEMPLATE_SYSTEM_SHEET = '__system__';

/** 내역 시트의 모델 행 (원본 `LED Display ` 기준). */
export const SYSTEM_ANCHOR = {
  /** `="▣ 공사명 : "&갑지!C5` */
  title: 1,
  /** 2단 머리글 윗줄. */
  headerTop: 2,
  /** 2단 머리글 아랫줄 (`단 가` / `금 액`). */
  headerBottom: 3,
  /** `Ⅰ` / `직접비` */
  directHeader: 4,
  /** `[ 시스템명 ]` 그룹 머리글. */
  group: 5,
  /** 소그룹 머리글. */
  subgroup: 6,
  /** 첫 품목 행 — A열이 상수 `1`이라 서식이 다르다. */
  firstItem: 7,
  /** 두 번째 이후 품목 행 — A열이 `=A{이전}+1`. */
  item: 8,
  /** `직접비계` */
  directTotal: 23,
  /** `Ⅱ` / `간접비` */
  indirectHeader: 24,
  /** 간접비 첫 행. */
  indirectFirst: 25,
  /** 간접비 중간 행. */
  indirectMiddle: 26,
  /** 간접비 마지막 행 (`공과잡비`) — C열이 길어 서식이 다르다. */
  indirectLast: 33,
  /** `간접비계` */
  indirectTotal: 34,
  /** `합      계` — 갑지가 참조하는 행. */
  grandTotal: 35,
} as const;

/** 갑지의 모델 행. */
export const COVER_ANCHOR = {
  /** `견   적   서` */
  title: 1,
  /** `No.` */
  quoteNumber: 2,
  quoteDate: 3,
  customer: 4,
  projectName: 5,
  contact: 6,
  /** `아래와 같이 견적합니다.` */
  intro: 7,
  /** `금  액 :` + NUMBERSTRING 수식. */
  amountSentence: 8,
  /** 표 머리글. */
  header: 9,
  /** 로마자 구역 행. */
  group: 10,
  /** 시스템 행. */
  system: 11,
  /** 마지막 시스템 행 — 아래 테두리가 달라 서식이 다르다. */
  lastSystem: 15,
  /** `합     계` + ROUNDDOWN. */
  sum: 16,
  /** `NEGO` — 음수 입력값. */
  nego: 17,
  /** `최     종     합     계` */
  final: 18,
  /** `비 고` 첫 줄. */
  remarkFirst: 19,
  /** `비 고` 둘째 줄. */
  remarkSecond: 20,
  /** 마감 행 — 인쇄 범위의 마지막 행. */
  close: 21,
} as const;

/** 원본의 행 높이 (pt). */
export const ROW_HEIGHT = {
  coverTitle: 50.2,
  coverBody: 24,
  coverClose: 10.05,
  systemHead: 20.75,
  systemItem: 21,
  systemTotals: 20.75,
} as const;

/** 설계서 §4.1에서 확인한 인쇄 설정. */
export const PRINT = {
  coverScale: 98,
  systemScale: 83,
  /** 내역 시트의 반복 머리글. */
  systemTitleRows: '$1:$3',
} as const;
