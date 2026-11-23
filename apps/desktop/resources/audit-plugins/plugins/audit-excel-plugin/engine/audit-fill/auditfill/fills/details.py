"""明细表驱动的其余科目：应付职工薪酬、无形资产。

两张表结构相同：分类行 + B 期初 / C 借方 / D 贷方（E=期初+贷−借 是公式），
审定表通过单元格引用汇总。分类靠 TB 子科目名称匹配，匹配不到进「其他」行。
"""
from __future__ import annotations

import re

from ..tb import TB, Account
from ..template import Template


def _n(v) -> str:
    return re.sub(r"[\s\u3000]+", "", str(v or ""))


def _leaves(tb: TB, std: str) -> list[Account]:
    pool = [a for a in tb.accounts if a.std == std]
    if not pool:
        return []
    return [a for a in pool if not any(b is not a and b.key.startswith(a.key) for b in pool)] or pool


def _label_rows(ws, start_marker: str, stop_marker: str) -> tuple[int | None, list[tuple[int, str]]]:
    start = stop = None
    for r in range(1, ws.max_row + 1):
        t = _n(ws.cell(r, 1).value)
        if start is None and t.startswith(start_marker):
            start = r
        elif start is not None and t.startswith(stop_marker):
            stop = r
            break
    if start is None:
        return None, []
    rows = []
    for r in range(start + 1, stop or ws.max_row + 1):
        t = _n(ws.cell(r, 1).value)
        if not t:
            continue
        rows.append((r, t))
    return start, rows


def _match(rows: list[tuple[int, str]], name: str) -> int | None:
    best, best_len = None, 0
    for r, t in rows:
        core = re.sub(r"^[0-9一二三四五六七八九十\.\(\)（）]+", "", t)
        core = core.replace("其中：", "").replace("其中:", "")
        if core and core in name and len(core) > best_len:
            best, best_len = r, len(core)
    return best


def _fill_section(tpl: Template, sheet: str, ws, rows, accounts, *, sign: float = 1.0,
                  other_row: int | None = None) -> dict:
    out = {"cells": 0, "warnings": [], "unmatched": 0.0}
    used = set()
    for a in accounts:
        if abs(a.end - a.begin) < 0.005 and abs(a.end) < 0.005:
            continue
        r = _match(rows, a.name)
        if r is None:
            if other_row:
                r = other_row
            else:
                out["unmatched"] += a.end
                out["warnings"].append(f"{a.name} 无对应行")
                continue
        for col, val in (("B", a.begin * sign), ("C", a.debit), ("D", a.credit)):
            old = ws[f"{col}{r}"].value
            base = old if isinstance(old, (int, float)) else 0
            if abs(val) > 0.004:
                tpl.put(sheet, f"{col}{r}", round(base + val, 2), f"TB {a.code} {col} 列")
                out["cells"] += 1
        used.add(a.code)
    return out


def fill_payroll(tpl: Template, tb: TB, *, sheet: str = "应付职工薪酬明细表") -> dict:
    ws = tpl.sheet(sheet)
    start, rows = _label_rows(ws, "一、短期薪酬", "五、")
    if start is None:
        return {"ok": False, "reason": "应付职工薪酬明细表结构未识别"}
    other = next((r for r, t in rows if t.startswith("其他")), None)
    accounts = _leaves(tb, "2211")
    summary = {"ok": True, "tb_end": round(-sum(a.end for a in accounts), 2)}
    summary.update(_fill_section(tpl, sheet, ws, rows, accounts, sign=-1, other_row=other))
    return summary


def fill_intangible(tpl: Template, tb: TB, *, sheet: str = "无形资产明细表",
                    fs_net: float | None = None) -> dict:
    ws = tpl.sheet(sheet)
    start, rows = _label_rows(ws, "一、原价合计", "二、累计摊销合计")
    start2, rows2 = _label_rows(ws, "二、累计摊销合计", "三、")
    if start is None or start2 is None:
        return {"ok": False, "reason": "无形资产明细表结构未识别"}
    other1 = next((r for r, t in rows if t == "其他"), None)
    cost = _leaves(tb, "1701")
    amort = _leaves(tb, "1702")
    s1 = _fill_section(tpl, sheet, ws, rows, cost, sign=1.0, other_row=other1)
    s2 = _fill_section(tpl, sheet, ws, rows2, amort, sign=-1.0,
                       other_row=(rows2[-1][0] if rows2 else None))
    if not any(a.std == "1702" for a in tb.accounts) and fs_net is not None:
        implied = round(sum(a.end for a in cost) - fs_net, 2)
        if abs(implied) > 0.004 and rows2:
            r = rows2[-1][0]
            tpl.put(sheet, f"B{r}", implied, "报表净额倒推累计摊销（TB 未提供 1702）")
            tpl.put(sheet, f"J{r}", "TB 缺累计摊销科目，按报表净额倒推，待客户补表", "倒推")
            s2["cells"] += 1
            s2["implied_amort"] = implied
    return {"ok": True, "cells": s1["cells"] + s2["cells"],
            "warnings": s1["warnings"] + s2["warnings"],
            "tb_cost": round(sum(a.end for a in cost), 2),
            "tb_amort": round(-sum(a.end for a in amort), 2) + s2.get("implied_amort", 0)}


def fill_dividend(tpl: Template, tb: TB, *, sheet: str = "应付股利明细表") -> dict:
    """应付股利明细表：普通股股利段（9-11 行），超出进「其他」段（15-17 行）。"""
    ws = tpl.sheet(sheet)
    accounts = _leaves(tb, "2231")
    summary = {"ok": True, "cells": 0, "warnings": [],
               "tb_end": round(-sum(a.end for a in accounts), 2)}
    if not accounts:
        return summary
    rows = [9, 10, 11, 15, 16, 17]
    for i, a in enumerate(accounts):
        if i >= len(rows):
            summary["warnings"].append(f"股东 {len(accounts)} 个超过模板行，未填 {a.name}")
            break
        r = rows[i]
        tpl.put(sheet, f"A{r}", re.sub(r"^(应付股利|应付利润)[-_/]?", "", a.name) or a.name,
                f"TB {a.code} 股东")
        tpl.put(sheet, f"B{r}", round(-a.begin, 2), f"TB {a.code} 期初（贷方为正）")
        tpl.put(sheet, f"C{r}", round(a.debit, 2), f"TB {a.code} 借方发生")
        tpl.put(sheet, f"D{r}", round(a.credit, 2), f"TB {a.code} 贷方发生")
        summary["cells"] += 4
    return summary


NOTE_GROUP = "未取得持股比例/投资协议，暂列「联营企业」"
NOTE_LOAN = "未取得借款合同，暂按「信用借款」列示"


def fill_lti(tpl: Template, tb: TB, *, sheet: str = "长期股权投资明细表") -> dict:
    """长期股权投资：无持股比例资料时统一暂列「联营企业」段。"""
    ws = tpl.sheet(sheet)
    accounts = _leaves(tb, "1501")
    summary = {"ok": True, "cells": 0, "warnings": [], "tb_end": round(sum(a.end for a in accounts), 2)}
    if not accounts:
        return summary
    rows = [20, 21, 22, 23]
    for i, a in enumerate(accounts):
        if i >= len(rows):
            summary["warnings"].append(f"投资项目 {len(accounts)} 个超过模板行")
            break
        r = rows[i]
        tpl.put(sheet, f"A{r}", re.sub(r"^(长期股权投资|长期投资)[-_/]?", "", a.name) or a.name,
                f"TB {a.code} 被投资单位")
        tpl.put(sheet, f"G{r}", round(a.begin, 2), f"TB {a.code} 期初账面余额")
        tpl.put(sheet, f"J{r}", round(a.debit, 2), f"TB {a.code} 本期借方")
        tpl.put(sheet, f"L{r}", round(a.credit, 2), f"TB {a.code} 本期贷方")
        summary["cells"] += 4
        if i == 0:
            summary["warnings"].append(NOTE_GROUP)
    return summary


def fill_short_loan(tpl: Template, tb: TB, *, sheet: str = "短期借款明细表（外币格式)") -> dict:
    """短期借款：无借款合同/担保资料时暂按「信用借款」，币种人民币、汇率 1。"""
    ws = tpl.sheet(sheet)
    accounts = _leaves(tb, "2001")
    summary = {"ok": True, "cells": 0, "warnings": [],
               "tb_end": round(-sum(a.end for a in accounts), 2)}
    if not accounts:
        return summary
    rows = list(range(9, 22))
    for i, a in enumerate(accounts):
        if i >= len(rows):
            summary["warnings"].append(f"借款 {len(accounts)} 笔超过模板行")
            break
        r = rows[i]
        begin = -a.begin
        increase = a.credit
        repay = a.debit
        tpl.put(sheet, f"A{r}", re.sub(r"^(短期借款)[-_/]?", "", a.name) or a.name, f"TB {a.code} 贷款银行")
        tpl.put(sheet, f"B{r}", "信用借款", NOTE_LOAN)
        tpl.put(sheet, f"C{r}", "人民币", "本位币")
        tpl.put(sheet, f"H{r}", round(begin, 2), f"TB {a.code} 期初（原币=本位币）")
        tpl.put(sheet, f"I{r}", 1, "汇率 1（未取得外币资料）")
        tpl.put(sheet, f"M{r}", round(increase, 2), f"TB {a.code} 本期增加")
        tpl.put(sheet, f"P{r}", round(repay, 2), f"TB {a.code} 本期归还")
        tpl.put(sheet, f"T{r}", 1, "汇率 1")
        summary["cells"] += 8
        if i == 0:
            summary["warnings"].append(NOTE_LOAN)
    return summary
