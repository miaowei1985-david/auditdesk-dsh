"""现金流量表（直接法）原型：按凭证把现金收付归类为经营/投资/筹资。

做法：
  1. 现金科目 = 1001/1002/1012；
  2. 逐张凭证算净现金变动 = Σ现金借方 − Σ现金贷方；
  3. 按凭证里非现金科目的性质归类：长期资产→投资，借款/权益→筹资，其余→经营；
  4. 三类合计应与现金净变动一致，作为自校验。
"""
from __future__ import annotations

from collections import defaultdict

from . import chart
from .vouchers import Entry

CASH = {"1001", "1002", "1012"}
INVEST = {"1501", "1503", "1601", "1602", "1603", "1604", "1605", "1701", "1702", "1801", "1811"}
FINANCE = {"2001", "2201", "2501", "2601", "2701", "4001", "4002", "4101", "4103", "4104", "2231"}


def std_lookup(tb=None):
    """科目编码→标准科目；凭证里的银行子户名不带「银行存款」字样时靠这里兜底。"""
    table = {}
    if tb is not None:
        for a in tb.accounts:
            if a.std:
                table[a.code] = a.std

    def resolve(code: str, name: str) -> str:
        if code in table:
            return table[code]
        best = ""
        for c, std in table.items():
            if code.startswith(c) and len(c) > len(best):
                best = c
        if best:
            return table[best]
        return chart.resolve(code, name) or ""
    return resolve


def classify(entries: list[Entry], tb=None) -> dict:
    # 用友导出里同一张凭证的后续行可能不带凭证号/日期，按顺序把空键行归到上一张凭证
    groups: dict[tuple, list[Entry]] = {}
    cur = ("?", "?")
    for e in entries:
        if e.vno or e.date:
            cur = (e.vno, e.date)
            groups.setdefault(cur, [])
        groups.setdefault(cur, []).append(e)

    resolve = std_lookup(tb)
    out = {"operating": 0.0, "investing": 0.0, "financing": 0.0, "details": []}
    for key, rows in groups.items():
        cash_delta = 0.0
        kinds = set()
        for e in rows:
            std = resolve(e.code, e.name)
            if std in CASH:
                cash_delta += e.debit - e.credit
            elif std in INVEST:
                kinds.add("investing")
            elif std in FINANCE:
                kinds.add("financing")
            elif std:
                kinds.add("operating")
        if abs(cash_delta) < 0.005:
            continue
        kind = ("investing" if "investing" in kinds else
                "financing" if "financing" in kinds else "operating")
        out[kind] += cash_delta
        if len(out["details"]) < 8:
            out["details"].append({"vno": key[0], "date": key[1], "amount": round(cash_delta, 2), "kind": kind})
    for k in ("operating", "investing", "financing"):
        out[k] = round(out[k], 2)
    out["net"] = round(out["operating"] + out["investing"] + out["financing"], 2)
    return out


def cash_change(tb) -> float:
    return round(sum(tb.end_std(s) for s in CASH) - sum(tb.begin_std(s) for s in CASH), 2)
