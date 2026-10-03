# -*- coding: utf-8 -*-
"""XLSX에서 민감 파트·외부링크·상속된 정의 이름을 ZIP 수준에서 제거한다 (설계서 §9.6).

원본 견적서는 수십 년간 복사되며 다음을 끌고 다닌다. 전부 제거 대상이다.
  - xl/externalLinks/*        다른 통합문서 링크 (경로에 고객사명 포함)
  - docProps/custom.xml       이전 작성자 PC 경로와 과거 프로젝트 파일명
  - definedNames              과거 고객사 통합문서 참조와 하드코딩된 노임 상수
  - calcChain.xml             오래된 계산 순서 캐시

남기는 정의 이름은 인쇄 관련 내장 이름뿐이다.

사용:  python tools/strip_xlsx.py <입력> <출력>
"""
import sys
import zipfile
import re
from pathlib import Path
import xml.etree.ElementTree as ET

sys.stdout.reconfigure(encoding="utf-8")

M = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_R = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"

DROP = re.compile(
    r"xl/externalLinks/|xl/calcChain\.xml|vbaProject|pivotCache|pivotTable|"
    r"xl/embeddings/|oleObject|customXml/|docProps/custom\.xml|comments\d*\.xml|"
    r"threadedComment|persons?/",
    re.I,
)

# 유지할 내장 정의 이름 (인쇄 설정). 그 외는 전부 제거.
KEEP_DEFINED_NAMES = {"_xlnm.Print_Area", "_xlnm.Print_Titles", "_xlnm._FilterDatabase"}


def main(src, dst):
    zin = zipfile.ZipFile(src)
    dropped = [n for n in zin.namelist() if DROP.search(n)]
    out = {n: zin.read(n) for n in zin.namelist() if not DROP.search(n)}

    ET.register_namespace("", M)
    ET.register_namespace("r", R)

    # --- xl/workbook.xml ---
    wb = ET.fromstring(out["xl/workbook.xml"])

    for el in wb.findall("{%s}externalReferences" % M):
        wb.remove(el)

    removed_names = []
    dn = wb.find("{%s}definedNames" % M)
    if dn is not None:
        for d in list(dn):
            if d.get("name") not in KEEP_DEFINED_NAMES:
                removed_names.append(d.get("name"))
                dn.remove(d)
        if len(dn) == 0:
            wb.remove(dn)

    calc = wb.find("{%s}calcPr" % M)
    if calc is None:
        calc = ET.SubElement(wb, "{%s}calcPr" % M)
    calc.set("fullCalcOnLoad", "1")
    calc.attrib.pop("calcId", None)

    out["xl/workbook.xml"] = ET.tostring(wb, xml_declaration=True, encoding="UTF-8")

    # --- docProps/core.xml: 인쇄 이력·개정 번호 제거 ---
    if "docProps/core.xml" in out:
        CP = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
        ET.register_namespace("cp", CP)
        core = ET.fromstring(out["docProps/core.xml"])
        for el in list(core):
            if el.tag.endswith("}lastPrinted") or el.tag.endswith("}revision"):
                core.remove(el)
        out["docProps/core.xml"] = ET.tostring(core, xml_declaration=True, encoding="UTF-8")

    # --- 관계 파일에서 드롭된 파트 참조 제거 ---
    ET.register_namespace("", PKG_R)
    for rels_part in ("xl/_rels/workbook.xml.rels", "_rels/.rels"):
        if rels_part not in out:
            continue
        rels = ET.fromstring(out[rels_part])
        for rel in list(rels):
            target = rel.get("Target", "")
            if DROP.search(target) or "externalLink" in target:
                rels.remove(rel)
        out[rels_part] = ET.tostring(rels, xml_declaration=True, encoding="UTF-8")

    # --- [Content_Types].xml ---
    ET.register_namespace("", CT)
    ct = ET.fromstring(out["[Content_Types].xml"])
    for ov in list(ct):
        part = ov.get("PartName", "")
        if part and DROP.search(part.lstrip("/")):
            ct.remove(ov)
    out["[Content_Types].xml"] = ET.tostring(ct, xml_declaration=True, encoding="UTF-8")

    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zo:
        for name, data in out.items():
            zo.writestr(name, data)

    print("dropped parts:", dropped)
    print("removed definedNames: %d" % len(removed_names))
    if removed_names:
        print("  ", ", ".join(sorted(n for n in removed_names if n)[:40]))
    print("written:", dst)


main(sys.argv[1], sys.argv[2])
