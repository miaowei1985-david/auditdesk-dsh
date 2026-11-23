"""现金流量表补充资料（J-3）间接法验算。

模板 J 工作簿原为 .xls，已用 LibreOffice 转成 templates/J_cashflow.xlsx。
J-3 的 D 列是输入，D38 = SUM(D10:D37)。这里按 TB 计算主要调节项，
再用「间接法净额 ≈ 直接法经营活动净额」自校验。
"""
from __future__ import annotations

import re

from ..tb import TB
from ..template import Template

ROWS = {
    "净利润": 10, "减值": 11, "折旧": 12, "无形摊销": 14, "长期待摊摊销": 15,
    "待摊费用": 16, "预提费用": 17, "处置损失": 18, "报废损失": 20,
    "财务费用": 22, "投资损失": 24, "递延税款": 25, "存货减少": 26,
    "经营性应收": 28, "经营性应付": 35, "非经营性应付": 36, "其他": 37,
}
AR = ("1122", "1121", "1123", "1221")
AP = ("2202", "2203", "2211", "2221", "2241", "2231")
INV = ("1401", "1402", "1403", "1404", "1405", "1406", "1408", "1411")


def _n(v) -> str:
    return re.sub(r"[\s\u3000]+", "", str(v or ""))


def _sum(tb: TB, std: str, field: str) -> float:
    return sum(getattr(a, field) for a in tb.accounts
               if a.std == std and not (a.parent and a.parent in {b.code for b in tb.accounts if b.std == std}))


def _std(tb: TB, std: str, field: str) -> float:
    return sum(getattr(a, field) for a in tb.by_std(std))


def _depreciation(tb: TB) -> float:
    total = 0.0
    for a in tb.accounts:
        if "折旧" in a.name and a.std in ("6601", "6602", "6603", "5001", "5101"):
            total += a.debit
    return total


def fill_cashflow_supp(tpl: Template, tb: TB, client: str, *, pl_net: float,
                       direct_operating: float | None = None) -> dict:
    for sh in ("J-1", "J-2", "J-3"):
        try:
            ws = tpl.sheet(sh)
            if _n(ws["A2"].value).startswith("被审计单位"):
                tpl.put(sh, "C2", client, "客户名称", "header")
        except Exception:
            pass
    ws = tpl.sheet("J-3")

    inv_b = sum(_std(tb, s, "begin") for s in INV)
    inv_e = sum(_std(tb, s, "end") for s in INV)
    ar_b = sum(_std(tb, s, "begin") for s in AR)
    ar_e = sum(_std(tb, s, "end") for s in AR)
    ap_b = -sum(_std(tb, s, "begin") for s in AP)
    ap_e = -sum(_std(tb, s, "end") for s in AP)

    values = {
        10: (pl_net, "损益表净利润"),
        12: (_depreciation(tb), "管理费用/营业费用中的折旧"),
        14: (sum(a.credit for a in tb.accounts if a.std == "1702"), "累计摊销贷方"),
        15: (sum(a.credit for a in tb.accounts if a.std == "1801"), "长期待摊贷方"),
        22: (sum(_std(tb, s, "debit") - _std(tb, s, "credit") for s in ("6603",)), "财务费用净额"),
        24: (-sum(a.credit for a in tb.accounts if a.std == "6111"), "投资收益（损失为正）"),
        26: (round(inv_b - inv_e, 2), "存货期初−期末"),
        28: (round(ar_b - ar_e, 2), "经营性应收期初−期末"),
        35: (round(ap_e - ap_b, 2), "经营性应付期末−期初"),
    }
    summary = {"ok": True, "cells": 0, "items": {}}
    for row, (val, basis) in values.items():
        if abs(val) < 0.005:
            continue
        tpl.put("J-3", f"D{row}", round(val, 2), basis)
        summary["cells"] += 1
    summary["items"] = {k: round(v[0], 2) for k, v in values.items()}
    summary["indirect_net"] = round(sum(v[0] for v in values.values()), 2)
    if direct_operating is not None:
        summary["direct_net"] = round(direct_operating, 2)
        summary["diff"] = round(summary["indirect_net"] - direct_operating, 2)
    return summary
