# -*- coding: utf-8 -*-
"""원본 견적 xlsx의 '구조'만 추출한다.
설계서 §4.5: 실제 금액/고객 정보는 출력하지 않는다.
- 숫자 중 절대값 >= 100 은 <num> 으로 마스킹 (요율/할증/수량은 보존)
- 수식/병합/인쇄설정/열너비/행높이/스타일 메타데이터는 그대로 출력
"""
import sys, io, re
from openpyxl import load_workbook

sys.stdout.reconfigure(encoding="utf-8")

MASK_TEXT_CELLS = set()  # 필요 시 고객명 셀 추가

def fmt(v):
    if v is None:
        return ""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return "<num>" if abs(v) >= 100 else repr(v)
    s = str(v)
    if s.startswith("="):
        return s
    return s

def dump(path, max_row=None, max_col=None):
    wbf = load_workbook(path, data_only=False)
    print("### SHEETS")
    for ws in wbf.worksheets:
        print(f"- {ws.title!r} state={ws.sheet_state} dims={ws.dimensions} max={ws.max_row}x{ws.max_column}")
    print()
    for ws in wbf.worksheets:
        print(f"\n{'='*70}\n## SHEET {ws.title!r}  state={ws.sheet_state}\n{'='*70}")
        print("print_area:", ws.print_area)
        print("title_rows:", ws.print_title_rows, "title_cols:", ws.print_title_cols)
        ps = ws.page_setup
        print("orientation:", ps.orientation, "paperSize:", ps.paperSize,
              "fitToWidth:", ps.fitToWidth, "fitToHeight:", ps.fitToHeight, "scale:", ps.scale)
        pm = ws.page_margins
        print("margins L/R/T/B/H/F:", pm.left, pm.right, pm.top, pm.bottom, pm.header, pm.footer)
        print("merged:", sorted(str(r) for r in ws.merged_cells.ranges))
        print("col widths:", {k: round(v.width,2) for k,v in ws.column_dimensions.items() if v.width})
        rh = {k: v.height for k,v in ws.row_dimensions.items() if v.height}
        print("row heights:", rh)
        print("hidden rows:", [k for k,v in ws.row_dimensions.items() if v.hidden])
        print("hidden cols:", [k for k,v in ws.column_dimensions.items() if v.hidden])
        print("--- cells ---")
        mr = max_row or ws.max_row
        mc = max_col or ws.max_column
        for row in ws.iter_rows(min_row=1, max_row=mr, max_col=mc):
            parts = []
            for c in row:
                if c.value is None:
                    continue
                parts.append(f"{c.coordinate}={fmt(c.value)}")
            if parts:
                print(" | ".join(parts))

if __name__ == "__main__":
    dump(sys.argv[1], int(sys.argv[2]) if len(sys.argv)>2 else None, int(sys.argv[3]) if len(sys.argv)>3 else None)
