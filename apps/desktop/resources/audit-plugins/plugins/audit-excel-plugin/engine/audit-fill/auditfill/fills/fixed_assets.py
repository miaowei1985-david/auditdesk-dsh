"""固定资产明细表 filling (category totals from TB 1601/1602/1603).

Without an asset register the categories (房屋/机器/运输/电子/办公...) cannot
be split, so the whole balance goes to the 其他 row and a note says why.  The
审定表 is formula-driven and then reconciles to the statement net book value.
"""
from __future__ import annotations

import re

from ..tb import TB
from ..template import Template

NOTE = "未取得固定资产卡片，暂全额列示「其他」，待补分类明细"


def _n(v) -> str:
    return re.sub(r"[\s\u3000]+", "", str(v or ""))


def _sum_std(tb: TB, std: str, field: str) -> float:
    pool = [a for a in tb.accounts if a.std == std]
    if not pool:
        return 0.0
    leaves = [a for a in pool if not any(b is not a and b.key.startswith(a.key) for b in pool)]
    return sum(getattr(a, field) for a in (leaves or pool))


# 顺序很重要：先匹配具体类别，再匹配宽泛的「机器设备」
CATEGORY_KEYS = [
    ("土地资产", ("土地",)),
    ("房屋、建筑物", ("房屋", "建筑物", "厂房", "装修")),
    ("运输工具", ("运输", "汽车", "车辆", "交通")),
    ("电子设备", ("电子", "电脑", "计算机", "服务器", "网络")),
    ("办公设备", ("办公", "家具", "器具")),
    ("酒店业家具", ("酒店",)),
    ("机器设备", ("机器", "生产设备")),
]


def _category(name: str) -> str:
    for label, keys in CATEGORY_KEYS:
        if any(k in name for k in keys):
            return label
    return "其他"


def _section_rows(ws, start_label: str, stop_label: str) -> dict[str, int]:
    start = None
    for r in range(1, ws.max_row + 1):
        if _n(ws.cell(r, 1).value).startswith(start_label):
            start = r
            break
    if start is None:
        return {}
    out = {}
    for r in range(start + 1, ws.max_row + 1):
        t = _n(ws.cell(r, 1).value)
        if t.startswith(stop_label):
            break
        if not t:
            continue
        if t.startswith("="):
            # 累计折旧段的类别名是公式（=A10），按引用行取标签
            m = re.match(r"^=[A-Z]+(\d+)$", t)
            if m:
                t = _n(ws.cell(int(m.group(1)), 1).value)
        out[t] = r
    return out


def _row(ws, label: str) -> int | None:
    for r in range(1, ws.max_row + 1):
        if _n(ws.cell(r, 1).value) == label:
            return r
    return None


def fill_fixed_assets(tpl: Template, tb: TB, *, sheet: str = "固定资产明细表",
                      fs_net: float | None = None) -> dict:
    ws = tpl.sheet(sheet)
    total_row = _row(ws, "一、原价合计")
    dep_row = _row(ws, "二、累计折旧合计")
    if not total_row or not dep_row:
        return {"ok": False, "reason": "明细表结构未识别"}

    cost = {"begin": _sum_std(tb, "1601", "begin"), "debit": _sum_std(tb, "1601", "debit"),
            "credit": _sum_std(tb, "1601", "credit"), "end": _sum_std(tb, "1601", "end")}
    dep = {"begin": _sum_std(tb, "1602", "begin"), "debit": _sum_std(tb, "1602", "debit"),
           "credit": _sum_std(tb, "1602", "credit"), "end": _sum_std(tb, "1602", "end")}
    imp = {"begin": _sum_std(tb, "1603", "begin"), "debit": _sum_std(tb, "1603", "debit"),
           "credit": _sum_std(tb, "1603", "credit"), "end": _sum_std(tb, "1603", "end")}

    summary = {"ok": True, "cells": 0, "warnings": [], "cost": cost, "dep": dep, "imp": imp}
    cost_rows = _section_rows(ws, "一、原价合计", "二、累计折旧合计")
    dep_rows = _section_rows(ws, "二、累计折旧合计", "三、固定资产减值准备合计")
    if cost_rows and dep_rows:
        # 按类别逐行填（有子科目分类时）
        pool1601 = [a for a in tb.accounts if a.std == "1601"]
        leaves1601 = [a for a in pool1601 if not any(b is not a and b.key.startswith(a.key) for b in pool1601)] or pool1601
        agg = {}
        for a in leaves1601:
            if abs(a.end) > 0.004 or abs(a.debit) + abs(a.credit) > 0.004:
                cat = _category(a.name)
                x = agg.setdefault(cat, {"b": 0.0, "d": 0.0, "c": 0.0})
                x["b"] += a.begin; x["d"] += a.debit; x["c"] += a.credit
        if len(agg) > 1 or next(iter(agg), "") != "其他":
            for cat, x in agg.items():
                r = cost_rows.get(cat) or cost_rows.get("其他")
                if not r:
                    continue
                tpl.put(sheet, f"B{r}", round(x["b"], 2), f"TB 1601 {cat} 期初")
                tpl.put(sheet, f"C{r}", round(x["d"], 2), f"TB 1601 {cat} 借方")
                tpl.put(sheet, f"D{r}", round(x["c"], 2), f"TB 1601 {cat} 贷方")
                summary["cells"] += 3
            pool1602 = [a for a in tb.accounts if a.std == "1602"]
            leaves1602 = [a for a in pool1602 if not any(b is not a and b.key.startswith(a.key) for b in pool1602)] or pool1602
            agg2 = {}
            for a in leaves1602:
                    cat = _category(a.name)
                    y = agg2.setdefault(cat, {"b": 0.0, "d": 0.0, "c": 0.0})
                    y["b"] += a.begin; y["d"] += a.debit; y["c"] += a.credit
            for cat, y in agg2.items():
                r = dep_rows.get(cat) or dep_rows.get("其他")
                if not r:
                    continue
                tpl.put(sheet, f"B{r}", round(-y["b"], 2), f"TB 1602 {cat} 期初（贷方为正）")
                tpl.put(sheet, f"C{r}", round(y["d"], 2), f"TB 1602 {cat} 借方")
                tpl.put(sheet, f"D{r}", round(y["c"], 2), f"TB 1602 {cat} 贷方")
                summary["cells"] += 3
            summary["tb_net"] = round(cost["end"] + dep["end"] + imp["end"], 2)
            return summary
    # 没有分类子科目：全部进「其他」
    r_cost = total_row + 8
    if cost["begin"] or cost["end"] or cost["debit"] or cost["credit"]:
        tpl.put(sheet, f"B{r_cost}", round(cost["begin"], 2), "TB 1601 期初")
        tpl.put(sheet, f"C{r_cost}", round(cost["debit"], 2), "TB 1601 借方发生")
        tpl.put(sheet, f"D{r_cost}", round(cost["credit"], 2), "TB 1601 贷方发生")
        tpl.put(sheet, f"H{r_cost}", NOTE, NOTE)
        summary["cells"] += 3

    r_dep = dep_row + 8
    if dep["begin"] or dep["end"] or dep["debit"] or dep["credit"]:
        tpl.put(sheet, f"B{r_dep}", round(-dep["begin"], 2), "TB 1602 期初（贷方为正）")
        tpl.put(sheet, f"C{r_dep}", round(dep["debit"], 2), "TB 1602 借方发生")
        tpl.put(sheet, f"D{r_dep}", round(dep["credit"], 2), "TB 1602 贷方发生")
        tpl.put(sheet, f"H{r_dep}", NOTE, NOTE)
        summary["cells"] += 3

    # TB 没有 1602 累计折旧时，用报表净额倒推（明确标注依据，不静默补数）
    if not any(a.std == "1602" for a in tb.accounts) and fs_net is not None:
        implied = round(cost["end"] - fs_net, 2)
        if abs(implied) > 0.004:
            r_dep = dep_row + 8
            tpl.put(sheet, f"B{r_dep}", implied, "报表净额倒推累计折旧（TB 未提供 1602）")
            tpl.put(sheet, f"H{r_dep}", "TB 缺累计折旧科目，按报表净额倒推，待客户补表", "倒推")
            summary["cells"] += 1
            summary["implied_dep"] = implied
            summary["tb_net"] = round(fs_net, 2)
    if imp["begin"] or imp["end"]:
        r_imp = (_row(ws, "三、固定资产减值准备合计") or 0) - 1
        if r_imp > 0:
            tpl.put(sheet, f"B{r_imp}", round(-imp["begin"], 2), "TB 1603 期初")
            tpl.put(sheet, f"C{r_imp}", round(imp["debit"], 2), "TB 1603 借方发生")
            tpl.put(sheet, f"D{r_imp}", round(imp["credit"], 2), "TB 1603 贷方发生")
            summary["cells"] += 3

    summary.setdefault("tb_net", round(cost["end"] + dep["end"] + imp["end"], 2))
    return summary


def verify_rows(tpl: Template) -> dict[str, int]:
    """Rows in 固定资产审定表 that carry the totals to recalculate."""
    ws = tpl.sheet("固定资产审定表")
    out = {}
    for r in range(1, ws.max_row + 1):
        t = _n(ws.cell(r, 1).value)
        if t in ("一、固定资产原价合计", "二、累计折旧合计", "三、减值准备合计", "四、账面价值合计"):
            out[t] = r
    return out
