"""主营业务月度毛利率分析表：用序时账/凭证按月汇总收入与成本。

模板行 8-19 对应 1-12 月，B 列主营业务收入、C 列主营业务成本，
毛利/毛利率是公式。上年数（F/G）没有上年凭证，留空。
"""
from __future__ import annotations

from ..tb import TB
from ..template import Template
from ..vouchers import Entry, monthly_by_std


def fill_monthly(tpl: Template, entries: list[Entry], *,
                 sheet: str = "主营业务月度毛利率分析表") -> dict:
    ws = tpl.sheet(sheet)
    months: dict[int, int] = {}
    for r in range(1, ws.max_row + 1):
        t = str(ws.cell(r, 1).value or "").strip()
        if t.isdigit() and 1 <= int(t) <= 12:
            months[int(t)] = r
    if len(months) < 12:
        return {"ok": False, "reason": f"月份行识别不全: {sorted(months)}"}

    rev = monthly_by_std(entries, "6001", revenue=True)
    cost = monthly_by_std(entries, "6401", revenue=False)
    summary = {"ok": True, "cells": 0, "months": [], "warnings": []}
    for m in range(1, 13):
        r = months[m]
        rv = round(rev.get(m, 0.0), 2)
        cs = round(cost.get(m, 0.0), 2)
        if rv:
            tpl.put(sheet, f"B{r}", rv, f"凭证 {m} 月主营业务收入（贷方）")
            summary["cells"] += 1
        if cs:
            tpl.put(sheet, f"C{r}", cs, f"凭证 {m} 月主营业务成本（借方）")
            summary["cells"] += 1
        summary["months"].append({"month": m, "revenue": rv, "cost": cs})
    summary["total_revenue"] = round(sum(rev.values()), 2)
    summary["total_cost"] = round(sum(cost.values()), 2)
    return summary
