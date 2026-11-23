"""损益类底稿填充（收入、成本、税金及附加、期间费用、所得税）。

要点：损益科目在年度结转后借贷两边相等（结转分录把余额转平），
所以金额不能取「借−贷」，而要取发生额的单边：
    收入类 = 贷方发生额；成本费用类 = 借方发生额。
否则所有损益都会填成 0。
"""
from __future__ import annotations

import re

from ..tb import TB, Account
from ..template import Template

REVENUE_STDS = {"6001", "6051", "6301", "6111"}
COST_STDS = {"6401", "6402", "6403", "6601", "6602", "6603", "6801", "6711"}


def _n(v) -> str:
    return re.sub(r"[\s\u3000]+", "", str(v or ""))


def _letter(c: int) -> str:
    s = ""
    while c:
        c, r = divmod(c - 1, 26)
        s = chr(65 + r) + s
    return s


def leaves(tb: TB, std: str) -> list[Account]:
    pool = [a for a in tb.accounts if a.std == std]
    if not pool:
        return []
    out = [a for a in pool if not any(b is not a and b.key.startswith(a.key) for b in pool)]
    return out or pool


INCOME_HINTS = ("收入", "收益", "利得", "补贴", "利息收入")


def pl_amount(a: Account, *, revenue: bool) -> float:
    """Gross side of the P&L flow.

    Closing entries make debit == credit on every P&L account, so netting gives
    zero.  Take the side in the account's natural direction; income-like
    accounts inside an expense subject (利息收入/汇兑收益) reduce the expense.
    """
    if revenue:
        return a.credit
    if any(k in a.name for k in INCOME_HINTS):
        # 利息收入 etc. reduce the expense; ERP exports sometimes carry the
        # amount as a red-letter negative, so use the absolute value.
        return -abs(a.credit)
    return a.debit


def revenue_total(tb: TB, std: str) -> float:
    return round(sum(pl_amount(a, revenue=True) for a in leaves(tb, std)), 2)


def cost_total(tb: TB, std: str) -> float:
    return round(sum(pl_amount(a, revenue=False) for a in leaves(tb, std)), 2)


def fill_revenue_cost(tpl: Template, tb: TB, *, sheet: str = "营业收入明细表") -> dict:
    ws = tpl.sheet(sheet)
    # header: A5 项目, B 本期数/收入, E 成本, rows: 主营小计 9, items 10-15, 其他小计 16, items 17+
    main_total = other_total = None
    for r in range(1, ws.max_row + 1):
        t = _n(ws.cell(r, 1).value)
        if t.startswith("一、主营业务小计"):
            main_total = r
        elif t.startswith("二、其他业务小计"):
            other_total = r
    rows_main = list(range(main_total + 1, other_total)) if (main_total and other_total) else []
    rows_other = list(range(other_total + 1, (other_total or ws.max_row) + 8)) if other_total else []
    # stop the other section at the first row that is a note/total
    rows_other = [r for r in rows_other if not _n(ws.cell(r, 1).value).startswith(("合计", "注释", "编制"))]

    summary = {"ok": True, "cells": 0, "warnings": []}
    main_rev = leaves(tb, "6001")
    main_cost = leaves(tb, "6401")
    other_rev = leaves(tb, "6051")
    other_cost = leaves(tb, "6402")

    def put_rows(rows, accounts, col, revenue):
        if not rows:
            return
        if not accounts:
            return
        groups = [accounts[i::len(rows)] for i in range(len(rows))] if len(accounts) <= len(rows) \
            else [[a] for a in accounts]
        for row, group in zip(rows, groups[:len(rows)]):
            if not group:
                continue
            amt = sum(pl_amount(a, revenue=revenue) for a in group)
            tpl.put(sheet, f"{col}{row}", round(amt, 2),
                    "TB " + ",".join(a.code for a in group) + (" 贷方发生" if revenue else " 借方发生"))
            summary["cells"] += 1
            if len(accounts) > len(rows):
                summary["warnings"].append(f"{col}列 {len(accounts)} 个明细超过模板 {len(rows)} 行")

    put_rows(rows_main, main_rev, "B", True)
    put_rows(rows_main, main_cost, "E", False)
    put_rows(rows_other, other_rev, "B", True)
    put_rows(rows_other, other_cost, "E", False)

    summary["rev"] = revenue_total(tb, "6001") + revenue_total(tb, "6051")
    summary["cost"] = cost_total(tb, "6401") + cost_total(tb, "6402")
    return summary


def fill_tax_surcharge(tpl: Template, tb: TB, *, sheet: str = "税金及附加审定表") -> dict:
    ws = tpl.sheet(sheet)
    accts = leaves(tb, "6403")
    total = sum(pl_amount(a, revenue=False) for a in accts)
    r_total = next((r for r in range(1, ws.max_row + 1) if _n(ws.cell(r, 1).value) == "合计"), None)
    rows = []
    for r in range(1, (r_total or ws.max_row)):
        t = _n(ws.cell(r, 1).value)
        if t and r > 6:
            rows.append((r, t))
    summary = {"ok": True, "cells": 0, "warnings": [], "tb": round(total, 2)}
    if not accts:
        return summary
    if len(accts) == 1 and rows:
        a = accts[0]
        hit = next((r for r, t in rows if t in a.name or a.name.endswith(t)), None)
        r = hit or rows[-1][0]
        label = dict(rows).get(r, "")
        tpl.put(sheet, f"B{r}", round(total, 2), "TB 6403 借方发生")
        summary["cells"] += 1
        summary["filled"] = {label: round(total, 2)}
        return summary
    # 多税种：按子科目名称匹配行
    for a in accts:
        hit = next((r for r, t in rows if t in a.name or a.name.endswith(t)), None)
        if hit is None:
            hit = next((r for r, t in rows if t in ("其他", "其他税费")), None)
        if hit is None:
            summary["warnings"].append(f"{a.name} 无对应行")
            continue
        amt = pl_amount(a, revenue=False)
        tpl.put(sheet, f"B{hit}", round(amt, 2), f"TB {a.code} 借方发生")
        summary["cells"] += 1
    return summary


def fill_expenses(tpl: Template, tb: TB, *, sheet: str, std: str) -> dict:
    ws = tpl.sheet(sheet)
    # label rows: A column text after the sub-header rows, until 合计/注释
    labels: list[tuple[int, str]] = []
    for r in range(7, ws.max_row + 1):
        t = _n(ws.cell(r, 1).value)
        if t in ("合计", "总计") or "注释" in t or "编制说明" in t:
            break
        if not t:
            continue
        if t.startswith("其中"):
            continue
        labels.append((r, t))
    if not labels:
        return {"ok": False, "reason": "费用表无明细行"}

    accts = leaves(tb, std)
    summary = {"ok": True, "cells": 0, "warnings": [], "rows": []}
    other_row = next((r for r, t in labels if t in ("其他", "……", "其他费用")), None)
    used = set()
    for a in accts:
        amt = pl_amount(a, revenue=False)
        if abs(amt) < 0.005:
            continue
        # longest template label contained in the account name
        cands = [(r, t) for r, t in labels if t in a.name or a.name.endswith(t)]
        cands.sort(key=lambda x: -len(x[1]))
        if cands:
            r, t = cands[0]
        elif other_row:
            r, t = other_row, "其他"
        else:
            summary["warnings"].append(f"{a.name} 无对应行，未填 ({amt:,.2f})")
            continue
        old = ws.cell(r, 2).value
        base = old if isinstance(old, (int, float)) else 0
        tpl.put(sheet, f"B{r}", round(base + amt, 2), f"TB {a.code} 借方发生")
        used.add(a.code)
        summary["cells"] += 1
    summary["tb_total"] = round(sum(pl_amount(a, revenue=False) for a in accts), 2)
    return summary


def fill_income_tax(tpl: Template, tb: TB, *, sheet: str = "所得税费用审定表") -> dict:
    ws = tpl.sheet(sheet)
    accts = leaves(tb, "6801")
    summary = {"ok": True, "cells": 0, "warnings": [], "tb_total": cost_total(tb, "6801")}
    if not accts:
        return summary
    rows = {}
    for r in range(1, ws.max_row + 1):
        t = _n(ws.cell(r, 1).value)
        if t in ("当期所得税费用", "递延所得税费用", "其他"):
            rows[t] = r
    for a in accts:
        amt = pl_amount(a, revenue=False)
        if "递延" in a.name:
            r = rows.get("递延所得税费用")
        elif "当期" in a.name or "汇算" in a.name:
            r = rows.get("当期所得税费用")
        else:
            r = rows.get("其他")
        if not r:
            summary["warnings"].append(f"{a.name} 无对应行")
            continue
        old = ws.cell(r, 2).value
        base = old if isinstance(old, (int, float)) else 0
        tpl.put(sheet, f"B{r}", round(base + amt, 2), f"TB {a.code} 借方发生")
        summary["cells"] += 1
    return summary


def fill_nonop(tpl: Template, tb: TB, *, sheet: str, std: str, revenue: bool) -> dict:
    """营业外收入/支出：没有明细分项时统一进「其他」行。"""
    ws = tpl.sheet(sheet)
    total = revenue_total(tb, std) if revenue else cost_total(tb, std)
    summary = {"ok": True, "cells": 0, "tb": round(total, 2)}
    if abs(total) < 0.005:
        return summary
    other = None
    for r in range(7, ws.max_row + 1):
        t = _n(ws.cell(r, 1).value)
        if t in ("其他", "其他收入", "其他支出"):
            other = r
            break
        if t == "合计":
            break
    if other is None:
        summary["warnings"] = ["未找到「其他」行"]
        return summary
    tpl.put(sheet, f"B{other}", round(total, 2), f"TB {std} 发生额（未取得明细，暂列其他）")
    summary["cells"] += 1
    summary["row"] = other
    return summary
