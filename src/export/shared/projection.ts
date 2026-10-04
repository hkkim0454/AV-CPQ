/**
 * 사내 공유용(1단계) 출력에 들어갈 것 (계획 2026-10-04 Task 4, 결정 D18).
 *
 * ## 고객용에 무엇을 더하는가
 *
 * ```
 * 고객용 projection  품명·규격·단위·수량·금액·사람 비고
 *   + 설명           D열. 제품 설명
 *   + 품셈 근거      품셈 코드·직종별 품·요율·할증
 *   + 제조사/구매처  영업비고
 * ```
 *
 * **원가와 이윤은 더하지 않는다.** 1단계는 영업팀 외 직원이 본다.
 *
 * ## 왜 고객용을 그대로 품고 가는가
 *
 * 1단계를 따로 만들면 두 경로가 갈려서, 고객용에서 뺀 것이 공유용에
 * 남는 일이 생긴다. 고객용 허용목록을 **그대로 쓰고** 그 위에 얹는다.
 * 빼는 방향으로만 가므로 되돌아갈 길이 없다 (D18 누적 삭제).
 *
 * ## 자유 텍스트는 구조로 못 막는다
 *
 * 사람이 비고 칸에 `원가 120만` 이라고 적으면 타입으로는 막을 수 없다.
 * 그건 구조가 아니라 내용이다. `suspiciousNotes` 로 **알리기만** 하고
 * "안전하다"고 보증하지 않는다.
 */
import type { LaborBreakdown } from '../../domain/labor/calculateLabor';
import type { CustomerExport } from '../customer/projection';
import { buildCustomerProjection } from '../customer/projection';
import type { PreparedQuote } from '../variants/prepare';

/** 행별 설명과 품셈 근거. 1단계와 0단계가 함께 쓴다. */
export interface SharedDetails {
  /** rowId → 제품 설명 (D열). */
  descriptionByRow: ReadonlyMap<string, string>;
  /** rowId → 일위대가 근거. */
  laborByRow: ReadonlyMap<string, LaborBreakdown>;
}

/**
 * 거래처 메타데이터. **원가가 아니다.**
 *
 * 사용자 결정: 영업팀 외 공유는 `G·H·N` 만 지운다. 제조사/구매처와
 * 영업비고는 1단계에 남는다. 2단계(고객)에서는 열 자체를 만들지 않는다.
 */
export interface SharedNotes {
  supplierByRow: ReadonlyMap<string, string>;
  salesRemarkByRow: ReadonlyMap<string, string>;
}

export interface SuspiciousNote {
  rowId: string;
  /** 어느 칸인지. 값은 담지 않는다. */
  field: 'remark' | 'salesRemark' | 'supplier' | 'description';
  /** 걸린 낱말. 금액은 담지 않는다. */
  word: string;
}

export interface SharedExport {
  customer: CustomerExport;
  details: SharedDetails;
  notes: SharedNotes;
  /**
   * 사람이 손으로 적은 글에 원가 냄새가 나는 것들.
   *
   * **경고일 뿐 보증이 아니다.** 여기가 비었다고 안전한 것이 아니다.
   */
  suspiciousNotes: SuspiciousNote[];
}

/**
 * 자유 텍스트에서 찾을 낱말.
 *
 * `원가` 는 **넣지 않는다.** 공사명에 들어갈 수 있고 실제로 그랬다
 * (`원가 연결 시연`). 양치기 소년이 되면 진짜가 묻힌다.
 */
const SUSPICIOUS_WORDS = [
  '매입',
  '마진',
  '이익률',
  '이익율',
  '가산율',
  '원가율',
] as const;

function scanNote(
  rowId: string,
  field: SuspiciousNote['field'],
  text: string | undefined,
  out: SuspiciousNote[],
): void {
  if (text === undefined || text === '') return;
  for (const word of SUSPICIOUS_WORDS) {
    if (text.includes(word)) out.push({ rowId, field, word });
  }
}

/** 허용된 필드만 복사한다. 객체를 통째로 펼치지 않는다. */
function copyNotes(source: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [rowId, value] of source) {
    if (typeof rowId !== 'string' || typeof value !== 'string') continue;
    out.set(rowId, value);
  }
  return out;
}

export function buildSharedProjection(
  prepared: PreparedQuote,
  notes: SharedNotes,
): SharedExport {
  const customer = buildCustomerProjection(prepared.document, prepared.priced.calculation);

  const descriptionByRow = new Map<string, string>();
  const suspicious: SuspiciousNote[] = [];

  for (const row of prepared.document.rows) {
    if (row.type !== 'item') continue;
    const description = row.internalDescription;
    if (description !== undefined && description !== '') {
      descriptionByRow.set(row.rowId, description);
    }
    scanNote(row.rowId, 'description', description, suspicious);
    scanNote(row.rowId, 'remark', row.remark, suspicious);
  }

  const supplierByRow = copyNotes(notes.supplierByRow);
  const salesRemarkByRow = copyNotes(notes.salesRemarkByRow);
  for (const [rowId, text] of supplierByRow) {
    scanNote(rowId, 'supplier', text, suspicious);
  }
  for (const [rowId, text] of salesRemarkByRow) {
    scanNote(rowId, 'salesRemark', text, suspicious);
  }

  return {
    customer,
    details: {
      descriptionByRow,
      // 품셈 근거는 계산이 만든 것이다. 여기서 지어내지 않는다.
      laborByRow: new Map(prepared.priced.laborBreakdowns),
    },
    notes: { supplierByRow, salesRemarkByRow },
    suspiciousNotes: suspicious,
  };
}
