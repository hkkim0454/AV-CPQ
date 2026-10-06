/**
 * 노무비 역산 대조 (품셈 교체 계획 Task 2).
 *
 * 추출이 **옳은 열을 읽었는지**를 자료 스스로 증명하게 한다. 원본이 적어 둔
 * 노무비 단가를, 우리가 읽은 공수·노임·요율·할증으로 **다시 계산해** 맞는지
 * 본다. 틀리면 어딘가 한 칸이 밀린 것이다.
 *
 * ## 산식 — 원본 수식에서 읽었다
 *
 * 하반기 원본의 노무비 단가 칸은 1,356행이 같은 모양이다.
 *
 * ```
 * =INT(SUM((할증*표준단가), 표준단가) * 요율)
 *   = INT( 표준단가 × (1 + 할증) × 요율 )
 * ```
 *
 * 그리고 `표준단가` 칸은 그 행의 **직종별 공수 × 노임의 합**이다. 우리는
 * 표준단가 칸을 읽지 않고 공수·노임에서 직접 더한다 — 그래야 직종 열이
 * 밀렸을 때 걸린다.
 *
 * ### `INT` 를 어디서 적용하는가 — 세 자리를 구분한다
 *
 * | 자리 | 적용 | 근거 |
 * |---|---|---|
 * | **원본 품셈 파일** | 노무비 단가 칸에서 `INT` 한 번 | 위 수식 (실측) |
 * | **우리 도메인 계산** | `calculateLaborUnitPrice` 가 같은 자리에서 `excelInt` | `domain/labor/calculateLabor.ts` |
 * | **Excel 출력** | 다시 적용하지 않는다 | 이미 정수로 넘어간다 |
 *
 * 여기서는 **원본 자리의 `INT`** 만 흉내낸다. 세 자리에서 각각 한 번씩
 * 적용하면 값이 달라진다.
 *
 * ## 네 갈래로만 나눈다
 *
 * ```
 * 통과     역산이 맞았다
 * 불일치   역산이 틀렸다                     ← 1건이라도 있으면 교체를 막는다
 * 미검증   계산에 필요한 값이 없거나 믿을 수 없다  ← 통과로 세지 않는다
 * 비대상   제품 행이 아니다 (제목·분류 머리글)
 * ```
 *
 * **`미검증` 을 통과로 세지 않는다.** 합이 전체 행 수와 맞는지 시험이 본다.
 */
import { Decimal, dec, excelInt } from '../../domain/calculation/rounding';
import type { RawRow, RawSheet } from './rawTypes';

export type LaborVerdict = '통과' | '불일치' | '미검증' | '비대상';

export interface LaborRowVerification {
  sheet: string;
  /** 원본 행 번호. 사람이 원본을 열어 찾아갈 수 있는 유일한 좌표다. */
  row: number;
  verdict: LaborVerdict;
  /** 미검증·불일치의 사유. **셀 값을 담지 않는다** — 분류 이름만 적는다. */
  reason?: string;
}

export interface LaborVerificationResult {
  rows: LaborRowVerification[];
  counts: Record<LaborVerdict, number>;
  /** 미검증 사유별 건수. "119건" 으로 뭉뚱그리지 않는다. */
  unverifiedReasons: Record<string, number>;
  /** **교체를 막는** 불일치. 승인 목록에 오른 행은 여기 들어가지 않는다. */
  mismatches: LaborRowVerification[];
  /** 사람이 사유를 적어 넘기기로 한 불일치. 넘겼다고 맞는 값이 되지는 않는다. */
  approved: LaborRowVerification[];
}

/**
 * 역산 불일치를 **한 행씩** 넘기는 승인 기록.
 *
 * ⛔ **통째로 면제하지 않는다.** 출처 파일의 해시까지 함께 적어서, 다음 판으로
 * 교체했을 때 옛 승인이 엉뚱한 행에 그대로 적용되는 일을 막는다. 행 번호는
 * 판이 바뀌면 다른 제품을 가리킨다.
 */
export interface MismatchApproval {
  /** 승인 당시 원본 파일의 SHA-256. 지금 원본과 다르면 승인은 무효다. */
  sourceSha256: string;
  sheet: string;
  row: number;
  /** 왜 넘기는지. 비어 있으면 승인으로 보지 않는다. */
  reason: string;
}

/** 외부 통합문서 참조 — `'[2]영상'!V6` 처럼 대괄호 안에 번호가 온다. */
const EXTERNAL_REFERENCE = /\[\d+\]/;

/** Excel 오류값. 숫자가 아니라 `#` 로 시작한다. */
function isErrorValue(value: string): boolean {
  return value.trimStart().startsWith('#');
}

function parseDecimal(value: string): Decimal | undefined {
  if (isErrorValue(value)) return undefined;
  try {
    return dec(value);
  } catch {
    return undefined;
  }
}

/**
 * 원본이 적어 둔 노무비 단가를 쓸 수 있는지 판정한다.
 *
 * 수식 칸의 **캐시값**을 쓰되, 눈으로 확인되는 조건으로만 거른다
 * (설계서 §8.3 — "캐시된 수식 결과를 조용히 신뢰하지 않는다").
 * "값이 그럴듯하다"로 통과시키지 않는다.
 */
function readOriginalLaborUnitPrice(row: RawRow): { value?: Decimal; reason?: string } {
  if (row.laborUnitPrice !== undefined) {
    const parsed = parseDecimal(row.laborUnitPrice);
    return parsed === undefined ? { reason: '노무비 단가가 숫자가 아니다' } : { value: parsed };
  }
  if (row.laborUnitPriceFormula === undefined) return { reason: '노무비 단가가 없다' };
  if (EXTERNAL_REFERENCE.test(row.laborUnitPriceFormula)) {
    return { reason: '노무비 단가가 외부 통합문서를 참조한다' };
  }
  if (row.laborUnitPriceCached === undefined) {
    return { reason: '노무비 단가가 수식인데 캐시값이 없다' };
  }
  const cached = parseDecimal(row.laborUnitPriceCached);
  return cached === undefined
    ? { reason: '노무비 단가 캐시값이 오류값이다' }
    : { value: cached };
}

function readRate(row: RawRow): { value?: Decimal; reason?: string } {
  const raw = row.itemRate ?? row.itemRateCached;
  if (raw === undefined) {
    return { reason: row.itemRateFormula === undefined ? '품목별 요율이 없다' : '품목별 요율이 수식인데 캐시값이 없다' };
  }
  const parsed = parseDecimal(raw);
  if (parsed === undefined) return { reason: '품목별 요율이 숫자가 아니다' };
  // 요율이 0이면 무엇을 곱해도 0이라 역산이 아무것도 증명하지 못한다.
  if (parsed.isZero()) return { reason: '품목별 요율이 0이라 역산이 아무것도 증명하지 못한다' };
  return { value: parsed };
}

function verifyRow(sheet: RawSheet, row: RawRow): LaborRowVerification {
  const at = { sheet: sheet.name, row: row.row };
  const trades = row.trades ?? [];

  // 제품 행조차 아니다 — 제목·분류 머리글. 미검증으로 세면 숫자가 부풀어
  // "검증 못한 제품"이 실제보다 많아 보인다.
  if (row.laborCode === undefined && trades.length === 0
      && row.laborUnitPrice === undefined && row.laborUnitPriceFormula === undefined) {
    return { ...at, verdict: '비대상' };
  }

  const original = readOriginalLaborUnitPrice(row);
  if (original.value === undefined) return { ...at, verdict: '미검증', reason: original.reason! };

  if (trades.length === 0) return { ...at, verdict: '미검증', reason: '직종별 공수가 없다' };

  const rate = readRate(row);
  if (rate.value === undefined) return { ...at, verdict: '미검증', reason: rate.reason! };

  const wageOf = new Map(sheet.wages.map((wage) => [wage.trade, wage]));
  const units = new Set<string>();
  let standard = new Decimal(0);
  for (const trade of trades) {
    const wage = wageOf.get(trade.trade);
    if (wage === undefined || wage.amount === null || wage.unit === null) {
      return { ...at, verdict: '미검증', reason: '직종의 노임을 찾지 못했다' };
    }
    units.add(wage.unit);
    const quantity = parseDecimal(trade.quantity);
    const amount = parseDecimal(wage.amount);
    if (quantity === undefined || amount === undefined) {
      return { ...at, verdict: '미검증', reason: '공수 또는 노임이 숫자가 아니다' };
    }
    standard = standard.plus(quantity.times(amount));
  }
  // D1 — M/D와 M/M을 한 행에서 더하면 약 20배 틀린다. 환산하지 않고 멈춘다.
  if (units.size > 1) {
    return { ...at, verdict: '미검증', reason: '한 행에 M/D와 M/M이 섞여 있다 (D1)' };
  }

  const surcharge = row.surcharge === undefined ? new Decimal(0) : parseDecimal(row.surcharge);
  if (surcharge === undefined) return { ...at, verdict: '미검증', reason: '할증이 숫자가 아니다' };

  // ⛔ `×할증` 이 아니라 `×(1+할증)` 이다. 할증 0.2는 1.2배지 0.2배가 아니다.
  const expected = excelInt(standard.times(surcharge.plus(1)).times(rate.value));
  if (!expected.equals(original.value)) {
    return { ...at, verdict: '불일치', reason: '역산 결과가 원본의 노무비 단가와 다르다' };
  }
  return { ...at, verdict: '통과' };
}

export interface VerifyLaborOptions {
  /** 지금 원본의 SHA-256. 승인 기록이 이 판의 것인지 가리는 데 쓴다. */
  sourceSha256?: string;
  approvedMismatches?: readonly MismatchApproval[];
}

export function verifyLaborRows(
  sheets: readonly RawSheet[],
  options: VerifyLaborOptions = {},
): LaborVerificationResult {
  const rows: LaborRowVerification[] = [];
  for (const sheet of sheets) {
    for (const row of sheet.rows) rows.push(verifyRow(sheet, row));
  }
  const counts: Record<LaborVerdict, number> = { 통과: 0, 불일치: 0, 미검증: 0, 비대상: 0 };
  const unverifiedReasons: Record<string, number> = {};
  for (const result of rows) {
    counts[result.verdict] += 1;
    if (result.verdict === '미검증' && result.reason !== undefined) {
      unverifiedReasons[result.reason] = (unverifiedReasons[result.reason] ?? 0) + 1;
    }
  }

  // 승인은 **이 판의 그 행**에만 적용된다. 해시·시트·행이 전부 맞고 사유가
  // 비어 있지 않아야 한다.
  const approvals = new Set(
    (options.approvedMismatches ?? [])
      .filter((a) => a.reason.trim() !== '' && a.sourceSha256 === options.sourceSha256)
      .map((a) => `${a.sheet} ${a.row}`),
  );
  const all = rows.filter((r) => r.verdict === '불일치');
  const approved = all.filter((r) => approvals.has(`${r.sheet} ${r.row}`));
  const mismatches = all.filter((r) => !approvals.has(`${r.sheet} ${r.row}`));

  return { rows, counts, unverifiedReasons, mismatches, approved };
}

/** 불일치 한 건을 사람이 읽는 한 줄로. **금액을 적지 않는다** — 좌표와 사유만. */
export function describeMismatch(mismatch: LaborRowVerification): string {
  return `${mismatch.sheet} ${mismatch.row}행: ${mismatch.reason ?? '역산 불일치'}`;
}

export interface WageComparison {
  /** 양쪽에 있고 금액·단위까지 같은 직종 수. */
  same: number;
  /** 사람이 읽는 차이 설명. 노임은 공표된 공개 수치라 금액을 적어도 된다. */
  differences: string[];
}

/**
 * 품셈 파일에서 읽은 노임표를 **견적서 가이드 템플릿의 노임**과 대조한다.
 *
 * 화면 계산은 가이드 노임을 쓴다(`workspace.ts`의 `WAGE_GUIDE_ID`). 품셈
 * 파일과 가이드가 다르면 **같은 견적서 안에서 숫자가 갈린다** — 품셈 항목은
 * 품셈 파일 기준인데 노무비는 가이드 노임으로 계산되기 때문이다.
 *
 * 여기서 막지는 않는다. 어느 쪽이 옳은지는 자료를 보고 사람이 정할 일이다.
 * 이 함수는 **무엇이 얼마나 다른지**만 돌려준다.
 */
export function compareGuideWages(
  extracted: Readonly<Record<string, { amount: string; unit: string }>>,
  guide: Readonly<Record<string, { amount: string; unit: string }>>,
): WageComparison {
  const trades = [...new Set([...Object.keys(extracted), ...Object.keys(guide)])].sort();
  const differences: string[] = [];
  let same = 0;
  for (const trade of trades) {
    const mine = extracted[trade];
    const theirs = guide[trade];
    if (theirs === undefined) {
      differences.push(`${trade}: 품셈 파일에만 있다 (${mine!.amount}/${mine!.unit})`);
    } else if (mine === undefined) {
      differences.push(`${trade}: 가이드에만 있다 (${theirs.amount}/${theirs.unit})`);
    } else if (mine.amount !== theirs.amount || mine.unit !== theirs.unit) {
      differences.push(
        `${trade}: 품셈 ${mine.amount}/${mine.unit} vs 가이드 ${theirs.amount}/${theirs.unit}`,
      );
    } else same += 1;
  }
  return { same, differences };
}
