/**
 * 접을 수 있는 설정 영역 (사용성 2차 Task C).
 *
 * ## ⛔ 접어도 children 을 떼지 않는다
 *
 * 조건부 렌더(`{open && <Panel/>}`)로 접으면 그 안의 입력이 **unmount** 된다.
 * 그러면:
 *
 * - 사람이 치던 값(`TextCell` 의 지역 draft)이 사라진다.
 * - `QuoteDrafts` 에 등록된 "입력 중" 표식이 cleanup 으로 풀려, 저장하지 않은
 *   변경이 있는데도 경고 없이 다른 문서를 열 수 있게 된다.
 * - `PrivateCostPanel` 의 원가 세션과 연결이 끊긴다. 문서 교체 때 폐기하는
 *   것은 정책이지만, **접었다는 이유로** 잃는 것은 결함이다.
 *
 * 그래서 `hidden` 으로만 감춘다. DOM 에는 남고 상태도 그대로다.
 *
 * ## 이 상태는 문서가 아니다
 *
 * 접기 여부는 화면 state 일 뿐이라 `QuoteDocument` 나 작업 파일에 넣지 않는다.
 * 접었다 폈다고 "저장하지 않은 변경"이 생기면 안 된다.
 *
 * ## ⛔ 바깥에서 **계속 펼쳐 두지** 않는다
 *
 * 펼치라는 요청은 `openRequest` 라는 **번호 한 번**으로 온다. 값이 바뀐
 * 그때 한 번만 펼치고, 그 뒤로는 사람이 접을 수 있다.
 *
 * 전에는 `forceOpen` 이라는 참/거짓을 받아 `open || forceOpen` 으로 폈다.
 * 그러면 한 번 이동한 뒤에는 그 값이 계속 참이라 **접기 단추를 눌러도
 * 영영 접히지 않았다.** 케이블 영역처럼 "아직 반영되지 않은 수정"이
 * 있는 동안 계속 참인 경우에는 더 심해서, 사람이 입력하는 내내 접을 수
 * 없었다(2026-10-12 독립 검토 지적, 실측 확인).
 */
import { useId, useState, type ReactNode } from 'react';

/**
 * 설정 영역의 DOM id.
 *
 * 탐색이 `getElementById` 로 찾는다. 선택자 문자열로 조합하지 않는다 —
 * `sectionId` 에 시스템 식별자가 섞여 들어가므로, 따옴표나 공백이 있으면
 * 선택자가 깨진다.
 */
export function sectionDomId(sectionId: string): string {
  return `q-section-${sectionId}`;
}

interface WorkspaceSectionProps {
  title: string;
  /** 처음에 펼친 채로 둘지. 기본은 접어 둔다 — 견적표를 먼저 보여준다. */
  defaultOpen?: boolean;
  /**
   * 펼치라는 **일회성 요청 번호**. 값이 달라진 렌더에서 한 번만 펼친다.
   * 같은 값이 다시 와도 아무 일도 하지 않으므로, 사람이 접은 상태가
   * 다음 요청 전까지 그대로 유지된다.
   */
  openRequest?: number;
  /** 영역을 찾아갈 때 쓰는 표식. */
  sectionId?: string;
  children: ReactNode;
}

export function WorkspaceSection({
  title,
  defaultOpen = false,
  openRequest,
  sectionId,
  children,
}: WorkspaceSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [handledRequest, setHandledRequest] = useState(openRequest);
  const bodyId = useId();

  // 렌더 중에 비교해서 **같은 렌더 패스 안에서** 펼친다(React 의 "prop 이
  // 바뀔 때 state 조정" 패턴). `useEffect` 로 미루면 한 프레임 늦게 열려서,
  // 부르는 쪽이 다음 프레임에 포커스할 때 아직 `hidden` 이라 포커스가 먹지 않는다.
  if (openRequest !== handledRequest) {
    setHandledRequest(openRequest);
    if (openRequest !== undefined) setOpen(true);
  }

  const expanded = open;

  return (
    <section
      className="q-card q-workspace-section"
      {...(sectionId === undefined
        ? {}
        : { 'data-section': sectionId, id: sectionDomId(sectionId) })}
    >
      <h3 className="q-section-head">
        <button
          type="button"
          className="q-button q-section-toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
        >
          {title}
          <span aria-hidden="true">{expanded ? ' ▾' : ' ▸'}</span>
        </button>
      </h3>
      {/*
        ⛔ `{expanded && children}` 으로 바꾸지 않는다. 그러면 접을 때마다
        입력이 unmount 되어 draft·원가 세션을 잃는다. `hidden` 은 DOM 에
        남기고 보조기술에도 숨긴다.
      */}
      <div id={bodyId} hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}
