// 진입점 자리표시자. 화면은 단계 3에서 만든다 (docs/stage-status.md).
// 지금은 빌드 파이프라인(배포 데이터 복사)을 검증하기 위한 최소 진입점이다.
const root = document.getElementById("root");
if (root !== null) {
  root.textContent = "AV 견적 — 화면은 단계 3에서 만든다.";
}
export {};
