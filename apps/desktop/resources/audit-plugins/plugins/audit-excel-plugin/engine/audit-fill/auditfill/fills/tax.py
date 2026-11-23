"""应交税费 明细表 filling (one row per tax type).

Template layout (3流动负债&权益 → 应交税费明细表):
    A 税种 | C 期初余额 | D 审计调整 | E 期初审定(=C+D) | F 已交数
    G 应交数 | H 期末余额(=C+G-F) | I 审计调整 | J(=H+I)
    K 纳税申报表金额 | L 差异(=J-K)

The trial balance gives, per tax sub-account, the opening balance, the debit
movement (payments) and the credit movement (accruals), which map exactly onto
C / F / G.  H then rolls forward to the TB closing balance.
"""
from __future__ import annotations

import re

from ..tb import TB, Account
from ..template import Template

DEFAULT_ROWS = {
    "增值税": ("增值税",),
    "消费税": ("消费税",),
    "营业税": ("营业税",),
    "资源税": ("资源税",),
    "企业所得税": ("企业所得税", "所得税"),
    "城市维护建设税": ("城市维护建设税", "城建税", "维护建设税"),
    "房产税": ("房产税",),
    "土地使用税": ("土地使用税", "城镇土地使用税"),
    "个人所得税": ("个人所得税",),
    "教育费附加": ("教育费附加", "教育附加", "地方教育附加"),
}
TAX_FALLBACK = ("印花税", "车船", "契税", "土地增值税", "耕地占用税", "环境保护税")


def _norm(v) -> str:
    return re.sub(r"[\s\u3000]+", "", str(v or ""))


def _col_map(tpl: Template, sheet: str) -> dict[str, int]:
    """Locate value columns by header text (row 6 area)."""
    ws = tpl.sheet(sheet)
    cols: dict[str, int] = {}
    for r in range(1, 12):
        for c in range(1, min(ws.max_column, 16) + 1):
            t = _norm(ws.cell(r, c).value)
            if not t:
                continue
            if "期初余额" in t and "begin" not in cols:
                cols["begin"] = c
            elif "已交" in t and "paid" not in cols:
                cols["paid"] = c
            elif "应交数" in t and "accrual" not in cols:
                cols["accrual"] = c
            elif t.startswith("审计调整") and "adj_begin" not in cols:
                cols["adj_begin"] = c
            elif t.startswith("审计调整") and "adj_end" not in cols:
                cols["adj_end"] = c
    return cols


def _accounts(tb: TB) -> list[Account]:
    return [a for a in tb.accounts if a.std == "2221"]


def fill_tax(tpl: Template, tb: TB, *, sheet: str = "应交税费明细表") -> dict:
    ws = tpl.sheet(sheet)
    cols = _col_map(tpl, sheet)
    if "begin" not in cols or "paid" not in cols or "accrual" not in cols:
        return {"ok": False, "reason": f"列识别失败: {cols}"}

    rows = []
    for r in range(7, ws.max_row + 1):
        label = _norm(ws.cell(r, 1).value)
        if not label:
            continue
        if label in ("合计", "总计"):
            break
        if label in ("项目",) or "注释" in label:
            continue
        rows.append((r, label))
    if not rows:
        return {"ok": False, "reason": "未找到税种行"}

    pool = _accounts(tb)
    # only leaves, with their ancestor names as context: sub-accounts are named
    # "进项税额" / "销项税额" and only make sense under "应交增值税".
    by_code = {a.code: a for a in pool}
    leaves = [a for a in pool if not any(b is not a and b.key.startswith(a.key) for b in pool)]
    def path_name(a):
        names = [a.name]
        cur = a
        while cur.parent and cur.parent in by_code:
            cur = by_code[cur.parent]
            names.append(cur.name)
        return "/".join(reversed(names))
    accts = [type("A", (), {})() for _ in ()]
    accts = []
    for a in leaves:
        clone = Account(code=a.code, name=a.name, begin=a.begin, debit=a.debit,
                        credit=a.credit, end=a.end, level=a.level, parent=a.parent,
                        std=a.std, extra={**a.extra, "path": path_name(a)})
        accts.append(clone)
    used: set[str] = set()
    summary = {"ok": True, "rows": [], "cells": 0, "warnings": []}
    for r, label in rows:
        keys = DEFAULT_ROWS.get(label)
        if keys is None:
            keys = (label,) + (TAX_FALLBACK if label == "其他税费" else ())
        picked = [a for a in accts if a.code not in used
                  and any(k in a.extra.get("path", a.name) for k in keys)]
        # "所得税" must not swallow 个人所得税
        if label == "企业所得税":
            picked = [a for a in picked if "个人" not in a.extra.get("path", "")]
        if label == "其他税费":
            picked = [a for a in picked if not any(
                any(k in a.extra.get("path", "") for k in v)
                for name, v in DEFAULT_ROWS.items() if name != "其他税费")]
        for a in picked:
            used.add(a.code)
        begin = sum(a.begin for a in picked)
        paid = sum(a.debit for a in picked)
        accrual = sum(a.credit for a in picked)
        end = begin + accrual - paid
        if not picked:
            summary["rows"].append({"row": r, "label": label, "accounts": 0})
            continue
        basis = "TB " + ",".join(a.code for a in picked)
        # liability presentation: the template rolls H = C + 应交 - 已交, i.e.
        # credit-positive.  Our canonical TB is debit-positive, so C is negated
        # and H ends up = -(TB closing balance).
        tpl.put(sheet, f"C{r}", round(-begin, 2), basis + " 期初（贷方为正）")
        tpl.put(sheet, f"D{r}", 0, "未做审计调整")
        tpl.put(sheet, f"F{r}", round(paid, 2), basis + " 借方发生(已交)")
        tpl.put(sheet, f"G{r}", round(accrual, 2), basis + " 贷方发生(应交)")
        tpl.put(sheet, f"I{r}", 0, "未做审计调整")
        summary["cells"] += 5
        summary["rows"].append({"row": r, "label": label, "accounts": len(picked),
                                "begin": round(begin, 2), "paid": round(paid, 2),
                                "accrual": round(accrual, 2), "end": round(end, 2)})

    # 明细行合计与总账可能不一致（部分客户总账行≠子科目合计），差额补进「其他税费」行
    target = round(-tb.end_std("2221"), 2)          # 贷方为正的应交税费
    sum_end = round(sum(x.get("end", 0) for x in summary["rows"]), 2)
    # H = C+G-F = -(begin+accrual-paid) = -end，所以当前合计是 -sum_end
    current_h = round(-sum_end, 2)
    adjust = round(target - current_h, 2)
    # 未解决：模板审定表与明细表的行映射在客户总账≠子科目时无法自动对齐，
    # 差额调整会误伤其他公司，暂不启用，记录差额供复核。
    if False and abs(adjust) > 0.02:
        other = next((r for r in summary["rows"] if "其他" in r["label"]), None)
        if other:
            old_c = tpl.wb[sheet][f"C{other['row']}"].value or 0
            tpl.put(sheet, f"C{other['row']}", round(old_c + adjust, 2), "总账与明细差额调整")
            other["_adjusted"] = True
            summary["warnings"].append(f"总账与明细差 {adjust:,.2f}，调整至「{other['label']}」行")
            summary["_adjust"] = adjust
    tb_end = sum(a.end for a in tb.by_std("2221"))
    tb_begin = sum(a.begin for a in tb.by_std("2221"))
    calc_end = sum(x.get("end", 0) for x in summary["rows"])
    summary["tb"] = {"begin": round(tb_begin, 2), "end": round(tb_end, 2)}
    summary["calc"] = {"end": round(-calc_end, 2)}
    summary["diff"] = round(-calc_end + tb_end, 2)
    return summary
