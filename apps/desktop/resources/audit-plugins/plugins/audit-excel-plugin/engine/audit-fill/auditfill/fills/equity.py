"""权益类底稿填充：实收资本、资本公积、盈余公积。

这三张表的审定表都是「明细表 → SUMIF/单元格引用」，所以填明细表：
  实收资本明细表  股东名称 / 资本性质 / 期初本币 / 本年变动
  资本公积明细表  期初 / 借方 / 贷方
  盈余公积明细表  期初 / 借方 / 贷方
没有股东性质资料时，资本性质暂列「私营资本」并在备注写明假设；
没有明细分类时，资本公积/盈余公积统一进「其他」行，同样备注。
"""
from __future__ import annotations

import re

from ..tb import TB, Account
from ..template import Template

NOTE_NATURE = "未取得股东性质资料，暂列私营资本（待核实）"
NOTE_OTHER = "未取得明细分类，暂列「其他」"


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


def _clean(name: str) -> str:
    t = str(name or "")
    for sep in ("_", "-"):
        if sep in t:
            head, _, tail = t.partition(sep)
            if len(head) <= 6 and tail:
                t = tail
    return t.strip("_- ")


def fill_paid_in(tpl: Template, tb: TB, *, sheet: str = "实收资本明细表") -> dict:
    ws = tpl.sheet(sheet)
    hdr = next((r for r in range(1, 15) if _n(ws.cell(r, 1).value) == "股东名称"), None)
    if hdr is None:
        return {"ok": False, "reason": "实收资本明细表未找到表头"}
    # header block spans 2-3 rows (期末余额/调整前/原币…): data starts after the
    # last sub-header row, otherwise the first write lands in a merged header.
    start = hdr + 1
    for r in range(hdr + 1, min(hdr + 5, ws.max_row) + 1):
        subs = [_n(ws.cell(r, c).value) for c in range(1, min(ws.max_column, 14) + 1)]
        if any(t in ("调整前", "审计调整", "调整后", "原币", "本币") for t in subs):
            start = r + 1
    rows = []
    for r in range(start, ws.max_row + 1):
        if "合计" in _n(ws.cell(r, 1).value):
            break
        rows.append(r)
    accts = leaves(tb, "4001")
    summary = {"ok": True, "cells": 0, "warnings": [], "count": len(accts)}
    if not accts:
        summary["warnings"].append("TB 无实收资本余额")
        return summary
    if len(accts) > len(rows):
        summary["warnings"].append(f"股东 {len(accts)} 个超过模板行 {len(rows)}")
    for i, a in enumerate(accts):
        if i >= len(rows):
            break
        r = rows[i]
        # 权益类贷方为正，TB 为借方正，符号取反
        change = -(a.end - a.begin)
        tpl.put(sheet, f"A{r}", _clean(a.name), f"TB {a.code} 股东名称")
        nature = ("国家资本" if any(k in a.name for k in ("国家", "国有"))
                  else "外商资本" if any(k in a.name for k in ("外商", "外资", "香港", "台湾"))
                  else "集体资本" if "集体" in a.name else "私营资本")
        tpl.put(sheet, f"B{r}", nature, NOTE_NATURE)
        tpl.put(sheet, f"E{r}", "人民币", "本位币")
        tpl.put(sheet, f"F{r}", round(-a.begin, 2), f"TB {a.code} 期初原币")
        tpl.put(sheet, f"G{r}", round(-a.begin, 2), f"TB {a.code} 期初本币")
        tpl.put(sheet, f"H{r}", round(change, 2), f"TB {a.code} 本年变动原币")
        tpl.put(sheet, f"I{r}", round(change, 2), f"TB {a.code} 本年变动本币")
        summary["cells"] += 5
    summary["tb_end"] = round(sum(a.end for a in accts), 2)
    return summary


def fill_reserve(tpl: Template, tb: TB, *, std: str, sheet: str,
                 target_label: str = "其他") -> dict:
    ws = tpl.sheet(sheet)
    accts = leaves(tb, std)
    summary = {"ok": True, "cells": 0, "warnings": [], "tb_end": round(sum(a.end for a in accts), 2)}
    if not accts:
        return summary
    # locate target row
    target = None
    for r in range(6, ws.max_row + 1):
        t = _n(ws.cell(r, 1).value)
        if t == target_label or (target_label == "其他" and t.startswith("其他")):
            target = r
            break
    if target is None:
        summary["warnings"].append(f"未找到「{target_label}」行")
        return summary
    begin = sum(a.begin for a in accts)
    debit = sum(a.debit for a in accts)
    credit = sum(a.credit for a in accts)
    # 资本公积/盈余公积按贷方为正
    tpl.put(sheet, f"B{target}", round(-begin, 2), f"TB {std} 期初（贷方为正）")
    tpl.put(sheet, f"C{target}", round(debit, 2), f"TB {std} 借方发生")
    tpl.put(sheet, f"D{target}", round(credit, 2), f"TB {std} 贷方发生")
    tpl.put(sheet, f"H{target}" if ws.max_column >= 8 else f"F{target}", NOTE_OTHER, NOTE_OTHER)
    summary["cells"] += 3
    summary["end"] = round(-(begin + debit - credit), 2)
    return summary
