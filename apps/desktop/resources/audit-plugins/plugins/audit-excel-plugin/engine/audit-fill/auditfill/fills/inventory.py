"""存货审定表 filling from the trial balance (category totals).

The template's 存货审定表 is already a category roll-up:
    原材料 / 委托加工物资 / 自制半成品及在产品 / 库存商品 / 发出商品 /
    周转材料 / 消耗性生物资产 / 工程施工 / 商品进销差价 / 其他
so it can be filled without an item-level inventory list.  Item-level sheets
(存货明细表、计价测试) still need the client's stock list and are not touched.
"""
from __future__ import annotations

import re

from ..tb import TB
from ..template import Template

ROW_OF_STD = {
    "5401": "工程施工（已完工未结算款）",
    "1403": "原材料",
    "1408": "委托加工物资",
    "5001": "自制半成品及在产品",
    "1405": "库存商品（产成品）",
    "1406": "发出商品",
    "1411": "周转材料（包装物、低值易耗品等）",
}
OTHER_STDS = {"1401", "1402", "1404", "1407", "1409", "1412", "1471", "1421"}


def _n(v) -> str:
    return re.sub(r"[\s\u3000]+", "", str(v or ""))


def _letter(c: int) -> str:
    s = ""
    while c:
        c, r = divmod(c - 1, 26)
        s = chr(65 + r) + s
    return s


def _amount(tb: TB, std: str, field: str) -> float:
    pool = [a for a in tb.accounts if a.std == std]
    if not pool:
        return 0.0
    leaves = [a for a in pool if not any(b is not a and b.key.startswith(a.key) for b in pool)]
    return sum(getattr(a, field) for a in (leaves or pool))


def fill_inventory(tpl: Template, tb: TB, *, sheet: str = "存货审定表") -> dict:
    ws = tpl.sheet(sheet)
    # locate label rows and the 期初/期末 columns
    begin_col = end_col = None
    for r in range(1, 10):
        for c in range(1, 12):
            t = _n(ws.cell(r, c).value)
            if t.startswith("期初数") and begin_col is None:
                begin_col = c
            if t == "调整前" and end_col is None:
                end_col = c
    if begin_col is None or end_col is None:
        return {"ok": False, "reason": "列识别失败"}

    labels = {}
    for r in range(1, ws.max_row + 1):
        t = _n(ws.cell(r, 1).value)
        if not t or t == "合计":
            continue
        labels.setdefault(t, r)

    summary = {"ok": True, "rows": [], "cells": 0, "warnings": []}
    filled = {}
    inv140 = sum(_amount(tb, s, "end") for s in
                 ("1401","1402","1403","1404","1405","1406","1408","1411"))
    for std, label in ROW_OF_STD.items():
        if std == "5401":
            # 合同履约成本只在「存货类科目为 0」时才代表存货；负数为已结转，不能列
            v = _amount(tb, std, "end")
            if abs(inv140) > 0.01 or v <= 0.01:
                continue
        r = labels.get(label)
        if not r:
            if _amount(tb, std, "end"):
                summary["warnings"].append(f"模板无「{label}」行，{std} 未填")
            continue
        begin = _amount(tb, std, "begin")
        end = _amount(tb, std, "end")
        if not begin and not end:
            continue
        tpl.put(sheet, f"{_letter(begin_col)}{r}", round(begin, 2), f"TB {std} 期初")
        tpl.put(sheet, f"{_letter(end_col)}{r}", round(end, 2), f"TB {std} 期末")
        summary["cells"] += 2
        filled[label] = end
        summary["rows"].append({"label": label, "std": std, "begin": round(begin, 2), "end": round(end, 2)})

    # everything else that is inventory but has no dedicated row
    other_begin = other_end = 0.0
    for a in tb.accounts:
        if a.std in OTHER_STDS:
            if not any(b is not a and b.key.startswith(a.key) and b.std == a.std for b in tb.accounts):
                other_begin += a.begin
                other_end += a.end
    if other_begin or other_end:
        r = labels.get("其他")
        if r:
            tpl.put(sheet, f"{_letter(begin_col)}{r}", round(other_begin, 2), "TB 其他存货科目 期初")
            tpl.put(sheet, f"{_letter(end_col)}{r}", round(other_end, 2), "TB 其他存货科目 期末")
            summary["cells"] += 2
            filled["其他"] = other_end
            summary["rows"].append({"label": "其他", "std": "其他", "begin": round(other_begin, 2), "end": round(other_end, 2)})

    total = sum(filled.values())
    summary["calc"] = round(total, 2)
    summary["tb"] = round(sum(_amount(tb, s, "end") for s in ROW_OF_STD) + other_end, 2)
    summary["diff"] = round(total - summary["tb"], 2)
    return summary
