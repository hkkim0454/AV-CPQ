/**
 * 견적 안에서 **자리를 옮기는 메뉴** (계획 §1 기본 배치).
 *
 * 큰 화면에서는 견적표 왼쪽에 붙고, 좁은 화면에서는 가로로 줄바꿈된다.
 * 시스템을 누르면 그 시스템의 표로, 설정 이름을 누르면 그 영역을 펼친 뒤
 * 그리로 간다.
 *
 * ## ⛔ 이 메뉴는 문서를 바꾸지 않는다
 *
 * 표를 **걸러 내지 않는다.** 한 시스템만 남기고 숨기면 화면의 합계와
 * 출력 파일의 합계가 달라 보이고, 사람이 "지금 보는 것이 전부"라고
 * 믿게 된다. 여기서 하는 일은 스크롤과 포커스뿐이다 — 그래서 이 메뉴를
 * 아무리 눌러도 '저장하지 않은 변경'이 생기거나 실행취소 거리가 늘지 않는다.
 */

export type NavTarget =
  | { kind: 'system'; systemId: string }
  | { kind: 'section'; sectionId: string };

interface WorkspaceNavProps {
  systems: readonly { systemId: string; name: string }[];
  /** 표 아래 접기 영역들. `sectionId` 는 `WorkspaceSection` 의 것과 같아야 한다. */
  sections: readonly { sectionId: string; label: string }[];
  onGo(target: NavTarget): void;
}

export function WorkspaceNav({ systems, sections, onGo }: WorkspaceNavProps) {
  return (
    <nav className="q-workspace-nav" aria-label="견적 내 이동">
      <p className="q-nav-group-title">시스템</p>
      <ul className="q-nav-list">
        {systems.map((system) => (
          <li key={system.systemId}>
            <button
              type="button"
              className="q-button q-nav-item"
              onClick={() => onGo({ kind: 'system', systemId: system.systemId })}
            >
              {system.name}
            </button>
          </li>
        ))}
      </ul>

      <p className="q-nav-group-title">설정</p>
      <ul className="q-nav-list">
        {sections.map((section) => (
          <li key={section.sectionId}>
            <button
              type="button"
              className="q-button q-nav-item"
              onClick={() => onGo({ kind: 'section', sectionId: section.sectionId })}
            >
              {section.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
