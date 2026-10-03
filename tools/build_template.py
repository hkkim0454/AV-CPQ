# -*- coding: utf-8 -*-
"""원본 견적서에서 '정리된 빈 템플릿'을 만든다 (설계서 §9.1, §9.2).

**ZIP 수준 수술**이다. openpyxl 같은 일반 라이브러리로 왕복 저장하지 않는다.
이유는 실측이다 — openpyxl로 왕복 저장한 파일을 Microsoft 365 Excel 16.0이
"파일 형식 또는 파일 확장명이 잘못되었습니다"로 거부했다 (2026-10-03).
설계서 §9.2가 "일반 라이브러리의 왕복 저장이 기준을 통과하지 못하면 제한된 템플릿
패치 방식을 사용한다"고 한 경우에 해당한다.

`xl/styles.xml`·`xl/theme/*`·`xl/drawings/*`·`xl/media/*`는 **바이트 그대로** 옮긴다.
다시 쓰는 파트는 다음뿐이다.
  - `[Content_Types].xml`         제거한 파트의 Override 삭제
  - `_rels/.rels`                 docProps/custom 참조 삭제
  - `xl/workbook.xml`             최소 형태로 새로 작성
  - `xl/_rels/workbook.xml.rels`  최소 형태로 새로 작성
  - `docProps/app.xml`            시트 제목 목록에 원본 시트명이 남아 있다
  - `docProps/core.xml`           작성자·인쇄 이력
  - 남기는 워크시트 2장           셀 값을 비우고 서식(s=)만 남긴다

제거하는 파트 (설계서 §9.6): externalLinks, calcChain, customXml,
docProps/custom, sharedStrings, 쓰지 않는 시트 4장, printerSettings.

## ElementTree 함정 (실측으로 확인)

`xml.etree.ElementTree`는 등록하지 않은 네임스페이스 접두사를 `ns0`, `ns1` …로
바꿔 쓴다. 원본 워크시트는 `mc:Ignorable="x14ac xr xr2 xr3"`처럼 **속성 값 안에서
접두사를 문자열로 참조**하므로, 접두사가 바뀌면 그 참조가 끊겨 Excel이 파일을
열지 못한다. (이것이 첫 생성물이 거부된 실제 원인이었다.)

해결: 재작성하는 파트에서 **개정·호환성 네임스페이스를 아예 제거**한다.
`mc`/`x14ac`/`xr*`는 Excel의 공동 편집 개정 추적용이고 서식·수식과 무관하다.
남기는 네임스페이스는 spreadsheetml 본체와 관계(`r:`)뿐이다.

사용:  python tools/build_template.py <출력.xlsx>
"""
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from source_paths import NEGO_QUOTE, require  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")

M = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
PKG_R = "http://schemas.openxmlformats.org/package/2006/relationships"
DOC_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
XML_NS = "http://www.w3.org/XML/1998/namespace"
EP = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
VT = "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"
CP = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
DC = "http://purl.org/dc/elements/1.1/"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
CORE_REL = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties"

DECL = b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

#: 재작성하는 파트에서 남기는 네임스페이스. 나머지는 전부 제거한다.
ALLOWED_NS = {M, DOC_R, XML_NS}

COVER_SHEET = "갑지"
MODEL_SHEET_SRC = "LED Display "
MODEL_SHEET_NAME = "__system__"

COVER_LAST_ROW = 21
COVER_LAST_COL = 10   # J
SYSTEM_LAST_ROW = 35
SYSTEM_LAST_COL = 11  # K

# 모델 행 — src/export/ooxml/anchors.ts의 SYSTEM_ANCHOR와 같은 값이어야 한다.
INDIRECT_FIRST_ROW = 25
DIRECT_TOTAL_ROW = 23
INDIRECT_HEADER_ROW = 24
INDIRECT_TOTAL_ROW = 34
GRAND_TOTAL_ROW = 35

COVER_KEEP = {
    "B1": "견   적   서",
    "B2": "No.", "B3": "견적일 : ", "B4": "견적처 : ",
    "B5": "견적명 : ", "B6": "담당자 : ",
    "B7": "아래와 같이 견적합니다.", "B8": "금  액 : ",
    "B9": "순위", "C9": "품     명", "D9": "  규     격",
    "E9": "단위", "F9": "수량", "G9": "금 액", "H9": "합 계", "I9": "비 고",
    "B16": "합     계", "I16": "만원미만절사",
    "B17": "NEGO", "B18": "최     종     합     계", "B19": "비 고",
}

INDIRECT_LABELS = [
    ("간접노무비", "노무비 대비", "0.0486"),
    ("고용보험료", "노무비 대비", "0.00424"),
    ("산재보험료", "노무비 대비", "0.00961"),
    ("연금보험료", "노무비 대비", "0.01215"),
    ("건강보험료", "노무비 대비", "0.00957"),
    ("노인장기요양보험료", "노무비 대비", "0.00124"),
    ("산업안전보건관리비", "직접비 대비", "0.0311"),
    ("퇴직공제부금비", "노무비 대비", "0.00621"),
    ("공과잡비", "직접비+간접노무비+산업안전관리비", "0.1"),
]


def system_keep():
    text = {
        "A2": "번호", "B2": "품   명", "C2": "규   격", "D2": "단위", "E2": "수량",
        "F2": "재료비", "H2": "노무비", "J2": "합  계", "K2": "비 고",
        "F3": "단 가", "G3": "금 액", "H3": "단 가", "I3": "금 액",
        "A4": "Ⅰ", "B4": "직접비",
        f"A{DIRECT_TOTAL_ROW}": "직접비계",
        f"A{INDIRECT_HEADER_ROW}": "Ⅱ",
        f"B{INDIRECT_HEADER_ROW}": "간접비",
        f"A{INDIRECT_TOTAL_ROW}": "간접비계",
        f"A{GRAND_TOTAL_ROW}": "합      계",
    }
    numbers = {}
    for index, (name, basis, rate) in enumerate(INDIRECT_LABELS):
        row = INDIRECT_FIRST_ROW + index
        text[f"B{row}"] = name
        text[f"C{row}"] = basis
        text[f"D{row}"] = "식"
        numbers[f"E{row}"] = rate
        numbers[f"A{row}"] = str(index + 1)
    return text, numbers


def tag(name, ns=M):
    return f"{{{ns}}}{name}"


def serialize(root):
    ET.register_namespace("", M)
    ET.register_namespace("r", DOC_R)
    return DECL + ET.tostring(root, encoding="UTF-8", xml_declaration=False)


def strip_foreign_namespaces(element):
    """개정·호환성 네임스페이스의 요소와 속성을 제거한다.

    `mc:Ignorable`, `x14ac:dyDescent`, `xr:uid` 같은 것들이다. 서식·수식과 무관하고,
    ElementTree가 접두사를 바꿔 쓰면 파일이 깨지는 원인이 된다.
    """
    for key in list(element.attrib):
        if key.startswith("{"):
            uri = key[1:].split("}", 1)[0]
            if uri not in ALLOWED_NS:
                del element.attrib[key]
    for child in list(element):
        if child.tag.startswith("{"):
            uri = child.tag[1:].split("}", 1)[0]
            if uri not in ALLOWED_NS:
                element.remove(child)
                continue
        strip_foreign_namespaces(child)


def read_rels(blob):
    root = ET.fromstring(blob)
    return {r.get("Id"): (r.get("Type"), r.get("Target")) for r in root}


def filter_sheet_rels(blob):
    """워크시트 관계에서 printerSettings를 뺀다. 도면(회사 직인)은 남긴다."""
    ET.register_namespace("", PKG_R)
    root = ET.fromstring(blob)
    for rel in list(root):
        if (rel.get("Type") or "").endswith("/printerSettings"):
            root.remove(rel)
    if len(root) == 0:
        return None
    return DECL + ET.tostring(root, encoding="UTF-8", xml_declaration=False)


def clean_worksheet(blob, keep_text, keep_number, last_row, last_col_index):
    """셀 값을 지우고 서식만 남긴다."""
    root = ET.fromstring(blob)
    strip_foreign_namespaces(root)

    for name in ("conditionalFormatting", "dataValidations", "legacyDrawing",
                 "extLst", "ignoredErrors"):
        for el in root.findall(tag(name)):
            root.remove(el)

    # 프린터 설정 파트를 버리므로 pageSetup의 r:id도 지운다.
    # 끊긴 관계가 남으면 Excel이 파일을 열지 못한다.
    page_setup = root.find(tag("pageSetup"))
    if page_setup is not None:
        page_setup.attrib.pop(tag("id", DOC_R), None)

    last_col = chr(ord("A") + last_col_index - 1)
    dim = root.find(tag("dimension"))
    if dim is not None:
        dim.set("ref", f"A1:{last_col}{last_row}")

    cols = root.find(tag("cols"))
    if cols is not None:
        for col in list(cols):
            if int(col.get("min", "1")) > last_col_index:
                cols.remove(col)
            else:
                col.set("max", str(min(int(col.get("max", "1")), last_col_index)))
        if len(cols) == 0:
            root.remove(cols)

    sheet_data = root.find(tag("sheetData"))
    for row in list(sheet_data):
        row_number = int(row.get("r", "0"))
        if row_number < 1 or row_number > last_row:
            sheet_data.remove(row)
            continue
        row.set("spans", f"1:{last_col_index}")
        for cell in list(row):
            ref = cell.get("r", "")
            column = re.sub(r"\d", "", ref)
            if len(column) != 1 or (ord(column) - ord("A") + 1) > last_col_index:
                row.remove(cell)
                continue
            for child in list(cell):
                cell.remove(child)
            for attr in ("t", "cm", "vm", "ph"):
                cell.attrib.pop(attr, None)

            if ref in keep_text:
                cell.set("t", "inlineStr")
                is_el = ET.SubElement(cell, tag("is"))
                t_el = ET.SubElement(is_el, tag("t"))
                t_el.set(tag("space", XML_NS), "preserve")
                t_el.text = keep_text[ref]
            elif ref in keep_number:
                ET.SubElement(cell, tag("v")).text = keep_number[ref]

    return serialize(root)


def build_workbook_xml():
    """최소 workbook.xml을 새로 쓴다.

    원본의 `mc`/`x15`/`xr*` 네임스페이스와 `extLst`를 들고 오지 않는다.
    견적 템플릿에 필요한 것은 시트 목록·인쇄 영역·재계산 설정뿐이다.
    """
    return (
        DECL
        + (
            f'<workbook xmlns="{M}" xmlns:r="{DOC_R}">'
            "<workbookPr/>"
            '<bookViews><workbookView xWindow="0" yWindow="0" '
            'windowWidth="28800" windowHeight="15600"/></bookViews>'
            "<sheets>"
            f'<sheet name="{COVER_SHEET}" sheetId="1" r:id="rId1"/>'
            f'<sheet name="{MODEL_SHEET_NAME}" sheetId="2" r:id="rId2"/>'
            "</sheets>"
            "<definedNames>"
            '<definedName name="_xlnm.Print_Area" localSheetId="0">'
            f"'{COVER_SHEET}'!$A$1:$J${COVER_LAST_ROW}</definedName>"
            '<definedName name="_xlnm.Print_Titles" localSheetId="1">'
            f"'{MODEL_SHEET_NAME}'!$1:$3</definedName>"
            '<definedName name="_xlnm.Print_Area" localSheetId="1">'
            f"'{MODEL_SHEET_NAME}'!$A$1:$K${SYSTEM_LAST_ROW}</definedName>"
            "</definedNames>"
            '<calcPr fullCalcOnLoad="1"/>'
            "</workbook>"
        ).encode("utf-8")
    )


def build_workbook_rels(cover_part, model_part):
    def rel(rid, rtype, target):
        return f'<Relationship Id="{rid}" Type="{DOC_R}/{rtype}" Target="{target}"/>'

    return DECL + (
        f'<Relationships xmlns="{PKG_R}">'
        + rel("rId1", "worksheet", cover_part.removeprefix("xl/"))
        + rel("rId2", "worksheet", model_part.removeprefix("xl/"))
        + rel("rId3", "styles", "styles.xml")
        + rel("rId4", "theme", "theme/theme1.xml")
        + "</Relationships>"
    ).encode("utf-8")


def build_root_rels():
    return DECL + (
        f'<Relationships xmlns="{PKG_R}">'
        f'<Relationship Id="rId1" Type="{DOC_R}/officeDocument" Target="xl/workbook.xml"/>'
        f'<Relationship Id="rId2" Type="{CORE_REL}" Target="docProps/core.xml"/>'
        f'<Relationship Id="rId3" Type="{DOC_R}/extended-properties" Target="docProps/app.xml"/>'
        "</Relationships>"
    ).encode("utf-8")


def build_app_xml():
    return DECL + (
        f'<Properties xmlns="{EP}" xmlns:vt="{VT}">'
        "<Application>Microsoft Excel</Application>"
        "<DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>"
        '<HeadingPairs><vt:vector size="2" baseType="variant">'
        "<vt:variant><vt:lpstr>워크시트</vt:lpstr></vt:variant>"
        "<vt:variant><vt:i4>2</vt:i4></vt:variant></vt:vector></HeadingPairs>"
        '<TitlesOfParts><vt:vector size="2" baseType="lpstr">'
        f"<vt:lpstr>{COVER_SHEET}</vt:lpstr>"
        f"<vt:lpstr>{MODEL_SHEET_NAME}</vt:lpstr>"
        "</vt:vector></TitlesOfParts>"
        "<Company/><LinksUpToDate>false</LinksUpToDate>"
        "<SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged>"
        "<AppVersion>16.0300</AppVersion></Properties>"
    ).encode("utf-8")


def build_core_xml():
    return DECL + (
        f'<cp:coreProperties xmlns:cp="{CP}" xmlns:dc="{DC}" xmlns:xsi="{XSI}">'
        "<dc:creator>AV-CPQ</dc:creator>"
        "<cp:lastModifiedBy>AV-CPQ</cp:lastModifiedBy>"
        "</cp:coreProperties>"
    ).encode("utf-8")


def build(out_path: Path) -> None:
    src = zipfile.ZipFile(require(NEGO_QUOTE), "r")
    names = src.namelist()

    workbook_rels = read_rels(src.read("xl/_rels/workbook.xml.rels"))
    wb_root = ET.fromstring(src.read("xl/workbook.xml"))
    sheet_parts = {}
    for sheet in wb_root.find(tag("sheets")):
        target = workbook_rels[sheet.get(tag("id", DOC_R))][1]
        sheet_parts[sheet.get("name")] = "xl/" + target.lstrip("/").removeprefix("xl/")

    cover_part = sheet_parts[COVER_SHEET]
    model_part = sheet_parts[MODEL_SHEET_SRC]
    kept_parts = {cover_part, model_part}

    def rels_path_of(part):
        head, name = part.rsplit("/", 1)
        return f"{head}/_rels/{name}.rels"

    # 남기는 시트의 관계가 가리키는 대상(도면 → 미디어)을 따라간다
    kept_sheet_rels, kept_targets = {}, set()
    for part in kept_parts:
        rp = rels_path_of(part)
        if rp not in names:
            continue
        kept_sheet_rels[part] = rp
        for _rid, (rtype, target) in read_rels(src.read(rp)).items():
            if rtype.endswith("/printerSettings"):
                continue
            kept_targets.add("xl/" + target.replace("../", "").lstrip("/").removeprefix("xl/"))
    for target in list(kept_targets):
        rp = rels_path_of(target)
        if rp in names:
            kept_targets.add(rp)
            for _rid, (_t, media) in read_rels(src.read(rp)).items():
                kept_targets.add("xl/" + media.replace("../", "").lstrip("/").removeprefix("xl/"))

    out = {}

    # 1) 워크시트 2장
    cover_text = dict(COVER_KEEP)
    system_text, system_numbers = system_keep()
    out[cover_part] = clean_worksheet(
        src.read(cover_part), cover_text, {}, COVER_LAST_ROW, COVER_LAST_COL
    )
    out[model_part] = clean_worksheet(
        src.read(model_part), system_text, system_numbers, SYSTEM_LAST_ROW, SYSTEM_LAST_COL
    )
    for part, rp in kept_sheet_rels.items():
        filtered = filter_sheet_rels(src.read(rp))
        if filtered is not None:
            out[rp] = filtered

    # 2) 바이트 그대로 옮기는 파트
    for name in names:
        if name.startswith(("customXml/", "xl/externalLinks/", "xl/printerSettings/")):
            continue
        if name.startswith("xl/worksheets/"):
            continue  # 위에서 처리
        if name in ("[Content_Types].xml", "_rels/.rels", "xl/workbook.xml",
                    "xl/_rels/workbook.xml.rels", "docProps/app.xml",
                    "docProps/core.xml", "docProps/custom.xml",
                    "xl/sharedStrings.xml", "xl/calcChain.xml"):
            continue
        out[name] = src.read(name)

    # 3) 새로 쓰는 파트
    out["xl/workbook.xml"] = build_workbook_xml()
    out["xl/_rels/workbook.xml.rels"] = build_workbook_rels(cover_part, model_part)
    out["_rels/.rels"] = build_root_rels()
    out["docProps/app.xml"] = build_app_xml()
    out["docProps/core.xml"] = build_core_xml()

    # 4) [Content_Types].xml — 남은 파트만
    ET.register_namespace("", CT)
    ct_root = ET.fromstring(src.read("[Content_Types].xml"))
    for child in list(ct_root):
        part = (child.get("PartName") or "").lstrip("/")
        if part and part not in out:
            ct_root.remove(child)
    out["[Content_Types].xml"] = DECL + ET.tostring(
        ct_root, encoding="UTF-8", xml_declaration=False
    )

    # 5) 쓰기 — [Content_Types].xml이 OPC 패키지의 첫 엔트리여야 한다
    out_path.parent.mkdir(parents=True, exist_ok=True)
    order = ["[Content_Types].xml"] + [n for n in out if n != "[Content_Types].xml"]
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zo:
        for name in order:
            zo.writestr(name, out[name])

    src.close()
    print(f"saved: {out_path}  ({len(order)} parts)")
    for name in order:
        print("  ", name)


if __name__ == "__main__":
    build(Path(sys.argv[1]))
