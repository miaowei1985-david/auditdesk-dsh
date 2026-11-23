"""凭证 / 序时账解析与月度汇总。

客户给的凭证明细有三种常见形态：
  1) 制单日期 / 凭证字号 / 摘要 / 科目编码 / 科目名称 / 辅助项 / 借方(本币) / 贷方(本币)
  2) 日期 / 凭证号数 / 科目编码 / 科目名称 / 摘要 / 方向 / 金额
  3) 用友导出单据头+单据体摊平在同一行（中天），需按列名定位
统一成 Entry 列表后，按科目取发生额单边（收入=贷方、成本费用=借方）。
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime

from .reader import load_grid
from .tb import to_number


@dataclass
class Entry:
    date: str
    month: int
    vno: str
    code: str
    name: str
    summary: str
    debit: float
    credit: float


def _n(v) -> str:
    return re.sub(r"[\s\u3000]+", "", str(v or ""))


def _month(v) -> int:
    if isinstance(v, (datetime, date)):
        return v.month
    s = str(v or "")
    m = re.search(r"(\d{4})[-/.年](\d{1,2})", s)
    if m:
        return int(m.group(2))
    m = re.search(r"^\s*(\d{1,2})\s*月", s)
    return int(m.group(1)) if m else 0


def _header(g) -> tuple[int, dict[str, int]]:
    for r in range(min(g.nrows, 12)):
        texts = [_n(g.cell(r, c)) for c in range(g.ncols)]
        joined = "|".join(texts)
        if ("科目编码" in joined or "科目代码" in joined) and ("借方" in joined or "方向" in joined):
            cols = {}
            for c, t in enumerate(texts):
                if not t:
                    continue
                if ("日期" in t or "制单" in t) and "date" not in cols:
                    cols["date"] = c
                elif "凭证" in t and ("号" in t or "字" in t) and "vno" not in cols:
                    cols["vno"] = c
                elif "科目编码" in t or "科目代码" in t:
                    cols.setdefault("code", c)
                elif "科目名称" in t or ("科目" in t and "名称" in t):
                    cols.setdefault("name", c)
                elif "摘要" in t:
                    cols.setdefault("summary", c)
                elif "借方" in t:
                    cols.setdefault("debit", c)
                elif "贷方" in t:
                    cols.setdefault("credit", c)
                elif "方向" in t:
                    cols.setdefault("direction", c)
                elif t == "金额" or t == "本币" or "金额" in t:
                    cols.setdefault("amount", c)
            return r, cols
    raise ValueError("voucher header not found")


def parse_vouchers(path: str, sheet: str | None = None) -> list[Entry]:
    g = load_grid(path, sheet)
    h, cols = _header(g)
    entries: list[Entry] = []
    for r in range(h + 1, g.nrows):
        code = g.text(r, cols["code"]) if "code" in cols else ""
        if not re.match(r"^[A-Za-z]{0,2}\d", code):
            continue
        d = g.text(r, cols["date"]) if "date" in cols else ""
        vno = g.text(r, cols["vno"]) if "vno" in cols else ""
        name = g.text(r, cols["name"]) if "name" in cols else ""
        summary = g.text(r, cols["summary"]) if "summary" in cols else ""
        if "debit" in cols or "credit" in cols:
            debit = to_number(g.cell(r, cols["debit"])) or 0.0 if "debit" in cols else 0.0
            credit = to_number(g.cell(r, cols["credit"])) or 0.0 if "credit" in cols else 0.0
        else:
            direction = g.text(r, cols.get("direction", 0))
            amount = to_number(g.cell(r, cols["amount"])) or 0.0 if "amount" in cols else 0.0
            debit, credit = (amount, 0.0) if "借" in direction else (0.0, amount)
        entries.append(Entry(date=d, month=_month(d), vno=vno, code=code, name=name,
                             summary=summary, debit=debit, credit=credit))
    return entries


def monthly_by_std(entries: list[Entry], std: str, *, revenue: bool) -> dict[int, float]:
    """Month -> gross P&L flow for accounts mapping to a standard subject.

    科目编码体系因客户而异（6001/5001/…），所以按科目名称+编码解析成标准科目再比。
    """
    from . import chart

    out: dict[int, float] = {}
    for e in entries:
        if chart.resolve(e.code, e.name) != std:
            continue
        out[e.month] = out.get(e.month, 0.0) + (e.credit if revenue else e.debit)
    return dict(sorted(out.items()))


def summarize_4104(entries: list[Entry]) -> dict:
    """利润分配方向的摘要归类（提取盈余公积 / 分配股利 / 其他）。"""
    out = {"提取盈余公积": 0.0, "分配股利": 0.0, "其他": 0.0, "samples": []}
    from . import chart

    for e in entries:
        if chart.resolve(e.code, e.name) != "4104":
            continue
        amt = e.debit  # 借方=减少未分配利润
        if not amt:
            continue
        s = e.summary
        if "盈余公积" in s:
            out["提取盈余公积"] += amt
        elif any(k in s for k in ("股利", "分红", "利润分配")):
            out["分配股利"] += amt
        else:
            out["其他"] += amt
        if len(out["samples"]) < 10:
            out["samples"].append((e.date, s, amt))
    return out
