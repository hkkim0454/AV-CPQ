/**
 * 산출물에 원가가 섞였는지 **보조로** 확인한다 (계획 2026-10-04 B2).
 *
 * ## 이 검사가 무엇이 아닌지 먼저
 *
 * 숫자 일치만으로는 유출을 판정할 수 없다. 판매가와 원가가 같을 수도 있고
 * (마진 0 제품), 수량 × 판매단가가 무관한 제품의 원가와 우연히 같을 수도 있다.
 *
 * 원가가 고객 출력에 안 들어가게 막는 가장 큰 방지선은 고객용 projection이
 * 원가를 아예 전달받지 못하는 타입 구조다 (`buildCustomerProjection`은
 * `PrivateCostSession`을 인자로 받지 않는다 — 설계서 §10.4, `audit-exports.mjs`
 * 6번 규칙). 다만 **이것도 완전한 보증은 아니다** — 생성기 코드 자체가 버그로
 * 숫자를 엉뚱한 칸에 쓰면 타입 시스템은 그걸 못 막는다(독립 검토에서 비고
 * 칸이 그런 예로 지적됐다). 이 칸 기반 검사는 그 틈을 메우는 **보조** 장치이지,
 * 이것 하나로 유출이 없다고 단정할 수 있는 건 아니다.
 *
 * ## 값이 아니라 **칸**으로 가른다
 *
 * 처음에는 "정당하게 들어갈 수 있는 값"이면 어디에 있든 봐주었다.
 * 그건 못 쓴다 — 같은 숫자가 판매가 칸(A1)에도 있고 금지 칸(Z1)에도 있으면
 * 둘 다 통과한다. 독립 검토에서 그대로 재현됐다.
 *
 * 이제 **어느 칸이 판매측인지**를 받는다. 같은 값이라도 그 칸이면 정상이고
 * 아니면 유출이다. 마진 0 제품은 판매가 칸에 있으니 통과하고, 품셈 블록이나
 * 인쇄 영역 밖에 같은 값이 나오면 걸린다.
 *
 * ## 왜 느슨하게 만들었나
 *
 * 처음 판은 고객용 파일에서 **35종을 찾았고 전부 오경보**였다.
 *
 * ```
 * 30종  theme1.xml 색상값(satMod/lumMod)·styles.xml 서식 번호에 우연히 같은 숫자
 *  3종  원가 == 판매가인 제품 (마진 0) → 판매가로 들어간 것. 정상
 *  2종  계산된 금액(수량 × 판매단가)이 무관한 제품 원가와 우연히 일치
 * ```
 *
 * `'원가'`라는 단어도 걸렸는데 시연용 **공사명**이 "원가 연결 시연"이었다.
 *
 * 전부 오경보인 검사는 양치기 소년이다. 진짜 유출이 나와도 묻힌다.
 * 그래서 **셀 값만** 보고, **정당하게 들어갈 수 있는 값은 제외**하고,
 * 단어 검사에서 `원가`를 뺐다.
 *
 * ## 값을 담지 않는다
 *
 * 설계서 §8.4: 발견 내용에 **좌표와 사유만** 담는다. 금액은 담지 않는다 —
 * 유출을 찾는 도구가 로그로 유출하면 말이 안 된다.
 */
import { unzipSync, strFromU8 } from 'fflate';

/**
 * 고객용 산출물에 나오면 안 되는 단어.
 *
 * `원가`는 **뺐다.** 공사명에 들어갈 수 있고 실제로 그랬다.
 * `제조사/구매처`(M열)·`영업비고`(N열)는 어떤 출력에도 나오면 안 된다 —
 * 2단계에서 품셈 블록을 지울 때 한 열이라도 남으면 매입처가 고객에게 간다.
 */
export const FORBIDDEN_WORDS = [
  '이익률',
  '이익율',
  '마진',
  '가산율',
  '매입단가',
  '매입처',
  '제조사/구매처',
  '영업비고',
] as const;

export interface LeakFinding {
  kind: 'cost-value' | 'forbidden-word' | 'forbidden-part';
  part: string;
  /** 셀 주소. 셀이 아니면 없다. */
  ref?: string;
  /** 금지 단어. **금액은 절대 담지 않는다** (설계서 §8.4). */
  detail?: string;
}

export interface ScanInput {
  /** 대조할 원가 값. 이 배열은 호출부 메모리에만 있고 어디에도 쓰지 않는다. */
  costValues: readonly string[];
  /**
   * **판매측 숫자가 정당하게 들어가는 칸.** `xl/worksheets/sheet2.xml!J15` 꼴.
   *
   * 값 목록이 아니라 **칸 목록**이다. 값으로 봐주면 같은 숫자가 금지 칸에
   * 있어도 통과한다 — 그게 이전 판의 구멍이었다.
   *
   * 호출부가 만든다. 생성기가 어느 칸에 판매단가·금액·합계를 썼는지 알기
   * 때문이다. 모르면 빈 집합을 넘겨 **전부 검사**하면 된다.
   */
  allowedCells: ReadonlySet<string>;
}

/**
 * 고객용 통합문서에 **있으면 안 되는 파트.**
 *
 * 메모·사용자 지정 XML·외부 링크·매크로는 열어 보지 않으면 모른다.
 * 숫자를 뒤지기 전에 파트 목록부터 본다.
 */
const FORBIDDEN_PARTS =
  /comments|threadedComment|person|customXml|docProps\/custom|externalLink|vbaProject|oleObject|embeddings/i;

/** `"1,234,567.00"` → `"1234567"`. 표기가 달라도 같은 값으로 본다. */
function canonical(raw: string): string | undefined {
  const cleaned = raw.replace(/[,\s₩$¥€]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return undefined;
  const negative = cleaned.startsWith('-');
  const body = negative ? cleaned.slice(1) : cleaned;
  const [whole = '0', fraction = ''] = body.split('.');
  const trimmedFraction = fraction.replace(/0+$/, '');
  const trimmedWhole = whole.replace(/^0+(?=\d)/, '');
  const out = trimmedFraction === '' ? trimmedWhole : `${trimmedWhole}.${trimmedFraction}`;
  return negative && out !== '0' ? `-${out}` : out;
}

/**
 * 워크시트의 `<c>` 를 훑는다. 정규식이지만 **셀 요소 안**만 본다.
 *
 * **자기닫기 꼴을 먼저 둔다.** 뒤에 두면 빈 칸이 여닫이 분기에 먼저 걸려
 * `[^>]*` 가 `/` 를 먹고, 본문 분기가 **다음 셀의 값까지** 삼킨다.
 * 그러면 빈 칸이 남의 값을 가진 것으로 보고된다. 실측으로 빈 칸 여덟 개가
 * 유출로 잡혔다.
 */
const CELL = /<c(?=[ />])([^>]*?)\/>|<c(?=[ />])([^>]*)>([\s\S]*?)<\/c>/g;
const ATTR = (source: string, name: string): string | undefined =>
  new RegExp('(?:^|[ \t])' + name + '="([^"]*)"').exec(source)?.[1];

function scanWorksheet(
  part: string,
  xml: string,
  costs: ReadonlySet<string>,
  allowedCells: ReadonlySet<string>,
  findings: LeakFinding[],
): void {
  CELL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CELL.exec(xml)) !== null) {
    // 1번 그룹 = 자기닫기 속성, 2·3번 = 여닫이 속성·본문.
    const attrs = match[1] ?? match[2] ?? '';
    const body = match[3] ?? '';
    const ref = ATTR(attrs, 'r');
    const type = ATTR(attrs, 't');

    // t="s" 면 <v> 는 sharedStrings **인덱스**다. 금액이 아니다.
    // 이걸 숫자로 보면 인덱스 35가 원가 35와 같다고 유출이 된다.
    if (type === 's' || type === 'inlineStr' || type === 'str') {
      const text = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
        .map((m) => m[1] ?? '')
        .join('');
      reportWords(part, text, findings, ref);
      continue;
    }

    const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
    if (raw === undefined) continue;
    const value = canonical(raw);
    if (value === undefined) continue;
    if (!costs.has(value)) continue;
    // **칸으로 가린다.** 같은 값이라도 판매측 칸이면 정상, 아니면 유출이다.
    if (ref !== undefined && allowedCells.has(`${part}!${ref}`)) continue;
    findings.push({ kind: 'cost-value', part, ...(ref !== undefined ? { ref } : {}) });
  }
}

function reportWords(
  part: string,
  text: string,
  findings: LeakFinding[],
  ref?: string,
): void {
  for (const word of FORBIDDEN_WORDS) {
    if (!text.includes(word)) continue;
    findings.push({
      kind: 'forbidden-word',
      part,
      detail: word,
      ...(ref !== undefined ? { ref } : {}),
    });
  }
}

export function scanCostLeak(bytes: Uint8Array, input: ScanInput): LeakFinding[] {
  const costs = new Set(
    input.costValues.map(canonical).filter((v): v is string => v !== undefined),
  );
  const files = unzipSync(bytes);
  const findings: LeakFinding[] = [];

  for (const part of Object.keys(files)) {
    if (FORBIDDEN_PARTS.test(part)) {
      findings.push({ kind: 'forbidden-part', part });
    }
  }

  for (const [part, raw] of Object.entries(files)) {
    if (!part.endsWith('.xml')) continue;
    const xml = strFromU8(raw);

    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(part)) {
      scanWorksheet(part, xml, costs, input.allowedCells, findings);
      continue;
    }

    if (part === 'xl/sharedStrings.xml') {
      // 문자열만 본다. 숫자는 셀에서 이미 봤다.
      for (const m of xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) {
        reportWords(part, m[1] ?? '', findings);
      }
      continue;
    }

    if (part === 'xl/workbook.xml') {
      for (const m of xml.matchAll(/<definedName\b[^>]*name="([^"]*)"/g)) {
        reportWords(part, m[1] ?? '', findings);
      }
      continue;
    }

    // theme·styles 등은 **보지 않는다.** 색상값·서식 번호가 금액과 우연히
    // 같은 경우가 30건이었고 전부 오경보였다.
  }

  return findings;
}
