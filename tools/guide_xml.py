# -*- coding: utf-8 -*-
"""워크시트 XML 수술 — 공유 수식 확장, 캐시 제거, 행 비우기.

`build_guide_templates.py` 가 쓴다. 별도 파일로 둔 이유는 정규식이 많아서다.

## 공유 수식을 왜 확장해야 하는가

예시 품목 행(6~12)의 수식에는 **민감한 값이 박혀 있다.**

    I6 = G6*1.2            원가 × 배율 = 판매가. 배율이 그대로 드러난다
    W6 = 0.7+0.59          예시 품목의 직종별 품(공수)
    Y6 = 0.5+0.3+0.7+0.89

그래서 지워야 하는데, 그냥 지우면 안 된다. 9~12행과 **13·14행**의 수식이
`<f t="shared" si="0"/>` 꼴로 6~8행의 원본을 가리키기 때문이다. 원본을 지우면
13·14행 수식까지 끊겨 Excel 이 복구를 요구한다.

그래서 **경계를 넘는 추종자를 먼저 제 수식으로 펼친 뒤** 원본을 지운다.

## 캐시된 값도 지운다

수식 칸의 `<v>` 는 마지막 계산 결과다. 예시 품목을 지워도 `G13=4800`,
`M15=…` 같은 **예시 금액이 그대로 남는다.** 셀을 열어 보면 보인다.
수식이 있는 칸의 캐시는 전부 버리고, 통합문서에 "열 때 다시 계산" 표시를 단다.
"""
import re

# 자기닫기 꼴을 먼저 둔다. `<c r="A7" s="5"/>` 가 여닫이 분기에 먼저 걸리면
# `[^>]*>` 가 `/>` 의 `>` 까지 먹고 `.*?</c>` 가 다음 셀까지 삼킨다.
CELL_RE = re.compile(rb"<c [^>]*/>|<c [^>]*>.*?</c>", re.S)
REF_ATTR_RE = re.compile(rb'r="([A-Z]+[0-9]+)"')
STYLE_ATTR_RE = re.compile(rb's="([0-9]+)"')
TYPE_ATTR_RE = re.compile(rb' t="[^"]*"')
FORMULA_RE = re.compile(rb"<f/>|<f [^>]*/>|<f>.*?</f>|<f [^>]*>.*?</f>", re.S)
VALUE_RE = re.compile(rb"<v>.*?</v>|<v/>", re.S)
INLINE_RE = re.compile(rb"<is>.*?</is>", re.S)

_SI_RE = re.compile(rb'si="([0-9]+)"')
_SHARED_RE = re.compile(rb't="shared"')
_REF_RANGE_RE = re.compile(rb'ref="([^"]*)"')

# 수식 안의 셀 참조. `$` 가 붙으면 절대 참조라 옮기지 않는다.
_A1_RE = re.compile(r"(\$?)([A-Z]{1,3})(\$?)([0-9]{1,7})")
# 문자열 리터럴은 건너뛴다 — `IFERROR(...,"-")` 의 `"-"` 안을 건드리면 안 된다.
_STRING_RE = re.compile(r'"[^"]*"')


def row_of(ref):
    return int("".join(ch for ch in ref if ch.isdigit()))


def col_of(ref):
    return "".join(ch for ch in ref if ch.isalpha())


def col_index(name):
    out = 0
    for ch in name:
        out = out * 26 + (ord(ch) - 64)
    return out


def col_name(index):
    out = ""
    while index > 0:
        index, rem = divmod(index - 1, 26)
        out = chr(65 + rem) + out
    return out


def translate(formula: str, row_delta: int, col_delta: int) -> str:
    """상대 참조만 옮긴다. 문자열 리터럴 안은 건드리지 않는다."""
    if row_delta == 0 and col_delta == 0:
        return formula

    def shift(match):
        col_abs, col, row_abs, row = match.groups()
        new_col = col if col_abs else col_name(col_index(col) + col_delta)
        new_row = row if row_abs else str(int(row) + row_delta)
        return f"{col_abs}{new_col}{row_abs}{new_row}"

    out = []
    last = 0
    for literal in _STRING_RE.finditer(formula):
        out.append(_A1_RE.sub(shift, formula[last : literal.start()]))
        out.append(literal.group(0))
        last = literal.end()
    out.append(_A1_RE.sub(shift, formula[last:]))
    return "".join(out)


def _cells(sheet_xml: bytes):
    """(match, ref, style, formula_block, 셀 전체) 를 차례로 내놓는다."""
    for match in CELL_RE.finditer(sheet_xml):
        block = match.group(0)
        ref_match = REF_ATTR_RE.search(block)
        if ref_match is None:
            continue
        yield match, ref_match.group(1).decode("ascii"), block


def collect_shared(sheet_xml: bytes):
    """`si` → (원본 셀, 원본 수식, 추종 셀 목록)."""
    masters = {}
    followers = {}
    for _, ref, block in _cells(sheet_xml):
        formula = FORMULA_RE.search(block)
        if formula is None:
            continue
        body = formula.group(0)
        if _SHARED_RE.search(body) is None:
            continue
        si_match = _SI_RE.search(body)
        if si_match is None:
            continue
        si = si_match.group(1).decode("ascii")
        text = re.sub(rb"<f[^>]*>|</f>", b"", body).decode("utf-8")
        if _REF_RANGE_RE.search(body) is not None and text != "":
            masters[si] = (ref, text)
        else:
            followers.setdefault(si, []).append(ref)
    return masters, followers


def expand_shared_across(sheet_xml: bytes, doomed_rows) -> bytes:
    """곧 지울 행에 원본이 있는 공유 수식을, **밖에 있는 추종자**에 펼쳐 넣는다.

    펼치지 않고 원본을 지우면 추종자의 `si` 가 가리킬 곳을 잃는다.
    Excel 은 그 통합문서를 복구 대상으로 본다.
    """
    doomed = set(doomed_rows)
    masters, followers = collect_shared(sheet_xml)

    inline = {}
    for si, (master_ref, text) in masters.items():
        if row_of(master_ref) not in doomed:
            continue
        for follower in followers.get(si, []):
            if row_of(follower) in doomed:
                continue  # 같이 지워질 칸이라 펼칠 필요가 없다
            inline[follower] = translate(
                text,
                row_of(follower) - row_of(master_ref),
                col_index(col_of(follower)) - col_index(col_of(master_ref)),
            )

    if not inline:
        return sheet_xml

    def replace(match):
        block = match.group(0)
        ref_match = REF_ATTR_RE.search(block)
        if ref_match is None:
            return block
        ref = ref_match.group(1).decode("ascii")
        if ref not in inline:
            return block
        formula = FORMULA_RE.search(block)
        if formula is None:
            return block
        body = b"<f>" + inline[ref].encode("utf-8") + b"</f>"
        return block[: formula.start()] + body + block[formula.end() :]

    return CELL_RE.sub(replace, sheet_xml)


def clear_rows_completely(sheet_xml: bytes, rows) -> bytes:
    """지정한 행의 값과 수식을 전부 없앤다. 스타일만 남긴다.

    `expand_shared_across` 를 **먼저** 부른 뒤에만 안전하다.
    """
    doomed = set(rows)

    def replace(match):
        block = match.group(0)
        ref_match = REF_ATTR_RE.search(block)
        if ref_match is None:
            return block
        ref = ref_match.group(1)
        if row_of(ref.decode("ascii")) not in doomed:
            return block
        style = STYLE_ATTR_RE.search(block)
        attrs = b' s="' + style.group(1) + b'"' if style else b""
        return b'<c r="' + ref + b'"' + attrs + b"/>"

    return CELL_RE.sub(replace, sheet_xml)


def clear_cells(sheet_xml: bytes, refs) -> bytes:
    """지정한 셀의 값만 비운다. 스타일은 남긴다."""
    targets = {r.encode("ascii") for r in refs}

    def replace(match):
        block = match.group(0)
        ref_match = REF_ATTR_RE.search(block)
        if ref_match is None or ref_match.group(1) not in targets:
            return block
        style = STYLE_ATTR_RE.search(block)
        attrs = b' s="' + style.group(1) + b'"' if style else b""
        return b'<c r="' + ref_match.group(1) + b'"' + attrs + b"/>"

    return CELL_RE.sub(replace, sheet_xml)


def strip_cached_values(sheet_xml: bytes) -> bytes:
    """수식 칸의 **마지막 계산 결과**를 버린다.

    예시 품목을 지워도 그 결과로 계산됐던 `G13=4800`, 직접비계, 간접비 금액이
    캐시로 남는다. 파일을 뜯어보면 예시 견적의 금액이 그대로 보인다.

    값만 있는 칸(머리글 문자열 등)은 건드리지 않는다 — 양식 자체다.
    """

    def replace(match):
        block = match.group(0)
        formula = FORMULA_RE.search(block)
        if formula is None:
            return block
        stripped = VALUE_RE.sub(b"", block)
        stripped = INLINE_RE.sub(b"", stripped)
        # 캐시가 사라지면 `t="str"`·`t="e"` 같은 결과 타입 표시도 뜻이 없다.
        head_end = stripped.index(b">")
        head = TYPE_ATTR_RE.sub(b"", stripped[:head_end])
        return head + stripped[head_end:]

    return CELL_RE.sub(replace, sheet_xml)


def force_full_calc(workbook_xml: bytes) -> bytes:
    """"열 때 전부 다시 계산" 을 켠다.

    캐시를 버렸으므로 Excel 이 직접 계산해야 한다. 이 표시가 없으면
    빈 칸으로 보이다가 사용자가 아무 칸이나 건드릴 때 값이 나타난다.
    """
    if b"<calcPr" in workbook_xml:
        return re.sub(
            rb"<calcPr([^>]*?)/>",
            lambda m: b"<calcPr"
            + re.sub(rb' fullCalcOnLoad="[^"]*"', b"", m.group(1))
            + b' fullCalcOnLoad="1"/>',
            workbook_xml,
        )
    return workbook_xml.replace(b"</workbook>", b'<calcPr fullCalcOnLoad="1"/></workbook>')
