/**
 * 메인페이지 자료 안내 — 노임 공표·표준품셈 PDF 보기·다운로드(계획 §8,
 * 2026-10-05).
 *
 * 링크만 렌더링한다 — `fetch`·`iframe`·`object`·`preload`·`prefetch`로
 * 미리 받지 않는다. 사용자가 보기/다운로드를 **누를 때만** 네트워크
 * 요청이 간다. 보기는 같은 사이트의 PDF를 새 탭으로 열고, 다운로드는
 * 그 **같은 파일**(바이트 동일)을 저장한다 — 내용을 추출해 화면에
 * 다시 그리지 않는다.
 *
 * 공표 PDF의 "적용기간"은 원문에 적힌 사실로만 보여준다 — 계산 기준
 * 버전과 연결하지 않는다. 날짜가 지나도 경고·자동 변경·출력 차단을
 * 하지 않는다(별도 명시 재계산 전까지는 기존 노임을 계속 쓴다).
 */
const BASE = import.meta.env.BASE_URL;

function docUrl(filename: string): string {
  return `${BASE}reference-docs/${encodeURIComponent(filename)}`;
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
      '한국정보통신공사협회 공표. 공표일 2026-09-01, 적용기간 2026-09-01~2026-12-31(원문 표기).',
      '정보통신부문 11개 + 건설업 공통부문 3개(교통정리원 포함) 총 14개 직종을 공표합니다. ' +
        '가이드 템플릿이 쓰는 17개 직종 중 12개와 값이 일치합니다 — 템플릿 17개 직종 전체의 근거는 아닙니다. ' +
        '나머지 5개 직종(저압케이블공·내선전공·플랜트기계설치공·내장공·건축목공)은 별도 출처 확인 대상입니다.',
      '적용기간이 지나도 이 화면이 경고를 내거나 계산 기준을 자동으로 바꾸지 않습니다 — ' +
        '다음 공표를 반영하는 것은 별도의 명시적 결정입니다.',
    ],
  },
  {
    filename: '2026년도-적용-정보통신공사-표준품셈.pdf',
    title: '2026년도 적용 정보통신공사 표준품셈',
    notes: [
      '노무비 산출근거 자료(587쪽). 과학기술정보통신부 지정 표준품셈 관리기관 보고 기준.',
      '이 화면은 원문 보기·다운로드만 제공합니다 — 내용을 추출해 화면에 다시 표시하거나 ' +
        '품셈 매핑·계산에 반영하지 않습니다. 이용 조건과 전체 내용 대조는 검증되지 않았습니다.',
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
                  보기
                </a>
                <a href={url} download={doc.filename} aria-label={`${doc.title} 다운로드`}>
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
