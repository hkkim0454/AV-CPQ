# -*- coding: utf-8 -*-
"""XLSX ZIP 전체 민감정보 감사 (설계서 §9.6, §9.7).

검사 항목:
  1. ZIP 구성 파트 목록 / 금지 파트(externalLink*, vbaProject, pivotCache, 임베디드, customProps)
  2. sharedStrings 전수
  3. 모든 워크시트의 인라인 문자열 / 숫자 리터럴 / 수식
  4. definedNames, properties, 숨김 시트·행·열
  5. calcChain 존재 여부
  6. 내장 패턴 — 로컬 경로, 다른 통합문서 파일명, customProperties
  7. 호출자가 넘긴 sentinel 문자열

사용:  python tools/audit_xlsx.py <파일> [sentinel ...]
종료코드 1 = 발견 사항 있음.
"""
import sys
import zipfile
import re
import xml.etree.ElementTree as ET

sys.stdout.reconfigure(encoding="utf-8")

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
MT = "{" + NS["m"] + "}"

FORBIDDEN_PART = re.compile(
    r"externalLink|vbaProject|pivotCache|pivotTable|embeddings|oleObject|"
    r"customXml|docProps/custom|comments|threadedComment|person",
    re.I,
)

# 내장 패턴: sentinel 목록과 무관하게 항상 검사한다.
LOCAL_PATH = re.compile(r"[A-Za-z]:[\\/](?:Users|work|temp|windows)", re.I)
OTHER_WORKBOOK = re.compile(r"[\w가-힣()\[\]. _-]+\.xls[xmb]?(?![a-z])", re.I)
CUSTOM_PROPS = re.compile(r"docProps/custom")
ALWAYS = [
    (LOCAL_PATH, "윈도우 로컬 경로"),
    (OTHER_WORKBOOK, "다른 통합문서 파일명"),
    (CUSTOM_PROPS, "customProperties 참조"),
]


def text_of(el):
    return "".join(t.text or "" for t in el.iter(MT + "t"))


def main(path, sentinels=()):
    z = zipfile.ZipFile(path)
    names = z.namelist()
    findings = []

    print("## AUDIT " + path)
    print("parts (%d):" % len(names))
    for n in sorted(names):
        bad = FORBIDDEN_PART.search(n)
        if bad:
            findings.append("금지 파트: " + n)
        print("  %s%s" % (n, "  <-- FORBIDDEN" if bad else ""))

    print()
    print("sharedStrings:")
    if "xl/sharedStrings.xml" in names:
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for i, si in enumerate(root.findall("m:si", NS)):
            print("  [%d] %r" % (i, text_of(si)))
    else:
        print("  (none)")

    print()
    print("worksheet literals:")
    for n in [x for x in names if x.startswith("xl/worksheets/sheet")]:
        root = ET.fromstring(z.read(n))
        vals, formulas = [], []
        hidden_rows = [r.get("r") for r in root.iter(MT + "row") if r.get("hidden") == "1"]
        hidden_cols = [
            "%s-%s" % (c.get("min"), c.get("max"))
            for c in root.iter(MT + "col")
            if c.get("hidden") == "1"
        ]
        for c in root.iter(MT + "c"):
            f = c.find("m:f", NS)
            if f is not None and f.text:
                formulas.append("%s=%s" % (c.get("r"), f.text))
            v = c.find("m:v", NS)
            if v is not None and v.text is not None:
                vals.append("%s:%s" % (c.get("r"), v.text))
            isel = c.find("m:is", NS)
            if isel is not None:
                vals.append("%s:inline=%r" % (c.get("r"), text_of(isel)))
        print(
            "  %s: values=%d formulas=%d hiddenRows=%s hiddenCols=%s"
            % (n, len(vals), len(formulas), hidden_rows, hidden_cols)
        )
        if hidden_rows:
            findings.append("숨김 행 %s in %s" % (hidden_rows, n))
        if hidden_cols:
            findings.append("숨김 열 %s in %s" % (hidden_cols, n))
        for v in vals:
            print("      v " + v)
        for f in formulas:
            print("      f " + f)

    root = ET.fromstring(z.read("xl/workbook.xml"))
    print()
    print("sheets:")
    for sh in root.iter(MT + "sheet"):
        state = sh.get("state", "visible")
        print("  %r state=%s" % (sh.get("name"), state))
        if state != "visible":
            findings.append("숨김 시트: " + str(sh.get("name")))
    print("definedNames:")
    dn = root.find("m:definedNames", NS)
    if dn is None:
        print("  (none)")
    else:
        for d in dn:
            print("  %s = %s" % (d.get("name"), d.text))

    print()
    print("properties:")
    for p in ("docProps/core.xml", "docProps/app.xml", "docProps/custom.xml"):
        if p in names:
            print("  %s: %s" % (p, z.read(p).decode("utf-8", "replace")[:1200]))

    print()
    print("calcChain:", "present" if "xl/calcChain.xml" in names else "absent")

    print()
    print("내장 패턴 검사:")
    hits = 0
    for n in names:
        if n == "[Content_Types].xml":
            continue
        blob = z.read(n).decode("utf-8", "replace")
        for rx, label in ALWAYS:
            for m in rx.finditer(blob):
                ctx = blob[max(0, m.start() - 60):m.end() + 60]
                ctx = " ".join(ctx.split())
                findings.append("%s in %s: ...%s..." % (label, n, ctx))
                print("  HIT %s in %s: %r" % (label, n, m.group(0)))
                hits += 1
    if hits == 0:
        print("  clean")

    if sentinels:
        print()
        print("sentinel scan:")
        hits = 0
        for n in names:
            blob = z.read(n).decode("utf-8", "replace")
            for s in sentinels:
                if s in blob:
                    findings.append("sentinel %r in %s" % (s, n))
                    print("  HIT %r in %s" % (s, n))
                    hits += 1
        if hits == 0:
            print("  clean")

    print()
    print("=== FINDINGS ===")
    if findings:
        for f in findings:
            print("  ! " + f)
        sys.exit(1)
    print("  none")


main(sys.argv[1], sys.argv[2:])
