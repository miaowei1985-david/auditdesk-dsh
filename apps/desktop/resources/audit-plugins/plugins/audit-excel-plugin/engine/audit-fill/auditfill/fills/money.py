"""货币资金 明细表 → 审定表 filling.

The template's 货币资金审定表 has no data-entry cells: every figure is a
formula pulling from 货币资金明细表.  So the fill target is the detail sheet,
one line per bank account / cash box, and the audit sheet is verified by
recalculation.

Column semantics are read from the sheet header instead of being hard-coded:
    期初余额 原币金额 / 汇率 / 本位币金额
    期末余额(调整前) 原币金额 / 汇率 / 本位币金额
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..template import Template
from ..tb import TB, Account

SECTION_KEYS = [("现金", "1001"), ("银行存款", "1002"), ("其他货币资金", "1012")]
NUM_RE = re.compile(r"^[0-9]{1,3}$")


@dataclass
class Section:
    name: str
    code: str
    header_row: int
    data_rows: list[int]
    cols: dict[str, int]


def _norm(v) -> str:
    return str(v).replace(" ", "").replace("\u3000", "").strip() if v is not None else ""


def _col_letters(ws, rows: list[int], max_col: int = 20) -> dict[int, str]:
    """merge-aware header text per column over the given rows."""
    import openpyxl

    texts = {}
    for r in rows:
        last = ""
        for c in range(1, max_col + 1):
            t = _norm(ws.cell(r, c).value)
            if t:
                last = t
            elif last and any(k in last for k in ("期初", "期末", "余额", "汇率", "原币")):
                t = last
            if t:
                texts[c] = (texts.get(c, "") + "|" + t).strip("|")
    return texts


def detect_sections(tpl: Template, sheet: str = "货币资金明细表") -> list[Section]:
    ws = tpl.sheet(sheet)
    heads = []
    for r in range(1, ws.max_row + 1):
        a = _norm(ws.cell(r, 1).value)
        b = _norm(ws.cell(r, 2).value)
        joined = a + b
        for name, code in SECTION_KEYS:
            if joined.startswith(name) and ("序号" in joined or "项目" in joined):
                heads.append((r, name, code))
    sections = []
    canon_cols = None
    for i, (r0, name, code) in enumerate(heads):
        r_end = heads[i + 1][0] if i + 1 < len(heads) else ws.max_row + 1
        rows = []
        for r in range(r0 + 1, r_end):
            a = _norm(ws.cell(r, 1).value)
            if "小计" in a or "合计" in a:
                break
            if NUM_RE.match(a):
                rows.append(r)
        texts = _col_letters(ws, [r0, r0 + 1, r0 + 2])
        cols = _resolve_cols(texts)
        # all sections share one 12-column layout; the 银行存款 block is the
        # canonical one (其他货币资金 has a merged 期末余额 label that misleads
        # the header-based resolution).
        if code == "1002" or canon_cols is None:
            canon_cols = cols
        sections.append(Section(name=name, code=code, header_row=r0, data_rows=rows,
                                cols=canon_cols if code == "1012" else cols))
    return sections


def _resolve_cols(texts: dict[int, str]) -> dict[str, int]:
    cols: dict[str, int] = {}
    for c, t in texts.items():
        if "期初" in t and "原币" in t:
            cols.setdefault("begin_orig", c)
        if "期初" in t and "汇率" in t:
            cols.setdefault("begin_rate", c)
        if "期初" in t and "本位币" in t:
            cols.setdefault("begin_base", c)
        if "期末" in t and "原币" in t:
            cols.setdefault("end_orig", c)
        if "期末" in t and "汇率" in t:
            cols.setdefault("end_rate", c)
        if "期末" in t and "本位币" in t:
            cols.setdefault("end_base", c)
        if "开户银行" in t or t == "项目":
            cols.setdefault("name", c)
        if "账号" in t:
            cols.setdefault("account", c)
        if "币种" in t:
            cols.setdefault("currency", c)
    return cols


def _pick_accounts(tb: TB, code: str) -> list[Account]:
    """Leaf accounts under a canonical subject (one line per bank account)."""
    pool = [a for a in tb.accounts if a.std == code]
    if not pool:
        return []
    leaves = [a for a in pool
              if not any(b is not a and b.key.startswith(a.key) and b.key != a.key for b in pool)]
    if leaves:
        return sorted(leaves, key=lambda a: (a.key, a.name))
    return sorted(pool, key=lambda a: a.key)


def fill_money(tpl: Template, tb: TB, *, sheet: str = "货币资金明细表",
               note: str = "") -> dict:
    """Write one line per sub-account; return a plan/quality summary."""
    sections = detect_sections(tpl, sheet)
    if not sections:
        return {"ok": False, "reason": "明细表结构未识别"}
    summary = {"ok": True, "sections": [], "warnings": [], "cells": 0}
    for sec in sections:
        accts = _pick_accounts(tb, sec.code)
        rows = sec.data_rows
        s = {"section": sec.name, "code": sec.code, "accounts": len(accts),
             "rows": len(rows), "filled": 0, "begin": 0.0, "end": 0.0}
        if not rows:
            summary["warnings"].append(f"{sec.name}: 无可用数据行")
            continue
        if len(accts) > len(rows):
            summary["warnings"].append(
                f"{sec.name}: 账户 {len(accts)} 个超过模板行 {len(rows)}，超出部分并入最后一行")
        # aggregate overflow into the last row
        buckets: list[list[Account]] = [[] for _ in rows]
        for i, a in enumerate(accts):
            buckets[min(i, len(rows) - 1)].append(a)
        for row, group in zip(rows, buckets):
            if not group:
                continue
            begin = sum(a.begin for a in group)
            end = sum(a.end for a in group)
            s["begin"] += begin
            s["end"] += end
            name = group[0].name if len(group) == 1 else " / ".join(a.name for a in group[:3])
            cols = sec.cols
            def put(col_key, value, basis):
                c = cols.get(col_key)
                if not c:
                    return
                letter = _letter(c)
                tpl.put(sheet, f"{letter}{row}", value, basis, "data")
                summary["cells"] += 1
            put("name", name, f"TB {group[0].code} 科目名称")
            if re.search(r"美元|欧元|日元|港币|英镑|外币", name):
                summary["warnings"].append(
                    f"{name}: 外币账户暂按本位币列示（汇率=1），原币/汇率需复核")
            put("currency", "人民币", "模板默认本位币")
            put("begin_orig", round(begin, 2), f"TB {','.join(a.code for a in group)} 期初余额")
            put("begin_rate", 1, "原币=本位币（TB 未提供原币/汇率）")
            put("end_orig", round(end, 2), f"TB {','.join(a.code for a in group)} 期末余额")
            put("end_rate", 1, "原币=本位币（TB 未提供原币/汇率）")
            s["filled"] += 1
            s["basis"] = note
        summary["sections"].append(s)
    return summary


def _letter(c: int) -> str:
    s = ""
    while c:
        c, r = divmod(c - 1, 26)
        s = chr(65 + r) + s
    return s


def expected_totals(tb: TB) -> dict:
    """What the recalculated 审定表 should show (TB side of the tieout)."""
    out = {}
    for name, code in SECTION_KEYS:
        parent = tb.by_code(code)
        out[name] = {"begin": parent.begin if parent else 0.0,
                     "end": parent.end if parent else 0.0}
    out["合计"] = {"begin": sum(v["begin"] for k, v in out.items()),
                   "end": sum(v["end"] for k, v in out.items())}
    return out
