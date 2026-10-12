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
 */
import { useId, useState, type ReactNode } from 'react';

interface WorkspaceSectionProps {
  title: string;
  /** 처음에 펼친 채로 둘지. 기본은 접어 둔다 — 견적표를 먼저 보여준다. */
  defaultOpen?: boolean;
  /** 바깥에서 펼치라고 요청할 때 쓴다(확인 목록 이동 등). */
  forceOpen?: boolean;
  /** 영역을 찾아갈 때 쓰는 표식. */
  sectionId?: string;
  children: ReactNode;
}

export function WorkspaceSection({
  title,
  defaultOpen = false,
  forceOpen = false,
  sectionId,
  children,
}: WorkspaceSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const expanded = open || forceOpen;

  return (
    <section
      className="q-card q-workspace-section"
      {...(sectionId === undefined ? {} : { 'data-section': sectionId })}
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
