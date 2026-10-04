/**
 * 메인페이지 자료 안내 — 노임 공표·표준품셈 PDF 보기·다운로드(계획 §8,
 * 2026-10-05).
 *
 * 링크만 렌더링한다 — `fetch`·`iframe`·`object`·`preload`·`prefetch`로
 * 미리 받지 않는다. 사용자가 보기/다운로드를 **누를 때만** 네트워크
 * 요청이 간다. 보기는 같은 사이트의 PDF를 새 탭으로 열고, 다운로드는
 * 그 **같은 파일**(바이트 동일)을 저장한다.
 *
 * 화면 문구는 사용자에게 필요한 사실(제목·발행 기관·원문 적용기간·
 * 정보통신 자료 범위)만 간결하게 담는다. 아래는 화면에는 없는 내부
 * 검증/작업 상태 기록이다(독립 검토 지적 반영, 2026-10-05):
 * - 두 PDF 모두 이용 조건(재배포·인용 등 저작권 허락 범위)은 검증되지
 *   않았다 — 사용자가 올린 원문을 그대로 내주는 것 이상의 권한 확인은
 *   하지 않았다.
 * - 표준품셈 PDF(587쪽)는 보기·다운로드만 제공한다. 내용을 추출해
 *   화면에 다시 표시하거나 기존 품셈 매핑·계산 로직과 대조/반영하는
 *   작업은 이번 범위에 없다(별도 과제).
 * - 노임 공표 PDF 표지 원문을 직접 pdftotext로 재확인했다(발행:
 *   한국정보통신공사협회, 통계법 제17조 승인번호 제365004호, 공표일
 *   2026-09-01, 적용기간 2026-09-01~12-31, 14개 직종 공표임금 일치).
 * - 표준품셈 PDF 표지 원문도 직접 재확인했다 — "과학기술정보통신부
 *   지정 표준품셈 관리기관"은 「한국정보통신산업연구원」이다(기존
 *   "지정 관리기관 보고 기준"이라는 모호한 표현을 이 정확한 기관명으로
 *   교체했다).
 */
const BASE = import.meta.env.BASE_URL;

function docUrl(filename: string): string {
  return `${BASE}reference-docs/${encodeURIComponent(filename)}`;
}

function ViewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M1 8s2.7-5 7-5 7 5 7 5-2.7 5-7 5-7-5-7-5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M8 1.5v8.5M8 10l-3-3M8 10l3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 12.5v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

interface DocEntry {
  filename: string;
  title: string;
  notes: readonly string[];
}

const DOCS: readonly DocEntry[] = [
  {
    filename: '2026년_하반기_적용_정보통신부문_시중노임단가_공표_안내_1부.pdf',
    title: '2026년 하반기 정보통신 노임 공표',
    notes: [
      '한국정보통신공사협회 공표 · 공표일 2026-09-01 · 적용기간 2026-09-01~2026-12-31(원문 표기).',
      '정보통신부문 11개 + 건설업 공통부문 3개, 총 14개 직종의 노임단가를 담고 있습니다. ' +
        '가이드 템플릿 17개 직종 중 12개와 값이 일치하며, 나머지 5개 직종' +
        '(저압케이블공·내선전공·플랜트기계설치공·내장공·건축목공)의 근거는 이 문서에 없습니다.',
    ],
  },
  {
    filename: '2026년도-적용-정보통신공사-표준품셈.pdf',
    title: '2026년도 적용 정보통신공사 표준품셈',
    notes: [
      '과학기술정보통신부 지정 표준품셈 관리기관 한국정보통신산업연구원 발행 · 노무비 산출근거 자료(587쪽).',
      '원문 보기·다운로드만 제공합니다.',
    ],
  },
];

export function ReferenceDocs() {
  return (
    <section className="q-card q-reference-docs">
      <h3>자료 안내</h3>
      <ul>
        {DOCS.map((doc) => {
          const url = docUrl(doc.filename);
          return (
            <li key={doc.filename}>
              <strong>{doc.title}</strong>
              <span className="q-reference-doc-actions">
                <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`${doc.title} 보기`}>
                  <ViewIcon />
                  보기
                </a>
                <a href={url} download={doc.filename} aria-label={`${doc.title} 다운로드`}>
                  <DownloadIcon />
                  다운로드
                </a>
              </span>
              {doc.notes.map((note) => (
                <p key={note} className="q-muted">
                  {note}
                </p>
              ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
