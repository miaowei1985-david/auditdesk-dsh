"""客户辅助核算/对象别汇总表解析（如台湾 ERP 的「对象别汇总表」）。

用于科目余额表只到币种汇总层、没有往来单位明细的客户（安堡罗）。
返回 {科目名称前缀: [(对象名称, 期初, 期末)]}，金额按科目自然方向为正。
"""
from __future__ import annotations

import re

from .reader import load_grid

KEY_SUBJECT = ("科目名称", "科目")
KEY_OBJECT = ("对象别", "单位名称", "客户", "供应商")


def _n(v) -> str:
    return re.sub(r"[\s\u3000]+", "", str(v or ""))


def _num(v) -> float:
    try:
        return float(str(v).replace(",", "")) if v not in (None, "") else 0.0
    except ValueError:
        return 0.0


def parse_dim(path: str, sheet: str | None = None) -> dict[str, list[tuple[str, float, float]]]:
    g = load_grid(path, sheet)
    hdr = None
    for r in range(min(g.nrows, 20)):
        row = [_n(g.cell(r, c)) for c in range(g.ncols)]
        if any(k in "".join(row) for k in KEY_SUBJECT) and any(k in "".join(row) for k in KEY_OBJECT):
            hdr = r
            break
    if hdr is None:
        return {}
    cols = {}
    for c in range(g.ncols):
        t = _n(g.cell(hdr, c))
        if "科目" in t and "名称" in t:
            cols["subject"] = c
        elif any(k in t for k in KEY_OBJECT):
            cols["object"] = c
        elif "期初" in t and "金额" in t:
            cols["begin"] = c
        elif "本期借方" in t:
            cols["debit"] = c
        elif "本期贷方" in t:
            cols["credit"] = c
        elif t in ("借/贷", "借贷", "方向"):
            cols["dir"] = c
    if "subject" not in cols or "object" not in cols:
        return {}
    out: dict[str, list[tuple[str, float, float]]] = {}
    for r in range(hdr + 1, g.nrows):
        subj = g.text(r, cols["subject"])
        obj = g.text(r, cols["object"])
        if not subj or not obj:
            continue
        begin = _num(g.cell(r, cols.get("begin", -1)) if "begin" in cols else 0)
        debit = _num(g.cell(r, cols.get("debit", -1)) if "debit" in cols else 0)
        credit = _num(g.cell(r, cols.get("credit", -1)) if "credit" in cols else 0)
        end = begin + debit - credit
        if abs(begin) < 0.005 and abs(end) < 0.005:
            continue
        out.setdefault(subj, []).append((obj, begin, end))
    return out


def by_prefix(dim: dict, *prefixes: str, sign: float = 1.0) -> list[tuple[str, float, float]]:
    out = []
    for subj, rows in dim.items():
        if any(subj.startswith(p) for p in prefixes):
            out += [(o, sign * b, sign * e) for o, b, e in rows]
    return out
