"""PDF 페이지를 PNG 이미지로 뽑는다 (계획 2026-10-04 P2-2).

독립 검토 지적: "사람만 할 수 있음"을 핑계로 시각 대조를 건너뛰지 않는다.
PyMuPDF(이 환경에 이미 설치돼 있다 — poppler/ghostscript 같은 외부
바이너리가 따로 필요 없다)로 각 페이지를 이미지로 렌더링하면, 그 이미지를
직접 열어서 글자 잘림·겹침·머리글 반복·인쇄 배율 같은 것을 사람(또는 이
도구를 부르는 에이전트)이 눈으로 본다.

사용: python tools/render_pdf_pages.py <PDF 경로> [출력 폴더] [DPI]
"""
import sys
from pathlib import Path

import pymupdf


def main() -> int:
    if len(sys.argv) < 2:
        print("사용: python tools/render_pdf_pages.py <PDF 경로> [출력 폴더] [DPI]")
        return 2

    pdf_path = Path(sys.argv[1])
    if not pdf_path.exists():
        print(f"미검증: 파일이 없다: {pdf_path}")
        return 2

    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else pdf_path.parent
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 150
    out_dir.mkdir(parents=True, exist_ok=True)

    doc = pymupdf.open(pdf_path)
    written = []
    for page_index in range(doc.page_count):
        page = doc.load_page(page_index)
        pix = page.get_pixmap(dpi=dpi)
        out_path = out_dir / f"{pdf_path.stem}_p{page_index + 1}.png"
        pix.save(str(out_path))
        written.append(out_path)
    doc.close()

    for path in written:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
