# -*- coding: utf-8 -*-
"""품셈 파일 → 원시 덤프 JSON (결정 문서 D1, 계획 Task 1).

**기계적 덤프다. 판단하지 않는다.** 어느 행이 제품인지, SKU를 어떻게 만들지는
TypeScript 쪽(`src/data/catalog/`)이 정한다. 여기서는 셀을 읽어 옮기기만 한다.
그래야 분류 규칙을 바꿀 때 원본을 다시 열지 않아도 된다.

## 읽지 않는 열 — 구조로 보장한다

| 열 | 내용 | 이유 |
|---|---|---|
| M (13) | 제조사/구매처 | **매입처 정보** (설계서 §8.1, 결정 D1) |
| N (14) | 영업비고 | **매입처 정보** |

이 스크립트에는 13·14 인덱스가 **어디에도 없다.** `READ_COLUMNS`에 없으면 읽히지 않는다.
금지 목록을 따로 두고 거르는 방식이 아니라, 읽을 열만 적는 allowlist다.

그 밖에 읽지 않는 열: F(수량 — 샘플값이라 카탈로그에 무의미),
H~K(금액 수식), O(노무비 메모), S(표준단가 수식 — 우리가 다시 계산한다),
U/W/Y…(직종별 금액 수식).

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
import sys
from datetime import date
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

sys.stdout.reconfigure(encoding="utf-8")

# --- 읽을 열 (allowlist). 13·14는 여기에 없다 ---------------------------------
READ_COLUMNS = {
    "number": 1,            # A 번호
    "name": 2,              # B 품명 (계층 있음 — 분류는 TS가 한다)
    "spec": 3,              # C 규격
    "description": 4,       # D 설명
    "unit": 5,              # E 단위
    "materialUnitPrice": 7, # G 재료비 단가 = 판매단가
    "remark": 12,           # L 비고
    "laborCode": 16,        # P 품셈 코드
    "itemRate": 17,         # Q 품목별 요율
    "surcharge": 18,        # R 할증
}

# --- 직종별 '품' 열. 노임은 col+1의 3행, 직종 이름은 col의 2행 -----------------
TRADE_COLUMNS_COMMON = [20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52]
#                       T   V   X   Z   AB  AD  AF  AH  AJ  AL  AN  AP  AR  AT  AV  AX  AZ
TRADE_COLUMNS_CMS = [64, 66, 68, 70]
#                    BL  BN  BP  BR   — 단위가 M/M이다 (결정 문서 D1)

HEADER_TRADE_ROW = 2
HEADER_UNIT_WAGE_ROW = 3
FIRST_BODY_ROW = 4

# 이 계획의 범위 밖 (결정 문서 D1, 계획 Global Constraints)
SKIP_SHEETS = {
    "LED전광판 계산",        # 숨김
    "단종, 미사용 제품",      # 숨김
    "간접비_DS",             # 발주처 프로파일 — 별도 계획
    "간접비_SDC, SDI",       # 발주처 프로파일 — 별도 계획
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


def read_wage_header(formula_ws, cached_ws, trade_columns):
    """2행 직종 이름 + 3행 단위 + 3행(col+1) 노임."""
    names = {}
    wages = []
    for column in trade_columns:
        name = text_of(formula_ws.cell(row=HEADER_TRADE_ROW, column=column).value)
        if name is None:
            continue
        # 원본에 '통신관련 기능사'처럼 공백이 섞여 있다. 그대로 쓰되 양끝만 정리한다.
        names[column] = name
        unit = text_of(formula_ws.cell(row=HEADER_UNIT_WAGE_ROW, column=column).value)
        amount = decimal_text(
            formula_ws.cell(row=HEADER_UNIT_WAGE_ROW, column=column + 1).value
        )
        if amount is None:
            amount = decimal_text(
                cached_ws.cell(row=HEADER_UNIT_WAGE_ROW, column=column + 1).value
            )
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
        trade_columns = list(TRADE_COLUMNS_COMMON)
        if name == "CMS":
            trade_columns += TRADE_COLUMNS_CMS

        trade_names, wages = read_wage_header(formula_ws, cached_ws, trade_columns)

        rows_out = []
        for row in range(FIRST_BODY_ROW, formula_ws.max_row + 1):
            record = {"row": row}
            empty = True
            for field, column in READ_COLUMNS.items():
                raw = formula_ws.cell(row=row, column=column).value
                if field in ("materialUnitPrice", "itemRate", "surcharge"):
                    cell = read_cell(formula_ws, cached_ws, row, column)
                    value = cell.get("value")
                    if value is not None:
                        record[field] = value
                        empty = False
                    elif "formula" in cell:
                        record[field + "Formula"] = cell["formula"]
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
