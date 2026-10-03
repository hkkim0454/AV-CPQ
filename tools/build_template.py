# -*- coding: utf-8 -*-
"""원본 견적서에서 '정리된 빈 템플릿'을 만든다 (설계서 §9.1).

원본은 읽기 전용으로만 연다. 남기는 것은 서식(styles.xml 인덱스), 열너비, 행높이,
병합, 인쇄 설정, 그리고 양식 고정 문구뿐이다.
고객명·금액·모델명·수량·외부링크·비고는 전부 제거한다.
"""
import sys, re, shutil
from pathlib import Path
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

sys.stdout.reconfigure(encoding="utf-8")

SRC = sys.argv[1]
OUT = Path(sys.argv[2])

SYSTEM_SHEET_SRC = "LED Display "      # 모델로 쓸 시스템 시트
SYSTEM_SHEET_NAME = "__system__"       # 템플릿에서의 이름

# 갑지에서 남길 고정 문구 (좌표 -> 값). 그 외 갑지 셀 값은 전부 제거.
GABJI_KEEP = {
    "B1": "견   적   서",
    "B2": "No.", "B3": "견적일 : ", "B4": "견적처 : ",
    "B5": "견적명 : ", "B6": "담당자 : ",
    "B7": "아래와 같이 견적합니다.",
    "B8": "금  액 : ",
    "B9": "순위", "C9": "품     명", "D9": "  규     격",
    "E9": "단위", "F9": "수량", "G9": "금 액", "H9": "합 계", "I9": "비 고",
    "B16": "합     계", "I16": "만원미만절사",
    "B17": "NEGO",
    "B18": "최     종     합     계",
    "B19": "비 고",
}

# 시스템 시트에서 남길 고정 문구
SYS_KEEP_ROWS_1_4 = {
    "A2": "번호", "B2": "품   명", "C2": "규   격", "D2": "단위", "E2": "수량",
    "F2": "재료비", "H2": "노무비", "J2": "합  계", "K2": "비 고",
    "F3": "단 가", "G3": "금 액", "H3": "단 가", "I3": "금 액",
    "A4": "Ⅰ", "B4": "직접비",
}
# 원본 LED 시트 기준: 23=직접비계, 24=Ⅱ/간접비, 25~33=간접비 9행, 34=간접비계, 35=합계
DIRECT_TOTAL_ROW = 23
INDIRECT_HEAD_ROW = 24
INDIRECT_FIRST = 25
INDIRECT_LAST = 33
INDIRECT_TOTAL_ROW = 34
GRAND_TOTAL_ROW = 35
MODEL_ITEM_ROW = 7
MODEL_GROUP_ROW = 5       # [ 시스템명 ]
MODEL_SUBGROUP_ROW = 6    # 소그룹 헤더

INDIRECT_LABELS = [
    ("간접노무비", "노무비 대비", 0.0486),
    ("고용보험료", "노무비 대비", 0.00424),
    ("산재보험료", "노무비 대비", 0.00961),
    ("연금보험료", "노무비 대비", 0.01215),
    ("건강보험료", "노무비 대비", 0.00957),
    ("노인장기요양보험료", "노무비 대비", 0.00124),
    ("산업안전보건관리비", "직접비 대비", 0.0311),
    ("퇴직공제부금비", "노무비 대비", 0.00621),
    ("공과잡비", "직접비+간접노무비+산업안전관리비", 0.1),
]


def clear_sheet(ws, keep):
    for row in ws.iter_rows():
        for c in row:
            if c.value is None:
                continue
            if c.coordinate in keep:
                c.value = keep[c.coordinate]
            else:
                c.value = None


def main():
    wb = load_workbook(SRC)

    # 1) 모델로 쓸 시스템 시트 외 나머지 시스템 시트 제거
    for name in list(wb.sheetnames):
        if name not in ("갑지", SYSTEM_SHEET_SRC):
            del wb[name]

    gabji = wb["갑지"]
    sysws = wb[SYSTEM_SHEET_SRC]

    # 2) 갑지 정리
    clear_sheet(gabji, GABJI_KEEP)
    # 외부 참조가 있던 인쇄 범위 밖 열은 값·서식 모두 제거
    for col in ("L", "M", "N"):
        for r in range(1, gabji.max_row + 1):
            gabji[f"{col}{r}"].value = None
        if col in gabji.column_dimensions:
            del gabji.column_dimensions[col]

    # 3) 시스템 시트 정리
    keep = dict(SYS_KEEP_ROWS_1_4)
    keep["A1"] = '="▣ 공사명 : "&갑지!C5'
    keep[f"A{DIRECT_TOTAL_ROW}"] = "직접비계"
    keep[f"A{INDIRECT_HEAD_ROW}"] = "Ⅱ"
    keep[f"B{INDIRECT_HEAD_ROW}"] = "간접비"
    keep[f"A{INDIRECT_TOTAL_ROW}"] = "간접비계"
    keep[f"A{GRAND_TOTAL_ROW}"] = "합      계"
    for i, (name, basis, rate) in enumerate(INDIRECT_LABELS):
        r = INDIRECT_FIRST + i
        keep[f"A{r}"] = 1 if i == 0 else f"=A{r-1}+1"
        keep[f"B{r}"] = name
        keep[f"C{r}"] = basis
        keep[f"D{r}"] = "식"
        keep[f"E{r}"] = rate
    clear_sheet(sysws, keep)
    # 인쇄 범위(A:K) 밖 품셈 계산 열 제거
    for r in range(1, sysws.max_row + 1):
        for ci in range(12, sysws.max_column + 1):
            sysws.cell(row=r, column=ci).value = None
    for ci in range(12, sysws.max_column + 1):
        L = get_column_letter(ci)
        if L in sysws.column_dimensions:
            del sysws.column_dimensions[L]

    sysws.title = SYSTEM_SHEET_NAME

    # 4) 통합문서 메타데이터 제거
    p = wb.properties
    p.creator = "AV-CPQ"; p.lastModifiedBy = "AV-CPQ"; p.title = None
    p.subject = None; p.description = None; p.keywords = None
    p.category = None; p.company = None; p.manager = None
    wb.calculation.fullCalcOnLoad = True

    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)
    print(f"saved: {OUT}")
    print("sheets:", wb.sheetnames)
    print(f"model rows -> item={MODEL_ITEM_ROW} group={MODEL_GROUP_ROW} subgroup={MODEL_SUBGROUP_ROW} "
          f"directTotal={DIRECT_TOTAL_ROW} indirect={INDIRECT_FIRST}..{INDIRECT_LAST} "
          f"indirectTotal={INDIRECT_TOTAL_ROW} grandTotal={GRAND_TOTAL_ROW}")


main()
