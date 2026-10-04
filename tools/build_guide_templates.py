# -*- coding: utf-8 -*-
"""견적서 가이드 원본 4종 → 정리된 템플릿 + 계산 기준 manifest (계획 2026-10-04 Task 2).

## 서식을 코드로 만들지 않는다 (D17)

글꼴·테두리·열너비·행높이·배율·여백·틀고정·병합은 **원본에서 그대로 가져온다.**
손으로 옮기다 노임 3건·틀고정·배율·갑지 테두리·여백을 전부 틀린 적이 있다.
그래서 이 스크립트는 **지우기만** 한다. 서식을 쓰지 않는다.

## openpyxl 왕복 저장 금지

openpyxl 로 열었다 저장하면 Excel 이 "파일 형식 또는 파일 확장명이 잘못되어…"
라고 거부하는 파일이 나온다 (verification.md §1). 여기서는 zipfile 로 파트를
골라 담고, 손대야 하는 XML 만 **경계가 분명한 요소 단위로** 고친다.

ElementTree 재직렬화도 쓰지 않는다. 미등록 네임스페이스 접두사가 `ns0` 로 바뀌면
`mc:Ignorable="x15 xr xr6 xr10 xr2"` 가 **문자열 안에서** 가리키는 접두사가 끊긴다.

## 원본에 실제로 들어 있던 것 (실측)

    docProps/custom.xml   이전 직원 PC 경로 + 삼성SDI 프로젝트 파일명
    workbook.xml          사내 공유폴더 \\\\192.168.1.51\\03_영업팀 자료\\…
    definedNames          #REF! 더미, C:\\msoffice\\CD\\남가내역.mdb, 사용자 지정 보기 잔재
    세부내역 6~12행        예시 품목의 원가·판매가·거래처·설명·품
    갑지 C2·C4·C6         견적번호·견적처·담당자

시트 셀만 지워서는 안 되는 이유다.

## 사용

    AVCPQ_GUIDE_WON=… AVCPQ_GUIDE_PUMSEM=… AVCPQ_GUIDE_DS=… AVCPQ_GUIDE_DS_WON=…
    python tools/build_guide_templates.py

환경변수가 없으면 `tools/source_paths.py` 의 알려진 경로를 쓴다.
**원본 값은 출력하지 않는다.** 구조와 좌표만 찍는다 (설계서 §8.4).
"""
import hashlib
import json
import os
import re
import sys
import zipfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import xml.etree.ElementTree as ET  # 읽기 전용 — 다시 쓰지 않는다

import guide_xml

M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "templates" / "sanitized"

COVER_SHEET = "xl/worksheets/sheet1.xml"
DETAIL_SHEET = "xl/worksheets/sheet2.xml"

# 지울 파트. calcChain 은 옛 계산 순서라 행이 바뀌면 복구 경고가 뜨고,
# printerSettings 는 특정 PC 의 프린터 이름을 담는다.
DROP_PART = re.compile(r"docProps/custom\.xml|xl/calcChain\.xml|xl/printerSettings/")

# 남길 definedName. 나머지는 과거 고객사 참조·외부 DB·사용자 지정 보기 잔재다.
KEEP_DEFINED_NAME = re.compile(r"^_xlnm\.(Print_Area|Print_Titles)$")

# 갑지에서 비울 셀 — 견적번호·견적처·견적명·담당자.
COVER_CLEAR = ("C2", "C3", "C4", "C5", "C6")


def column_index(ref: str) -> int:
    out = 0
    for ch in ref:
        if not ch.isalpha():
            break
        out = out * 26 + (ord(ch.upper()) - 64)
    return out


def column_name(index: int) -> str:
    out = ""
    while index > 0:
        index, rem = divmod(index - 1, 26)
        out = chr(65 + rem) + out
    return out


def col_of(ref: str) -> str:
    return "".join(ch for ch in ref if ch.isalpha())


def row_of(ref: str) -> int:
    return int("".join(ch for ch in ref if ch.isdigit()))


# ---------------------------------------------------------------------------
# 읽기 — 측정은 **지우기 전에** 한다
# ---------------------------------------------------------------------------


class Sheet:
    """셀 한 장. 값·수식을 좌표로 찾는다."""

    def __init__(self, xml: bytes, shared: list):
        root = ET.fromstring(xml)
        self.root = root
        self.text = {}
        self.number = {}
        self.formula = {}
        data = root.find(M + "sheetData")
        if data is None:
            return
        for row in data.findall(M + "row"):
            for cell in row.findall(M + "c"):
                ref = cell.get("r")
                if ref is None:
                    continue
                f = cell.find(M + "f")
                if f is not None and f.text:
                    self.formula[ref] = f.text
                v = cell.find(M + "v")
                if cell.get("t") == "s" and v is not None:
                    self.text[ref] = shared[int(v.text)]
                elif cell.get("t") == "inlineStr":
                    node = cell.find(M + "is")
                    if node is not None:
                        self.text[ref] = "".join(
                            t.text or "" for t in node.iter(M + "t")
                        )
                elif v is not None and v.text is not None:
                    self.number[ref] = v.text

    def label(self, ref: str) -> str:
        return (self.text.get(ref) or "").strip()


def read_shared(zf: zipfile.ZipFile) -> list:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    out = []
    for si in root.findall(M + "si"):
        out.append("".join(t.text or "" for t in si.iter(M + "t")))
    return out


def measure(zf: zipfile.ZipFile, guide_id: str) -> dict:
    shared = read_shared(zf)
    detail = Sheet(zf.read(DETAIL_SHEET), shared)

    # --- 2행 머리글 → 열 역할 ---
    # '단 가'/'금 액' 은 3행에 있고 2행 머리글이 그룹 이름이다. 그룹 머리글의
    # 열부터 다음 그룹 전까지가 그 그룹이다. 중복 머리글을 이름만으로 구분하지 않는다.
    # 역할 대조용으로만 공백을 지운다. **직종 이름은 원문 그대로 쓴다** —
    # '통신관련 기능사'의 공백을 지우면 노임표 키와 안 맞아 노무비가 0이 된다.
    headers = {}
    headers_raw = {}
    for ref, value in detail.text.items():
        if row_of(ref) != 2:
            continue
        raw = value.strip()
        name = re.sub(r"\s+", "", value)
        if name:
            headers[column_index(col_of(ref))] = name
            headers_raw[column_index(col_of(ref))] = raw

    columns = {}
    role_by_header = {
        "번호": "no",
        "품명": "name",
        "규격": "spec",
        "설명": "description",
        "단위": "unit",
        "수량": "quantity",
        "원가": "cost",
        "재료비": "material",
        "노무비": "labor",
        "합계": "total",
        "재료비이윤": "profit",
        "비고": "remark",
        "제조사/구매처": "supplier",
        "영업비고": "salesRemark",
        "품목별요율%": "itemRate",
        "할증": "surcharge",
    }
    grouped = {"cost", "material", "labor"}
    trade_start = None
    standard_col = None

    def has_unit_subheader(index: int) -> bool:
        """3행에 '단 가'가 있는가 — 2열 금액 묶음인지 가른다.

        **'노무비' 머리글이 두 장에 두 번 나온다.** 앞은 단가/금액 묶음이고
        뒤는 품셈 블록의 메모 칸이다. 이름만으로 고르면 뒤엣것이 앞엣것을
        덮어써서 노무비 금액 열이 품셈 블록 한가운데를 가리킨다.
        상위 머리글(2행)과 하위 머리글(3행)을 함께 봐야 구분된다.
        """
        return "단" in detail.label(f"{column_name(index)}3")

    for index in sorted(headers):
        name = headers[index]
        role = role_by_header.get(name)
        if role in grouped and has_unit_subheader(index):
            columns[f"{role}.unit"] = column_name(index)
            columns[f"{role}.amount"] = column_name(index + 1)
        elif role == "labor":
            # 하위 머리글이 없는 '노무비' = 품셈 블록의 메모 칸.
            columns["laborNote"] = column_name(index)
        elif role in grouped:
            raise SystemExit(
                f"{guide_id}: '{name}' 머리글({column_name(index)}2)에 "
                "하위 머리글이 없다. 묶음인지 메모인지 가릴 수 없다."
            )
        elif role is not None:
            columns[role] = column_name(index)
        elif "하반기" in name or "상반기" in name:
            standard_col = index
            columns["standardUnitPrice"] = column_name(index)
            trade_start = index + 1

    # --- 품셈 코드 열 ---
    # 2행에 머리글이 **없다.** 원본 구조상 `노무비(메모) / 품셈코드 / 품목별요율%`
    # 순서라 메모 바로 다음 칸이다. 추론이므로 **확인을 붙인다** —
    # 메모 다음 칸이 요율 칸 바로 앞이 아니면 구조가 달라진 것이고, 그때는
    # 엉뚱한 칸에 품셈 코드를 쓰게 된다.
    if "laborNote" in columns and "itemRate" in columns:
        note_index = column_index(columns["laborNote"])
        rate_index = column_index(columns["itemRate"])
        if rate_index - note_index != 2:
            raise SystemExit(
                f"{guide_id}: 노무비 메모({columns['laborNote']})와 "
                f"품목별 요율({columns['itemRate']}) 사이가 한 칸이 아니다. "
                "품셈 코드 열을 추론할 수 없다."
            )
        columns["pumsemCode"] = column_name(note_index + 1)

    # --- 직종과 노임 (3행) ---
    trades = []
    wages = {}
    if trade_start is not None:
        index = trade_start
        while index in headers:
            trade = headers_raw[index]
            unit_ref = f"{column_name(index)}3"
            amount_ref = f"{column_name(index + 1)}3"
            unit = detail.label(unit_ref)
            amount = detail.number.get(amount_ref)
            if unit == "" or amount is None:
                break
            trades.append(trade)
            wages[trade] = {"amount": amount, "unit": unit}
            index += 2
        columns["tradeFirst"] = column_name(trade_start)
        columns["tradeLast"] = column_name(index - 1)

    # --- 행 역할 ---
    first_item = None
    last_item = None
    derived = []
    direct_subtotal = None
    indirect_first = None
    indirect_last = None
    indirect_subtotal = None
    grand_total = None
    name_col = columns.get("name", "B")
    unit_col = columns.get("unit", "E")
    qty_col = columns.get("quantity", "F")

    def is_item_row(row: int) -> bool:
        """품목 행인가.

        **A열 번호로 세지 않는다.** 원본 9~12행의 번호 칸은 `<f t="shared"/>`
        공유 수식이라 수식 본문이 없다. 본문으로 세면 7~8행만 잡힌다.

        대신 단위·수량이 있는지로 가른다. 그룹 머리글 행('소회의실')에는
        둘 다 없고, 품목 행에는 반드시 있다.
        """
        if detail.label(f"{unit_col}{row}") != "":
            return True
        ref = f"{qty_col}{row}"
        return ref in detail.number or ref in detail.formula

    for row in range(1, 80):
        a = detail.label(f"A{row}")
        b = detail.label(f"{name_col}{row}")
        if b in ("배관 기타자재", "잡자재비"):
            derived.append(row)
            continue
        if a == "직접비계":
            direct_subtotal = row
            continue
        if a == "간접비계":
            indirect_subtotal = row
            continue
        if a.replace(" ", "") == "합계":
            grand_total = row
            continue
        if b == "간접비":
            indirect_first = row + 1
            continue

    limit = direct_subtotal if direct_subtotal is not None else 60
    for row in range(4, limit):
        if row in derived:
            continue
        if not is_item_row(row):
            continue
        if first_item is None:
            first_item = row
        last_item = row
    if indirect_first is not None and indirect_subtotal is not None:
        indirect_last = indirect_subtotal - 1

    # --- 간접비 항목 ---
    total_col = columns.get("total", "K")
    indirect = []
    if indirect_first is not None and indirect_last is not None:
        for row in range(indirect_first, indirect_last + 1):
            name = detail.label(f"{name_col}{row}")
            if name == "":
                continue
            rate_raw = detail.number.get(f"E{row}") or detail.number.get(f"F{row}")
            amount_ref = f"{total_col}{row}"
            # 금액 칸이 수식이면 적용, 상수 0 이면 미적용이다 (설계서 §5.4).
            applied = amount_ref in detail.formula
            entry = {
                "name": name,
                "basisLabel": detail.label(f"C{row}"),
                "rate": normalize_rate(rate_raw),
                "applied": applied,
            }
            condition = ""
            for probe in range(column_index(total_col) + 1, column_index(total_col) + 6):
                candidate = detail.label(f"{column_name(probe)}{row}")
                if candidate:
                    condition = candidate
                    break
            if condition:
                entry["conditionText"] = condition
            indirect.append(entry)

    # --- 인쇄 설정 ---
    cover = Sheet(zf.read(COVER_SHEET), shared)
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    print_area = {}
    print_titles = ""
    for dn in workbook.iter(M + "definedName"):
        name = dn.get("name") or ""
        if name == "_xlnm.Print_Area":
            key = "detail" if dn.get("localSheetId") == "1" else "cover"
            print_area[key] = (dn.text or "").split("!")[-1].replace("$", "")
        elif name == "_xlnm.Print_Titles":
            print_titles = (dn.text or "").split("!")[-1].replace("$", "")

    # --- 갑지 절사 단위 ---
    # 가이드는 `ROUNDDOWN(…,-3)` 천원 절사다. 평택 원본은 만원(-4)이었다.
    # 양식마다 다르므로 **읽는다.** 코드에 박으면 한 양식에서 조용히 틀린다.
    cover_rounding = None
    cover_rounding_label = ""
    for ref, text_value in cover.formula.items():
        if "ROUNDDOWN" not in text_value:
            continue
        match = re.search(r"ROUNDDOWN\(.*?,\s*(-?\d+)\s*\)", text_value)
        if match is None:
            raise SystemExit(f"{guide_id}: 갑지 {ref} 의 ROUNDDOWN 자릿수를 읽지 못했다.")
        cover_rounding = int(match.group(1))
        # 바로 오른쪽 칸에 '천원미만절사' 같은 설명이 있다.
        label_ref = f"{column_name(column_index(col_of(ref)) + 1)}{row_of(ref)}"
        cover_rounding_label = cover.label(label_ref)
        break
    if cover_rounding is None:
        raise SystemExit(f"{guide_id}: 갑지에서 절사 수식을 찾지 못했다.")

    page_setup = detail.root.find(M + "pageSetup")
    scale = int(page_setup.get("scale", "100")) if page_setup is not None else 100
    pane = detail.root.find(M + "sheetViews/" + M + "sheetView/" + M + "pane")
    freeze = pane.get("topLeftCell") if pane is not None else ""

    sheet_names = [s.get("name") for s in workbook.iter(M + "sheet")]

    wage_unit = ""
    if wages:
        units = {w["unit"] for w in wages.values()}
        wage_unit = units.pop() if len(units) == 1 else "/".join(sorted(units))

    return {
        "profile": "ds" if len(indirect) == 9 else "general",
        "hasCost": "cost.unit" in columns,
        "sheets": {"cover": sheet_names[0], "detail": sheet_names[1]},
        "printArea": print_area,
        "detailScale": scale,
        "coverRoundingDigits": cover_rounding,
        "coverRoundingLabel": cover_rounding_label,
        "freezePane": freeze or "",
        "printTitles": print_titles,
        "columns": columns,
        "rows": {
            "firstItem": first_item,
            "lastItem": last_item,
            "derived": sorted(derived),
            "directSubtotal": direct_subtotal,
            "indirectFirst": indirect_first,
            "indirectLast": indirect_last,
            "indirectSubtotal": indirect_subtotal,
            "grandTotal": grand_total,
        },
        "trades": trades,
        "wage": {
            "periodLabel": headers_raw.get(standard_col, "") if standard_col else "",
            "unit": wage_unit,
            "wages": wages,
            "contentHash": wage_hash(wages),
        },
        "indirect": indirect,
        "_coverSheet": cover,
        "_detailSheet": detail,
    }


def normalize_rate(raw):
    """`4.8599999999999997E-2` → `0.0486`. 부동소수 찌꺼기를 떼되 값은 바꾸지 않는다."""
    if raw is None:
        return None
    from decimal import Decimal

    value = Decimal(raw)
    # 원본은 Excel 의 배정밀도 표기다. 유효숫자 12자리면 요율의 실제 자리수를 덮는다.
    rounded = value.quantize(Decimal("1E-12")).normalize()
    return format(rounded, "f")


def wage_hash(wages: dict) -> str:
    """기간이 아니라 **내용**으로 노임표를 식별한다. 파일이 달라도 내용이 같으면 같다."""
    payload = json.dumps(
        {k: [v["amount"], v["unit"]] for k, v in sorted(wages.items())},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# 정리 — 경계가 분명한 요소만 손댄다
# ---------------------------------------------------------------------------

# 자기닫기 꼴을 **먼저** 둔다. `<c r="A7" s="5"/>` 가 여닫이 분기에 먼저 걸리면
# `[^>]*>` 가 `/>` 의 `>` 까지 먹고 `.*?</c>` 가 다음 셀까지 삼켜 버린다.
# 행도 같다 — 자기닫기 행 하나 때문에 그 뒤 행들이 통째로 사라진다.
CELL_RE = re.compile(
    rb"<c [^>]*/>|<c [^>]*>.*?</c>",
    re.S,
)
CELL_REF_RE = re.compile(rb'r="([A-Z]+\d+)"')
FORMULA_RE = re.compile(rb"<f[ >][^>]*/>|<f[ >].*?</f>|<f/>", re.S)
STYLE_RE = re.compile(rb's="(\d+)"')


def clear_values_in_rows(sheet_xml: bytes, rows) -> bytes:
    """지정한 행에서 **값만** 지운다. 수식과 스타일은 남긴다.

    ## 행을 통째로 비우면 안 되는 이유

    원본 9~12행의 수식은 `<f t="shared" si="3"/>` 공유 수식이고, 원본은
    6~8행 어딘가에 있다. 행을 비워 원본을 지우면 **같은 si 를 쓰는 13·14·15행
    수식까지 끊긴다.** Excel 은 그 파일을 복구 대상으로 본다.

    그래서 `<f>` 는 남기고 `<v>`·`<is>` 와 타입 속성만 뗀다. 예시 품목의 품명·
    규격·설명·원가·판매가·품은 전부 값이므로 이걸로 사라진다. 남는 것은
    "이 칸은 이렇게 계산한다"는 **구조**뿐이다.
    """
    targets = set(rows)

    def replace(match: "re.Match") -> bytes:
        block = match.group(0)
        ref_match = CELL_REF_RE.search(block)
        if ref_match is None:
            return block
        ref = ref_match.group(1)
        if row_of(ref.decode("ascii")) not in targets:
            return block
        style = STYLE_RE.search(block)
        attrs = b' s="' + style.group(1) + b'"' if style else b""
        formula = FORMULA_RE.search(block)
        if formula is None:
            # 값만 있던 칸 — 스타일만 남긴 빈 칸이 된다.
            return b'<c r="' + ref + b'"' + attrs + b"/>"
        # 수식은 남기고 캐시된 결과만 버린다. Excel 이 열면서 다시 계산한다.
        return b'<c r="' + ref + b'"' + attrs + b">" + formula.group(0) + b"</c>"

    return CELL_RE.sub(replace, sheet_xml)


def clear_cells(sheet_xml: bytes, refs) -> bytes:
    """지정한 셀의 값만 비운다. 스타일(`s=`)은 남겨 서식을 지킨다."""
    targets = {r.encode("ascii") for r in refs}

    def replace(match: "re.Match") -> bytes:
        block = match.group(0)
        ref_match = CELL_REF_RE.search(block)
        if ref_match is None or ref_match.group(1) not in targets:
            return block
        style = STYLE_RE.search(block)
        attrs = b' s="' + style.group(1) + b'"' if style else b""
        return b'<c r="' + ref_match.group(1) + b'"' + attrs + b"/>"

    return CELL_RE.sub(replace, sheet_xml)


def clean_workbook(xml: bytes) -> bytes:
    """사내 경로와 쓸모없는 definedName 을 걷어낸다.

    `mc:AlternateContent` 안의 `x15ac:absPath` 가 사내 공유폴더 경로를 담는다.
    `definedNames` 에는 과거 고객사 통합문서 참조와 외부 DB 경로가 있다.
    인쇄 영역·반복 머리글만 남긴다.
    """
    xml = re.sub(rb"<mc:AlternateContent\b.*?</mc:AlternateContent>", b"", xml, flags=re.S)

    def rebuild(match: "re.Match") -> bytes:
        block = match.group(0)
        kept = []
        for entry in re.finditer(rb"<definedName\b[^>]*>.*?</definedName>", block, re.S):
            name = re.search(rb'\bname="([^"]*)"', entry.group(0))
            if name is None:
                continue
            if KEEP_DEFINED_NAME.match(name.group(1).decode("utf-8")):
                kept.append(entry.group(0))
        if not kept:
            return b""
        return b"<definedNames>" + b"".join(kept) + b"</definedNames>"

    xml = re.sub(rb"<definedNames>.*?</definedNames>", rebuild, xml, flags=re.S)
    return xml


def clean_sheet_rels(xml: bytes) -> bytes:
    return re.sub(rb"<Relationship\b[^>]*printerSettings[^>]*/>", b"", xml)


def drop_printer_reference(xml: bytes) -> bytes:
    """`<pageSetup r:id="rId3"/>` 의 관계가 끊기면 Excel 이 복구 경고를 띄운다."""
    return re.sub(rb'(<pageSetup\b[^>]*?)\s+r:id="[^"]*"', rb"\1", xml)


def clean_content_types(xml: bytes) -> bytes:
    xml = re.sub(rb'<Override\b[^>]*docProps/custom\.xml[^>]*/>', b"", xml)
    xml = re.sub(rb'<Override\b[^>]*calcChain\.xml[^>]*/>', b"", xml)
    xml = re.sub(rb'<Default\b[^>]*Extension="bin"[^>]*/>', b"", xml)
    return xml


def clean_root_rels(xml: bytes) -> bytes:
    return re.sub(rb"<Relationship\b[^>]*custom-properties[^>]*/>", b"", xml)


CORE_XML = (
    b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    b'<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
    b' xmlns:dc="http://purl.org/dc/elements/1.1/"'
    b' xmlns:dcterms="http://purl.org/dc/terms/"'
    b' xmlns:dcmitype="http://purl.org/dcmitype/"'
    b' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    b"<dc:creator>AV-CPQ</dc:creator>"
    b"<cp:lastModifiedBy>AV-CPQ</cp:lastModifiedBy>"
    b"</cp:coreProperties>"
)


def posix_join(base: str, target: str) -> str:
    """rels 의 상대 Target 을 ZIP 안의 절대 파트 이름으로 바꾼다.

    `base` 가 빈 문자열이면(루트 `_rels/.rels`) `"".split("/")` 가 `['']` 를
    돌려주어 결과에 **앞 슬래시가 붙는다.** 그러면 `/xl/workbook.xml` 이 되어
    파트 목록과 안 맞고, 멀쩡한 관계가 '끊긴 것'으로 판정돼 루트 rels 가
    통째로 비워진다. Excel 은 그 파일을 '형식이 잘못되었습니다' 로 거부한다.
    """
    if target.startswith("/"):
        return target.lstrip("/")
    parts = [piece for piece in base.split("/") if piece]
    for piece in target.split("/"):
        if piece == "..":
            if parts:
                parts.pop()
        elif piece not in ("", "."):
            parts.append(piece)
    return "/".join(parts)


def drop_dangling_relationships(parts: dict) -> dict:
    """사라진 파트를 가리키는 관계와, 그 관계를 쓰던 시트 요소를 함께 걷어낸다.

    파트만 지우고 관계를 두면 **Excel 이 복구 경고를 띄운다.** 반대로 관계만
    지우고 `<drawing r:id="rId3"/>` 를 두면 회사 직인이 사라진다. 전에 둘 다
    겪었다 (verification.md D3·D5). 그래서 한 번에 처리한다.

    개별 이름을 열거하지 않고 **실제로 남아 있는 파트와 대조**한다 —
    목록으로 막으면 새로 지우는 파트가 생길 때마다 빠진다.
    """
    for rel_name in [n for n in parts if n.endswith(".rels")]:
        # `A/B/_rels/C.rels` 는 파트 `A/B/C` 를 설명하고, 상대 Target 은 `A/B` 기준이다.
        # 루트 `_rels/.rels` 는 패키지 자체를 설명하므로 기준이 빈 문자열이다.
        owner = rel_name.replace("_rels/", "")[: -len(".rels")]
        base = owner.rsplit("/", 1)[0] if "/" in owner else ""
        dropped = []

        def keep(match: "re.Match") -> bytes:
            block = match.group(0)
            if b'TargetMode="External"' in block:
                return block
            target = re.search(rb'[ ]Target="([^"]*)"', block)
            if target is None:
                return block
            resolved = posix_join(base, target.group(1).decode("utf-8"))
            if resolved in parts:
                return block
            rid = re.search(rb'[ ]Id="([^"]*)"', block)
            if rid is not None:
                dropped.append(rid.group(1))
            return b""

        parts[rel_name] = re.sub(rb"<Relationship [^>]*/>", keep, parts[rel_name])

        if not dropped:
            continue
        # 이 rels 를 쓰던 시트에서 그 rId 를 참조하는 요소를 지운다.
        if owner not in parts:
            continue
        xml = parts[owner]
        for rid in dropped:
            # **요소를 지우지 않고 속성만 뗀다.**
            # `<pageSetup paperSize="9" scale="70" orientation="landscape" r:id="rId2"/>`
            # 를 통째로 지우면 배율·용지·방향이 함께 사라진다. 실제로 58/70 배율이
            # 날아갔다. 끊긴 것은 프린터 설정 참조뿐이므로 그 속성만 뗀다.
            xml = re.sub(rb'[ ]r:id="' + re.escape(rid) + rb'"', b"", xml)
        leftover = re.search(rb'r:id="(' + b"|".join(re.escape(r) for r in dropped) + rb')"', xml)
        if leftover is not None:
            raise SystemExit(
                f"{owner}: 지운 관계 {leftover.group(1).decode()} 를 아직 참조한다. "
                "요소를 지우면 서식이 함께 사라지므로 자동 처리하지 않는다."
            )
        parts[owner] = xml
    return parts


def rebuild_shared_strings(parts: dict) -> dict:
    """쓰이지 않는 공유 문자열을 버리고 색인을 다시 매긴다.

    셀만 지우면 **문자열은 sharedStrings 에 그대로 남는다.** 거래처명·고객명이
    인쇄 영역 밖도 아니고 파일 안에 통째로 남는 것이다. 평택 원본 감사에서
    인쇄 영역 밖 58칸의 내부 메모가 나온 것과 같은 자리다.
    """
    if "xl/sharedStrings.xml" not in parts:
        return parts
    root = ET.fromstring(parts["xl/sharedStrings.xml"])
    entries = list(root.findall(M + "si"))

    used = set()
    sheet_names = [n for n in parts if re.match(r"xl/worksheets/sheet\d+\.xml$", n)]
    pattern = re.compile(rb'<c\b[^>]*\bt="s"[^>]*>\s*<v>(\d+)</v>')
    for name in sheet_names:
        for match in pattern.finditer(parts[name]):
            used.add(int(match.group(1)))

    order = sorted(used)
    remap = {old: new for new, old in enumerate(order)}

    for name in sheet_names:
        def replace(match: "re.Match") -> bytes:
            old = int(match.group(1))
            return match.group(0).replace(
                b"<v>%d</v>" % old, b"<v>%d</v>" % remap[old]
            )

        parts[name] = pattern.sub(replace, parts[name])

    kept = b"".join(ET.tostring(entries[i], encoding="utf-8") for i in order)
    kept = kept.replace(b'xmlns:ns0="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', b"")
    kept = kept.replace(b"ns0:", b"")
    parts["xl/sharedStrings.xml"] = (
        b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        b'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        b' count="%d" uniqueCount="%d">' % (len(order), len(order))
        + kept
        + b"</sst>"
    )
    return parts


def sanitize(zf: zipfile.ZipFile, spec: dict) -> dict:
    parts = {}
    for name in zf.namelist():
        if DROP_PART.search(name):
            continue
        parts[name] = zf.read(name)

    parts["docProps/core.xml"] = CORE_XML
    parts["xl/workbook.xml"] = clean_workbook(parts["xl/workbook.xml"])
    parts["[Content_Types].xml"] = clean_content_types(parts["[Content_Types].xml"])
    parts["_rels/.rels"] = clean_root_rels(parts["_rels/.rels"])

    for name in list(parts):
        if re.match(r"xl/worksheets/_rels/sheet\d+\.xml\.rels$", name):
            parts[name] = clean_sheet_rels(parts[name])
        if re.match(r"xl/worksheets/sheet\d+\.xml$", name):
            parts[name] = drop_printer_reference(parts[name])

    rows = spec["rows"]
    item_rows = range(rows["firstItem"], rows["lastItem"] + 1)
    detail = parts[DETAIL_SHEET]

    # 1) 지울 행에 원본이 있는 공유 수식을 **밖의 추종자에 먼저 펼친다.**
    #    안 펼치고 지우면 13·14행 수식이 가리킬 곳을 잃고 Excel 이 복구를 요구한다.
    detail = guide_xml.expand_shared_across(detail, item_rows)

    # 2) 예시 품목 행을 값·수식까지 전부 비운다.
    #    수식에 민감한 값이 박혀 있다 — `I6=G6*1.2`(배율), `W6=0.7+0.59`(예시 품).
    detail = guide_xml.clear_rows_completely(detail, item_rows)

    # 3) 시스템 이름 예시('소회의실')도 사용자 데이터다.
    detail = guide_xml.clear_cells(
        detail, [f"{spec['columns'].get('name', 'B')}{rows['firstItem'] - 1}"]
    )

    # 4) 수식 칸의 캐시를 버린다. 예시 금액(배관기타자재 4,800, 직접비계, 간접비)이
    #    마지막 계산 결과로 남아 있다.
    detail = guide_xml.strip_cached_values(detail)
    parts[DETAIL_SHEET] = detail

    parts[COVER_SHEET] = guide_xml.strip_cached_values(
        guide_xml.clear_cells(parts[COVER_SHEET], COVER_CLEAR)
    )
    # 사용자 지정 보기 잔재를 들어낸다 — 인쇄 설정이 둘이 되어 배율을 잘못 읽는다.
    for name in (COVER_SHEET, DETAIL_SHEET):
        parts[name] = guide_xml.drop_custom_sheet_views(parts[name])
    parts["xl/workbook.xml"] = guide_xml.force_full_calc(parts["xl/workbook.xml"])

    parts = drop_dangling_relationships(parts)
    return rebuild_shared_strings(parts)


# ---------------------------------------------------------------------------

GUIDES = {
    "won": ("AVCPQ_GUIDE_WON", "SDC,SDI_견적서가이드_260901_원.xlsx"),
    "pumsem": ("AVCPQ_GUIDE_PUMSEM", "SDC,SDI_견적서가이드_260901_품셈.xlsx"),
    "ds": ("AVCPQ_GUIDE_DS", "DS_견적서가이드_260901_품셈.xlsx"),
    "ds-won": ("AVCPQ_GUIDE_DS_WON", "DS_견적서가이드_품셈_260901_원.xlsx"),
}


def resolve_source(guide_id: str) -> Path:
    env_name, file_name = GUIDES[guide_id]
    from_env = os.environ.get(env_name)
    if from_env:
        path = Path(from_env)
        if not path.exists():
            raise SystemExit(f"{env_name} 가 가리키는 파일이 없다: {path}")
        return path
    uploads = Path.home() / ".paseo" / "uploads"
    matches = sorted(uploads.glob(f"upload_*/{file_name}"))
    if not matches:
        raise SystemExit(
            f"가이드 원본을 찾지 못했다: {file_name}\n"
            f"  {env_name} 로 경로를 지정하거나 원본을 받아 둔다."
        )
    return matches[-1]


def build() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schemaVersion": 1,
        "note": "원본에서 측정한 구조와 계산 기준. 민감 값은 담지 않는다.",
        "guides": {},
    }

    for guide_id in GUIDES:
        source = resolve_source(guide_id)
        raw = source.read_bytes()
        source_sha = hashlib.sha256(raw).hexdigest()

        with zipfile.ZipFile(source) as zf:
            spec = measure(zf, guide_id)
            parts = sanitize(zf, spec)

        out_path = OUT_DIR / f"guide-{guide_id}.xlsx"
        # [Content_Types].xml 이 **먼저** 와야 한다 (OPC 규격).
        ordered = ["[Content_Types].xml"] + [
            n for n in parts if n != "[Content_Types].xml"
        ]
        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as out:
            for name in ordered:
                out.writestr(name, parts[name])

        template_sha = hashlib.sha256(out_path.read_bytes()).hexdigest()
        entry = {k: v for k, v in spec.items() if not k.startswith("_")}
        entry["sourceSha256"] = source_sha
        entry["templateSha256"] = template_sha
        manifest["guides"][guide_id] = entry

        rows = entry["rows"]
        print(
            f"{guide_id:>7}  {entry['profile']:>7}  원가={entry['hasCost']}  "
            f"품목 {rows['firstItem']}~{rows['lastItem']}  파생 {rows['derived']}  "
            f"간접비 {len(entry['indirect'])}항목  합계 {rows['grandTotal']}행  "
            f"직종 {len(entry['trades'])}  배율 {entry['detailScale']}"
        )

    (OUT_DIR / "guide-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"\nmanifest: {OUT_DIR / 'guide-manifest.json'}")


if __name__ == "__main__":
    build()
