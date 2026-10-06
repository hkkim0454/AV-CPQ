# -*- coding: utf-8 -*-
"""품셈 파일 → 원시 덤프 JSON (결정 문서 D1, 계획 Task 1).

**기계적 덤프다. 판단하지 않는다.** 어느 행이 제품인지, SKU를 어떻게 만들지는
TypeScript 쪽(`src/data/catalog/`)이 정한다. 여기서는 셀을 읽어 옮기기만 한다.
그래야 분류 규칙을 바꿀 때 원본을 다시 열지 않아도 된다.

## 열 번호를 외우지 않는다 — 머리글로 찾는다 (품셈 교체 Task 1)

예전에는 `READ_COLUMNS = {"laborCode": 16, ...}` 처럼 **열 번호를 상수로**
적었다. 2026 하반기 파일에서 열이 밀리자 16번이 `제조사/구매처`가 되어
**매입처가 카탈로그로 들어갔다**(합성 시트로 재현함 —
`tools/test_extract_catalog.py`).

그래서 지금은 2행(상위)·3행(하위) 머리글을 읽어 **역할로** 열을 찾는다.
`재료비`+`단 가`가 판매단가이고 `노무비`+`단 가`가 노무비 단가다.
**상위만으로도, 하위만으로도 정하지 않는다** — 상반기와 하반기 둘 다
`재료비`·`노무비` 아래에 `단 가`·`금액`이 한 쌍씩 있기 때문이다.

못 찾거나(결손), 같은 머리글이 두 열에 있거나(모호), 구조가 어긋나면
**추출 전체를 중단한다.** 그 열만 건너뛰지 않는다.

## 읽지 않는 열 — 머리글로 막는다

`제조사` · `구매처` · `영업비고` · `원가` 중 하나라도 **읽기 대상 열의
머리글**에 있으면 `SystemExit`로 멈춘다. 중단 메시지에는 **열 문자와
머리글만** 적는다 — 그 열의 값이 매입처일 수 있다(설계서 §8.1, 결정 D1).

그 밖에 읽지 않는 열: 수량(샘플값이라 카탈로그에 무의미), 각종 금액 수식,
노무비 메모, 직종별 금액 수식.

## 원본은 읽기만 한다

`wb.save()`를 부르지 않는다. 실측으로 확인한 사실: openpyxl 왕복 저장은
Excel이 열지 못하는 파일을 만든다 (`docs/template/verification.md` §1.1).

사용:
    set AVCPQ_PUMSEM_XLSX=<품셈 파일 경로>
    python tools/extract_catalog.py .local/raw/catalog-raw.json
"""
import hashlib
import json
import os
import re
import unicodedata
import sys
from datetime import date
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

sys.stdout.reconfigure(encoding="utf-8")

# --- 금지 머리글. 읽기 대상 열에 하나라도 있으면 전체 중단 ---------------------
FORBIDDEN_HEADER_TOKENS = ("제조사", "구매처", "영업비고", "원가")

# --- 머리글 역할표 -----------------------------------------------------------
#
# `sub` 가 `ANY` 면 하위 머리글을 보지 않는다. 튜플이면 그 중 하나여야 한다.
# 상위만으로 정할 수 있는 역할(`번호`·`품명`…)과, 상위·하위를 함께 봐야만
# 정해지는 역할(`재료비`+`단 가`)을 구분한다.
ANY = None

COLUMN_SPECS = (
    ("number", ("번호",), ANY),
    ("name", ("품명",), ANY),
    ("spec", ("규격",), ANY),
    ("description", ("설명",), ANY),
    ("unit", ("단위",), ANY),
    ("materialUnitPrice", ("재료비",), ("단가",)),   # 판매단가
    ("laborUnitPrice", ("노무비",), ("단가",)),      # 역산 대조용 (Task 2)
    ("remark", ("비고",), ANY),
    ("itemRate", ("품목별요율%", "품목별요율"), ANY),
    ("surcharge", ("할증",), ANY),
)

#: `품목별 요율%` 를 기준으로 한 품셈 블록의 상대 위치. 머리글이 없는
#: 품셈 코드 열을 "요율의 왼쪽"만으로 정하지 않고 이 블록 전체를 확인한다.
#:
#:     [품셈 코드] [품목별 요율%] [할증] [표준 단가] [직종1] [노임1] [직종2] …
#:         -1            0         +1      +2        +3
LABOR_CODE_OFFSET = -1
SURCHARGE_OFFSET = 1
STANDARD_PRICE_OFFSET = 2
FIRST_TRADE_OFFSET = 3

#: 숫자로 읽을 칸. 나머지는 문자열 그대로 옮긴다.
NUMERIC_FIELDS = ("materialUnitPrice", "laborUnitPrice", "itemRate", "surcharge")

# 이 계획의 범위 밖 (결정 문서 D1, 계획 Global Constraints)
SKIP_SHEETS = {
    "LED전광판 계산",        # 숨김
    "단종, 미사용 제품",      # 숨김
    "간접비_DS",             # 발주처 프로파일 — 별도 계획
    "간접비_SDC, SDI",       # 발주처 프로파일 — 별도 계획
}


def normalize_header(value):
    """머리글 비교용 정규화. 공백·개행을 없애고 전각을 반각으로 맞춘다.

    원본에 `품   명`, `단 가` 처럼 공백이 섞여 있고 시트마다 다르다.
    숫자 머리글(`할증` 아래의 `0`)도 문자열로 다룬다.
    """
    if value is None:
        return ""
    text = unicodedata.normalize("NFKC", str(value))
    return "".join(text.split())


def stop(sheet, message):
    """추출 전체를 멈춘다. **셀 값을 적지 않는다** — 열 문자와 머리글만 적는다."""
    raise SystemExit(f"[{sheet}] {message}")


def header_grid(worksheet, top_row, sub_row):
    """(행, 열) → 정규화한 머리글.

    병합 영역은 **anchor 셀의 값을 그 범위 안에서만** 펼친다. 머리글이
    비었다고 왼쪽 값을 계속 끌어오면(forward fill) 병합 범위 밖의 엉뚱한
    열이 이름을 얻는다.

    세로로 2·3행에 걸쳐 병합된 열(`품명` 등)은 하위 머리글이 **없는 것**으로
    본다. 안 그러면 `품명`이 상위이자 하위가 되어 복합 역할 판정이 깨진다.
    """
    grid = {}
    for row in (top_row, sub_row):
        for column in range(1, worksheet.max_column + 1):
            grid[(row, column)] = normalize_header(worksheet.cell(row=row, column=column).value)

    spans_both_rows = set()
    for merged in worksheet.merged_cells.ranges:
        anchor = normalize_header(worksheet.cell(row=merged.min_row, column=merged.min_col).value)
        if anchor == "":
            continue
        for row in (top_row, sub_row):
            if merged.min_row <= row <= merged.max_row:
                for column in range(merged.min_col, merged.max_col + 1):
                    grid[(row, column)] = anchor
        if merged.min_row <= top_row and merged.max_row >= sub_row:
            for column in range(merged.min_col, merged.max_col + 1):
                spans_both_rows.add(column)

    roles = {}
    for column in range(1, worksheet.max_column + 1):
        top = grid.get((top_row, column), "")
        sub = "" if column in spans_both_rows else grid.get((sub_row, column), "")
        roles[column] = (top, sub)
    return roles


def find_header_rows(worksheet, sheet_name):
    """머리글 행을 **찾는다.** `2·3행`이라고 외우지 않는다.

    `품명` 이 있는 행이 상위 머리글 행이고, 그 다음이 하위 머리글 행이며,
    본문은 그 다음 행부터다. 못 찾으면 중단한다.
    """
    for row in range(1, min(worksheet.max_row, 8) + 1):
        for column in range(1, min(worksheet.max_column, 12) + 1):
            if normalize_header(worksheet.cell(row=row, column=column).value) == "품명":
                return row, row + 1, row + 2
    stop(sheet_name, "머리글 행을 찾지 못했다 — '품 명' 머리글이 없다")


def check_forbidden(sheet_name, column, roles):
    """읽기 대상 열의 머리글에 금지 낱말이 있으면 전체 중단."""
    top, sub = roles.get(column, ("", ""))
    for header in (top, sub):
        for token in FORBIDDEN_HEADER_TOKENS:
            if token and token in header:
                stop(
                    sheet_name,
                    f"{get_column_letter(column)}열의 머리글 '{header}' 에 금지 낱말 '{token}' 이 있다. "
                    "읽으면 매입처·원가가 카탈로그로 들어간다 — 추출을 멈춘다.",
                )


def resolve_columns(worksheet, sheet_name):
    """머리글로 읽을 열을 정한다. 결손·모호·구조 불일치는 전부 중단."""
    top_row, sub_row, first_body_row = find_header_rows(worksheet, sheet_name)
    roles = header_grid(worksheet, top_row, sub_row)

    fields = {}
    for field, tops, subs in COLUMN_SPECS:
        matches = [
            column
            for column, (top, sub) in roles.items()
            if top in tops and (subs is ANY or sub in subs)
        ]
        if not matches:
            wanted = "/".join(tops) + ("" if subs is ANY else " + " + "/".join(subs))
            stop(sheet_name, f"머리글 '{wanted}' 에 해당하는 열이 없다")
        if len(matches) > 1:
            letters = ", ".join(get_column_letter(c) for c in matches)
            stop(sheet_name, f"머리글 '{'/'.join(tops)}' 이 여러 열({letters})에 있어 어느 쪽인지 정할 수 없다")
        fields[field] = matches[0]

    # --- 품셈 블록 — 코드 열에는 머리글이 없다 --------------------------------
    rate_column = fields["itemRate"]
    code_column = rate_column + LABOR_CODE_OFFSET
    if code_column < 1:
        stop(sheet_name, f"품목별 요율%({get_column_letter(rate_column)}열) 왼쪽에 품셈 코드 열이 없다")
    check_forbidden(sheet_name, code_column, roles)
    code_top, code_sub = roles.get(code_column, ("", ""))
    if code_top != "" or code_sub != "":
        stop(
            sheet_name,
            f"품셈 코드 자리({get_column_letter(code_column)}열)에 머리글 '{code_top or code_sub}' 이 있다. "
            "이 자리는 머리글이 없어야 한다 — 열 구조가 예상과 다르다.",
        )
    fields["laborCode"] = code_column

    if fields["surcharge"] != rate_column + SURCHARGE_OFFSET:
        stop(
            sheet_name,
            f"할증 열이 {get_column_letter(fields['surcharge'])}열인데 "
            f"품목별 요율%({get_column_letter(rate_column)}열) 바로 오른쪽이 아니다",
        )
    standard_column = rate_column + STANDARD_PRICE_OFFSET
    if normalize_header(roles.get(standard_column, ("", ""))[1]) != "표준단가":
        stop(
            sheet_name,
            f"표준 단가 자리({get_column_letter(standard_column)}열)의 하위 머리글이 '표준단가'가 아니다",
        )

    # --- 직종 쌍 — col 이 직종·품, col+1 이 노임 -------------------------------
    first_trade = rate_column + FIRST_TRADE_OFFSET
    trade_columns = []
    for column in range(first_trade, worksheet.max_column, 2):
        name = roles[column][0]
        if name == "":
            continue
        check_forbidden(sheet_name, column, roles)
        if column + 1 > worksheet.max_column:
            stop(sheet_name, f"직종 {get_column_letter(column)}열의 노임 열이 시트 밖이다")
        trade_columns.append(column)

    # 노임 자리(홀수 칸)에 **자기 직종과 다른 이름**이 있으면 짝이 어긋난 것이다.
    for column in range(first_trade + 1, worksheet.max_column + 1, 2):
        stray = roles[column][0]
        if stray != "" and stray != roles.get(column - 1, ("", ""))[0]:
            stop(
                sheet_name,
                f"노임 자리({get_column_letter(column)}열)에 별도 머리글 '{stray}' 이 있다 — 직종 쌍이 어긋났다",
            )

    if not trade_columns:
        stop(sheet_name, f"직종 열을 하나도 찾지 못했다(표준 단가 오른쪽 {get_column_letter(first_trade)}열부터 비어 있다)")

    for column in fields.values():
        check_forbidden(sheet_name, column, roles)

    return {
        "fields": fields,
        "trade_columns": trade_columns,
        "top_row": top_row,
        "sub_row": sub_row,
        "first_body_row": first_body_row,
    }


def decimal_text(value):
    """셀 값을 DecimalText(문자열)로. 숫자가 아니면 None.

    `number`로 저장하지 않는 이유는 `src/domain/quote/types.ts`의 `DecimalText`
    규약을 지키기 위해서다 — 부동소수 오차가 JSON을 거치며 굳어지면 안 된다.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        # repr가 아니라 Decimal 왕복 가능한 최단 표현을 쓴다.
        text = f"{value:.10f}".rstrip("0").rstrip(".")
        return text if text not in ("", "-") else "0"
    return None


def text_of(value):
    if value is None:
        return None
    text = str(value).strip()
    return text if text != "" else None


class NotLiteralArithmetic(Exception):
    """숫자 리터럴만으로 이루어진 식이 아니다 — 셀 참조나 함수가 섞였다."""


# 숫자 리터럴 산술만 허용하는 토큰. 식별자(셀 주소·함수명)는 토큰에 아예 없다.
_TOKEN = re.compile(r"\d+(?:\.\d+)?%?|[-+*/()]")


def eval_literal_arithmetic(formula):
    """`=0.23*80%`, `=(0.48+0.5)*120%` 같은 **숫자 리터럴 산술식**만 계산한다.

    설계서 §5.1: "JavaScript eval로 파일의 수식을 실행하지 않는다."
    Python에서도 `eval`을 쓰지 않는다. 재귀 하강 파서로 직접 읽는다.

    허용: 숫자, `%`(×0.01) 후위, `+ - * /`, 괄호.
    거부: 셀 참조, 함수, 그 밖의 모든 식별자 → `NotLiteralArithmetic`.

    원본 품셈의 품 열에는 `=0.63*(1+(2-1)*30%)` 같은 식이 585개 있고,
    **전부 셀 참조가 없다**(실측). 이것을 풀지 않으면 제품 3분의 1의 노무비가 빈다.
    """
    body = formula.lstrip("=").replace(" ", "")
    if body == "":
        raise NotLiteralArithmetic(formula)

    tokens = []
    position = 0
    while position < len(body):
        match = _TOKEN.match(body, position)
        if match is None:
            # 숫자·연산자·괄호가 아닌 것이 나왔다 = 셀 참조이거나 함수다.
            raise NotLiteralArithmetic(formula)
        tokens.append(match.group(0))
        position = match.end()

    index = 0

    def peek():
        return tokens[index] if index < len(tokens) else None

    def take():
        nonlocal index
        token = tokens[index]
        index += 1
        return token

    def primary():
        token = peek()
        if token is None:
            raise NotLiteralArithmetic(formula)
        if token == "(":
            take()
            value = expression()
            if peek() != ")":
                raise NotLiteralArithmetic(formula)
            take()
            return value
        if token in ("+", "-"):
            take()
            value = primary()
            return -value if token == "-" else value
        take()
        if token.endswith("%"):
            return float(token[:-1]) / 100.0
        return float(token)

    def term():
        value = primary()
        while peek() in ("*", "/"):
            operator = take()
            right = primary()
            if operator == "/":
                if right == 0:
                    raise NotLiteralArithmetic(formula)
                value /= right
            else:
                value *= right
        return value

    def expression():
        value = term()
        while peek() in ("+", "-"):
            operator = take()
            right = term()
            value = value + right if operator == "+" else value - right
        return value

    result = expression()
    if index != len(tokens):
        raise NotLiteralArithmetic(formula)
    return result


def sum_of_literals(formula):
    """수식을 숫자로 푼다. 못 풀면 None — TS 쪽이 `review-required`로 다룬다."""
    try:
        return decimal_text(eval_literal_arithmetic(formula))
    except NotLiteralArithmetic:
        return None


def read_cell(formula_ws, cached_ws, row, column):
    """수식 셀은 (수식, 캐시값) 둘 다 본다.

    설계서 §8.3: "캐시된 수식 결과를 원가 값으로 조용히 신뢰하지 않는다."
    그래서 수식이면 단순 덧셈만 직접 풀고, 아니면 원문을 그대로 넘겨
    판단을 TS 쪽으로 미룬다.
    """
    raw = formula_ws.cell(row=row, column=column).value
    if isinstance(raw, str) and raw.startswith("="):
        resolved = sum_of_literals(raw)
        if resolved is not None:
            return {"value": resolved, "fromFormula": True}
        cached = decimal_text(cached_ws.cell(row=row, column=column).value)
        return {"value": None, "formula": raw, "cached": cached, "fromFormula": True}
    return {"value": decimal_text(raw) if not isinstance(raw, str) else None,
            "text": text_of(raw)}


def extract_trades(formula_ws, cached_ws, row, trade_columns, trade_names):
    """직종별 품. 0과 빈칸은 담지 않는다 — 품이 없는 직종은 줄에 없어야 한다."""
    out = []
    unresolved = []
    for column in trade_columns:
        name = trade_names.get(column)
        if name is None:
            continue
        cell = read_cell(formula_ws, cached_ws, row, column)
        quantity = cell.get("value")
        if quantity is None:
            if "formula" in cell:
                unresolved.append(
                    {"trade": name, "column": get_column_letter(column), "formula": cell["formula"]}
                )
            continue
        if quantity in ("0", "0.0", "-0"):
            continue
        out.append({"trade": name, "quantity": quantity})
    return out, unresolved


def read_wage_header(formula_ws, cached_ws, layout, sheet_name):
    """상위 행의 직종 이름 + 하위 행의 단위 + 하위 행(col+1)의 노임.

    `col+1 이 노임 열`이라는 좌표 계약을 여기서 확인한다. 노임을 숫자로
    읽지 못하면 중단한다 — 노임이 비면 노무비가 통째로 0이 된다.
    """
    top_row, sub_row = layout["top_row"], layout["sub_row"]
    names = {}
    wages = []
    for column in layout["trade_columns"]:
        name = text_of(formula_ws.cell(row=top_row, column=column).value)
        if name is None:
            continue
        # 원본에 '통신관련 기능사'처럼 공백이 섞여 있다. 그대로 쓰되 양끝만 정리한다.
        names[column] = name
        unit = text_of(formula_ws.cell(row=sub_row, column=column).value)
        amount = decimal_text(formula_ws.cell(row=sub_row, column=column + 1).value)
        if amount is None:
            amount = decimal_text(cached_ws.cell(row=sub_row, column=column + 1).value)
        if amount is None:
            stop(
                sheet_name,
                f"직종 {get_column_letter(column)}열의 노임 자리"
                f"({get_column_letter(column + 1)}{sub_row})에 숫자가 없다 — 좌표 계약이 어긋났다",
            )
        if unit is None:
            stop(sheet_name, f"직종 {get_column_letter(column)}열에 단위(M/D·M/M)가 없다")
        wages.append(
            {
                "trade": name,
                "unit": unit,
                "amount": amount,
                "quantityColumn": get_column_letter(column),
            }
        )
    return names, wages


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extract(source: Path, destination: Path) -> None:
    formula_wb = load_workbook(source, data_only=False)
    cached_wb = load_workbook(source, data_only=True)

    sheets_out = []
    for formula_ws in formula_wb.worksheets:
        name = formula_ws.title
        if name in SKIP_SHEETS:
            continue
        if formula_ws.sheet_state != "visible":
            # 숨김 시트는 이름을 몰라도 건너뛴다.
            continue

        cached_ws = cached_wb[name]
        layout = resolve_columns(formula_ws, name)
        trade_columns = layout["trade_columns"]

        trade_names, wages = read_wage_header(formula_ws, cached_ws, layout, name)

        rows_out = []
        for row in range(layout["first_body_row"], formula_ws.max_row + 1):
            record = {"row": row}
            empty = True
            for field, column in layout["fields"].items():
                raw = formula_ws.cell(row=row, column=column).value
                if field in NUMERIC_FIELDS:
                    cell = read_cell(formula_ws, cached_ws, row, column)
                    value = cell.get("value")
                    if value is not None:
                        record[field] = value
                        empty = False
                    elif "formula" in cell:
                        record[field + "Formula"] = cell["formula"]
                        # 캐시값을 **버리지 않고** 함께 넘긴다. 노무비 단가는
                        # 대부분 셀 참조 수식이라 여기로 오는데, 역산 대조
                        # (Task 2)가 그 값을 봐야 한다. 믿을지 말지는 TS 쪽이
                        # 정한다 — 캐시가 없으면 `미검증`이다(설계서 §8.3).
                        if cell.get("cached") is not None:
                            record[field + "Cached"] = cell["cached"]
                        empty = False
                else:
                    value = text_of(raw)
                    if value is not None:
                        record[field] = value
                        empty = False

            trades, unresolved = extract_trades(
                formula_ws, cached_ws, row, trade_columns, trade_names
            )
            if trades:
                record["trades"] = trades
                empty = False
            if unresolved:
                record["unresolvedTrades"] = unresolved
                empty = False

            if not empty:
                rows_out.append(record)

        sheets_out.append({"name": name, "wages": wages, "rows": rows_out})

    formula_wb.close()
    cached_wb.close()

    payload = {
        "schemaVersion": 1,
        # 파일명·경로를 담지 않는다. 해시만으로 어느 판인지 확인할 수 있다.
        "source": {"sha256": sha256_of(source), "extractedOn": date.today().isoformat()},
        "sheets": sheets_out,
    }

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    total = sum(len(s["rows"]) for s in sheets_out)
    print(f"saved: {destination}")
    print(f"sheets: {len(sheets_out)}  rows: {total}")
    for sheet in sheets_out:
        print(f"  {sheet['name']}: rows={len(sheet['rows'])} trades={len(sheet['wages'])}")


def main() -> None:
    # 경로는 환경변수나 `--source`로 받는다. 코드에 하드코딩하지 않는다 (설계서 §4.5).
    # `--source`가 따로 있는 이유: Git Bash가 환경변수의 한글 경로를 깨뜨린다.
    # argv는 깨지지 않으므로 한글 파일명을 쓸 때는 이쪽을 쓴다.
    args = sys.argv[1:]
    raw_source = os.environ.get("AVCPQ_PUMSEM_XLSX")
    destination_arg = None
    index = 0
    while index < len(args):
        if args[index] == "--source" and index + 1 < len(args):
            raw_source = args[index + 1]
            index += 2
            continue
        destination_arg = args[index]
        index += 1

    if not raw_source:
        raise SystemExit(
            "품셈 파일 경로를 지정한다.\n"
            "  환경변수:  AVCPQ_PUMSEM_XLSX=<경로>\n"
            "  또는 인자:  --source <경로>"
        )
    source = Path(raw_source)
    if not source.exists():
        raise SystemExit(f"원본을 찾을 수 없다: {source}")

    extract(source, Path(destination_arg or ".local/raw/catalog-raw.json"))


if __name__ == "__main__":
    main()
