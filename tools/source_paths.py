# -*- coding: utf-8 -*-
"""원본 자료의 위치. 설계서 §4.5에서 확인한 경로다.

원본은 **읽기 전용**으로만 연다. 저장소·public·빌드 산출물로 복사하지 않는다.
다른 PC에서는 이 경로가 존재하지 않는다 — 그때는 템플릿 재생성을 건너뛰고
이미 커밋된 `templates/sanitized/quote-template.xlsx`를 쓴다.
"""
from pathlib import Path

UPLOADS = Path.home() / ".paseo" / "uploads"

NEGO_QUOTE = (
    UPLOADS
    / "upload_a728fa9d-e438-46b8-a177-33293375409a"
    / "견적서(NEGO)_평택 사무3동 6층 CLEAN IEC 룸 AV시스템 납품설치_260826.xlsx"
)
"""최종 고객용 양식 기준. SHA-256 57ab58c1…c3080922 (대조 완료)."""

PUMSEM_QUOTE = (
    UPLOADS
    / "upload_0b96eb24-d00d-478a-8ff1-a3e32ac8220d"
    / "견적서_6-3라인 6층 교육장 개선_260522_품셈.xlsx"
)
"""구양식 품셈 견적 — 일위대가 구조 참고 (설계서 §4.3)."""

PUMSEM_DB = (
    UPLOADS
    / "upload_08ec1814-0517-42c2-9ae0-6bbcff2cf3c4"
    / "원가삭제_2026상반기_표준품셈_260408.xlsx"
)
"""표준품셈 데이터베이스 — 2026 **상반기**. 현재 배포 자료의 출처 (설계서 §4.4)."""

PUMSEM_DB_2026H2 = (
    UPLOADS
    / "upload_45127f91-51f6-44ba-adca-be61c65fa98e"
    / "AI용_2026하반기_표준품셈_261002.xlsx"
)
"""표준품셈 데이터베이스 — 2026 **하반기**. 교체 대상 (계획 2026-10-05).

사용자가 2026-10-06 확정했다. 같은 업로드 폴더에
`원가삭제 2026하반기_표준품셈_261002.xlsx` 도 있으나 **그쪽은 판매단가(재료비
단가)의 절반 가까이가 0으로 지워져 있어** 쓰지 않는다(영상 시트 기준 값 168건
대 0 153건). 이 파일은 0이 거의 없고 현행 상반기 파일과 같은 모양이다.

⚠ 이 파일의 `TV` 시트 H열에 0이 아닌 원가 금액이 5칸 남아 있다. H열은
추출기가 머리글로 거르는 금지 열이라 읽히지 않는다 —
`tools/test_extract_catalog.py` 가 그 차단을 시험한다."""


def require(path: Path) -> Path:
    if not path.exists():
        raise SystemExit(f"원본 자료가 없다: {path}")
    return path
